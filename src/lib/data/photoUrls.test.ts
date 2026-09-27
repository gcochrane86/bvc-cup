import { describe, it, expect } from 'vitest';
import { planPhotoUrls, PHOTO_URL_REFRESH_MS } from './photoUrls';

const now = 1_000_000_000_000;

describe('planPhotoUrls', () => {
  it('signs paths it has never seen', () => {
    expect(planPhotoUrls({}, ['p/1.jpg'], now)).toEqual({ keep: {}, sign: ['p/1.jpg'] });
  });

  it('keeps recently signed URLs', () => {
    const cache = { 'p/1.jpg': { url: 'u1', signedAt: now - 60_000 } };
    expect(planPhotoUrls(cache, ['p/1.jpg'], now)).toEqual({ keep: cache, sign: [] });
  });

  it('re-signs URLs before they expire, so long-open phones keep their photos', () => {
    const cache = { 'p/1.jpg': { url: 'u1', signedAt: now - PHOTO_URL_REFRESH_MS - 1 } };
    expect(planPhotoUrls(cache, ['p/1.jpg'], now)).toEqual({ keep: {}, sign: ['p/1.jpg'] });
  });

  it('drops URLs for photos that were replaced', () => {
    const cache = { 'p/1.jpg': { url: 'u1', signedAt: now } };
    expect(planPhotoUrls(cache, ['p/2.jpg'], now)).toEqual({ keep: {}, sign: ['p/2.jpg'] });
  });
});
