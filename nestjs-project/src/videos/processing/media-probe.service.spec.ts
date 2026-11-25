import type { FfprobeData } from 'fluent-ffmpeg';
import { InvalidMediaError, MediaProbeService } from './media-probe.service';

const probeData = (
  streams: Partial<FfprobeData['streams'][number]>[],
  format: Partial<FfprobeData['format']> = {},
): FfprobeData =>
  ({
    streams,
    format: {
      duration: 2.04,
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      bit_rate: 118000,
      size: 30120,
      ...format,
    },
    chapters: [],
  }) as unknown as FfprobeData;

describe('MediaProbeService', () => {
  describe('toProbeResult', () => {
    it('should map duration and the 8 metadata keys', () => {
      const result = MediaProbeService.toProbeResult(
        probeData([
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 320,
            height: 240,
            r_frame_rate: '25/1',
          },
          { codec_type: 'audio', codec_name: 'aac' },
        ]),
      );

      expect(result).toEqual({
        durationSeconds: 2.04,
        metadata: {
          width: 320,
          height: 240,
          videoCodec: 'h264',
          audioCodec: 'aac',
          formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
          bitRate: 118000,
          frameRate: 25,
          sizeBytes: 30120,
        },
      });
    });

    it('should use null for an absent audio stream and unknown values', () => {
      const result = MediaProbeService.toProbeResult(
        probeData(
          [{ codec_type: 'video', codec_name: 'vp9', r_frame_rate: '0/0' }],
          { bit_rate: undefined },
        ),
      );

      expect(result.metadata.audioCodec).toBeNull();
      expect(result.metadata.frameRate).toBeNull();
      expect(result.metadata.bitRate).toBeNull();
      expect(result.metadata.width).toBeNull();
    });

    it('should parse fractional frame rates', () => {
      const result = MediaProbeService.toProbeResult(
        probeData([{ codec_type: 'video', r_frame_rate: '30000/1001' }]),
      );
      expect(result.metadata.frameRate).toBe(29.97);
    });

    it('should throw InvalidMediaError when there is no video stream', () => {
      expect(() =>
        MediaProbeService.toProbeResult(
          probeData([{ codec_type: 'audio', codec_name: 'mp3' }]),
        ),
      ).toThrow(InvalidMediaError);
    });
  });
});
