// Robot photos are normalised in the browser before upload: decoded with the phone's rotation applied, cropped to
// a square, scaled to at most 1024 px, and compressed (WebP, or JPEG where the browser can't encode WebP) until the
// file is under the upload limit.
import { cropBox, outputSize, PHOTO_LIMIT, QUALITIES } from '../shared/crop.js';

export class PhotoError extends Error {}

export async function decodePhoto(file) {
  if (!file?.type?.startsWith('image/')) throw new PhotoError('not an image');
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older browsers: an <img> applies EXIF rotation on its own.
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } catch {
      throw new PhotoError('could not decode');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export const photoSize = image => ({ width: image.width || image.naturalWidth, height: image.height || image.naturalHeight });

export function drawCrop(canvas, image, crop, size) {
  const { width, height } = photoSize(image);
  const { left, top, side } = cropBox(width, height, crop);
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#0e1318';
  context.fillRect(0, 0, size, size);
  context.drawImage(image, left, top, side, side, 0, 0, size, size);
  return side;
}

const encode = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));

function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Returns { extension, bytes } ready for the upload endpoints.
export async function exportPhoto(image, crop) {
  const { width, height } = photoSize(image);
  const canvas = document.createElement('canvas');
  drawCrop(canvas, image, crop, outputSize(cropBox(width, height, crop).side));
  let blob = null;
  for (const type of ['image/webp', 'image/jpeg']) {
    for (const quality of QUALITIES) {
      blob = await encode(canvas, type, quality);
      // Browsers that can't encode WebP hand back a PNG instead; move on to JPEG.
      if (!blob || blob.type !== type) break;
      if (blob.size <= PHOTO_LIMIT) return { extension: type === 'image/webp' ? 'webp' : 'jpg', bytes: await base64(blob) };
    }
  }
  if (blob?.type === 'image/jpeg') return { extension: 'jpg', bytes: await base64(blob) };
  throw new PhotoError('could not encode');
}
