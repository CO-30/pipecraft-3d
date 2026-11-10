/**
 * 壁・基礎の立上りの候補を線から拾う: 「太い線が 2 本、壁の厚さだけ離れて平行に走っている所」を帯（strip）として取り出す。
 * 入力は図面座標(mm)。水平・垂直の線だけを見る（斜めの壁は対象外）。すべて純粋関数。
 */
export type WSeg = { x1: number; y1: number; x2: number; y2: number; w: number };
/** 帯。dir 'h' は東西に走る（c は y、lo〜hi は x）、'v' は南北（c は x、lo〜hi は y）。t は厚さ */
export type Strip = { dir: 'h' | 'v'; c: number; lo: number; hi: number; t: number };
/** 軸に平行な線。pos は直角方向の位置、lo〜hi は線に沿った範囲 */
type Line = { pos: number; lo: number; hi: number };

export type StripOptions = { minT: number; maxT: number; minLen: number };
export const WALL_STRIP: StripOptions = { minT: 90, maxT: 260, minLen: 180 };

/** 軸からのずれの許容（長さに対する比） */
const AXIS_TOL = 0.01;
/** 組にする線の本数の上限（向きごと。長い線から採る）。ハッチの多い図面で端末が固まらないように */
export const MAX_LINES = 6000;
/** 同じ線とみなす直角方向のずれ(mm) / つなげる線のすき間(mm) */
const SAME_POS = 4, JOIN_GAP = 12;

/**
 * 断面（壁・基礎）を描いている線の太さ。図面では切り口をいちばん太い線で描くので、
 * 「十分な長さを占める太さのうち最も太いもの」を採る（枠や印の数本だけの極太線は除く）。
 */
export function heavyWidth(segs: WSeg[]): number {
  const total = new Map<number, number>();
  let sum = 0;
  for (const s of segs) {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const w = Math.round(s.w * 100) / 100;
    total.set(w, (total.get(w) ?? 0) + len);
    sum += len;
  }
  const big = [...total].filter(([, len]) => len >= sum * 0.04).map(([w]) => w);
  return big.length ? Math.max(...big) : 0;
}

function axisLines(segs: WSeg[], minW: number): { h: Line[]; v: Line[] } {
  const h: Line[] = [], v: Line[] = [];
  for (const s of segs) {
    if (s.w < minW) continue;
    const dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1);
    if (dx < 1 && dy < 1) continue;
    if (dy <= dx * AXIS_TOL) h.push({ pos: (s.y1 + s.y2) / 2, lo: Math.min(s.x1, s.x2), hi: Math.max(s.x1, s.x2) });
    else if (dx <= dy * AXIS_TOL) v.push({ pos: (s.x1 + s.x2) / 2, lo: Math.min(s.y1, s.y2), hi: Math.max(s.y1, s.y2) });
  }
  return { h: mergeLines(h), v: mergeLines(v) };
}

/** 同じ位置で、つながっている（すき間 JOIN_GAP 以内の）線を 1 本にする */
function mergeLines(lines: Line[]): Line[] {
  const sorted = [...lines].sort((a, b) => a.pos - b.pos || a.lo - b.lo);
  const out: Line[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].pos - sorted[i].pos <= SAME_POS) j++;
    const group = sorted.slice(i, j + 1).sort((a, b) => a.lo - b.lo);
    const pos = group.reduce((s, l) => s + l.pos, 0) / group.length;
    let cur = { pos, lo: group[0].lo, hi: group[0].hi };
    for (const l of group.slice(1)) {
      if (l.lo <= cur.hi + JOIN_GAP) cur.hi = Math.max(cur.hi, l.hi);
      else { out.push(cur); cur = { pos, lo: l.lo, hi: l.hi }; }
    }
    out.push(cur);
    i = j + 1;
  }
  return out;
}

function pairLines(lines: Line[], dir: 'h' | 'v', o: StripOptions): Strip[] {
  const sorted = lines.filter((l) => l.hi - l.lo >= o.minLen).sort((a, b) => b.hi - b.lo - (a.hi - a.lo)).slice(0, MAX_LINES).sort((a, b) => a.pos - b.pos);
  const out: Strip[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    /** a の向かいがすでに見つかった範囲（その先にある線は別の壁なので組にしない） */
    const taken: [number, number][] = [];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const t = b.pos - a.pos;
      if (t > o.maxT) break;
      const lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
      if (hi - lo < o.minLen) continue;
      if (t >= o.minT) {
        for (const [p, q] of subtract([lo, hi], taken)) if (q - p >= o.minLen) out.push({ dir, c: (a.pos + b.pos) / 2, lo: p, hi: q, t });
      }
      // 厚さに満たない近い線（仕上げ線など）も、その先を隠す
      taken.push([lo, hi]);
    }
  }
  return out;
}

/** 区間 r から cuts を引いた残り */
export function subtract(r: [number, number], cuts: [number, number][]): [number, number][] {
  let rest: [number, number][] = [r];
  for (const [c0, c1] of cuts) {
    rest = rest.flatMap(([a, b]): [number, number][] => (c1 <= a || c0 >= b ? [[a, b]] : [[a, Math.min(b, c0)], [Math.max(a, c1), b]]));
    rest = rest.filter(([a, b]) => b - a > 1e-6);
  }
  return rest;
}

/** 太い線の組から帯を取り出す。minWidthRatio: 「太い線」とみなす下限（最も太い線に対する比） */
export function detectStrips(segs: WSeg[], o: StripOptions = WALL_STRIP, minWidthRatio = 0.85): Strip[] {
  const { h, v } = axisLines(segs, heavyWidth(segs) * minWidthRatio);
  return [...pairLines(h, 'h', o), ...pairLines(v, 'v', o)];
}
