import { randomBytes } from 'node:crypto';

export const PUBLIC_ID_LENGTH = 11;
export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * 8 random bytes → 11-character base64url string (64 bits of entropy).
 * Uniqueness is enforced by the database; callers retry on collision
 * (phase-03-videos/TD-13).
 */
export function generatePublicId(): string {
  return randomBytes(8).toString('base64url');
}
