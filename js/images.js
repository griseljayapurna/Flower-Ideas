// Loading, shrinking and reading pictures.

const BG_MAX = 2048;      // longest side of a background photo
const CUTOUT_MAX = 900;   // longest side of a pasted flower

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not open this picture'));
    img.src = src;
  });
}

/** Load a Blob as an <img>. Modern browsers turn phone photos the right way up automatically. */
export async function loadImageFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return img;
  } finally {
    // Keep the URL alive until the image has decoded; then it is safe to drop.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not save picture'))), type, quality);
  });
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** A background photo: shrink to a sensible size, save as JPEG. */
export async function prepareBackground(file) {
  const img = await loadImageFromBlob(file);
  const k = Math.min(1, BG_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = makeCanvas(img.naturalWidth * k, img.naturalHeight * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/jpeg', 0.88);
}

/** A flower cut-out: shrink, trim empty transparent edges, keep transparency (PNG). */
export async function prepareCutout(blob) {
  const img = await loadImageFromBlob(blob);
  const k = Math.min(1, CUTOUT_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = makeCanvas(img.naturalWidth * k, img.naturalHeight * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);

  const b = alphaBounds(ctx.getImageData(0, 0, c.width, c.height), 8);
  if (!b) throw new Error('This picture looks empty');
  const pad = 2;
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  const w = Math.min(c.width - x, b.w + pad * 2), h = Math.min(c.height - y, b.h + pad * 2);
  const out = makeCanvas(w, h);
  out.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h);
  return canvasToBlob(out, 'image/png');
}

/** Smallest box around pixels whose alpha is above `threshold`. */
function alphaBounds(imageData, threshold) {
  const { width: w, height: h, data } = imageData;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Work out where a flower picture actually has something drawn, so that tapping
 * a see-through corner picks the flower underneath, and the selection outline
 * hugs the flower instead of the whole square.
 */
export function analyzeImage(img) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const k = Math.min(1, 160 / Math.max(W, H));
  const c = makeCanvas(W * k, H * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  let data;
  try {
    data = ctx.getImageData(0, 0, c.width, c.height);
  } catch {
    return { mask: null, bounds: { x: 0, y: 0, w: W, h: H } };
  }
  const alpha = new Uint8Array(c.width * c.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data.data[i * 4 + 3];
  const b = alphaBounds(data, 20) || { x: 0, y: 0, w: c.width, h: c.height };
  return {
    mask: { w: c.width, h: c.height, data: alpha, k },
    bounds: { x: b.x / k, y: b.y / k, w: b.w / k, h: b.h / k },
  };
}

/**
 * Read a picture from the clipboard (e.g. a flower "lifted" from a photo on
 * iPhone, or copied on Android). Returns a Blob, or throws an Error with a
 * friendly `code`: 'unsupported' | 'empty' | 'denied'.
 */
export async function readClipboardImage() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    const e = new Error('unsupported'); e.code = 'unsupported'; throw e;
  }
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch (err) {
    const e = new Error('denied'); e.code = err && err.name === 'NotAllowedError' ? 'denied' : 'empty'; throw e;
  }
  for (const item of items) {
    const type = item.types.find(t => t.startsWith('image/'));
    if (type) return item.getType(type);
  }
  const e = new Error('empty'); e.code = 'empty'; throw e;
}

export { canvasToBlob, makeCanvas };
