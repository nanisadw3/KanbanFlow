// Turns a picked image into a small square avatar: centre-cropped, 256x256, JPEG. Keeps the upload
// to a few tens of KB whatever the original was.
export const AVATAR_SIZE = 256;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

export async function fileToAvatarDataUrl(file: File, size: number = AVATAR_SIZE): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('not_image');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('too_big');

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('unreadable'));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('unreadable');
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('unreadable');
    ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background instead of black
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}
