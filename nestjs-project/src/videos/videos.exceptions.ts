import { DomainException } from '../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class FileTooLargeException extends DomainException {
  constructor() {
    super('FILE_TOO_LARGE', 400, 'File exceeds the maximum allowed size');
  }
}

export class InvalidVideoStatusException extends DomainException {
  constructor() {
    super(
      'INVALID_VIDEO_STATUS',
      409,
      'Operation not allowed in the current video status',
    );
  }
}

export class InvalidPartNumberException extends DomainException {
  constructor() {
    super('INVALID_PART_NUMBER', 400, 'Part number out of range');
  }
}

export class UploadIncompleteException extends DomainException {
  constructor() {
    super('UPLOAD_INCOMPLETE', 400, 'Upload parts are missing or invalid');
  }
}

export class UploadSizeMismatchException extends DomainException {
  constructor() {
    super(
      'UPLOAD_SIZE_MISMATCH',
      400,
      'Uploaded file size does not match the declared size',
    );
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video is not ready');
  }
}
