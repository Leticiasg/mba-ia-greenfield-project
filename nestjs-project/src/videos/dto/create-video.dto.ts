import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class CreateVideoDto {
  /** Original filename, kept only as metadata (never used in object keys). */
  @IsString()
  @Length(1, 255)
  filename: string;

  /** Declared size in bytes; the 10GB cap is enforced by the service (FILE_TOO_LARGE). */
  @IsInt()
  @Min(1)
  fileSize: number;

  /** Declared MIME type; must start with `video/`. */
  @IsString()
  @Matches(/^video\//, { message: 'contentType must be a video MIME type' })
  contentType: string;

  /** Optional; defaults to the filename without its extension. */
  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;
}
