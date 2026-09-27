import { must, supabase } from './supabase';

/** Centre-crop to a square and re-encode as JPEG (fixes phone EXIF rotation; ~30–60 KB). */
export async function resizeToSquareJpeg(file: Blob, size = 400): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', 0.85),
  );
}

export async function uploadPlayerPhoto(playerId: string, file: Blob): Promise<void> {
  const blob = await resizeToSquareJpeg(file);
  const path = `${playerId}/${Date.now()}.jpg`;
  await must(supabase.storage.from('player-photos').upload(path, blob, { contentType: 'image/jpeg' }));
  await must(supabase.rpc('set_player_photo', { p_player_id: playerId, p_path: path }));
}
