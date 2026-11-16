/**
 * 部材図 PDF（A4 横）。見積書とは別に印刷する施工用の図。
 * 1ページ目以降: 階ごとの平面図・外配管の立面図に、継手・支持金具（サドル等）・ネジ継手・器具を記号で描き、右に凡例と個数。
 * 記号は重ならない所に置き（離したときは短い引出線）、混み合って読めない図は「全体図＋拡大図」にする（2026-11-16）。
 * 最後: 部材一覧（金額なし。現場への持ち出し・発注のチェック用）。
 * 縮尺は 1/20〜1/1000 の切りのよい値から、図が収まるいちばん大きいものを選ぶ（A4 で印刷したときの縮尺）。
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { legendOf, type DrawMark, type DrawPage, type Drawing, type LegendRow, type P2, type PartsRow } from './drawing';
import { textWidth } from './labelLayout';
import type { SystemType } from '../model/network';
import { dateJa } from './report';

const PAGE: [number, number] = [841.89, 595.28];
const M = 28;
const LEGEND_W = 200;
const PT_PER_MM = 72 / 25.4;
export const SCALES = [20, 30, 50, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1500, 2000];
const INK = rgb(0.12, 0.13, 0.16);
const GRAY = rgb(0.5, 0.52, 0.56);
const WALL = rgb(0.62, 0.65, 0.7);
const FIX = rgb(0.05, 0.45, 0.56);
const RED = rgb(0.85, 0.1, 0.1);
const SUP = rgb(0.2, 0.22, 0.28);

const hex = (h: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return GRAY;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** 図が収まる縮尺（1/N の N）。どれでも収まらなければいちばん小さい縮尺 */
export function pickScale(wMm: number, hMm: number, areaW: number, areaH: number): number {
  for (const n of SCALES) if ((wMm * PT_PER_MM) / n <= areaW && (hMm * PT_PER_MM) / n <= areaH) return n;
  return SCALES[SCALES.length - 1];
}

function fit(font: PDFFont, s: string, size: number, w: number) {
  if (font.widthOfTextAtSize(s, size) <= w) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > w) t = t.slice(0, -1);
  return t + '…';
}

type Ctx = { page: PDFPage; font: PDFFont };
const txt = (c: Ctx, s: string, x: number, y: number, size: number, color: RGB = INK, center = false) => {
  const w = c.font.widthOfTextAtSize(s, size);
  c.page.drawText(s, { x: center ? x - w / 2 : x, y, size, font: c.font, color });
};

/** 支持金具の記号: サドル=配管を横切る線、レベルバンド=三角、T字金具=T */
function drawSupport(c: Ctx, x: number, y: number, kind: DrawMark['support'], dir: { x: number; y: number } = { x: 1, y: 0 }) {
  const l = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / l, uy = dir.y / l; // 配管方向（PDF座標）
  const nx = -uy, ny = ux; // 垂直
  if (kind === 'levelBand') {
    c.page.drawSvgPath(`M ${x + nx * 4} ${-(y + ny * 4)} L ${x - nx * 4 + ux * 3} ${-(y - ny * 4 + uy * 3)} L ${x - nx * 4 - ux * 3} ${-(y - ny * 4 - uy * 3)} Z`, { x: 0, y: 0, color: SUP, borderWidth: 0 });
    return;
  }
  c.page.drawLine({ start: { x: x + nx * 4, y: y + ny * 4 }, end: { x: x - nx * 4, y: y - ny * 4 }, thickness: 1.1, color: SUP });
  if (kind === 'tBracket') c.page.drawLine({ start: { x: x + nx * 4 - ux * 2.5, y: y + ny * 4 - uy * 2.5 }, end: { x: x + nx * 4 + ux * 2.5, y: y + ny * 4 + uy * 2.5 }, thickness: 1.1, color: SUP });
}

function drawFitting(c: Ctx, x: number, y: number, code: string, confirm: boolean) {
  const r = code.length > 1 ? 6.2 : 5;
  c.page.drawCircle({ x, y, size: r, color: rgb(1, 1, 1), borderColor: confirm ? RED : INK, borderWidth: 0.8 });
  txt(c, code, x, y - 2, code.length > 1 ? 5 : 6, confirm ? RED : INK, true);
}

function legendSymbol(c: Ctx, row: LegendRow, x: number, y: number) {
  if (row.kind === 'support') {
    c.page.drawLine({ start: { x: x - 6, y }, end: { x: x + 6, y }, thickness: 1.2, color: hex('#64748b') });
    drawSupport(c, x, y, row.support);
  } else drawFitting(c, x, y, row.code, row.kind === 'confirm');
}

/** 図を描く範囲（用紙 pt。右は凡例） */
const AREA = { x: M, y: M + 30, w: PAGE[0] - M * 2 - LEGEND_W - 10, h: PAGE[1] - M * 2 - 40 };
/** 記号を元の位置から離してよい長さ（pt）。これより遠くなる図は拡大図にする */
export const LEAD_MAX = 40;
/** 拡大図の枚数の上限（1 つの階） */
const MAX_DETAILS = 8;
/** 1 つの階の拡大図の合計の上限（超える分は全体図に残す） */
const MAX_DETAILS_TOTAL = 12;
const markR = (code: string) => (code.length > 1 ? 6.2 : 5);

type Box = { x1: number; y1: number; x2: number; y2: number };
export type Placed = { x: number; y: number; moved: boolean; lead: number; ok: boolean; /** 器具の名前に重ならず、引出線がほかの札を横切らない */ clean: boolean };
/** 置くもの: 元の位置（ax, ay）と大きさ（w × h の矩形。中心に置く） */
export type Unit = { x: number; y: number; w: number; h: number };

/**
 * 記号（1 つの ○、または同じ所の ○ を横に並べた札）を重ならない所に置く（用紙 pt）。混み合った所から順に、
 * 元の位置 → 周りの輪を内側から試し、ほかの札・器具の名前と重ならず、引出線がほかの札を横切らない最初の所。
 * 見つからなければ重なりのいちばん少ない所（ok = false）
 */
export function layoutMarks(units: Unit[], obstacles: Box[], area: Box): Placed[] {
  const out: (Placed | null)[] = units.map(() => null);
  const done: Box[] = [];
  const crowd = units.map((a) => units.filter((b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 4 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + 4).length);
  const order = units.map((_, i) => i).sort((i, j) => crowd[j] - crowd[i] || units[i].y - units[j].y || units[i].x - units[j].x || i - j);
  const box = (u: Unit, x: number, y: number): Box => ({ x1: x - u.w / 2, y1: y - u.h / 2, x2: x + u.w / 2, y2: y + u.h / 2 });
  const ov = (a: Box, b: Box, gap: number) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) + gap) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) + gap);
  const segBox = (ax: number, ay: number, bx: number, by: number, r: Box) => {
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    for (const [p, q] of [[-dx, ax - r.x1], [dx, r.x2 - ax], [-dy, ay - r.y1], [dy, r.y2 - ay]] as const) {
      if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t0 < t1;
  };
  for (const i of order) {
    const u = units[i];
    // 守ること（ほかの札と重ならない・図の範囲の中）と、なるべく避けること（器具の名前・引出線がほかの札を横切る）
    let best: { x: number; y: number; hard: number; soft: number } | null = null;
    const better = (a: { hard: number; soft: number }, b: { hard: number; soft: number }) => a.hard < b.hard - 1e-9 || (Math.abs(a.hard - b.hard) <= 1e-9 && a.soft < b.soft - 1e-9);
    const tryAt = (x: number, y: number): boolean => {
      const b = box(u, x, y);
      let hard = 0, soft = 0;
      for (const o of done) hard += ov(b, o, 0.8);
      if (b.x1 < area.x1 || b.x2 > area.x2 || b.y1 < area.y1 || b.y2 > area.y2) hard += 1000;
      for (const o of obstacles) soft += ov(b, o, 0) > 0 ? 1 : 0;
      const shrink = (o: Box): Box => ({ x1: o.x1 + 1, y1: o.y1 + 1, x2: o.x2 - 1, y2: o.y2 - 1 });
      if ((x !== u.x || y !== u.y) && done.some((o) => segBox(u.x, u.y, x, y, shrink(o)))) soft += 0.5;
      const cand = { x, y, hard, soft };
      if (!best || better(cand, best)) best = cand;
      return hard === 0 && soft === 0;
    };
    let found = tryAt(u.x, u.y);
    const r0 = Math.max(u.w, u.h) / 2;
    for (let d = r0 + 6; !found && d <= LEAD_MAX * 3; d += 3) {
      // 守ることを満たす所が LEAD_MAX までに見つかっていれば、それより遠くは探さない
      if (d > LEAD_MAX && best && (best as { hard: number }).hard === 0) break;
      const n = Math.max(8, Math.round((2 * Math.PI * d) / 8));
      for (let k = 0; k < n && !found; k++) {
        const th = -Math.PI / 2 + (2 * Math.PI * k) / n;
        found = tryAt(u.x + d * Math.cos(th), u.y + d * Math.sin(th));
      }
    }
    const b = best as unknown as { x: number; y: number; hard: number };
    const lead = Math.hypot(b.x - u.x, b.y - u.y);
    out[i] = { x: b.x, y: b.y, moved: lead > 0.01, lead, ok: b.hard === 0, clean: (b as unknown as { soft: number }).soft === 0 };
    done.push(box(u, b.x, b.y));
  }
  return out as Placed[];
}

/** 同じ所（用紙で GROUP_PT 以内）の記号は 1 つの札（○ を横に並べる）にまとめる。縦管の上下のエルボ・止水栓・水栓エルボなど */
const GROUP_PT = 5;
/** 同じ場所（縦管の上下など）とみなす平面の距離(mm) */
const SAME_SPOT = 30;
/** 1 行に並べる ○ の数 */
const PER_ROW = 6;
type Item = { code: string; confirm: boolean };
function stripSize(items: Item[]): { w: number; h: number; rows: Item[][] } {
  const rows: Item[][] = [];
  for (let i = 0; i < items.length; i += PER_ROW) rows.push(items.slice(i, i + PER_ROW));
  const rowW = (r: Item[]) => r.reduce((s, it) => s + 2 * markR(it.code), 0) + (r.length - 1) * 0.6;
  return { w: Math.max(...rows.map(rowW)), h: rows.length * 12.6 - 0.6, rows };
}

type Bounds = DrawPage['bounds'];
/** 1 枚の図（全体図・拡大図）。placed は用紙 pt の記号の位置（継手・要確認の記号だけ。支持金具は線で描くので含めない） */
export type SheetView = {
  title: string; scale: number; bounds: Bounds; marks: DrawMark[]; legend: LegendRow[];
  /** 拡大図のとき、見せる範囲（mm）。ここで線を切る */
  clip?: Bounds;
  /** 全体図で、拡大図に描く記号は点だけにする */
  dots: boolean;
  /** 点だけにする記号（全体図: 拡大図に描くもの。拡大図: ほかの図に描くもの） */
  dotMarks?: DrawMark[];
  /** 全体図に描く拡大図の範囲（mm） */
  details: { label: string; bounds: Bounds }[];
  placed: (Placed & { w: number; h: number; items: Item[]; ax: number; ay: number; /** 札にまとめた記号の、別々の場所の数（同じ縦管の上下は 1 か所） */ spots: number })[];
};

/** 図の範囲を用紙へ（縮尺 1/n、範囲の中心を図の範囲の中心に） */
function mapper(b: Bounds, n: number) {
  const k = PT_PER_MM / n, w = b.maxX - b.minX, h = b.maxY - b.minY;
  const ox = AREA.x + (AREA.w - w * k) / 2, oy = AREA.y + AREA.h - (AREA.h - h * k) / 2;
  const P = (q: P2) => ({ x: ox + (q.x - b.minX) * k, y: oy - (q.y - b.minY) * k });
  /** 用紙の図の範囲に見えている所（mm） */
  const visible: Bounds = { minX: b.minX - (AREA.w / k - w) / 2, maxX: b.maxX + (AREA.w / k - w) / 2, minY: b.minY - (AREA.h / k - h) / 2, maxY: b.maxY + (AREA.h / k - h) / 2 };
  return { k, P, visible };
}

/** 器具の名前の置き場所（用紙 pt、器具の外の上）。記号はここを避ける */
function fixtureLabels(p: DrawPage, P: (q: P2) => { x: number; y: number }, vis?: Bounds) {
  return p.fixtures.flatMap((fx) => {
    const cx0 = fx.corners.reduce((s, q) => s + q.x, 0) / fx.corners.length, cy0 = fx.corners.reduce((s, q) => s + q.y, 0) / fx.corners.length;
    if (vis && (cx0 < vis.minX || cx0 > vis.maxX || cy0 < vis.minY || cy0 > vis.maxY)) return [];
    const cs = fx.corners.map(P);
    const cx = cs.reduce((s, q) => s + q.x, 0) / cs.length, top = Math.max(...cs.map((q) => q.y));
    const w = Math.min(90, textWidth(fx.label, 6));
    return [{ label: fx.label, x: cx, y: top + 3, box: { x1: cx - w / 2 - 1, y1: top + 1.5, x2: cx + w / 2 + 1, y2: top + 3 + 6 } }];
  });
}

/** 継手・要確認の記号を置いてみる（同じ所の記号は 1 つの札にまとめる） */
function placeAll(p: DrawPage, marks: DrawMark[], P: (q: P2) => { x: number; y: number }, vis?: Bounds): SheetView['placed'] {
  const ms = marks.filter((m) => m.kind !== 'support');
  const pts = ms.map((m) => P(m.p));
  // 近い記号を同じ札に（つながったものをまとめる）
  const parent = ms.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) <= GROUP_PT) parent[find(i)] = find(j);
  const groups = new Map<number, number[]>();
  ms.forEach((_, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(i); });
  const gs = [...groups.values()].map((idx) => {
    const items = idx.map((i) => ({ code: ms[i].code, confirm: ms[i].kind === 'confirm' })).sort((a, b) => Number(b.confirm) - Number(a.confirm) || a.code.localeCompare(b.code));
    const sz = stripSize(items);
    const spots: P2[] = [];
    for (const i of idx) if (!spots.some((q) => Math.hypot(q.x - ms[i].p.x, q.y - ms[i].p.y) <= SAME_SPOT)) spots.push(ms[i].p);
    return { x: idx.reduce((s, i) => s + pts[i].x, 0) / idx.length, y: idx.reduce((s, i) => s + pts[i].y, 0) / idx.length, w: sz.w, h: sz.h, items, spots: spots.length };
  });
  const obstacles = fixtureLabels(p, P, vis).map((l) => l.box);
  const pl = layoutMarks(gs, obstacles, { x1: AREA.x, y1: AREA.y, x2: AREA.x + AREA.w, y2: AREA.y + AREA.h });
  return pl.map((q, i) => ({ ...q, w: gs[i].w, h: gs[i].h, items: gs[i].items, ax: gs[i].x, ay: gs[i].y, spots: gs[i].spots }));
}
/** 読めない札: 重なる・引出線が長い・離れた 3 か所以上の記号を 1 つの札にまとめている（縮尺が足りない） */
const unreadable = (pl: SheetView['placed']) => pl.filter((q) => !q.ok || q.lead > LEAD_MAX || q.spots > 2).length;
const readable = (pl: SheetView['placed']) => unreadable(pl) === 0;

/** 混み合った記号の集まりを、拡大図に回す範囲としてまとめる距離(mm)と、範囲の余白(mm) */
const CLUSTER_MM = 900, DETAIL_PAD_MM = 400;

/**
 * 1 つの図（階の平面・立面）を何枚で描くか。記号が全体図で読めるように置ければ 1 枚。
 * 読めない所（重なる・引出線が長い・離れた記号を 1 つの札にまとめないと置けない）があれば、そのまわりだけを
 * 大きい縮尺の拡大図にする。全体図では、拡大図に回した記号は点と枠だけ、ほかの記号はそのまま
 */
export function sheetViews(p: DrawPage): SheetView[] {
  const w = p.bounds.maxX - p.bounds.minX, h = p.bounds.maxY - p.bounds.minY;
  const n0 = pickScale(w, h, AREA.w, AREA.h);
  const m0 = mapper(p.bounds, n0);
  const fits = p.marks.filter((m) => m.kind !== 'support');
  const placed0 = placeAll(p, p.marks, m0.P);
  const whole: SheetView = { title: p.title, scale: n0, bounds: p.bounds, marks: p.marks, legend: p.legend, dots: false, details: [], placed: placed0 };
  if (!fits.length || readable(placed0)) return [whole];
  // 読めない札の記号（mm）と、そのまわりの記号をまとめて、拡大図の範囲にする
  const bad = placed0.filter((q) => !q.ok || q.lead > LEAD_MAX || q.spots > 2);
  const toMm = (x: number, y: number): P2 => ({ x: p.bounds.minX + (x - (AREA.x + (AREA.w - w * m0.k) / 2)) / m0.k, y: p.bounds.minY + ((AREA.y + AREA.h - (AREA.h - h * m0.k) / 2) - y) / m0.k });
  const seeds = bad.map((q) => toMm(q.ax, q.ay));
  const inDetail = new Set<DrawMark>();
  const clusters: DrawMark[][] = [];
  const near = (a: P2, b: P2, d: number) => Math.abs(a.x - b.x) <= d && Math.abs(a.y - b.y) <= d;
  for (const sd of seeds) {
    if (fits.some((m) => inDetail.has(m) && near(m.p, sd, 1))) continue;
    // 種から CLUSTER_MM 以内でつながる記号をまとめる
    const group: DrawMark[] = [];
    const stack = fits.filter((m) => !inDetail.has(m) && near(m.p, sd, CLUSTER_MM / 2));
    for (const m of stack) inDetail.add(m);
    while (stack.length) {
      const m = stack.pop()!;
      group.push(m);
      for (const o of fits) if (!inDetail.has(o) && near(o.p, m.p, CLUSTER_MM / 2) && seeds.some((s2) => near(o.p, s2, CLUSTER_MM))) { inDetail.add(o); stack.push(o); }
    }
    if (group.length) clusters.push(group);
  }
  // 拡大図: まとまりごとに、全体図より大きい縮尺を小さい順に試す（入りきらなければ区切る）
  const details: SheetView[] = [];
  const supportsIn = (vis: Bounds) => p.marks.filter((m) => m.kind === 'support' && m.p.x >= vis.minX && m.p.x <= vis.maxX && m.p.y >= vis.minY && m.p.y <= vis.maxY);
  for (const group of clusters) {
    let pick: SheetView[] | null = null, pickBad = Infinity;
    for (const n of SCALES.filter((x) => x < n0).reverse()) {
      const k = PT_PER_MM / n, pad = Math.min(DETAIL_PAD_MM, 40 / k);
      const tw = AREA.w / k - 2 * pad, th = AREA.h / k - 2 * pad;
      const x0 = Math.min(...group.map((m) => m.p.x)), y0 = Math.min(...group.map((m) => m.p.y));
      const cells = new Map<string, DrawMark[]>();
      for (const m of group) { const key = `${Math.floor((m.p.y - y0) / th)},${Math.floor((m.p.x - x0) / tw)}`; (cells.get(key) ?? cells.set(key, []).get(key)!).push(m); }
      if (cells.size > MAX_DETAILS || details.length + cells.size > MAX_DETAILS_TOTAL) continue;
      const keys = [...cells.keys()].sort((a, b) => { const [ay, ax] = a.split(',').map(Number), [by, bx] = b.split(',').map(Number); return ay - by || ax - bx; });
      const views = keys.map((key): SheetView => {
        const ms = cells.get(key)!;
        const bb: Bounds = { minX: Math.min(...ms.map((m) => m.p.x)) - pad, maxX: Math.max(...ms.map((m) => m.p.x)) + pad, minY: Math.min(...ms.map((m) => m.p.y)) - pad, maxY: Math.max(...ms.map((m) => m.p.y)) + pad };
        const mp = mapper(bb, n);
        const marks = [...ms, ...supportsIn(mp.visible)];
        // ほかの図（全体図・別の拡大図）に描く継手は、見えている範囲に薄い点で（記号が無いのではないと分かるように）
        const others = fits.filter((m) => !ms.includes(m) && m.p.x >= mp.visible.minX && m.p.x <= mp.visible.maxX && m.p.y >= mp.visible.minY && m.p.y <= mp.visible.maxY);
        return { title: '', scale: n, bounds: bb, clip: mp.visible, marks, legend: legendOf(marks), dots: false, details: [], placed: placeAll(p, ms, mp.P, mp.visible), dotMarks: others };
      });
      // 読めない札がいちばん少ない縮尺（同じなら枚数の少ない方 = 先に試した方）
      const nb = views.reduce((t, v) => t + unreadable(v.placed), 0);
      if (nb < pickBad) { pick = views; pickBad = nb; }
      if (nb === 0) break;
    }
    // 拡大図にできない（もう大きい縮尺が無い・枚数が多すぎる）まとまりは、全体図に残す（記号を消さない）
    if (pick) details.push(...pick); else for (const m of group) inDetail.delete(m);
  }
  details.forEach((v, i) => { const label = String.fromCharCode(65 + (i % 26)); v.title = `${p.title} 拡大${label}`; v.details = [{ label, bounds: v.bounds }]; });
  // 全体図: 拡大図に回した記号は点だけ、ほかはそのまま置く
  const rest = p.marks.filter((m) => !inDetail.has(m));
  const overview: SheetView = { ...whole, title: `${p.title}（全体）`, dots: true, details: details.map((v) => v.details[0]), placed: placeAll(p, rest, m0.P), dotMarks: [...inDetail] };
  return [overview, ...details];
}

/** 線分を範囲で切る（Liang–Barsky）。外なら null */
function clipSeg(a: P2, b: P2, r?: Bounds): [P2, P2] | null {
  if (!r) return [a, b];
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [pp, q] of [[-dx, a.x - r.minX], [dx, r.maxX - a.x], [-dy, a.y - r.minY], [dy, r.maxY - a.y]] as const) {
    if (Math.abs(pp) < 1e-12) { if (q < 0) return null; continue; }
    const t = q / pp;
    if (pp < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
}
const inside = (q: P2, r?: Bounds) => !r || (q.x >= r.minX && q.x <= r.maxX && q.y >= r.minY && q.y <= r.maxY);

/** 凡例が入りきらなければ、記号ごとにまとめる（品名の細かい違い・仕様は部材一覧で） */
function compactLegend(rows: LegendRow[], max: number): LegendRow[] {
  if (rows.length <= max) return rows;
  const m = new Map<string, LegendRow & { names: Map<string, number> }>();
  for (const r of rows) {
    const key = `${r.kind}|${r.code}|${r.support ?? ''}`;
    const g = m.get(key) ?? m.set(key, { ...r, spec: '', count: 0, names: new Map() }).get(key)!;
    g.count += r.count;
    g.names.set(r.name, (g.names.get(r.name) ?? 0) + r.count);
  }
  return [...m.values()].map(({ names, ...g }) => ({ ...g, name: [...names].sort((a, b) => b[1] - a[1])[0][0] + (names.size > 1 ? ' など' : ''), spec: '' }));
}

function drawPage(pdf: PDFDocument, font: PDFFont, p: DrawPage, v: SheetView, d: { name: string; date: Date }, colors: Record<SystemType, string>) {
  const page = pdf.addPage(PAGE);
  const c: Ctx = { page, font };
  const areaX = AREA.x;
  page.drawRectangle({ x: M - 6, y: M - 6, width: PAGE[0] - (M - 6) * 2, height: PAGE[1] - (M - 6) * 2, borderColor: INK, borderWidth: 0.8 });
  const n = v.scale;
  const { k, P } = mapper(v.bounds, n);
  const cl = v.clip;
  /** 範囲で切った線を描く（拡大図） */
  const line = (a: P2, b: P2, o: { thickness: number; color: RGB }) => { const s = clipSeg(a, b, cl); if (s) page.drawLine({ start: P(s[0]), end: P(s[1]), ...o }); };

  if (p.frame && cl) {
    // 拡大図: 外形と GL の線も見えている所だけ
    const { w: fw, h: fh } = p.frame;
    for (const [a, b] of [[{ x: 0, y: 0 }, { x: fw, y: 0 }], [{ x: fw, y: 0 }, { x: fw, y: fh }], [{ x: fw, y: fh }, { x: 0, y: fh }], [{ x: 0, y: fh }, { x: 0, y: 0 }]] as const) line(a, b, { thickness: 1.2, color: WALL });
    line({ x: cl.minX, y: fh }, { x: cl.maxX, y: fh }, { thickness: 1.5, color: INK });
  } else if (p.frame) {
    const a = P({ x: 0, y: 0 }), b = P({ x: p.frame.w, y: p.frame.h });
    page.drawRectangle({ x: a.x, y: b.y, width: b.x - a.x, height: a.y - b.y, borderColor: WALL, borderWidth: 1.2, color: rgb(0.97, 0.97, 0.98) });
    page.drawLine({ start: { x: a.x - 10, y: b.y }, end: { x: b.x + 10, y: b.y }, thickness: 1.5, color: INK });
    txt(c, 'GL', a.x - 22, b.y - 3, 7, GRAY);
  }
  for (const wl of p.walls) line(wl.a, wl.b, { thickness: Math.max(1.5, wl.thickness * k), color: WALL });
  for (const fx of p.fixtures) for (let i = 0; i < fx.corners.length; i++) line(fx.corners[i], fx.corners[(i + 1) % fx.corners.length], { thickness: 0.8, color: FIX });
  // 名前は器具の外（上）に出して、接続口の記号と重ねない（記号はこの名前を避けて置いてある）
  for (const l of fixtureLabels(p, P, cl)) txt(c, fit(font, l.label, 6, 90), l.x, l.y, 6, FIX, true);
  for (const pp of p.pipes) line(pp.a, pp.b, { thickness: 1.6, color: hex(colors[pp.system] ?? '#475569') });
  for (const r of p.risers) {
    if (!inside(r.p, cl)) continue;
    const q = P(r.p);
    page.drawCircle({ x: q.x, y: q.y, size: 3.2, borderColor: hex(colors[r.system] ?? '#475569'), borderWidth: 1.4 });
    page.drawCircle({ x: q.x, y: q.y, size: 0.9, color: hex(colors[r.system] ?? '#475569') });
  }
  // 支持金具 → 継手の順（継手を上に）
  for (const m of v.marks) if (m.kind === 'support' && inside(m.p, cl)) { const q = P(m.p); drawSupport(c, q.x, q.y, m.support, m.dir ? { x: m.dir.x, y: -m.dir.y } : undefined); }
  // 点だけの記号（全体図: 拡大図に描くもの＝黒の点。拡大図: ほかの図に描くもの＝薄い点）
  for (const m of v.dotMarks ?? []) { const q = P(m.p); page.drawCircle({ x: q.x, y: q.y, size: 1.3, color: m.kind === 'confirm' ? RED : v.clip ? rgb(0.58, 0.6, 0.64) : INK }); }
  if (v.dots) {
    for (const dt of v.details) {
      const a = P({ x: dt.bounds.minX, y: dt.bounds.maxY }), b = P({ x: dt.bounds.maxX, y: dt.bounds.minY });
      page.drawRectangle({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y, borderColor: RED, borderWidth: 0.8, borderDashArray: [3, 2] });
      txt(c, `拡大${dt.label}`, a.x + 2, b.y - 8, 7, RED);
    }
  }
  {
    // 記号は重ならない所に置いてある（離したものは細い引出線と元の位置の点）
    for (const q of v.placed) if (q.moved) {
      // 引出線は札の縁まで
      const dx = q.x - q.ax, dy = q.y - q.ay;
      const t = Math.min(dx ? (q.w / 2) / Math.abs(dx) : Infinity, dy ? (q.h / 2) / Math.abs(dy) : Infinity, 1);
      page.drawLine({ start: { x: q.ax, y: q.ay }, end: { x: q.x - dx * t, y: q.y - dy * t }, thickness: 0.4, color: GRAY });
      page.drawCircle({ x: q.ax, y: q.ay, size: 0.9, color: GRAY });
    }
    for (const q of v.placed) {
      const { rows } = stripSize(q.items);
      rows.forEach((row, ri) => {
        const rw = row.reduce((s, it) => s + 2 * markR(it.code), 0) + (row.length - 1) * 0.6;
        let x = q.x - rw / 2;
        const y = q.y + q.h / 2 - 6.2 - ri * 12.6;
        for (const it of row) { const r = markR(it.code); drawFitting(c, x + r, y, it.code, it.confirm); x += 2 * r + 0.6; }
      });
    }
  }

  // 縮尺バー（1m）
  const bar = 1000 * k;
  const bx = areaX, by = M + 8;
  page.drawLine({ start: { x: bx, y: by }, end: { x: bx + bar, y: by }, thickness: 2, color: INK });
  txt(c, `1m　縮尺 1/${n}（A4）`, bx + bar + 6, by - 3, 8);

  // 凡例
  const lx = PAGE[0] - M - LEGEND_W;
  page.drawLine({ start: { x: lx - 6, y: M - 6 }, end: { x: lx - 6, y: PAGE[1] - M + 6 }, thickness: 0.6, color: INK });
  let y = PAGE[1] - M - 10;
  txt(c, fit(font, d.name, 11, LEGEND_W - 4), lx, y, 11); y -= 16;
  txt(c, fit(font, `部材図　${v.title}`, 9, LEGEND_W - 4), lx, y, 9); y -= 13;
  txt(c, dateJa(d.date), lx, y, 7.5, GRAY); y -= 18;
  txt(c, v.clip ? '凡例（この拡大図の個数）' : p.kind === 'elevation' ? '凡例（この図の個数・平面図と重複）' : '凡例（この図の個数）', lx, y, 8.5); y -= 6;
  page.drawLine({ start: { x: lx, y }, end: { x: lx + LEGEND_W - 4, y }, thickness: 0.5, color: GRAY }); y -= 13;
  const bottom = M + 70;
  // 入りきらなければ記号ごとにまとめる（仕様ごとの個数は拡大図・部材一覧で）
  const rows = compactLegend(v.legend, Math.floor((y - bottom) / 14) + 1);
  let shown = 0;
  for (const r of rows) {
    if (y < bottom) break;
    legendSymbol(c, r, lx + 8, y + 2.5);
    txt(c, fit(font, `${r.name} ${r.spec}`, 7, LEGEND_W - 52), lx + 20, y, 7);
    txt(c, `${r.count}`, lx + LEGEND_W - 8 - font.widthOfTextAtSize(`${r.count}`, 7.5), y, 7.5);
    y -= 14;
    shown++;
  }
  if (shown < rows.length) { txt(c, `ほか ${rows.length - shown} 種類（部材一覧を参照）`, lx, y, 7, GRAY); y -= 14; }
  if (rows.length === 0) { txt(c, '記号なし', lx, y, 7, GRAY); y -= 14; }
  // 線の色
  const sys = [...new Set([...p.pipes.map((q) => q.system), ...p.risers.map((q) => q.system)])];
  let sx = lx;
  const sy = M + 44;
  for (const s of sys) {
    page.drawLine({ start: { x: sx, y: sy + 2.5 }, end: { x: sx + 12, y: sy + 2.5 }, thickness: 1.8, color: hex(colors[s] ?? '#475569') });
    const label = SYS_LABEL[s] ?? s;
    txt(c, label, sx + 14, sy, 6.5);
    sx += 20 + font.widthOfTextAtSize(label, 6.5);
    if (sx > lx + LEGEND_W - 30) break;
  }
  txt(c, v.dots ? '・ 継手の位置（記号は拡大図）　○ 縦管' : v.clip ? '・ 薄い点はほかの図に記号　○ 縦管' : '○ 縦管（平面）　! 要確認の点', lx, M + 30, 6.5, GRAY);
  txt(c, '記号の位置は目安です。現場で確認してください。', lx, M + 18, 6.5, GRAY);
}

const SYS_LABEL: Partial<Record<SystemType, string>> = {
  water: '給水', hotWater: '給湯', drain: '排水', sewage: '汚水', vent: '通気', gas: 'ガス', refrigerant: '冷媒', condensate: 'ドレン', electric: '電気', telecom: '通信', other: 'その他',
};

function partsPages(pdf: PDFDocument, font: PDFFont, rows: PartsRow[], d: { name: string; date: Date }) {
  const widths = [0.13, 0.3, 0.2, 0.08, 0.06, 0.23];
  const W = PAGE[0] - M * 2;
  const ws = widths.map((x) => x * W);
  const head = ['区分', '品名', '仕様', '数量', '単位', '備考'];
  let page: PDFPage | null = null;
  let y = 0;
  const start = () => {
    page = pdf.addPage(PAGE);
    y = PAGE[1] - M - 14;
    page.drawText(`部材一覧（金額なし）　${d.name}`, { x: M, y, size: 13, font, color: INK });
    page.drawText(dateJa(d.date), { x: PAGE[0] - M - font.widthOfTextAtSize(dateJa(d.date), 8), y, size: 8, font, color: GRAY });
    y -= 24;
    row(head, true);
  };
  const row = (cells: string[], isHead = false) => {
    const pg = page!;
    if (isHead) pg.drawRectangle({ x: M, y: y - 4, width: W, height: 15, color: rgb(0.93, 0.95, 0.98) });
    let x = M;
    cells.forEach((s, i) => {
      const t = fit(font, s, 8, ws[i] - 6);
      const right = !isHead && i === 3;
      pg.drawText(t, { x: right ? x + ws[i] - 3 - font.widthOfTextAtSize(t, 8) : x + 3, y, size: 8, font, color: INK });
      x += ws[i];
    });
    pg.drawLine({ start: { x: M, y: y - 5 }, end: { x: M + W, y: y - 5 }, thickness: 0.4, color: rgb(0.78, 0.8, 0.83) });
    y -= 16;
  };
  start();
  if (rows.length === 0) row(['', '部材はありません', '', '', '', '']);
  for (const r of rows) {
    if (y < M + 20) start();
    row([r.group, r.name, r.spec, String(r.qty), r.unit, r.note]);
  }
}

export async function buildDrawingPdf(dr: Drawing, meta: { name: string; date: Date }, colors: Record<SystemType, string>, fontBytes: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false });
  pdf.setTitle(`${meta.name} 部材図`);
  pdf.setCreator('PipeCraft 3D');
  pdf.setCreationDate(meta.date);
  for (const p of dr.pages) for (const v of sheetViews(p)) drawPage(pdf, font, p, v, meta, colors);
  partsPages(pdf, font, dr.parts, meta);
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    const s = `${i + 1} / ${pages.length}`;
    pg.drawText(s, { x: PAGE[0] / 2 - font.widthOfTextAtSize(s, 7) / 2, y: M - 18, size: 7, font, color: GRAY });
  });
  return pdf.save();
}
