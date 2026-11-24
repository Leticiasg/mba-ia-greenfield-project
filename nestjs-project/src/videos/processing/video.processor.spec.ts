import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job, UnrecoverableError } from 'bullmq';
import type { VideoProcessJobData } from '../../queue/queue.constants';
import { StorageService } from '../../storage/storage.service';
import { Video, VideoStatus } from '../entities/video.entity';
import { InvalidMediaError, MediaProbeService } from './media-probe.service';
import { thumbnailOffsetSeconds, VideoProcessor } from './video.processor';

const metadata = {
  width: 320,
  height: 240,
  videoCodec: 'h264',
  audioCodec: null,
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  bitRate: 120000,
  frameRate: 25,
  sizeBytes: 30000,
};

const buildJob = (
  overrides: Partial<{ attemptsMade: number; attempts: number }> = {},
): Job<VideoProcessJobData> =>
  ({
    data: { videoId: 'video-1' },
    attemptsMade: overrides.attemptsMade ?? 1,
    opts: { attempts: overrides.attempts ?? 3 },
  }) as unknown as Job<VideoProcessJobData>;

describe('VideoProcessor', () => {
  let processor: VideoProcessor;
  const videoRepository = {
    findOne: jest.fn<Promise<Video | null>, [unknown]>(),
    update: jest.fn<Promise<unknown>, [unknown, unknown]>(),
  };
  const storageService = {
    presignGetObject: jest.fn(),
    putObject: jest.fn(),
  };
  const mediaProbe = { probe: jest.fn(), extractFrame: jest.fn() };

  const processing = {
    id: 'video-1',
    status: VideoStatus.PROCESSING,
    video_key: 'videos/video-1/original',
  } as Video;

  beforeEach(async () => {
    jest.clearAllMocks();
    videoRepository.findOne.mockResolvedValue(processing);
    videoRepository.update.mockResolvedValue({ affected: 1 });
    storageService.presignGetObject.mockResolvedValue('http://minio:9000/x');
    mediaProbe.probe.mockResolvedValue({ durationSeconds: 20, metadata });
    mediaProbe.extractFrame.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));

    const module = await Test.createTestingModule({
      providers: [
        VideoProcessor,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: StorageService, useValue: storageService },
        { provide: MediaProbeService, useValue: mediaProbe },
      ],
    }).compile();

    processor = module.get(VideoProcessor);
  });

  describe('process', () => {
    it('should store the thumbnail and mark the video ready with duration and metadata', async () => {
      await processor.process(buildJob());

      expect(storageService.presignGetObject).toHaveBeenCalledWith(
        'videos/video-1/original',
        { consumer: 'internal' },
      );
      expect(mediaProbe.extractFrame).toHaveBeenCalledWith(
        'http://minio:9000/x',
        2,
      );
      expect(storageService.putObject).toHaveBeenCalledWith(
        'thumbnails/video-1.jpg',
        expect.any(Buffer),
        'image/jpeg',
      );
      expect(videoRepository.update).toHaveBeenCalledWith(
        { id: 'video-1', status: VideoStatus.PROCESSING },
        {
          status: VideoStatus.READY,
          duration_seconds: '20.000',
          metadata,
          thumbnail_key: 'thumbnails/video-1.jpg',
        },
      );
    });

    it('should leave a video that is no longer processing untouched', async () => {
      videoRepository.findOne.mockResolvedValue({
        ...processing,
        status: VideoStatus.READY,
      } as Video);

      await processor.process(buildJob());

      expect(mediaProbe.probe).not.toHaveBeenCalled();
      expect(storageService.putObject).not.toHaveBeenCalled();
      expect(videoRepository.update).not.toHaveBeenCalled();
    });

    it('should skip a video that no longer exists', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(processor.process(buildJob())).resolves.toBeUndefined();
      expect(mediaProbe.probe).not.toHaveBeenCalled();
    });

    it('should throw UnrecoverableError(INVALID_MEDIA) for invalid media', async () => {
      mediaProbe.probe.mockRejectedValue(new InvalidMediaError('no video'));

      await expect(processor.process(buildJob())).rejects.toEqual(
        new UnrecoverableError('INVALID_MEDIA'),
      );
      expect(videoRepository.update).not.toHaveBeenCalled();
    });

    it('should rethrow transient errors so BullMQ retries', async () => {
      const transient = new Error('connect ECONNREFUSED minio:9000');
      mediaProbe.probe.mockRejectedValue(transient);

      await expect(processor.process(buildJob())).rejects.toBe(transient);
    });
  });

  describe('onFailed', () => {
    it('should mark INVALID_MEDIA immediately for UnrecoverableError', async () => {
      await processor.onFailed(
        buildJob({ attemptsMade: 1 }),
        new UnrecoverableError('INVALID_MEDIA'),
      );

      expect(videoRepository.update).toHaveBeenCalledWith(
        { id: 'video-1', status: VideoStatus.PROCESSING },
        { status: VideoStatus.ERROR, error_reason: 'INVALID_MEDIA' },
      );
    });

    it('should do nothing while attempts remain', async () => {
      await processor.onFailed(
        buildJob({ attemptsMade: 2, attempts: 3 }),
        new Error('transient'),
      );

      expect(videoRepository.update).not.toHaveBeenCalled();
    });

    it('should mark PROCESSING_FAILED once attempts are exhausted', async () => {
      await processor.onFailed(
        buildJob({ attemptsMade: 3, attempts: 3 }),
        new Error('transient'),
      );

      expect(videoRepository.update).toHaveBeenCalledWith(
        { id: 'video-1', status: VideoStatus.PROCESSING },
        { status: VideoStatus.ERROR, error_reason: 'PROCESSING_FAILED' },
      );
    });
  });

  describe('thumbnailOffsetSeconds', () => {
    it('should take 10% of the duration', () => {
      expect(thumbnailOffsetSeconds(20)).toBe(2);
    });

    it('should clamp to the end of very short videos', () => {
      expect(thumbnailOffsetSeconds(0.05)).toBe(0);
      expect(thumbnailOffsetSeconds(0.5)).toBeCloseTo(0.05);
    });

    it('should return 0 for unknown or zero duration', () => {
      expect(thumbnailOffsetSeconds(0)).toBe(0);
      expect(thumbnailOffsetSeconds(Number.NaN)).toBe(0);
    });
  });
});
