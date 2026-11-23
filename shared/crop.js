// Square photo crops, shared by the browser photo cropper and its tests. Pure math, no DOM.

export const MAX_ZOOM = 4;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// The square to cut from a width × height image. Zoom 1 fits the shorter side; `x` and `y` are the centre of the
// square as fractions of the image's width and height, kept far enough in that the square never leaves the image.
export function cropBox(width, height, { zoom = 1, x = .5, y = .5 } = {}) {
  const side = Math.min(width, height) / clamp(zoom, 1, MAX_ZOOM);
  const half = side / 2;
  const left = clamp(x * width, half, width - half) - half;
  const top = clamp(y * height, half, height - half) - half;
  return { left, top, side };
}

// Moves the crop centre by a drag of (dx, dy) screen pixels on a viewport `view` pixels wide. Dragging right shows
// more of the left of the image, like moving a photo under a frame. Returns a clamped { x, y }.
export function dragCrop(width, height, crop, dx, dy, view) {
  const { side } = cropBox(width, height, crop);
  const scale = side / view;
  const half = side / 2;
  const x = clamp(crop.x * width - dx * scale, half, width - half) / width;
  const y = clamp(crop.y * height - dy * scale, half, height - half) / height;
  return { ...crop, x, y };
}

export const zoomCrop = (crop, zoom) => ({ ...crop, zoom: clamp(zoom, 1, MAX_ZOOM) });

// Output size for a crop: up to 1024 pixels, never enlarging a small photo by more than double, at least 256.
export const outputSize = side => Math.round(clamp(Math.min(1024, side * 2), 256, 1024));

// JPEG/WebP qualities to try, best first, until the file fits the upload limit.
export const QUALITIES = [.85, .78, .7, .62, .55, .5];
export const PHOTO_LIMIT = 300_000;
