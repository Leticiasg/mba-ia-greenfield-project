import { ApiProperty } from '@nestjs/swagger';

export class UploadCompletedDto {
  @ApiProperty({ example: 'a1B2c3D4e5F' })
  publicId: string;

  @ApiProperty({ example: 'processing' })
  status: string;
}
