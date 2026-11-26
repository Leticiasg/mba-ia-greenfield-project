export const STORAGE_CLIENTS = {
  INTERNAL: 'S3_INTERNAL_CLIENT',
  PUBLIC: 'S3_PUBLIC_CLIENT',
} as const;

/** S3 error names returned by CompleteMultipartUpload when the part list is unusable. */
export const INCOMPLETE_UPLOAD_ERROR_NAMES = [
  'InvalidPart',
  'InvalidPartOrder',
  'NoSuchUpload',
] as const;
