import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Redirect,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { UploadCompletedDto } from './dto/upload-completed.dto';
import { RequestPartUrlsDto } from './dto/request-part-urls.dto';
import { PartUrlsDto, UploadedPartsDto } from './dto/upload-parts-response.dto';
import { UploadPlanDto } from './dto/upload-plan.dto';
import { VideoDto } from './dto/video.dto';
import { type PlaybackKind, VideosService } from './videos.service';

// ThrottlerGuard is an APP_GUARD (AuthModule), so it covers every route.
// Its auth-sized limit (10 req/min) would block status polling and upload
// part requests; video routes are authenticated and owner-only instead.
@SkipThrottle()
@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      'Pre-registers the video as draft in the caller’s channel and opens a multipart upload in object storage. The file bytes go straight to storage through presigned part URLs.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created; upload plan returned',
    type: UploadPlanDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or FILE_TOO_LARGE',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<UploadPlanDto> {
    return this.videosService.initUpload(user.sub, dto);
  }

  @Post(':publicId/upload/parts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Issue presigned part URLs',
    description:
      'Returns short-lived presigned UploadPart URLs for the requested part numbers of a draft video. The client PUTs each part straight to storage and keeps the ETag.',
  })
  @ApiResponse({
    status: 200,
    description: 'Part URLs issued',
    type: PartUrlsDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or INVALID_PART_NUMBER',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'INVALID_VIDEO_STATUS — video is not a draft',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async issuePartUrls(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: RequestPartUrlsDto,
  ): Promise<PartUrlsDto> {
    return this.videosService.issuePartUrls(
      publicId,
      user.sub,
      dto.partNumbers,
    );
  }

  @Get(':publicId/upload/parts')
  @ApiOperation({
    summary: 'List uploaded parts',
    description:
      'Lists the parts already stored for an in-progress upload, so the client can resume after a dropped connection.',
  })
  @ApiResponse({
    status: 200,
    description: 'Stored parts',
    type: UploadedPartsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'INVALID_VIDEO_STATUS — video is not a draft',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async listUploadedParts(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<UploadedPartsDto> {
    return this.videosService.listUploadedParts(publicId, user.sub);
  }

  @Post(':publicId/upload/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Complete the upload',
    description:
      'Completes the multipart upload, checks the stored size, moves the video to processing and enqueues the processing job. Processing continues asynchronously.',
  })
  @ApiResponse({
    status: 202,
    description: 'Upload completed; processing started',
    type: UploadCompletedDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed, UPLOAD_INCOMPLETE or UPLOAD_SIZE_MISMATCH',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'INVALID_VIDEO_STATUS — video is not a draft',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<UploadCompletedDto> {
    return this.videosService.completeUpload(publicId, user.sub, dto.parts);
  }

  @Get(':publicId')
  @ApiOperation({
    summary: 'Get a video',
    description: 'Returns the owner view of a video and its processing status.',
  })
  @ApiResponse({ status: 200, description: 'The video', type: VideoDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<VideoDto> {
    return this.videosService.getOwnedVideo(publicId, user.sub);
  }

  @Get(':publicId/stream')
  @Redirect(undefined, HttpStatus.FOUND)
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Redirects to a short-lived presigned URL of the original video; storage answers Range requests with 206 Partial Content.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect (Location header) to a short-lived presigned URL',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'VIDEO_NOT_READY — video status is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<{ url: string }> {
    return this.redirectTo(publicId, user.sub, 'stream');
  }

  @Get(':publicId/download')
  @Redirect(undefined, HttpStatus.FOUND)
  @ApiOperation({
    summary: 'Download a video',
    description:
      'Redirects to a short-lived presigned URL that downloads the original video as an attachment with its original filename.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect (Location header) to a short-lived presigned URL',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'VIDEO_NOT_READY — video status is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<{ url: string }> {
    return this.redirectTo(publicId, user.sub, 'download');
  }

  @Get(':publicId/thumbnail')
  @Redirect(undefined, HttpStatus.FOUND)
  @ApiOperation({
    summary: 'Get the video thumbnail',
    description:
      'Redirects to a short-lived presigned URL of the generated JPEG thumbnail.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect (Location header) to a short-lived presigned URL',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'VIDEO_NOT_READY — video status is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async thumbnail(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<{ url: string }> {
    return this.redirectTo(publicId, user.sub, 'thumbnail');
  }

  private async redirectTo(
    publicId: string,
    userId: string,
    kind: PlaybackKind,
  ): Promise<{ url: string }> {
    const url = await this.videosService.getPlaybackUrl(publicId, userId, kind);
    return { url };
  }
}
