/**
 * Turns a chosen picture into the two small copies the company logo needs:
 * a JPEG on white for printed documents, and a PNG that keeps its transparent background for the
 * loading screen. SVG is accepted too; it is drawn onto a canvas, so only plain pixels are ever kept
 * (no script or link from an uploaded file can survive).
 */

export type LogoCopies = { jpeg: string; png: string | null };

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/svg+xml';
const PRINT_BOX = { width: 480, height: 240 };
const SCREEN_BOX = { width: 360, height: 180 };
const MAX_JPEG_BASE64 = 250000;
const MAX_PNG_BASE64 = 250000;

/** The size that fits inside the box, never larger than the original and never zero. */
export function fitWithin(
  width: number,
  height: number,
  box: { width: number; height: number },
): { width: number; height: number } {
  const scale = Math.min(1, box.width / width, box.height / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isLogoFileType(type: string): boolean {
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/svg+xml';
}

async function loadPicture(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  if (file.type !== 'image/svg+xml') {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  }
  // An SVG is loaded as a picture (not inserted into the page), so nothing in it can run.
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const width = image.naturalWidth || 300;
    const height = image.naturalHeight || 150;
    return { source: image, width, height };
  } finally {
    // The decoded image keeps its pixels; the address is no longer needed.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function render(
  picture: { source: CanvasImageSource; width: number; height: number },
  box: { width: number; height: number },
  background: string | null,
): HTMLCanvasElement {
  const size = fitWithin(picture.width, picture.height, box);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas');
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(picture.source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const base64Of = (url: string) => url.slice(url.indexOf(',') + 1);

/** Throws when the picture cannot be read or the printed copy would be too large. */
export async function makeLogoCopies(file: File): Promise<LogoCopies> {
  const picture = await loadPicture(file);
  const jpeg = base64Of(render(picture, PRINT_BOX, '#ffffff').toDataURL('image/jpeg', 0.85));
  if (jpeg.length > MAX_JPEG_BASE64) throw new Error('too large');
  const png = base64Of(render(picture, SCREEN_BOX, null).toDataURL('image/png'));
  // A picture too heavy for the loading screen simply has no screen copy; documents still work.
  return { jpeg, png: png.length <= MAX_PNG_BASE64 ? png : null };
}
