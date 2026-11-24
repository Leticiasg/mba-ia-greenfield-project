import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { STORAGE_CLIENTS } from './storage.constants';
import { StorageService } from './storage.service';

const buildClient = (
  storage: ConfigType<typeof storageConfig>,
  endpoint: string,
): S3Client =>
  new S3Client({
    endpoint,
    region: storage.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
    },
  });

@Module({
  providers: [
    {
      // Server-side calls from inside the Compose network (phase-03-videos/TD-10).
      provide: STORAGE_CLIENTS.INTERNAL,
      inject: [storageConfig.KEY],
      useFactory: (storage: ConfigType<typeof storageConfig>) =>
        buildClient(storage, storage.endpoint),
    },
    {
      // Only signs URLs handed to HTTP clients (phase-03-videos/TD-10).
      provide: STORAGE_CLIENTS.PUBLIC,
      inject: [storageConfig.KEY],
      useFactory: (storage: ConfigType<typeof storageConfig>) =>
        buildClient(storage, storage.publicEndpoint),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
