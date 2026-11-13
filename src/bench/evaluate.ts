/**
 * 図面の読み取り結果を正解データと比べて、誤差を数字にする（純粋関数）。
 * 読み取り結果は Reading（読み取りの形に依存しない平らな形）。PlanSetResult からは readingOf（reading.ts）で作る。
 */
import type { Truth } from './truth';

type V = { x: number; y: number };
export type BenchWall = { floor: number; a: V; b: V; thickness: number };
export type BenchItem = { type: string; x: number; y: number };
export type Reading = {
  sheets: { name: string; kind: string; scale?: number }[];
  floors: { n: number; height: number }[];
  glToFl?: number;
  walls: BenchWall[];
  openings: { floor: number; count: number }[];
  fixtures: (BenchItem & { floor: number })[];
  site: BenchItem[];
  /** 要確認として出したこと */
  checks: string[];
};

export type TypeCount = { truth: number; read: number; matched: number; missing: number; extra: number };
export type ItemScore = { byType: Record<string, TypeCount>; recall: number | null; precision: number | null; positionMedian: number | null; positionMax: number | null };
export type Score = {
  sheets: { total: number; kindCorrect: number; scaleTotal: number; scaleCorrect: number; wrong: string[] };
  floors: { truth: number; read: number; heightErrorMax: number | null; glToFlError: number | null };
  walls: { truthLength: number; readLength: number; recall: number | null; precision: number | null; thicknessError: number | null };
  openings: { truth: number; read: number; diff: number } | null;
  fixtures: ItemScore;
  site: ItemScore;
  checks: number;
};

/** 同じ壁とみなす芯のずれ(mm)・向きのずれ */
export const WALL_TOL_MM = 100;
const ANGLE_TOL = Math.sin((5 * Math.PI) / 180);
/** 同じ器具とみなす距離(mm) */
export const ITEM_TOL_MM = 2000;

const len = (w: BenchWall) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);

/** 壁 q が壁 p と重なる長さ（p の線上に投影、芯のずれ・向きが許容内のときだけ） */
function overlap(p: BenchWall, q: BenchWall): number {
  if (p.floor !== q.floor) return 0;
  const L = len(p), M = len(q);
  if (L < 1 || M < 1) return 0;
  const ux = (p.b.x - p.a.x) / L, uy = (p.b.y - p.a.y) / L;
  const vx = (q.b.x - q.a.x) / M, vy = (q.b.y - q.a.y) / M;
  if (Math.abs(ux * vy - uy * vx) > ANGLE_TOL) return 0;
  const off = (pt: V) => Math.abs((pt.x - p.a.x) * uy - (pt.y - p.a.y) * ux);
  if (off({ x: (q.a.x + q.b.x) / 2, y: (q.a.y + q.b.y) / 2 }) > WALL_TOL_MM) return 0;
  const t = (pt: V) => (pt.x - p.a.x) * ux + (pt.y - p.a.y) * uy;
  const lo = Math.max(0, Math.min(t(q.a), t(q.b))), hi = Math.min(L, Math.max(t(q.a), t(q.b)));
  return Math.max(0, hi - lo);
}

/** 区間 [lo, hi] の和の長さ（重なりを二重に数えない） */
function covered(walls: BenchWall[], p: BenchWall): number {
  const L = len(p);
  if (L < 1) return 0;
  const ux = (p.b.x - p.a.x) / L, uy = (p.b.y - p.a.y) / L;
  const t = (pt: V) => (pt.x - p.a.x) * ux + (pt.y - p.a.y) * uy;
  const iv = walls.filter((q) => overlap(p, q) > 0)
    .map((q) => [Math.max(0, Math.min(t(q.a), t(q.b))), Math.min(L, Math.max(t(q.a), t(q.b)))] as const)
    .sort((a, b) => a[0] - b[0]);
  let sum = 0, cur = -Infinity, end = -Infinity;
  for (const [lo, hi] of iv) {
    if (lo > end) { if (end > cur) sum += end - cur; cur = lo; end = hi; } else end = Math.max(end, hi);
  }
  if (end > cur) sum += end - cur;
  return sum;
}

function scoreWalls(read: BenchWall[], truth: BenchWall[] | undefined): Score['walls'] {
  const readLength = read.reduce((s, w) => s + len(w), 0);
  if (!truth?.length) return { truthLength: 0, readLength, recall: null, precision: null, thicknessError: null };
  const truthLength = truth.reduce((s, w) => s + len(w), 0);
  const hitT = truth.reduce((s, w) => s + covered(read, w), 0);
  const hitR = read.reduce((s, w) => s + covered(truth, w), 0);
  // 厚さ: 正解の壁ごとに、いちばん長く重なる読んだ壁との差（重なった長さで重み付け）
  let wsum = 0, esum = 0;
  for (const t of truth) {
    let best: BenchWall | null = null, bo = 0;
    for (const r of read) { const o = overlap(t, r); if (o > bo) { bo = o; best = r; } }
    if (best) { wsum += bo; esum += bo * Math.abs(best.thickness - t.thickness); }
  }
  return {
    truthLength, readLength,
    recall: hitT / truthLength,
    precision: readLength ? hitR / readLength : 0,
    thicknessError: wsum ? Math.round(esum / wsum) : null,
  };
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

/** 種類（と階）ごとに、近い順に 1 対 1 で組にする */
function scoreItems(read: (BenchItem & { floor?: number })[], truth: (BenchItem & { floor?: number })[] | undefined): ItemScore {
  const t = truth ?? [];
  const byType: Record<string, TypeCount> = {};
  const errors: number[] = [];
  const types = new Set([...t.map((x) => x.type), ...read.map((x) => x.type)]);
  for (const type of types) {
    const tt = t.filter((x) => x.type === type), rr = read.filter((x) => x.type === type);
    const pairs: [number, number, number][] = [];
    tt.forEach((a, i) => rr.forEach((b, j) => {
      if ((a.floor ?? 0) !== (b.floor ?? 0)) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d <= ITEM_TOL_MM) pairs.push([d, i, j]);
    }));
    pairs.sort((p, q) => p[0] - q[0]);
    const ui = new Set<number>(), uj = new Set<number>();
    for (const [d, i, j] of pairs) if (!ui.has(i) && !uj.has(j)) { ui.add(i); uj.add(j); errors.push(d); }
    byType[type] = { truth: tt.length, read: rr.length, matched: ui.size, missing: tt.length - ui.size, extra: rr.length - ui.size };
  }
  const m = Object.values(byType).reduce((s, c) => s + c.matched, 0);
  return {
    byType,
    recall: t.length ? m / t.length : null,
    precision: t.length ? (read.length ? m / read.length : 0) : null,
    positionMedian: median(errors),
    positionMax: errors.length ? Math.round(Math.max(...errors)) : null,
  };
}

const baseName = (s: string) => s.replace(/\.[a-z0-9]+$/i, '');

export function evaluate(r: Reading, t: Truth): Score {
  // 図面
  const wrong: string[] = [];
  let kindCorrect = 0, scaleCorrect = 0, scaleTotal = 0;
  for (const ts of t.sheets ?? []) {
    const rs = r.sheets.find((s) => baseName(s.name) === baseName(ts.name));
    if (rs?.kind === ts.kind) kindCorrect++;
    else wrong.push(`${ts.name}: 種類 ${rs?.kind ?? '読めず'}（正解 ${ts.kind}）`);
    if (ts.scale) {
      scaleTotal++;
      if (rs?.scale === ts.scale) scaleCorrect++;
      else wrong.push(`${ts.name}: 縮尺 ${rs?.scale ? `1/${rs.scale}` : '読めず'}（正解 1/${ts.scale}）`);
    }
  }
  // 階
  const herr = (t.floors ?? []).flatMap((f) => { const g = r.floors.find((x) => x.n === f.n); return g ? [Math.abs(g.height - f.height)] : []; });
  const openings = t.openings?.length
    ? (() => { const a = t.openings.reduce((s, o) => s + o.count, 0), b = r.openings.reduce((s, o) => s + o.count, 0); return { truth: a, read: b, diff: b - a }; })()
    : null;
  return {
    sheets: { total: t.sheets?.length ?? 0, kindCorrect, scaleTotal, scaleCorrect, wrong },
    floors: {
      truth: t.floors?.length ?? 0,
      read: r.floors.length,
      heightErrorMax: herr.length ? Math.max(...herr) : null,
      glToFlError: t.glToFl !== undefined && r.glToFl !== undefined ? Math.abs(r.glToFl - t.glToFl) : null,
    },
    walls: scoreWalls(r.walls, t.walls),
    openings,
    fixtures: scoreItems(r.fixtures, t.fixtures),
    site: scoreItems(r.site, t.site),
    checks: r.checks.length,
  };
}
