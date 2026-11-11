/**
 * 配置図を読む（純関数）。
 * - 記号の大きさは図面の凡例から測る（汚水公共桝・汚水桝・雨水桝）。凡例そのものは数えない
 * - 汚水公共桝（大きな四角の中に ☒）・汚水桝（☒）・雨水桝（□）・水道メーター（「WM」）・敷地の高さ（「GL−950」）・BM（「BM+550=GL±0」）
 * - 配置図には通り芯が無いことが多いので、平面図の外壁と配置図の線の重なりで位置を合わせる（alignSite）
 */
import type { Vec2 } from '../building';
import type { FixtureType } from '../fixtures';
import type { PSeg, PText, ToWorld, VectorPage } from './sheet';

export type SiteItem = { type: Extract<FixtureType, 'publicSewage' | 'manholeSewage' | 'manholeRain' | 'waterMeter' | 'outdoorFaucet'>; p: Vec2 };
/** 配置図から読めたもの（紙の座標 pt）。levels: 敷地の高さ（設計 GL からの mm）、bm: BM から GL±0 までの高さ(mm) */
export type SiteRead = {
  legend: { publicSewer?: number; sewer?: number; rain?: number } | null;
  items: SiteItem[];
  levels: { p: Vec2; gl: number }[];
  bm?: number;
};

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
const len = (s: PSeg) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const LEGEND: Record<string, 'publicSewer' | 'sewer' | 'rain' | 'meter' | 'level' | 'other'> = {
  汚水公共桝: 'publicSewer', 公共桝: 'publicSewer', 汚水公共ます: 'publicSewer', 公共ます: 'publicSewer',
  汚水桝: 'sewer', 汚水ます: 'sewer', 雨水桝: 'rain', 雨水ます: 'rain', 水道メーター: 'meter', 敷地レベル: 'level',
  // 凡例の行として除くだけ（記号は数えない）
  立水栓: 'other', 散水栓: 'other', 浸透槽: 'other', 浸透桝: 'other', 玄関位置: 'other', 給湯器: 'other',
};
/** 円（短い線の集まり）が四角のすぐ横にあるか: 立水栓（□○）。雨水桝と見分ける */
function circleBeside(segs: PSeg[], b: { cx: number; cy: number; size: number }): boolean {
  const r = b.size * 1.7;
  const short = segs.filter((s) => len(s) < 0.6 && Math.hypot((s.x1 + s.x2) / 2 - b.cx, (s.y1 + s.y2) / 2 - b.cy) < r
    && (Math.abs((s.x1 + s.x2) / 2 - b.cx) > b.size / 2 + 0.1 || Math.abs((s.y1 + s.y2) / 2 - b.cy) > b.size / 2 + 0.1));
  return short.length >= 12;
}

type Box = { cx: number; cy: number; size: number; cross: boolean };

/** 軸に平行な四角（上下の辺がそろっている）を探す。sizes の大きさ（±15%）だけ */
function findBoxes(segs: PSeg[], sizes: number[]): Box[] {
  const hs = segs.filter((s) => Math.abs(s.y1 - s.y2) < 0.05 && sizes.some((z) => Math.abs(len(s) - z) <= z * 0.15));
  const out: Box[] = [];
  for (const h of hs) {
    const x0 = Math.min(h.x1, h.x2), x1 = Math.max(h.x1, h.x2), L = x1 - x0;
    const other = hs.find((g) => g !== h && Math.abs(Math.min(g.x1, g.x2) - x0) < 0.4 && Math.abs(Math.max(g.x1, g.x2) - x1) < 0.4 && Math.abs(g.y1 - h.y1 - L) < 0.4);
    if (!other) continue;
    const cx = (x0 + x1) / 2, cy = h.y1 + L / 2;
    if (out.some((b) => Math.hypot(b.cx - cx, b.cy - cy) < 0.3 && Math.abs(b.size - L) < 0.3)) continue;
    const near = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y) < 0.7;
    const diag = (a: Vec2, b: Vec2) => segs.some((s) => (near({ x: s.x1, y: s.y1 }, a) && near({ x: s.x2, y: s.y2 }, b)) || (near({ x: s.x1, y: s.y1 }, b) && near({ x: s.x2, y: s.y2 }, a)));
    const h2 = L / 2;
    const cross = diag({ x: cx - h2, y: cy - h2 }, { x: cx + h2, y: cy + h2 }) && diag({ x: cx - h2, y: cy + h2 }, { x: cx + h2, y: cy - h2 });
    out.push({ cx, cy, size: L, cross });
  }
  return out;
}

export function readSite(page: VectorPage): SiteRead {
  // 凡例: ラベルの左の同じ行にある記号の大きさ
  const labels = page.texts.map((t) => ({ t, k: LEGEND[norm(t.s)] })).filter((x) => x.k);
  const rows = labels.map(({ t }) => ({ y: t.y, x0: t.x - 110, x1: t.x + 5 }));
  const inLegend = (p: Vec2) => rows.some((r) => Math.abs(p.y - r.y) < 4 && p.x >= r.x0 && p.x <= r.x1);
  const sizeOf = (t: PText) => {
    const near = page.segs.filter((s) => len(s) >= 2.5 && Math.abs((s.y1 + s.y2) / 2 - t.y) <= 3.5 && Math.min(s.x1, s.x2) >= t.x - 110 && Math.max(s.x1, s.x2) <= t.x - 3);
    if (!near.length) return undefined;
    const xs = near.flatMap((s) => [s.x1, s.x2]);
    return Math.max(...xs) - Math.min(...xs);
  };
  const legend: NonNullable<SiteRead['legend']> = {};
  for (const { t, k } of labels) if (k === 'publicSewer' || k === 'sewer' || k === 'rain') legend[k] ??= sizeOf(t);
  const has = Object.values(legend).some((v) => v !== undefined);

  const items: SiteItem[] = [];
  if (has) {
    const sizes = [legend.publicSewer, legend.sewer, legend.rain].filter((v): v is number => v !== undefined);
    const boxes = findBoxes(page.segs, sizes).filter((b) => !inLegend({ x: b.cx, y: b.cy }));
    const is = (b: Box, z?: number) => z !== undefined && Math.abs(b.size - z) <= z * 0.15;
    const used = new Set<Box>();
    // 公共桝: 大きな四角の中に ☒（凡例の大きさが汚水桝と区別できるときだけ）
    if (legend.publicSewer && (!legend.sewer || legend.publicSewer > legend.sewer * 1.15)) {
      for (const b of boxes.filter((x) => is(x, legend.publicSewer))) {
        const inner = boxes.find((x) => x !== b && x.size < b.size && Math.hypot(x.cx - b.cx, x.cy - b.cy) < 0.5);
        if (!inner) continue;
        used.add(b); used.add(inner);
        items.push({ type: 'publicSewage', p: { x: b.cx, y: b.cy } });
      }
    }
    for (const b of boxes) {
      if (used.has(b)) continue;
      if (b.cross && is(b, legend.sewer)) items.push({ type: 'manholeSewage', p: { x: b.cx, y: b.cy } });
      else if (!b.cross && circleBeside(page.segs, b)) items.push({ type: 'outdoorFaucet', p: { x: b.cx, y: b.cy } });
      else if (!b.cross && is(b, legend.rain) && !is(b, legend.publicSewer)) items.push({ type: 'manholeRain', p: { x: b.cx, y: b.cy } });
    }
  }
  const levels: SiteRead['levels'] = [];
  let bm: number | undefined;
  for (const t of page.texts) {
    const s = norm(t.s);
    if (inLegend(t)) continue;
    if (s === 'WM') items.push({ type: 'waterMeter', p: { x: t.x, y: t.y } });
    const m = /^GL([±+\-−])(\d*)$/.exec(s);
    if (m) levels.push({ p: { x: t.x, y: t.y }, gl: m[1] === '±' ? 0 : (m[1] === '+' ? 1 : -1) * Number(m[2] || 0) });
    const b = /BM\+(\d+)=GL±0/.exec(s);
    if (b) bm = Number(b[1]);
  }
  return { legend: has ? legend : null, items, levels, ...(bm !== undefined ? { bm } : {}) };
}

/** 平面図の外壁（芯 a→b、厚さ t、図面座標 mm） */
export type RefWall = { a: Vec2; b: Vec2; t: number };
type AxisLine = { v: boolean; c: number; lo: number; hi: number };
/** 配置図の線で家の外形とみなす長さの下限(mm) */
const MIN_LINE = 900;
/** 外壁の線と重なっているとみなす離れ(mm) */
const NEAR = 30;

/**
 * 配置図（縮尺 k mm/pt、回転なし）を平面図の外壁に合わせる。外壁の芯・外面・内面と配置図の縦横の線のずれを数え、
 * 重なる長さがいちばん長いずれを採る。外壁の長さの半分以上重ならなければ null（合わせられない）
 */
export function alignSite(page: VectorPage, k: number, ref: RefWall[]): ToWorld | null {
  const site: AxisLine[] = page.segs.filter((s) => len(s) * k >= MIN_LINE && (Math.abs(s.x1 - s.x2) < 0.05 || Math.abs(s.y1 - s.y2) < 0.05)).map((s) => {
    const v = Math.abs(s.x1 - s.x2) < 0.05;
    const [x1, y1, x2, y2] = [s.x1 * k, -s.y1 * k, s.x2 * k, -s.y2 * k];
    return { v, c: v ? x1 : y1, lo: v ? Math.min(y1, y2) : Math.min(x1, x2), hi: v ? Math.max(y1, y2) : Math.max(x1, x2) };
  });
  const walls = ref.filter((w) => Math.abs(w.a.x - w.b.x) < 1 || Math.abs(w.a.y - w.b.y) < 1).map((w) => {
    const v = Math.abs(w.a.x - w.b.x) < 1;
    return { v, c: v ? w.a.x : w.a.y, lo: v ? Math.min(w.a.y, w.b.y) : Math.min(w.a.x, w.b.x), hi: v ? Math.max(w.a.y, w.b.y) : Math.max(w.a.x, w.b.x), t: w.t };
  });
  const perimeter = walls.reduce((s, w) => s + (w.hi - w.lo), 0);
  if (!site.length || perimeter <= 0) return null;
  const votes = (v: boolean) => {
    const m = new Map<number, number>();
    for (const s of site.filter((x) => x.v === v)) for (const w of walls.filter((x) => x.v === v)) for (const o of [-w.t / 2, 0, w.t / 2]) {
      const d = Math.round((w.c + o - s.c) / 10) * 10;
      m.set(d, (m.get(d) ?? 0) + Math.min(s.hi - s.lo, w.hi - w.lo));
    }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 20).map((x) => x[0]);
  };
  /** ずれ (dx, dy) で外壁と重なる長さ: 外壁ごとに、芯・外面・内面のどれかに乗る線の長さ（外壁の長さまで） */
  const score = (dx: number, dy: number) => walls.reduce((sum, w) => {
    let got = 0;
    for (const s of site) {
      if (s.v !== w.v) continue;
      const c = s.c + (s.v ? dx : dy), lo = s.lo + (s.v ? dy : dx), hi = s.hi + (s.v ? dy : dx);
      if (![-w.t / 2, 0, w.t / 2].some((o) => Math.abs(c - (w.c + o)) <= NEAR)) continue;
      got += Math.max(0, Math.min(hi, w.hi) - Math.max(lo, w.lo));
    }
    return sum + Math.min(got, w.hi - w.lo);
  }, 0);
  let best: { dx: number; dy: number; s: number } | null = null;
  for (const dx of votes(true)) for (const dy of votes(false)) {
    const s = score(dx, dy);
    if (!best || s > best.s) best = { dx, dy, s };
  }
  if (!best || best.s < 0.5 * perimeter) return null;
  // world x = px·k + dx = (px − ox)·k、world y = −py·k + dy = (oy − py)·k
  return { ox: -best.dx / k, oy: best.dy / k, k };
}
