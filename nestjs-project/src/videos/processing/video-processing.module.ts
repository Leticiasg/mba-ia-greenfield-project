import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueModule } from '../../queue/queue.module';
import { StorageModule } from '../../storage/storage.module';
import { Video } from '../entities/video.entity';
import { MediaProbeService } from './media-probe.service';
import { VideoProcessor } from './video.processor';

/** Queue consumer side; imported only by the WorkerModule, never by the API. */
@Module({
  imports: [TypeOrmModule.forFeature([Video]), StorageModule, QueueModule],
  providers: [MediaProbeService, VideoProcessor],
})
export class VideoProcessingModule {}
