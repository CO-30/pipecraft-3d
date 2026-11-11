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
/** 四角の横の円・円弧（短い線の集まり）の中心と半径（最小二乗の円の当てはめ。半分しか描かれていない円でもよい）。円らしくなければ null */
function circleNear(segs: PSeg[], b: { cx: number; cy: number; size: number }, reach: number): { c: Vec2; r: number } | null {
  const pts = segs.filter((s) => len(s) < 0.8).flatMap((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }])
    .filter((m) => Math.hypot(m.x - b.cx, m.y - b.cy) < reach && (Math.abs(m.x - b.cx) > b.size / 2 + 0.1 || Math.abs(m.y - b.cy) > b.size / 2 + 0.1));
  // 当てはめて、円から外れた点（近くの破線など）を除いてもう一度
  const first = fitCircle(pts);
  if (!first) return null;
  const on = pts.filter((p) => Math.abs(Math.hypot(p.x - first.c.x, p.y - first.c.y) - first.r) < 0.4);
  const fit = on.length >= 12 ? fitCircle(on) : null;
  return fit && fit.r > 0.3 && fit.sd < fit.r * 0.15 ? { c: fit.c, r: fit.r } : null;
}

/** 最小二乗の円（x² + y² + D·x + E·y + F = 0 を 3×3 の連立方程式で解く） */
function fitCircle(pts: Vec2[]): { c: Vec2; r: number; sd: number } | null {
  if (pts.length < 12) return null;
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
  for (const p of pts) {
    const row = [p.x, p.y, 1], z = -(p.x * p.x + p.y * p.y);
    for (let i = 0; i < 3; i++) { v[i] += row[i] * z; for (let j = 0; j < 3; j++) m[i][j] += row[i] * row[j]; }
  }
  const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d0 = det(m);
  if (Math.abs(d0) < 1e-9) return null;
  const col = (k: number) => m.map((r, i) => r.map((x, j) => (j === k ? v[i] : x)));
  const [D, E, F] = [0, 1, 2].map((k) => det(col(k)) / d0);
  const c = { x: -D / 2, y: -E / 2 };
  const r2 = c.x * c.x + c.y * c.y - F;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  const sd = Math.sqrt(pts.reduce((t, p) => t + (Math.hypot(p.x - c.x, p.y - c.y) - r) ** 2, 0) / pts.length);
  return { c, r, sd };
}

type Box = { cx: number; cy: number; size: number; cross: boolean };

/**
 * 凡例の立水栓（□○）と同じ形か: 四角の上下左右、凡例と同じ離れの所に、凡例と同じ半径の円（半分以上描かれていればよい）がある。
 * 雨どいの丸（大きさ・離れが違う）や近くの別の円弧と見分ける
 */
function isFaucet(segs: PSeg[], b: Box, f: { r: number; off: number }): boolean {
  const pts = segs.filter((s) => len(s) < 0.8).flatMap((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }])
    .filter((p) => Math.hypot(p.x - b.cx, p.y - b.cy) < f.off + f.r * 1.5);
  for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c = { x: b.cx + ux * f.off, y: b.cy + uy * f.off };
    const on = pts.filter((p) => Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - f.r) < Math.max(0.3, f.r * 0.15));
    // 円の回り 12 区分のうち半分以上に点がある
    const bins = new Set(on.map((p) => Math.floor(((Math.atan2(p.y - c.y, p.x - c.x) + Math.PI) / (2 * Math.PI)) * 12) % 12));
    if (bins.size >= 6) return true;
  }
  return false;
}


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
    // 縦の辺もある（同じ間隔の平行線・ハッチを四角と取り違えない）
    const side = (x: number) => segs.some((s) => Math.abs(s.x1 - s.x2) < 0.05 && Math.abs(s.x1 - x) < 0.4 && Math.min(s.y1, s.y2) <= h.y1 + 0.4 + L * 0.2 && Math.max(s.y1, s.y2) >= h.y1 + L * 0.8 - 0.4);
    if (!side(x0) || !side(x1)) continue;
    // ×: 四角の中で、中心近くを通る右上がり・右下がりの斜めの線（角まで届かなくてもよい）
    const inside = (s: PSeg) => [s.x1, s.x2].every((x) => x >= x0 - 0.3 && x <= x1 + 0.3) && [s.y1, s.y2].every((y) => y >= h.y1 - 0.3 && y <= h.y1 + L + 0.3);
    const through = (s: PSeg) => { const d = Math.abs((s.x2 - s.x1) * (s.y1 - cy) - (s.x1 - cx) * (s.y2 - s.y1)) / Math.max(len(s), 1e-6); return d < L * 0.12; };
    const diags = segs.filter((s) => inside(s) && len(s) >= L * 0.5 && Math.abs(s.x1 - s.x2) > 0.1 && Math.abs(s.y1 - s.y2) > 0.1 && through(s));
    const cross = diags.some((s) => (s.x2 - s.x1) * (s.y2 - s.y1) > 0) && diags.some((s) => (s.x2 - s.x1) * (s.y2 - s.y1) < 0);
    out.push({ cx, cy, size: L, cross });
  }
  return out;
}

export function readSite(page: VectorPage): SiteRead {
  // 凡例: ラベルの左の同じ行にある記号の大きさ
  const all = page.texts.map((t) => ({ t, k: LEGEND[norm(t.s)] })).filter((x) => x.k);
  // 凡例: 縦に並んだ 3 つ以上のラベル（図の中の説明の「水道メーター」などは凡例にしない）
  const labels = all.filter(({ t }) => all.filter((o) => Math.abs(o.t.x - t.x) < 40 && Math.abs(o.t.y - t.y) < 120).length >= 3);
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
  // 立水栓の凡例（□ と横の ○）: 円の半径と、四角の中心から円の中心までの距離
  const faucetLabel = labels.find(({ k, t }) => k === 'other' && /立水栓/.test(norm(t.s)));
  let faucet: { r: number; off: number } | null = null;
  if (faucetLabel && legend.rain) {
    const fb = findBoxes(page.segs, [legend.rain]).find((b) => Math.abs(b.cy - faucetLabel.t.y) < 3.5 && b.cx > faucetLabel.t.x - 110 && b.cx < faucetLabel.t.x);
    const c = fb && circleNear(page.segs, fb, fb.size * 2);
    if (fb && c) faucet = { r: c.r, off: Math.hypot(c.c.x - fb.cx, c.c.y - fb.cy) };
  }
  // 四角の中に文字がある（「WM」の枠・番号の札）ものは ます にしない
  const hasText = (b: Box) => page.texts.some((t) => Math.abs(t.x - b.cx) < b.size / 2 && Math.abs(t.y - b.cy) < b.size / 2);

  const items: SiteItem[] = [];
  if (has) {
    const sizes = [legend.publicSewer, legend.sewer, legend.rain].filter((v): v is number => v !== undefined);
    const boxes = findBoxes(page.segs, sizes).filter((b) => !inLegend({ x: b.cx, y: b.cy }) && !hasText(b));
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
      else if (!b.cross && faucet && isFaucet(page.segs, b, faucet)) items.push({ type: 'outdoorFaucet', p: { x: b.cx, y: b.cy } });
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
 * 重なる長さがいちばん長いずれを採る。外壁の長さの 7 割以上、かつ縦・横それぞれ向かい合う外壁に重ならなければ null（合わせられない）
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
  if (!best) return null;
  // 外壁の長さの 7 割以上、かつ縦・横それぞれ向かい合う 2 か所以上の外壁に重なる（軒の線の 2 辺だけで合わせない）
  const b0 = best;
  /** 外壁 1 本に重なる線の長さ（途切れた線は足す） */
  const covered = (w: (typeof walls)[number]) => site.reduce((sum, s) => {
    if (s.v !== w.v) return sum;
    const c = s.c + (w.v ? b0.dx : b0.dy), lo = s.lo + (w.v ? b0.dy : b0.dx), hi = s.hi + (w.v ? b0.dy : b0.dx);
    if (![-w.t / 2, 0, w.t / 2].some((o) => Math.abs(c - (w.c + o)) <= NEAR)) return sum;
    return sum + Math.max(0, Math.min(hi, w.hi) - Math.max(lo, w.lo));
  }, 0);
  const hit = (v: boolean) => {
    const cs = walls.filter((w) => w.v === v && covered(w) > (w.hi - w.lo) * 0.5).map((w) => w.c);
    return cs.length >= 2 && Math.max(...cs) - Math.min(...cs) > 1000;
  };
  if (best.s < 0.7 * perimeter || !hit(true) || !hit(false)) return null;
  // world x = px·k + dx = (px − ox)·k、world y = −py·k + dy = (oy − py)·k
  return { ox: -best.dx / k, oy: best.dy / k, k };
}
