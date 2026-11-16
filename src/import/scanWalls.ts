/** 下敷きの画像（スキャンした図面）を画素にして、壁の候補を読む（ブラウザだけ。読み取りの中身は src/model/planRead/raster.ts） */
import type { Underlay } from '../model/underlay';
import { inkMask, rasterWalls, type PxWall } from '../model/planRead/raster';

export async function readWallsFromUnderlay(u: Underlay): Promise<PxWall[]> {
  const img = new Image();
  img.decoding = 'async';
  img.src = u.src;
  await img.decode();
  // 壁の端は下敷きの画素（widthPx × heightPx）の座標で返すので、その大きさで描く
  const canvas = document.createElement('canvas');
  canvas.width = u.widthPx; canvas.height = u.heightPx;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('画像を読めませんでした');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, u.widthPx, u.heightPx);
  ctx.drawImage(img, 0, 0, u.widthPx, u.heightPx);
  const { data } = ctx.getImageData(0, 0, u.widthPx, u.heightPx);
  // 紙の上の 1px（線の太さの比べ方だけに使う）。写真など紙の大きさが分からないときは 1/100 とみなす
  const paper = u.paperMmPerPx ?? u.mmPerPx / 100;
  return rasterWalls(inkMask(data, u.widthPx, u.heightPx), u.widthPx, u.heightPx, u.mmPerPx, paper);
}
