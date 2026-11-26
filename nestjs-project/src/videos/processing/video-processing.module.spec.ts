import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import queueConfig from '../../config/queue.config';
import storageConfig from '../../config/storage.config';
import videoConfig from '../../config/video.config';
import { createTestDataSource } from '../../test/create-test-data-source';
import { VIDEO_TEST_ENTITIES } from '../../test/video-test-module';
import { MediaProbeService } from './media-probe.service';
import { VideoProcessingModule } from './video-processing.module';
import { VideoProcessor } from './video.processor';

describe('VideoProcessingModule', () => {
  it('should compile with the processor and the media probe', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, videoConfig, queueConfig],
        }),
        TypeOrmModule.forRoot(
          createTestDataSource(VIDEO_TEST_ENTITIES).options,
        ),
        VideoProcessingModule,
      ],
    }).compile();

    expect(module.get(VideoProcessor)).toBeInstanceOf(VideoProcessor);
    expect(module.get(MediaProbeService)).toBeInstanceOf(MediaProbeService);
    await module.close();
  }, 30000);
});
