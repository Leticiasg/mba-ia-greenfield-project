import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CompletedPartDto {
  /** 1-based part number. */
  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber: number;

  /** ETag returned by storage for this part. */
  @IsString()
  @IsNotEmpty()
  eTag: string;
}

export class CompleteUploadDto {
  /** One entry per uploaded part. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts: CompletedPartDto[];
}
