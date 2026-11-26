import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

/** Upload/processing lifecycle only — Phase 04 publication is a separate concern (phase-03-videos/TD-12). */
export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

/** Fixed metadata key set extracted by the worker (phase-03-videos/TD-06, revision 2026-11-24). */
export interface VideoMetadata {
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  formatName: string | null;
  bitRate: number | null;
  frameRate: number | null;
  sizeBytes: number | null;
}

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 11, unique: true })
  public_id: string;

  @Index()
  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 255 })
  original_filename: string;

  @Column({ type: 'varchar', length: 100 })
  content_type: string;

  // bigint comes back from pg as a string; keep it typed as string to avoid precision loss.
  @Column({ type: 'bigint' })
  size_bytes: string;

  @Column({ type: 'enum', enum: VideoStatus, default: VideoStatus.DRAFT })
  status: VideoStatus;

  @Column({ type: 'text', nullable: true })
  error_reason: string | null;

  @Column({ type: 'varchar', length: 1024 })
  video_key: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  upload_id: string | null;

  @Column({ type: 'integer' })
  part_size_bytes: number;

  @Column({ type: 'integer' })
  part_count: number;

  @Column({ type: 'numeric', precision: 12, scale: 3, nullable: true })
  duration_seconds: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: VideoMetadata | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
