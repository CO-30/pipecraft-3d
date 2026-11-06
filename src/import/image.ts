/** 画像ファイル → 縮小した JPEG の data URL（下敷き・写真補正用） */
import { MAX_UNDERLAY_PX, TARGET_UNDERLAY_SRC } from '../model/underlay';

export type Raster = { src: string; widthPx: number; heightPx: number };

/** EXIF の向きを反映して読み込む */
export async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 下へ */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const sizeOf = (img: CanvasImageSource) => {
  const i = img as { naturalWidth?: number; width: number; naturalHeight?: number; height: number };
  return { w: i.naturalWidth || i.width, h: i.naturalHeight || i.height };
};

export function canvasFrom(img: CanvasImageSource, maxPx = MAX_UNDERLAY_PX, crop?: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const { w, h } = crop ?? { ...sizeOf(img), x: 0, y: 0 };
  const k = Math.min(1, maxPx / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  if (crop) ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
  else ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** JPEG にする。保存できる大きさに収まるまで画質→画素数の順に下げる */
export function toRaster(c: HTMLCanvasElement, quality = 0.85): Raster {
  let cur = c, q = quality;
  for (let i = 0; i < 12; i++) {
    const src = cur.toDataURL('image/jpeg', q);
    if (src.length <= TARGET_UNDERLAY_SRC) return { src, widthPx: cur.width, heightPx: cur.height };
    if (q > 0.6) q -= 0.1;
    else cur = canvasFrom(cur, Math.round(Math.max(cur.width, cur.height) * 0.8));
  }
  throw new Error('画像が大きすぎます');
}

export async function fileToRaster(file: Blob, maxPx = MAX_UNDERLAY_PX): Promise<Raster> {
  return toRaster(canvasFrom(await loadBitmap(file), maxPx));
}
