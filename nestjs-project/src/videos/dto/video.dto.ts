import { ApiProperty } from '@nestjs/swagger';

export class VideoMetadataDto {
  @ApiProperty({ type: Number, nullable: true, example: 320 })
  width: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 240 })
  height: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'h264' })
  videoCodec: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'aac' })
  audioCodec: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'mov,mp4,m4a,3gp,3g2,mj2',
  })
  formatName: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 118000 })
  bitRate: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 25 })
  frameRate: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 30120 })
  sizeBytes: number | null;
}

export class VideoDto {
  @ApiProperty({ example: 'a1B2c3D4e5F' })
  publicId: string;

  @ApiProperty({ example: 'My clip' })
  title: string;

  @ApiProperty({ enum: ['draft', 'processing', 'ready', 'error'] })
  status: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  errorReason: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 2.04 })
  durationSeconds: number | null;

  @ApiProperty({ type: VideoMetadataDto, nullable: true })
  metadata: VideoMetadataDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}
