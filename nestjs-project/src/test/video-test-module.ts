import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { VideosModule } from '../videos/videos.module';
import { createTestDataSource } from './create-test-data-source';

export const VIDEO_TEST_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
];

/**
 * Real VideosModule wired to the Compose Postgres and MinIO, for
 * integration tests of the videos domain. Call `module.init()` so the
 * storage bucket is ensured before the first test.
 */
export async function createVideosTestingModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [storageConfig, videoConfig, queueConfig],
      }),
      TypeOrmModule.forRoot(createTestDataSource(VIDEO_TEST_ENTITIES).options),
      VideosModule,
    ],
  }).compile();
}
