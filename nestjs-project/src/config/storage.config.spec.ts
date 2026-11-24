import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from './storage.config';

const ENV_KEYS = ['NODE_ENV', 'S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT'] as const;

const loadConfig = async (
  env: Partial<Record<(typeof ENV_KEYS)[number], string>>,
): Promise<ConfigType<typeof storageConfig>> => {
  for (const key of ENV_KEYS) {
    if (env[key] !== undefined) process.env[key] = env[key];
    else delete process.env[key];
  }

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [storageConfig] }),
    ],
  }).compile();

  const config = module.get<ConfigType<typeof storageConfig>>(
    storageConfig.KEY,
  );
  await module.close();
  return config;
};

describe('storageConfig', () => {
  const original = { ...process.env };

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] !== undefined) process.env[key] = original[key];
      else delete process.env[key];
    }
  });

  it('should use the internal endpoint as public endpoint when NODE_ENV=test', async () => {
    const config = await loadConfig({
      NODE_ENV: 'test',
      S3_ENDPOINT: 'http://minio:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
    });
    expect(config.endpoint).toBe('http://minio:9000');
    expect(config.publicEndpoint).toBe('http://minio:9000');
  });

  it('should keep a distinct public endpoint outside the test environment', async () => {
    const config = await loadConfig({
      NODE_ENV: 'development',
      S3_ENDPOINT: 'http://minio:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
    });
    expect(config.endpoint).toBe('http://minio:9000');
    expect(config.publicEndpoint).toBe('http://localhost:9000');
  });
});
