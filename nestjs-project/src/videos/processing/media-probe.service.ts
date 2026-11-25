import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import ffmpeg, { type FfprobeData } from 'fluent-ffmpeg';
import type { VideoMetadata } from '../entities/video.entity';

/** Input is not a usable video (no video stream or unparseable container). */
export class InvalidMediaError extends Error {
  constructor(reason: string) {
    super(`Invalid media: ${reason}`);
    this.name = 'InvalidMediaError';
  }
}

export interface ProbeResult {
  durationSeconds: number;
  metadata: VideoMetadata;
}

/** ffprobe messages that mean "the bytes are not a usable media file". */
const INVALID_INPUT_PATTERNS = [
  /Invalid data found when processing input/i,
  /moov atom not found/i,
  /could not find codec parameters/i,
];

const toNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '' || value === 'N/A')
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** "30000/1001" → 29.97; "25/1" → 25. */
const parseFrameRate = (value: string | undefined): number | null => {
  if (!value) return null;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return Math.round((num / den) * 1000) / 1000;
};

/**
 * Wraps fluent-ffmpeg (deprecated, pinned 2.1.3 — phase-03-videos/TD-06) in
 * promises. It shells out to the ffmpeg/ffprobe binaries of the worker image.
 */
@Injectable()
export class MediaProbeService {
  /** Reads duration and the fixed metadata key set (TD-06 revision 2026-11-24). */
  async probe(input: string): Promise<ProbeResult> {
    const data = await this.ffprobe(input);
    return MediaProbeService.toProbeResult(data);
  }

  /** Writes one JPEG frame taken at `seconds` and returns its bytes. */
  async extractFrame(input: string, seconds: number): Promise<Buffer> {
    // `.jpg` output selects the JPEG encoder (screenshots() would default to PNG).
    const outPath = join(tmpdir(), `thumbnail-${randomUUID()}.jpg`);
    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(input)
          .seekInput(seconds)
          .frames(1)
          .outputOptions(['-q:v', '2'])
          .output(outPath)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(err))
          .run();
      });
      return await readFile(outPath);
    } finally {
      await rm(outPath, { force: true });
    }
  }

  static toProbeResult(data: FfprobeData): ProbeResult {
    const video = data.streams.find((s) => s.codec_type === 'video');
    if (!video) {
      throw new InvalidMediaError('no video stream');
    }
    const audio = data.streams.find((s) => s.codec_type === 'audio');

    return {
      durationSeconds: toNumber(data.format.duration) ?? 0,
      metadata: {
        width: toNumber(video.width),
        height: toNumber(video.height),
        videoCodec: video.codec_name ?? null,
        audioCodec: audio?.codec_name ?? null,
        formatName: data.format.format_name ?? null,
        bitRate: toNumber(data.format.bit_rate),
        frameRate: parseFrameRate(video.r_frame_rate),
        sizeBytes: toNumber(data.format.size),
      },
    };
  }

  private ffprobe(input: string): Promise<FfprobeData> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(input, (err: unknown, data: FfprobeData) => {
        if (!err) return resolve(data);
        const message =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : 'Unknown ffprobe error';
        if (INVALID_INPUT_PATTERNS.some((p) => p.test(message))) {
          return reject(new InvalidMediaError(message));
        }
        // Anything else (network, storage, binary) is treated as transient.
        return reject(err instanceof Error ? err : new Error(message));
      });
    });
  }
}
