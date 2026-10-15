import { describe, it, expect } from 'vitest';
import { guideFiles, guidePhotoKey } from './guideOffline';
import { GUIDES, photoGuide } from './guides';

const g = (slug: string) => GUIDES.find((x) => x.slug === slug)!;
const photo = (course_name: string, hole: number, path: string) => ({ course_name, hole, path });

describe('saving guides on the phone', () => {
  it("lists every hole's built-in pages", () => {
    const { pages, photos } = guideFiles([g('dundonald'), g('krtb')], []);
    expect(pages).toHaveLength(18 + 36);
    expect(pages[0]).toBe('guides/dundonald/hole-01.webp');
    expect(pages).toContain('guides/krtb/hole-18-approach.webp');
    expect(photos).toEqual([]);
  });

  it("takes a hole's uploaded photos instead of its built-in pages", () => {
    const { pages, photos } = guideFiles([g('krtb')], [photo('King Robert the Bruce', 3, 'krtb/3/a.jpg'), photo('Dundonald Links', 3, 'd/3/x.jpg')]);
    expect(pages).not.toContain('guides/krtb/hole-03-layout.webp');
    expect(pages).toHaveLength(34);
    expect(photos).toEqual(['krtb/3/a.jpg']);
  });

  it('saves only the photos for a photo-only guide', () => {
    const { pages, photos } = guideFiles([photoGuide('Castle')], [photo('Castle', 1, 'castle/1/a.jpg'), photo('Castle', 1, 'castle/1/b.jpg')]);
    expect(pages).toEqual([]);
    expect(photos).toEqual(['castle/1/a.jpg', 'castle/1/b.jpg']);
  });

  it("keys a photo the way the service worker does (the file, without a link token)", () => {
    expect(guidePhotoKey('https://x.supabase.co/', 'krtb/3/a.jpg')).toBe('https://x.supabase.co/storage/v1/object/sign/course-guides/krtb/3/a.jpg');
  });
});
