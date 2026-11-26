import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import queueConfig from '../config/queue.config';
import { VIDEO_PROCESSING_QUEUE } from './queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [queueConfig.KEY],
      // BullMQ shape is `connection:` (the legacy Bull `redis:` key does not apply).
      useFactory: (queue: ConfigType<typeof queueConfig>) => ({
        connection: { host: queue.host, port: queue.port },
      }),
    }),
    BullModule.registerQueue({
      name: VIDEO_PROCESSING_QUEUE,
      // Retries for transient failures; failed jobs stay inspectable since
      // BullMQ has no native dead-letter queue (phase-03-videos/TD-01, TD-12).
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
