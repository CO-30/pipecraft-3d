/**
 * スキャンした図面（画像だけの PDF・写真）から壁の候補を読む。すべて純粋関数。
 * 画素 → インクの印（inkMask）→ 水平・垂直の線（rasterLines）→ 図面座標の線 → ベクター図面と同じ壁の読み取り
 * （strips.ts の「太い線 2 本が壁の厚さだけ離れて平行」→ walls.ts の壁芯・開口・外壁/内壁）。
 * 文字は読まない（縮尺は下敷きで決める）。斜めの壁は対象外。
 */
import type { Vec2 } from '../building';
import { detectStrips, heavyWidth, WALL_STRIP, type Strip, type WSeg } from './strips';
import { buildingStrips, wallsFromStrips, type WallOpening } from './walls';

/** 色の濃さ（最大−最小）がこれより大きい画素は書き込み（赤ペン・青ペン）とみなしてインクにしない */
const CHROMA = 60;
/** 明るさの幅がこれより狭い画像（白紙・真っ黒）は読まない */
const MIN_CONTRAST = 40;
/** 大津の閾値を最も暗い値からどれだけの割合の所に置くか */
const DARK_BIAS = 0.6;

/** 画素（RGBA）→ インクなら 1。明るさの閾値は大津の方法（薄いスキャンにも合わせる） */
export function inkMask(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const n = w * h, lum = new Uint8Array(n), gray = new Uint8Array(n);
  const hist = new Float64Array(256);
  let lo = 255, hi = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const L = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    lum[i] = L;
    if (Math.max(r, g, b) - Math.min(r, g, b) > CHROMA) continue;
    gray[i] = 1; hist[L]++;
    if (L < lo) lo = L;
    if (L > hi) hi = L;
  }
  const mask = new Uint8Array(n);
  if (hi - lo < MIN_CONTRAST) return mask;
  // 大津の閾値: 2 つの組の分散が最も大きくなる明るさ
  let total = 0, sumAll = 0;
  for (let t = 0; t < 256; t++) { total += hist[t]; sumAll += t * hist[t]; }
  let wB = 0, sumB = 0, best = -1, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  // 図面の線はいちばん暗い所。カラーの層の薄い灰色（網掛け・薄い文字）を拾わないよう、閾値を暗い側へ寄せる
  thr = Math.round(lo + (thr - lo) * DARK_BIAS);
  for (let i = 0; i < n; i++) if (gray[i] && lum[i] <= thr) mask[i] = 1;
  return mask;
}

/** 水平（dir 'h'）・垂直（'v'）の線（画素）。c は線の中心（行・列）、lo〜hi は線に沿った範囲、t は太さ */
export type PxLine = { dir: 'h' | 'v'; c: number; lo: number; hi: number; t: number };

/** 長さ minRun 以上のインクの並びを行（列）ごとに拾い、同じ幅で続くものを 1 本の線にまとめる */
export function rasterLines(mask: Uint8Array, w: number, h: number, minRun: number): PxLine[] {
  const out: PxLine[] = [];
  for (const dir of ['h', 'v'] as const) {
    const rows = dir === 'h' ? h : w, len = dir === 'h' ? w : h;
    type Band = { a: number; b: number; lo: number; hi: number };
    let active: Band[] = [];
    const flush = (b: Band) => out.push({ dir, c: (b.a + b.b) / 2, lo: b.lo, hi: b.hi, t: b.b - b.a + 1 });
    for (let r = 0; r < rows; r++) {
      const next: Band[] = [];
      let s = -1;
      for (let k = 0; k <= len; k++) {
        const ink = k < len && mask[dir === 'h' ? r * w + k : k * w + r] === 1;
        if (ink) { if (s < 0) s = k; continue; }
        if (s >= 0 && k - s >= minRun) {
          const lo = s, hi = k - 1;
          const i = active.findIndex((b) => Math.abs(b.lo - lo) <= 3 && Math.abs(b.hi - hi) <= 3);
          if (i >= 0) { const b = active[i]; active.splice(i, 1); b.b = r; b.lo = Math.min(b.lo, lo); b.hi = Math.max(b.hi, hi); next.push(b); }
          else next.push({ a: r, b: r, lo, hi });
        }
        s = -1;
      }
      for (const b of active) flush(b);
      active = next;
    }
    for (const b of active) flush(b);
  }
  return out;
}

/**
 * 表（申請書・チェックシートの罫線など）を除く: 平行な帯が線を共有して並ぶ（はしご）所は壁ではない。
 * 本物の壁は 1 本の線を両側の壁で共有しない
 */
export function dropLadders(strips: Strip[]): Strip[] {
  const shares = (p: Strip, q: Strip) => p !== q && p.dir === q.dir
    && Math.abs(Math.abs(p.c - q.c) - (p.t + q.t) / 2) < Math.min(p.t, q.t) * 0.25
    && Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo) > Math.min(p.hi - p.lo, q.hi - q.lo) * 0.5;
  return strips.filter((p) => !strips.some((q) => shares(p, q)));
}

const wallLen = (w: { a: Vec2; b: Vec2 }) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
/** 点から線分までの距離 */
const distTo = (p: Vec2, w: { a: Vec2; b: Vec2 }) => {
  const L = wallLen(w), t = L ? Math.max(0, Math.min(1, ((p.x - w.a.x) * (w.b.x - w.a.x) + (p.y - w.a.y) * (w.b.y - w.a.y)) / (L * L))) : 0;
  return Math.hypot(p.x - (w.a.x + (w.b.x - w.a.x) * t), p.y - (w.a.y + (w.b.y - w.a.y) * t));
};
/**
 * スキャンの読み取りの誤り（文字枠・記号の枠・寸法の付近）を除く: 厚すぎて短い壁（厚さ 180mm 超・長さ 1m 未満）と、
 * どの壁にも端が触れていない短い壁（600mm 未満）
 */
function pruneWalls<T extends { a: Vec2; b: Vec2; thickness: number }>(walls: T[]): T[] {
  const keep = walls.filter((w) => !(w.thickness > 180 && wallLen(w) < 1000));
  return keep.filter((w) => wallLen(w) >= 600 || keep.some((o) => o !== w && (distTo(w.a, o) < 150 || distTo(w.b, o) < 150)));
}

/** 壁の候補（端は画像の画素の座標、厚さと開口は mm） */
export type PxWall = { a: Vec2; b: Vec2; thickness: number; kind: 'exterior' | 'interior'; openings: WallOpening[] };

/**
 * インクの印 → 壁。mmPerPx は 1px の実寸（縮尺込み）、paperMmPerPx は紙の上の寸法（線の太さの比べ方にだけ使う）。
 * 線と見なす長さは 300mm 以上（壁の厚さより長くして、直角に走る壁の切り口を線と取り違えない）
 */
export function rasterWalls(mask: Uint8Array, w: number, h: number, mmPerPx: number, paperMmPerPx: number): PxWall[] {
  if (!(mmPerPx > 0)) return [];
  const minRun = Math.max(6, Math.ceil(300 / mmPerPx));
  const segs: WSeg[] = rasterLines(mask, w, h, minRun).map((l) => (l.dir === 'h'
    ? { x1: l.lo * mmPerPx, y1: -l.c * mmPerPx, x2: (l.hi + 1) * mmPerPx, y2: -l.c * mmPerPx, w: l.t * paperMmPerPx }
    : { x1: l.c * mmPerPx, y1: -l.lo * mmPerPx, x2: l.c * mmPerPx, y2: -(l.hi + 1) * mmPerPx, w: l.t * paperMmPerPx }));
  if (!heavyWidth(segs)) return [];
  const walls = pruneWalls(wallsFromStrips(buildingStrips(dropLadders(detectStrips(segs, WALL_STRIP))), segs));
  const px = (p: Vec2): Vec2 => ({ x: p.x / mmPerPx, y: -p.y / mmPerPx });
  return walls.map((v) => ({ a: px(v.a), b: px(v.b), thickness: v.thickness, kind: v.kind, openings: v.openings }));
}
