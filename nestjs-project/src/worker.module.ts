import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from './channels/entities/channel.entity';
import databaseConfig from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import queueConfig from './config/queue.config';
import storageConfig from './config/storage.config';
import videoConfig from './config/video.config';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { User } from './users/entities/user.entity';
import { Video } from './videos/entities/video.entity';
import { VideoProcessingModule } from './videos/processing/video-processing.module';

/**
 * Root module of the video-worker process: same codebase and config as the
 * API, no HTTP modules (phase-03-videos/TD-05). Entities are the closure of
 * Video's relations (Video → Channel → User).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, storageConfig, queueConfig, videoConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        entities: [Video, Channel, User],
        synchronize: false,
      }),
    }),
    StorageModule,
    QueueModule,
    VideoProcessingModule,
  ],
})
export class WorkerModule {}
