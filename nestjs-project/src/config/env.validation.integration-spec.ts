import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret-key',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const result = validate({});
    const value = result.value as Record<string, string>;
    expect(result.error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — storage, queue and video', () => {
  it('should reject a missing S3_ACCESS_KEY', () => {
    const { error } = envValidationSchema.validate(
      { ...requiredEnv, S3_ACCESS_KEY: undefined },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('S3_ACCESS_KEY');
  });

  it('should reject a missing S3_SECRET_KEY', () => {
    const { error } = envValidationSchema.validate(
      { ...requiredEnv, S3_SECRET_KEY: undefined },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('S3_SECRET_KEY');
  });

  it('should apply the queue and video defaults', () => {
    const result = validate({});
    const value = result.value as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    expect(value.REDIS_HOST).toBe('redis');
    expect(value.REDIS_PORT).toBe(6379);
    expect(value.S3_ENDPOINT).toBe('http://minio:9000');
    expect(value.S3_BUCKET).toBe('streamtube');
    expect(value.VIDEO_MAX_SIZE_BYTES).toBe(10737418240);
    expect(value.VIDEO_UPLOAD_PART_SIZE_BYTES).toBe(104857600);
    expect(value.VIDEO_UPLOAD_URL_TTL_SECONDS).toBe(900);
    expect(value.VIDEO_PLAYBACK_URL_TTL_SECONDS).toBe(900);
  });

  it('should reject VIDEO_UPLOAD_PART_SIZE_BYTES below 5 MiB', () => {
    const { error } = validate({ VIDEO_UPLOAD_PART_SIZE_BYTES: '5242879' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('VIDEO_UPLOAD_PART_SIZE_BYTES');
  });
});
