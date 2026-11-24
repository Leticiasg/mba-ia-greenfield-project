import { ApiProperty } from '@nestjs/swagger';

export class UploadPlanDto {
  @ApiProperty({
    example: 'a1B2c3D4e5F',
    description: '11-character unique id; the video URL is /videos/{publicId}',
  })
  publicId: string;

  @ApiProperty({ example: 'My clip' })
  title: string;

  @ApiProperty({ example: 'draft' })
  status: string;

  @ApiProperty({ example: 104857600, description: 'Bytes per part' })
  partSize: number;

  @ApiProperty({ example: 103, description: 'Total parts (1-based numbers)' })
  partCount: number;
}
