// Course guide photos uploaded in Admin: stored in the private 'course-guides' bucket, one row each in guide_photos.
import { must, supabase } from './supabase';
import type { GuidePhotoRow } from './data/types';

/** Shrink to at most 1600px on the long side and re-encode as JPEG (fixes phone EXIF rotation; ~150–400 KB). */
export async function resizeForGuide(file: Blob, max = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', 0.82),
  );
}

const folder = (courseName: string) => courseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function uploadGuidePhoto(courseName: string, hole: number, file: Blob): Promise<void> {
  const blob = await resizeForGuide(file);
  const path = `${folder(courseName)}/${hole}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  await must(supabase.storage.from('course-guides').upload(path, blob, { contentType: 'image/jpeg' }));
  await must(supabase.from('guide_photos').insert({ course_name: courseName, hole, path }));
}

export async function removeGuidePhoto(photo: GuidePhotoRow): Promise<void> {
  await must(supabase.from('guide_photos').delete().eq('id', photo.id));
  await supabase.storage.from('course-guides').remove([photo.path]); // the row is what counts; a stray file is harmless
}

/** Signed URLs (1 hour) for guide photos, cached for the session. */
const cache = new Map<string, { url: string; until: number }>();
export async function guidePhotoUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const missing = paths.filter((p) => !((cache.get(p)?.until ?? 0) > now));
  if (missing.length) {
    const { data } = await supabase.storage.from('course-guides').createSignedUrls(missing, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) cache.set(d.path, { url: d.signedUrl, until: now + 50 * 60 * 1000 });
  }
  return Object.fromEntries(paths.filter((p) => cache.has(p)).map((p) => [p, cache.get(p)!.url]));
}
