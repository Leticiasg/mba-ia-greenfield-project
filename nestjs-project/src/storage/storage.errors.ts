/**
 * Thrown when storage rejects the part list of a multipart upload
 * (missing part, wrong ETag, invalid order, unknown upload). The videos
 * module maps it to the UPLOAD_INCOMPLETE domain error.
 */
export class StorageUploadIncompleteError extends Error {
  constructor(readonly reason: string) {
    super(`Multipart upload could not be completed: ${reason}`);
    this.name = 'StorageUploadIncompleteError';
  }
}
