import {
  generatePublicId,
  PUBLIC_ID_LENGTH,
  PUBLIC_ID_PATTERN,
} from './public-id.util';

describe('generatePublicId', () => {
  it('should always return 11 base64url characters', () => {
    for (let i = 0; i < 200; i++) {
      const id = generatePublicId();
      expect(id).toHaveLength(PUBLIC_ID_LENGTH);
      expect(id).toMatch(PUBLIC_ID_PATTERN);
    }
  });

  it('should return different values on successive calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generatePublicId()));
    expect(ids.size).toBe(200);
  });
});
