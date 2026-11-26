import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { generatePublicId } from '../public-id.util';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channel: Channel;

  const buildVideo = (overrides: Partial<Video> = {}): Video =>
    videoRepository.create({
      public_id: generatePublicId(),
      channel_id: channel.id,
      title: 'Clip',
      original_filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: '1048576',
      video_key: `videos/${randomUUID()}/original`,
      part_size_bytes: 104857600,
      part_count: 1,
      ...overrides,
    });

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: `video_owner_${randomUUID()}@example.com`,
        password: 'hashed',
      }),
    );
    channel = await dataSource.getRepository(Channel).save(
      dataSource.getRepository(Channel).create({
        name: 'Owner',
        nickname: `owner_${randomUUID().slice(0, 8)}`,
        user_id: user.id,
      }),
    );
  });

  it('should default status to draft', async () => {
    const saved = await videoRepository.save(buildVideo());
    const found = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(found.status).toBe(VideoStatus.DRAFT);
  });

  it('should enforce a unique public_id', async () => {
    const publicId = generatePublicId();
    await videoRepository.save(buildVideo({ public_id: publicId }));

    await expect(
      videoRepository.save(buildVideo({ public_id: publicId })),
    ).rejects.toThrow();
  });

  it('should reject a channel_id that does not exist', async () => {
    await expect(
      videoRepository.save(buildVideo({ channel_id: randomUUID() })),
    ).rejects.toThrow();
  });

  it('should accept null metadata and store a JSONB object', async () => {
    const withoutMetadata = await videoRepository.save(buildVideo());
    expect(
      (await videoRepository.findOneByOrFail({ id: withoutMetadata.id }))
        .metadata,
    ).toBeNull();

    const metadata = {
      width: 320,
      height: 240,
      videoCodec: 'h264',
      audioCodec: null,
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      bitRate: 120000,
      frameRate: 25,
      sizeBytes: 30000,
    };
    const withMetadata = await videoRepository.save(buildVideo({ metadata }));
    expect(
      (await videoRepository.findOneByOrFail({ id: withMetadata.id })).metadata,
    ).toEqual(metadata);
  });

  it('should load the owning channel and the inverse videos relation', async () => {
    const saved = await videoRepository.save(buildVideo());

    const video = await videoRepository.findOneOrFail({
      where: { id: saved.id },
      relations: ['channel'],
    });
    expect(video.channel.id).toBe(channel.id);

    const loadedChannel = await dataSource
      .getRepository(Channel)
      .findOneOrFail({
        where: { id: channel.id },
        relations: ['videos'],
      });
    expect(loadedChannel.videos.map((v) => v.id)).toEqual([saved.id]);
  });
});
