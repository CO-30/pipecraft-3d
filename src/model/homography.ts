/**
 * 射影変換（現場写真の壁を正面から見た画像に補正する）。
 * 四隅の対応から 3×3 行列を求め、補正後の各画素について元写真の画素を引く（最近傍）。
 */
import type { Vec2 } from './building';

export type Mat3 = number[]; // 行優先 9要素

/** from の4点を to の4点に写す行列 */
export function solveHomography(from: Vec2[], to: Vec2[]): Mat3 | null {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // ガウスの消去法（部分ピボット）
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [...h, 1];
}

export function applyH(H: Mat3, p: Vec2): Vec2 {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

/** quad（元写真の 左上・右上・右下・左下）を outW×outH の正面画像に補正 */
export function rectify(src: { data: Uint8ClampedArray; width: number; height: number }, quad: Vec2[], outW: number, outH: number): Uint8ClampedArray | null {
  const H = solveHomography([{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }], quad);
  if (!H) return null;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const s = applyH(H, { x: x + 0.5, y: y + 0.5 });
    const sx = Math.floor(s.x), sy = Math.floor(s.y);
    const o = (y * outW + x) * 4;
    if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) { out[o + 3] = 255; continue; }
    const i = (sy * src.width + sx) * 4;
    out[o] = src.data[i]; out[o + 1] = src.data[i + 1]; out[o + 2] = src.data[i + 2]; out[o + 3] = 255;
  }
  return out;
}

export type FaceRect = { x0: number; y0: number; x1: number; y1: number };

/**
 * 補正画像上の四角（px）→ 開口部の寸法(mm)。画像の幅 = 壁の長さ、高さ = 床から天井。
 * flipped: 写真の左端が壁の b 端（a→b が右から左）。10mm 単位に丸める。
 */
export function rectToOpening(r: FaceRect, outW: number, outH: number, wallLen: number, faceH: number, flipped: boolean) {
  const r10 = (v: number) => Math.round(v / 10) * 10;
  const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
  const kx = wallLen / outW, ky = faceH / outH;
  const cx = ((x0 + x1) / 2) * kx;
  return {
    offset: r10(flipped ? wallLen - cx : cx),
    width: r10((x1 - x0) * kx),
    height: r10((y1 - y0) * ky),
    sill: Math.max(0, r10((outH - y1) * ky)),
  };
}

/** 開口部(mm) → 補正画像上の四角（既存の開口部の表示用） */
export function openingToRect(o: { offset: number; width: number; height: number; sill: number }, outW: number, outH: number, wallLen: number, faceH: number, flipped: boolean): FaceRect {
  const kx = outW / wallLen, ky = outH / faceH;
  const cx = (flipped ? wallLen - o.offset : o.offset) * kx;
  return { x0: cx - (o.width / 2) * kx, x1: cx + (o.width / 2) * kx, y1: outH - o.sill * ky, y0: outH - (o.sill + o.height) * ky };
}
