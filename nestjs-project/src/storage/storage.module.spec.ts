import { S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { STORAGE_CLIENTS } from './storage.constants';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageModule', () => {
  it('should compile with the internal and public S3 clients', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig, videoConfig],
        }),
        StorageModule,
      ],
    }).compile();

    expect(module.get(StorageService)).toBeInstanceOf(StorageService);
    expect(module.get(STORAGE_CLIENTS.INTERNAL)).toBeInstanceOf(S3Client);
    expect(module.get(STORAGE_CLIENTS.PUBLIC)).toBeInstanceOf(S3Client);
    expect(module.get(STORAGE_CLIENTS.INTERNAL)).not.toBe(
      module.get(STORAGE_CLIENTS.PUBLIC),
    );
    await module.close();
  }, 15000);
});
