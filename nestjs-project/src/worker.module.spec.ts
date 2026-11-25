import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { Channel } from './channels/entities/channel.entity';
import { StorageService } from './storage/storage.service';
import { User } from './users/entities/user.entity';
import { Video } from './videos/entities/video.entity';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('should compile with storage, queue and the Video entity closure, without HTTP modules', async () => {
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(module.get(StorageService)).toBeInstanceOf(StorageService);

    const entities = module
      .get(DataSource)
      .entityMetadatas.map((m) => m.target);
    expect(entities).toEqual(expect.arrayContaining([Video, Channel, User]));
    expect(entities).toHaveLength(3);

    await module.close();
  }, 30000);
});
