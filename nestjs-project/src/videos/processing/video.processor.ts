import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, UnrecoverableError } from 'bullmq';
import { Repository } from 'typeorm';
import {
  VIDEO_PROCESSING_QUEUE,
  type VideoProcessJobData,
} from '../../queue/queue.constants';
import { StorageService } from '../../storage/storage.service';
import { Video, VideoStatus } from '../entities/video.entity';
import { VIDEO_STORAGE_KEYS } from '../videos.constants';
import { InvalidMediaError, MediaProbeService } from './media-probe.service';

export const VIDEO_ERROR_REASONS = {
  INVALID_MEDIA: 'INVALID_MEDIA',
  PROCESSING_FAILED: 'PROCESSING_FAILED',
} as const;

const THUMBNAIL_POSITION = 0.1;
const END_MARGIN_SECONDS = 0.1;

/** Frame at 10% of the duration, clamped to [0, duration − ε] (phase-03-videos/TD-08). */
export function thumbnailOffsetSeconds(durationSeconds: number): number {
  if (!(durationSeconds > 0)) return 0;
  const latest = Math.max(0, durationSeconds - END_MARGIN_SECONDS);
  return Math.min(durationSeconds * THUMBNAIL_POSITION, latest);
}

/**
 * Consumes `video.process` in the video-worker container (phase-03-videos/TD-05).
 * Idempotent: only acts on videos still in `processing`, transitions are
 * conditional and the thumbnail key is deterministic (TD-12, TD-09).
 */
@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly mediaProbe: MediaProbeService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessJobData>): Promise<void> {
    const { videoId } = job.data;
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video || video.status !== VideoStatus.PROCESSING) {
      this.logger.log(`Skipping ${videoId}: not in processing`);
      return;
    }

    // The worker runs inside Compose → sign with the internal client
    // (phase-03-videos/TD-07, TD-10 revision 2026-11-24).
    const input = await this.storageService.presignGetObject(video.video_key, {
      consumer: 'internal',
    });

    let probe: Awaited<ReturnType<MediaProbeService['probe']>>;
    try {
      probe = await this.mediaProbe.probe(input);
    } catch (err) {
      if (err instanceof InvalidMediaError) {
        throw new UnrecoverableError(VIDEO_ERROR_REASONS.INVALID_MEDIA);
      }
      throw err;
    }

    const frame = await this.mediaProbe.extractFrame(
      input,
      thumbnailOffsetSeconds(probe.durationSeconds),
    );
    const thumbnailKey = VIDEO_STORAGE_KEYS.thumbnail(video.id);
    await this.storageService.putObject(thumbnailKey, frame, 'image/jpeg');

    await this.videoRepository.update(
      { id: video.id, status: VideoStatus.PROCESSING },
      {
        status: VideoStatus.READY,
        duration_seconds: probe.durationSeconds.toFixed(3),
        metadata: probe.metadata,
        thumbnail_key: thumbnailKey,
      },
    );
  }

  /**
   * Final failure → `error` (TD-12): immediately for UnrecoverableError
   * (invalid media), otherwise only once every attempt is used.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<VideoProcessJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const unrecoverable = error instanceof UnrecoverableError;
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!unrecoverable && !exhausted) return;

    const reason =
      unrecoverable && error.message === VIDEO_ERROR_REASONS.INVALID_MEDIA
        ? VIDEO_ERROR_REASONS.INVALID_MEDIA
        : VIDEO_ERROR_REASONS.PROCESSING_FAILED;
    try {
      await this.videoRepository.update(
        { id: job.data.videoId, status: VideoStatus.PROCESSING },
        { status: VideoStatus.ERROR, error_reason: reason },
      );
    } catch (err) {
      // Event handler: rethrowing would crash the worker process.
      this.logger.error(
        `Could not mark ${job.data.videoId} as error`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
