export const VIDEO_PUBLIC_ID_MAX_ATTEMPTS = 3;

export const VIDEO_STORAGE_KEYS = {
  original: (videoId: string): string => `videos/${videoId}/original`,
  thumbnail: (videoId: string): string => `thumbnails/${videoId}.jpg`,
} as const;
