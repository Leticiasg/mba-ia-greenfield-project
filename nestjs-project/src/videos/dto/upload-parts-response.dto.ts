import { ApiProperty } from '@nestjs/swagger';

export class PartUrlDto {
  @ApiProperty({ example: 1 })
  partNumber: number;

  @ApiProperty({
    description:
      'Presigned URL; PUT the raw bytes of this part and keep the ETag response header',
  })
  url: string;
}

export class PartUrlsDto {
  @ApiProperty({ type: [PartUrlDto] })
  parts: PartUrlDto[];

  @ApiProperty({ example: '2026-11-24T13:15:00.000Z', format: 'date-time' })
  expiresAt: string;
}

export class UploadedPartDto {
  @ApiProperty({ example: 1 })
  partNumber: number;

  @ApiProperty({ example: '"9e107d9d372bb6826bd81d3542a419d6"' })
  eTag: string;

  @ApiProperty({ example: 104857600 })
  size: number;
}

export class UploadedPartsDto {
  @ApiProperty({ type: [UploadedPartDto] })
  parts: UploadedPartDto[];
}
