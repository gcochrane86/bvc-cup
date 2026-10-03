// Course guide photos uploaded in Admin: stored in the private 'course-guides' bucket, one row each in guide_photos.
import { must, supabase } from './supabase';
import type { GuidePhotoRow } from './data/types';
import { sourceRect, turnedSize, type Box } from './crop';
import { GUIDE_QUALITY, guideScale } from './imageSize';

/** Shrink (see guideScale: tall pages keep their width) and re-encode as JPEG (fixes phone EXIF rotation). */
export async function resizeForGuide(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = guideScale(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', GUIDE_QUALITY),
  );
}

/** Turn a photo by quarter turns, keep just the frame, shrink (guideScale) and re-encode as JPEG. */
export async function cropForGuide(file: Blob, box: Box, turns: number): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const turned = turnCanvas(bmp, turns);
  bmp.close();
  const { sx, sy, sw, sh } = sourceRect(box, turned.width, turned.height);
  const scale = guideScale(sw, sh);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(turned, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', GUIDE_QUALITY),
  );
}

/** The image drawn onto a canvas after this many quarter turns clockwise. */
export function turnCanvas(img: CanvasImageSource & { width: number; height: number }, turns: number): HTMLCanvasElement {
  const t = ((turns % 4) + 4) % 4;
  const { w, h } = turnedSize(img.width, img.height, t);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.translate(w / 2, h / 2);
  ctx.rotate((t * Math.PI) / 2);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return c;
}

const folder = (courseName: string) => courseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** ready: already cropped and shrunk (cropForGuide), so it's uploaded as it is. */
export async function uploadGuidePhoto(courseName: string, hole: number, file: Blob, ready = false): Promise<void> {
  const blob = ready ? file : await resizeForGuide(file);
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
