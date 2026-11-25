import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import videoConfig from '../config/video.config';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.constants';
import { StorageUploadIncompleteError } from '../storage/storage.errors';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import {
  FileTooLargeException,
  InvalidPartNumberException,
  InvalidVideoStatusException,
  UploadIncompleteException,
  UploadSizeMismatchException,
  VideoNotFoundException,
  VideoNotReadyException,
} from './videos.exceptions';
import {
  attachmentDisposition,
  titleFromFilename,
  VideosService,
} from './videos.service';

const PART_SIZE = 104857600;
const MAX_SIZE = 10737418240;

const uniqueViolation = (): QueryFailedError => {
  const err = new QueryFailedError('INSERT', [], new Error('duplicate'));
  Object.assign(err, {
    code: '23505',
    detail: 'Key (public_id)=(abc) already exists.',
  });
  return err;
};

describe('VideosService', () => {
  let service: VideosService;
  const videoRepository = {
    create: jest.fn((fields: Partial<Video>) => ({ ...fields }) as Video),
    save: jest.fn<Promise<Video>, [Video]>(),
    findOne: jest.fn<Promise<Video | null>, [unknown]>(),
    update: jest.fn<Promise<{ affected?: number }>, [unknown, unknown]>(),
  };
  const processingQueue = { add: jest.fn() };
  const channelsService = { findByUserId: jest.fn() };
  const storageService = {
    createMultipartUpload: jest.fn(),
    presignUploadPart: jest.fn(),
    listParts: jest.fn(),
    completeMultipartUpload: jest.fn(),
    presignGetObject: jest.fn(),
    headObject: jest.fn(),
    deleteObject: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    channelsService.findByUserId.mockResolvedValue({ id: 'channel-1' });
    storageService.createMultipartUpload.mockResolvedValue('upload-1');
    videoRepository.save.mockImplementation((video: Video) =>
      Promise.resolve(video),
    );

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: ChannelsService, useValue: channelsService },
        { provide: StorageService, useValue: storageService },
        {
          provide: getQueueToken(VIDEO_PROCESSING_QUEUE),
          useValue: processingQueue,
        },
        {
          provide: videoConfig.KEY,
          useValue: {
            maxSizeBytes: MAX_SIZE,
            uploadPartSizeBytes: PART_SIZE,
            uploadUrlTtlSeconds: 900,
            playbackUrlTtlSeconds: 900,
          },
        },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  describe('initUpload', () => {
    const dto = {
      filename: 'holiday.trip.mov',
      fileSize: 3 * PART_SIZE + 1,
      contentType: 'video/quicktime',
    };

    it('should default the title to the filename without its extension', async () => {
      const plan = await service.initUpload('user-1', dto);
      expect(plan.title).toBe('holiday.trip');
    });

    it('should keep an explicit title', async () => {
      const plan = await service.initUpload('user-1', {
        ...dto,
        title: 'Mine',
      });
      expect(plan.title).toBe('Mine');
    });

    it('should compute partCount as ceil(fileSize / partSize)', async () => {
      const plan = await service.initUpload('user-1', dto);
      expect(plan.partSize).toBe(PART_SIZE);
      expect(plan.partCount).toBe(4);
    });

    it('should persist a draft in the user channel with the multipart upload id', async () => {
      await service.initUpload('user-1', dto);

      const saved = videoRepository.save.mock.calls[0][0];
      expect(saved.channel_id).toBe('channel-1');
      expect(saved.status).toBe(VideoStatus.DRAFT);
      expect(saved.upload_id).toBe('upload-1');
      expect(saved.video_key).toBe(`videos/${saved.id}/original`);
      expect(storageService.createMultipartUpload).toHaveBeenCalledWith(
        saved.video_key,
        'video/quicktime',
      );
    });

    it('should throw FileTooLargeException above the cap without touching storage', async () => {
      await expect(
        service.initUpload('user-1', { ...dto, fileSize: MAX_SIZE + 1 }),
      ).rejects.toBeInstanceOf(FileTooLargeException);
      expect(storageService.createMultipartUpload).not.toHaveBeenCalled();
      expect(videoRepository.save).not.toHaveBeenCalled();
    });

    it('should retry with a new public_id after a unique collision', async () => {
      videoRepository.save
        .mockRejectedValueOnce(uniqueViolation())
        .mockImplementationOnce((video: Video) => Promise.resolve(video));

      const plan = await service.initUpload('user-1', dto);

      expect(videoRepository.save).toHaveBeenCalledTimes(2);
      const [first, second] = videoRepository.save.mock.calls.map(
        (c) => c[0].public_id,
      );
      expect(first).not.toBe(second);
      expect(plan.publicId).toBe(second);
    });

    it('should give up after 3 public_id collisions', async () => {
      videoRepository.save.mockRejectedValue(uniqueViolation());

      await expect(service.initUpload('user-1', dto)).rejects.toBeInstanceOf(
        QueryFailedError,
      );
      expect(videoRepository.save).toHaveBeenCalledTimes(3);
    });
  });

  describe('issuePartUrls / listUploadedParts', () => {
    const draft = {
      id: 'video-1',
      public_id: 'abcdefghijk',
      status: VideoStatus.DRAFT,
      video_key: 'videos/video-1/original',
      upload_id: 'upload-1',
      part_count: 3,
    } as Video;

    it('should throw VideoNotFoundException when the video is not owned by the user', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(
        service.issuePartUrls('abcdefghijk', 'other-user', [1]),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
      expect(videoRepository.findOne).toHaveBeenCalledWith({
        where: { public_id: 'abcdefghijk', channel: { user_id: 'other-user' } },
      });
    });

    it('should throw VideoNotFoundException for a malformed publicId without querying', async () => {
      await expect(
        service.issuePartUrls('not-valid', 'user-1', [1]),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
      expect(videoRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw InvalidVideoStatusException outside draft', async () => {
      videoRepository.findOne.mockResolvedValue({
        ...draft,
        status: VideoStatus.PROCESSING,
      } as Video);

      await expect(
        service.issuePartUrls('abcdefghijk', 'user-1', [1]),
      ).rejects.toBeInstanceOf(InvalidVideoStatusException);
      await expect(
        service.listUploadedParts('abcdefghijk', 'user-1'),
      ).rejects.toBeInstanceOf(InvalidVideoStatusException);
    });

    it('should throw InvalidPartNumberException above partCount', async () => {
      videoRepository.findOne.mockResolvedValue(draft);

      await expect(
        service.issuePartUrls('abcdefghijk', 'user-1', [1, 4]),
      ).rejects.toBeInstanceOf(InvalidPartNumberException);
      expect(storageService.presignUploadPart).not.toHaveBeenCalled();
    });

    it('should return one URL per requested part and an expiry', async () => {
      videoRepository.findOne.mockResolvedValue(draft);
      storageService.presignUploadPart.mockImplementation(
        (_key: string, _upload: string, n: number) =>
          Promise.resolve(`https://storage/part-${n}`),
      );

      const result = await service.issuePartUrls(
        'abcdefghijk',
        'user-1',
        [1, 2],
      );

      expect(result.parts).toEqual([
        { partNumber: 1, url: 'https://storage/part-1' },
        { partNumber: 2, url: 'https://storage/part-2' },
      ]);
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('completeUpload', () => {
    const draft = {
      id: 'video-1',
      public_id: 'abcdefghijk',
      status: VideoStatus.DRAFT,
      video_key: 'videos/video-1/original',
      upload_id: 'upload-1',
      size_bytes: '2048',
      part_count: 1,
    } as Video;
    const parts = [{ partNumber: 1, eTag: '"etag-1"' }];

    beforeEach(() => {
      videoRepository.findOne.mockResolvedValue(draft);
      videoRepository.update.mockResolvedValue({ affected: 1 });
      storageService.completeMultipartUpload.mockResolvedValue(undefined);
      storageService.headObject.mockResolvedValue(2048);
    });

    it('should move the video to processing and enqueue the job with jobId = videoId', async () => {
      const result = await service.completeUpload(
        'abcdefghijk',
        'user-1',
        parts,
      );

      expect(result).toEqual({ publicId: 'abcdefghijk', status: 'processing' });
      expect(videoRepository.update).toHaveBeenCalledWith(
        { id: 'video-1', status: VideoStatus.DRAFT },
        { status: VideoStatus.PROCESSING, upload_id: null },
      );
      expect(processingQueue.add).toHaveBeenCalledWith(
        'video.process',
        { videoId: 'video-1' },
        { jobId: 'video-1' },
      );
    });

    it('should throw InvalidVideoStatusException outside draft', async () => {
      videoRepository.findOne.mockResolvedValue({
        ...draft,
        status: VideoStatus.PROCESSING,
      } as Video);

      await expect(
        service.completeUpload('abcdefghijk', 'user-1', parts),
      ).rejects.toBeInstanceOf(InvalidVideoStatusException);
      expect(processingQueue.add).not.toHaveBeenCalled();
    });

    it('should map StorageUploadIncompleteError to UploadIncompleteException', async () => {
      storageService.completeMultipartUpload.mockRejectedValue(
        new StorageUploadIncompleteError('InvalidPart'),
      );

      await expect(
        service.completeUpload('abcdefghijk', 'user-1', parts),
      ).rejects.toBeInstanceOf(UploadIncompleteException);
      expect(videoRepository.update).not.toHaveBeenCalled();
      expect(processingQueue.add).not.toHaveBeenCalled();
    });

    it('should delete the object and mark error on size mismatch', async () => {
      storageService.headObject.mockResolvedValue(1024);

      await expect(
        service.completeUpload('abcdefghijk', 'user-1', parts),
      ).rejects.toBeInstanceOf(UploadSizeMismatchException);
      expect(storageService.deleteObject).toHaveBeenCalledWith(
        'videos/video-1/original',
      );
      expect(videoRepository.update).toHaveBeenCalledWith(
        { id: 'video-1', status: VideoStatus.DRAFT },
        {
          status: VideoStatus.ERROR,
          error_reason: 'UPLOAD_SIZE_MISMATCH',
          upload_id: null,
        },
      );
      expect(processingQueue.add).not.toHaveBeenCalled();
    });

    it('should not enqueue when a concurrent request already moved the video', async () => {
      videoRepository.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.completeUpload('abcdefghijk', 'user-1', parts),
      ).rejects.toBeInstanceOf(InvalidVideoStatusException);
      expect(processingQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('getPlaybackUrl', () => {
    const ready = {
      id: 'video-1',
      public_id: 'abcdefghijk',
      status: VideoStatus.READY,
      original_filename: 'clip.mp4',
      video_key: 'videos/video-1/original',
      thumbnail_key: 'thumbnails/video-1.jpg',
    } as Video;

    beforeEach(() => {
      videoRepository.findOne.mockResolvedValue(ready);
      storageService.presignGetObject.mockResolvedValue('https://signed');
    });

    it.each([VideoStatus.DRAFT, VideoStatus.PROCESSING, VideoStatus.ERROR])(
      'should throw VideoNotReadyException when status is %s',
      async (status) => {
        videoRepository.findOne.mockResolvedValue({
          ...ready,
          status,
        } as Video);

        await expect(
          service.getPlaybackUrl('abcdefghijk', 'user-1', 'stream'),
        ).rejects.toBeInstanceOf(VideoNotReadyException);
        expect(storageService.presignGetObject).not.toHaveBeenCalled();
      },
    );

    it('should sign the original with the public client for streaming', async () => {
      await expect(
        service.getPlaybackUrl('abcdefghijk', 'user-1', 'stream'),
      ).resolves.toBe('https://signed');
      expect(storageService.presignGetObject).toHaveBeenCalledWith(
        'videos/video-1/original',
        { consumer: 'public', disposition: undefined },
      );
    });

    it('should add an attachment disposition with the original filename for download', async () => {
      await service.getPlaybackUrl('abcdefghijk', 'user-1', 'download');
      expect(storageService.presignGetObject).toHaveBeenCalledWith(
        'videos/video-1/original',
        {
          consumer: 'public',
          disposition: attachmentDisposition('clip.mp4'),
        },
      );
    });

    it('should sign the thumbnail key for the thumbnail', async () => {
      await service.getPlaybackUrl('abcdefghijk', 'user-1', 'thumbnail');
      expect(storageService.presignGetObject).toHaveBeenCalledWith(
        'thumbnails/video-1.jpg',
        { consumer: 'public' },
      );
    });
  });

  describe('attachmentDisposition', () => {
    it('should keep ASCII names and add the UTF-8 variant', () => {
      expect(attachmentDisposition('clip.mp4')).toBe(
        `attachment; filename="clip.mp4"; filename*=UTF-8''clip.mp4`,
      );
    });

    it('should replace quotes and non-ASCII characters in the fallback', () => {
      expect(attachmentDisposition('fé "x".mp4')).toBe(
        `attachment; filename="f_ _x_.mp4"; filename*=UTF-8''f%C3%A9%20%22x%22.mp4`,
      );
    });
  });

  describe('titleFromFilename', () => {
    it('should keep names without an extension', () => {
      expect(titleFromFilename('clip')).toBe('clip');
      expect(titleFromFilename('.hidden')).toBe('.hidden');
    });
  });
});
