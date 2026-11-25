import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => {
  const endpoint = process.env.S3_ENDPOINT || 'http://minio:9000';
  // In tests the e2e runs inside the API container, so URLs handed to HTTP
  // clients must be signed for the same host the container reaches.
  const publicEndpoint =
    process.env.NODE_ENV === 'test'
      ? endpoint
      : process.env.S3_PUBLIC_ENDPOINT || 'http://localhost:9000';

  return {
    endpoint,
    publicEndpoint,
    region: process.env.S3_REGION || 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    bucket: process.env.S3_BUCKET || 'streamtube',
  };
});
