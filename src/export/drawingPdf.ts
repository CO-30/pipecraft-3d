/**
 * 部材図 PDF（A4 横）。見積書とは別に印刷する施工用の図。
 * 1ページ目以降: 階ごとの平面図・外配管の立面図に、継手・支持金具（サドル等）・ネジ継手・器具を記号で描き、右に凡例と個数。
 * 記号は重ならない所に置き（離したときは短い引出線）、混み合って読めない図は「全体図＋拡大図」にする（2026-11-16）。
 * 最後: 部材一覧（金額なし。現場への持ち出し・発注のチェック用）。
 * 縮尺は 1/20〜1/1000 の切りのよい値から、図が収まるいちばん大きいものを選ぶ（A4 で印刷したときの縮尺）。
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { type DrawMark, type DrawPage, type Drawing, type P2, type PartsRow } from './drawing';
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

/** 図を描く範囲（用紙 pt。右は凡例） */
const AREA = { x: M, y: M + 30, w: PAGE[0] - M * 2 - LEGEND_W - 10, h: PAGE[1] - M * 2 - 40 };
/** 記号を元の位置から離してよい長さ（pt）。これより遠くなる図は拡大図にする */
export const LEAD_MAX = 40;

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

type Bounds = DrawPage['bounds'];

/** 図の範囲を用紙へ（縮尺 1/n、範囲の中心を図の範囲の中心に） */
function mapper(b: Bounds, n: number) {
  const k = PT_PER_MM / n, w = b.maxX - b.minX, h = b.maxY - b.minY;
  const ox = AREA.x + (AREA.w - w * k) / 2, oy = AREA.y + AREA.h - (AREA.h - h * k) / 2;
  const P = (q: P2) => ({ x: ox + (q.x - b.minX) * k, y: oy - (q.y - b.minY) * k });
  return { k, P };
}

/** 器具の名前の置き場所（用紙 pt、器具の外の上）。番号の札はここを避ける */
function fixtureLabels(p: DrawPage, P: (q: P2) => { x: number; y: number }) {
  return p.fixtures.map((fx) => {
    const cs = fx.corners.map(P);
    const cx = cs.reduce((s, q) => s + q.x, 0) / cs.length, top = Math.max(...cs.map((q) => q.y));
    const w = Math.min(90, textWidth(fx.label, 6));
    return { label: fx.label, x: cx, y: top + 3, box: { x1: cx - w / 2 - 1, y1: top + 1.5, x2: cx + w / 2 + 1, y2: top + 3 + 6 } };
  });
}

/**
 * 部材図の記号の描き分け（2026-11-16 ユーザー:「記号を工夫して 1 枚にまとめつつ、ごちゃごちゃせずに見やすく」）
 * - エルボ（L・45°）: 配管の曲がりそのものなので記号は描かない（個数は凡例・部材一覧）
 * - 配管の途中の部品: 配管の上に小さな形で（チーズ・Y・クロス = ●、ソケット = ‖、径違い = ▶、バルブ = ⋈）
 * - 器具の口・縦管の上下など、同じ所に部品が集まる所（と、器具の口の部品 A・WL など）: 番号の札 1 つ。中身は右の「接続部の一覧」
 * - 要確認の点: 赤い「!」の札（番号の札と同じに一覧へ）
 */
export type GlyphKind = 'elbow' | 'tee' | 'socket' | 'reducer' | 'valve';
const GLYPH: Record<string, GlyphKind> = { L: 'elbow', '45': 'elbow', T: 'tee', Y: 'tee', '+': 'tee', S: 'socket', RS: 'reducer', V: 'valve' };
/** 同じ所（縦管の上下・器具の口）とみなす平面の距離(mm) */
const SAME_SPOT_MM = 40;
/** 番号の札の半径(pt) */
const TAG_R = 4.6;
/** 同じ器具の口を 1 つの札にまとめる距離(mm) */
const MERGE_MM = 700;

/** 番号の札 1 つ: 同じ器具の口（給水・給湯・排水・通気）や縦管の上下の部品。points は札から引出線を引く所（mm） */
export type Spot = { no: number; p: P2; points: P2[]; label: string; codes: string; confirm: boolean; marks: DrawMark[] };
export type SheetPlan = {
  scale: number;
  /** 配管の上に形で描く部品（エルボは形も描かない） */
  glyphs: { m: DrawMark; kind: GlyphKind; dir: P2 }[];
  spots: Spot[];
  /** 番号の札の置き場所（用紙 pt）。spots と同じ並び */
  tags: (Placed & { ax: number; ay: number })[];
};

/** 一覧の略号の意味 */
const CODE_NAME: Record<string, string> = {
  '!': '要確認', WL: '給水栓エルボ', WS: '給水栓ソケット', VS: 'バルブ用ソケット', A: '器具接続継手', HA: 'HIVP変換継手', AV: '通気弁',
  V: 'バルブ', T: 'チーズ', Y: 'Y', '+': 'クロス', RS: '径違い', S: 'ソケット', '45': '45°エルボ', L: 'エルボ', 'L*': 'エルボ（角度要確認）', J: 'ジョイントボックス', C: 'キャップ', '?': 'その他',
};
/** 部品の並びを短く: 「WL・V・L×2・A」 */
function codeSummary(ms: DrawMark[]): string {
  const order = ['!', 'WL', 'WS', 'VS', 'A', 'HA', 'AV', 'V', 'T', 'Y', '+', 'RS', 'S', '45', 'L', 'L*', 'J', 'C', '?'];
  const n = new Map<string, number>();
  for (const m of ms) n.set(m.code, (n.get(m.code) ?? 0) + 1);
  return [...n].sort((a, b) => (order.indexOf(a[0]) + 99) % 199 - (order.indexOf(b[0]) + 99) % 199).map(([c, k]) => (k > 1 ? `${c}×${k}` : c)).join('・');
}

/** 1 つの図（階の平面・立面）の記号の描き分けと、番号の札の置き場所。いつも 1 枚 */
export function sheetPlan(p: DrawPage): SheetPlan {
  const w = p.bounds.maxX - p.bounds.minX, h = p.bounds.maxY - p.bounds.minY;
  const n = pickScale(w, h, AREA.w, AREA.h);
  const { P } = mapper(p.bounds, n);
  const fits = p.marks.filter((m) => m.kind !== 'support');
  // 同じ所の部品をまとめる
  const parent = fits.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < fits.length; i++) for (let j = i + 1; j < fits.length; j++) if (Math.hypot(fits[i].p.x - fits[j].p.x, fits[i].p.y - fits[j].p.y) <= SAME_SPOT_MM) parent[find(i)] = find(j);
  const groups = new Map<number, DrawMark[]>();
  fits.forEach((m, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(m); });
  // 部品の向き: いちばん近い配管の向き（縦管だけの所は横）
  const dirAt = (q: P2): P2 => {
    let best: { d: number; v: P2 } | null = null;
    for (const pp of p.pipes) {
      const dx = pp.b.x - pp.a.x, dy = pp.b.y - pp.a.y, L2 = dx * dx + dy * dy;
      if (L2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((q.x - pp.a.x) * dx + (q.y - pp.a.y) * dy) / L2));
      const d = Math.hypot(pp.a.x + dx * t - q.x, pp.a.y + dy * t - q.y);
      if (!best || d < best.d) best = { d, v: { x: dx, y: dy } };
    }
    return best && best.d < 60 ? best.v : { x: 1, y: 0 };
  };
  const glyphs: SheetPlan['glyphs'] = [];
  const spotGroups: DrawMark[][] = [];
  for (const g of groups.values()) {
    if (g.length === 1 && g[0].kind !== 'confirm' && GLYPH[g[0].code]) glyphs.push({ m: g[0], kind: GLYPH[g[0].code], dir: dirAt(g[0].p) });
    else if (g.every((m) => m.kind !== 'confirm' && GLYPH[m.code] === 'elbow')) for (const m of g) glyphs.push({ m, kind: 'elbow', dir: dirAt(m.p) }); // 曲がりが重なるだけ（縦管の上下のエルボ）は記号なし
    else spotGroups.push(g);
  }
  const center = (g: DrawMark[]): P2 => ({ x: g.reduce((s, m) => s + m.p.x, 0) / g.length, y: g.reduce((s, m) => s + m.p.y, 0) / g.length });
  /** いちばん近い器具（900mm 以内）。番号と名前 */
  const near = (q: P2): { i: number; label: string } => {
    let best: { d: number; i: number; label: string } | null = null;
    p.fixtures.forEach((fx, i) => {
      const cx = fx.corners.reduce((s, c) => s + c.x, 0) / fx.corners.length, cy = fx.corners.reduce((s, c) => s + c.y, 0) / fx.corners.length;
      const d = Math.hypot(cx - q.x, cy - q.y);
      if (d < 900 && (!best || d < best.d)) best = { d, i, label: fx.label };
    });
    const b = best as { i: number; label: string } | null;
    return b ? { i: b.i, label: b.label } : { i: -1, label: '' };
  };
  // 同じ器具の口（いちばん近い器具が同じで MERGE_MM 以内）は 1 つの札にまとめる（キッチンの給水・給湯・排水・通気など）
  const merged: { pts: P2[]; marks: DrawMark[]; label: string; fx: number }[] = [];
  for (const g of spotGroups) {
    const c0 = center(g), f = near(c0);
    const to = f.i >= 0 ? merged.find((x) => x.fx === f.i && x.pts.some((q) => Math.hypot(q.x - c0.x, q.y - c0.y) <= MERGE_MM)) : undefined;
    if (to) { to.pts.push(c0); to.marks.push(...g); } else merged.push({ pts: [c0], marks: [...g], label: f.label, fx: f.i });
  }
  // 番号は上から下・左から右の順
  const centers = merged.map((x) => ({ x: x.pts.reduce((s, q) => s + q.x, 0) / x.pts.length, y: x.pts.reduce((s, q) => s + q.y, 0) / x.pts.length }));
  const order = merged.map((_, i) => i).sort((a, b) => (Math.abs(centers[a].y - centers[b].y) > 300 ? centers[a].y - centers[b].y : centers[a].x - centers[b].x));
  const spots: Spot[] = order.map((i, k) => {
    const g = merged[i];
    return { no: k + 1, p: centers[i], points: g.pts, label: g.label, codes: codeSummary(g.marks.map((m) => (m.kind === 'confirm' ? { ...m, code: '!' } : m))), confirm: g.marks.some((m) => m.kind === 'confirm'), marks: g.marks };
  });
  const anchors = spots.map((sp) => P(sp.p));
  const obstacles = fixtureLabels(p, P).map((l) => l.box);
  const pl = layoutMarks(anchors.map((a) => ({ ...a, w: 2 * TAG_R + 0.6, h: 2 * TAG_R + 0.6 })), obstacles, { x1: AREA.x, y1: AREA.y, x2: AREA.x + AREA.w, y2: AREA.y + AREA.h });
  return { scale: n, glyphs, spots, tags: pl.map((q, i) => ({ ...q, ax: anchors[i].x, ay: anchors[i].y })) };
}

/** 配管の上の部品の形（用紙 pt、dir は配管の向き） */
function drawGlyph(c: Ctx, x: number, y: number, kind: GlyphKind, dir: P2) {
  const l = Math.hypot(dir.x, dir.y) || 1, ux = dir.x / l, uy = dir.y / l, nx = -uy, ny = ux;
  const pt = (a: number, b: number) => `${x + ux * a + nx * b} ${-(y + uy * a + ny * b)}`;
  if (kind === 'tee') c.page.drawCircle({ x, y, size: 1.9, color: INK });
  else if (kind === 'socket') for (const o of [-0.9, 0.9]) c.page.drawLine({ start: { x: x + ux * o + nx * 3, y: y + uy * o + ny * 3 }, end: { x: x + ux * o - nx * 3, y: y + uy * o - ny * 3 }, thickness: 0.7, color: INK });
  else if (kind === 'reducer') c.page.drawSvgPath(`M ${pt(-2.5, 2.8)} L ${pt(2.5, 0)} L ${pt(-2.5, -2.8)} Z`, { x: 0, y: 0, color: INK, borderWidth: 0 });
  else if (kind === 'valve') c.page.drawSvgPath(`M ${pt(-3.2, 2.6)} L ${pt(3.2, -2.6)} L ${pt(3.2, 2.6)} L ${pt(-3.2, -2.6)} Z`, { x: 0, y: 0, color: INK, borderWidth: 0 });
}

/** 番号の札 */
function drawTag(c: Ctx, x: number, y: number, no: number | string, confirm: boolean) {
  c.page.drawCircle({ x, y, size: TAG_R, color: rgb(1, 1, 1), borderColor: confirm ? RED : INK, borderWidth: 0.7 });
  const s = String(no), size = s.length > 1 ? 4.6 : 5.4;
  txt(c, s, x, y - size * 0.36, size, confirm ? RED : INK, true);
}

function drawPage(pdf: PDFDocument, font: PDFFont, p: DrawPage, d: { name: string; date: Date }, colors: Record<SystemType, string>) {
  const page = pdf.addPage(PAGE);
  const c: Ctx = { page, font };
  page.drawRectangle({ x: M - 6, y: M - 6, width: PAGE[0] - (M - 6) * 2, height: PAGE[1] - (M - 6) * 2, borderColor: INK, borderWidth: 0.8 });
  const plan = sheetPlan(p);
  const n = plan.scale;
  const { k, P } = mapper(p.bounds, n);
  const line = (a: P2, b: P2, o: { thickness: number; color: RGB }) => page.drawLine({ start: P(a), end: P(b), ...o });

  if (p.frame) {
    const a = P({ x: 0, y: 0 }), b = P({ x: p.frame.w, y: p.frame.h });
    page.drawRectangle({ x: a.x, y: b.y, width: b.x - a.x, height: a.y - b.y, borderColor: WALL, borderWidth: 1.2, color: rgb(0.97, 0.97, 0.98) });
    page.drawLine({ start: { x: a.x - 10, y: b.y }, end: { x: b.x + 10, y: b.y }, thickness: 1.5, color: INK });
    txt(c, 'GL', a.x - 22, b.y - 3, 7, GRAY);
  }
  for (const wl of p.walls) line(wl.a, wl.b, { thickness: Math.max(1.5, wl.thickness * k), color: WALL });
  for (const fx of p.fixtures) for (let i = 0; i < fx.corners.length; i++) line(fx.corners[i], fx.corners[(i + 1) % fx.corners.length], { thickness: 0.8, color: FIX });
  // 名前は器具の外（上）に出す（番号の札はこの名前を避けて置いてある）
  // 同じ名前が重なるとき（隣り合う汚水マスなど）は 1 つだけ
  const drawnLabels: { label: string; box: { x1: number; y1: number; x2: number; y2: number } }[] = [];
  for (const l of fixtureLabels(p, P)) {
    if (drawnLabels.some((o) => o.label === l.label && o.box.x1 < l.box.x2 && l.box.x1 < o.box.x2 && o.box.y1 < l.box.y2 && l.box.y1 < o.box.y2)) continue;
    drawnLabels.push(l);
    txt(c, fit(font, l.label, 6, 90), l.x, l.y, 6, FIX, true);
  }
  for (const pp of p.pipes) line(pp.a, pp.b, { thickness: 1.6, color: hex(colors[pp.system] ?? '#475569') });
  for (const r of p.risers) {
    const q = P(r.p);
    page.drawCircle({ x: q.x, y: q.y, size: 2.6, borderColor: hex(colors[r.system] ?? '#475569'), borderWidth: 1.1 });
  }
  // 支持金具は細く薄く（配管を読む邪魔をしない）
  for (const m of p.marks) if (m.kind === 'support') { const q = P(m.p); drawSupport(c, q.x, q.y, m.support, m.dir ? { x: m.dir.x, y: -m.dir.y } : undefined); }
  // 配管の上の部品
  for (const g of plan.glyphs) if (g.kind !== 'elbow') { const q = P(g.m.p); drawGlyph(c, q.x, q.y, g.kind, { x: g.dir.x, y: -g.dir.y }); }
  // 番号の札（離したものは細い引出線）
  plan.tags.forEach((q, i) => {
    // 札から、まとめた口それぞれへ細い引出線（札の上にある口は線なし）
    const sp = plan.spots[i];
    for (const pt of sp.points) {
      const a = P(pt), L = Math.hypot(q.x - a.x, q.y - a.y);
      if (L <= TAG_R + 0.5) continue;
      page.drawLine({ start: a, end: { x: q.x - ((q.x - a.x) / L) * TAG_R, y: q.y - ((q.y - a.y) / L) * TAG_R }, thickness: 0.4, color: GRAY });
      page.drawCircle({ x: a.x, y: a.y, size: 0.9, color: GRAY });
    }
    drawTag(c, q.x, q.y, sp.no, sp.confirm);
  });

  // 縮尺バー（1m）
  const bar = 1000 * k;
  const bx = AREA.x, by = M + 8;
  page.drawLine({ start: { x: bx, y: by }, end: { x: bx + bar, y: by }, thickness: 2, color: INK });
  txt(c, `1m　縮尺 1/${n}（A4）`, bx + bar + 6, by - 3, 8);

  // 右の欄: 題名・記号の見方・接続部の一覧
  const lx = PAGE[0] - M - LEGEND_W;
  page.drawLine({ start: { x: lx - 6, y: M - 6 }, end: { x: lx - 6, y: PAGE[1] - M + 6 }, thickness: 0.6, color: INK });
  let y = PAGE[1] - M - 10;
  txt(c, fit(font, d.name, 11, LEGEND_W - 4), lx, y, 11); y -= 15;
  txt(c, fit(font, `部材図　${p.title}`, 9, LEGEND_W - 4), lx, y, 9); y -= 12;
  txt(c, dateJa(d.date), lx, y, 7.5, GRAY); y -= 15;
  const head = (s: string) => { txt(c, s, lx, y, 8.5); y -= 5; page.drawLine({ start: { x: lx, y }, end: { x: lx + LEGEND_W - 4, y }, thickness: 0.5, color: GRAY }); y -= 11; };
  head(p.kind === 'elevation' ? '記号（この図の個数・平面図と重複）' : '記号（この図の個数）');
  const count = (f: (m: DrawMark) => boolean) => p.marks.filter(f).length;
  type KeyRow = { draw: (x: number, yy: number) => void; label: string; n: number };
  const keyRows: KeyRow[] = ([
    { draw: (x, yy) => { page.drawLine({ start: { x: x - 6, y: yy - 3 }, end: { x: x, y: yy - 3 }, thickness: 1.4, color: GRAY }); page.drawLine({ start: { x, y: yy - 3 }, end: { x, y: yy + 3 }, thickness: 1.4, color: GRAY }); }, label: 'エルボ（配管の曲がり。記号なし）', n: count((m) => m.kind === 'fitting' && GLYPH[m.code] === 'elbow') },
    { draw: (x, yy) => { page.drawLine({ start: { x: x - 6, y: yy }, end: { x: x + 6, y: yy }, thickness: 1.4, color: GRAY }); drawGlyph(c, x, yy, 'tee', { x: 1, y: 0 }); }, label: 'チーズ・Y・クロス', n: count((m) => m.kind === 'fitting' && GLYPH[m.code] === 'tee') },
    { draw: (x, yy) => { page.drawLine({ start: { x: x - 6, y: yy }, end: { x: x + 6, y: yy }, thickness: 1.4, color: GRAY }); drawGlyph(c, x, yy, 'socket', { x: 1, y: 0 }); }, label: 'ソケット（定尺の継ぎ足しを含む）', n: count((m) => m.kind === 'fitting' && GLYPH[m.code] === 'socket') },
    { draw: (x, yy) => { page.drawLine({ start: { x: x - 6, y: yy }, end: { x: x + 6, y: yy }, thickness: 1.4, color: GRAY }); drawGlyph(c, x, yy, 'reducer', { x: 1, y: 0 }); }, label: '径違い', n: count((m) => m.kind === 'fitting' && GLYPH[m.code] === 'reducer') },
    { draw: (x, yy) => { page.drawLine({ start: { x: x - 6, y: yy }, end: { x: x + 6, y: yy }, thickness: 1.4, color: GRAY }); drawGlyph(c, x, yy, 'valve', { x: 1, y: 0 }); }, label: 'バルブ（止水栓）', n: count((m) => m.kind === 'fitting' && GLYPH[m.code] === 'valve') },
    ...(['levelBand', 'saddle', 'tBracket'] as const).map((sk) => ({ draw: (x: number, yy: number) => { page.drawLine({ start: { x: x - 6, y: yy }, end: { x: x + 6, y: yy }, thickness: 1.2, color: hex('#64748b') }); drawSupport(c, x, yy, sk); }, label: sk === 'levelBand' ? 'レベルバンド' : sk === 'saddle' ? 'サドルバンド' : 'T 字金具', n: count((m) => m.kind === 'support' && m.support === sk) })),
    { draw: (x, yy) => drawTag(c, x, yy, 1, false), label: '接続部の番号（中身は下の一覧）', n: plan.spots.length },
  ] as KeyRow[]).filter((r) => r.n > 0 || r.label.startsWith('エルボ'));
  for (const r of keyRows) {
    r.draw(lx + 8, y + 2.5);
    txt(c, fit(font, r.label, 7, LEGEND_W - 46), lx + 20, y, 7);
    txt(c, `${r.n}`, lx + LEGEND_W - 8 - font.widthOfTextAtSize(`${r.n}`, 7.5), y, 7.5);
    y -= 12.5;
  }
  txt(c, '品名・仕様ごとの個数は最後の「部材一覧」', lx, y, 6.5, GRAY); y -= 14;
  // 接続部の一覧（入りきらなければ 2 列に）
  if (plan.spots.length) {
    head('接続部の一覧');
    const bottom = M + 56, lineH = 9.2;
    const rowsPerCol = Math.max(1, Math.floor((y - bottom) / lineH) + 1);
    const cols = plan.spots.length > rowsPerCol ? 2 : 1;
    const colW = (LEGEND_W - 4) / cols;
    plan.spots.forEach((sp, i) => {
      const col = Math.floor(i / rowsPerCol);
      if (col >= cols) return;
      const yy = y - (i % rowsPerCol) * lineH, x0 = lx + col * colW;
      drawTag(c, x0 + 5, yy + 2.3, sp.no, sp.confirm);
      const text = `${sp.label ? `${sp.label}　` : ''}${sp.codes}`;
      txt(c, fit(font, text, cols > 1 ? 5.6 : 6.6, colW - 14), x0 + 12, yy, cols > 1 ? 5.6 : 6.6, sp.confirm ? RED : INK);
    });
    const shown = Math.min(plan.spots.length, rowsPerCol * cols);
    if (shown < plan.spots.length) txt(c, `ほか ${plan.spots.length - shown} か所（部材一覧を参照）`, lx, bottom - 10, 6.5, GRAY);
    // 略号の意味（一覧に出てくるものだけ。入る所まで折り返す）
    const used = [...new Set(plan.spots.flatMap((sp) => sp.marks.map((m) => (m.kind === 'confirm' ? '!' : m.code))))].filter((k) => CODE_NAME[k]);
    let ky = y - Math.min(plan.spots.length, rowsPerCol) * lineH - 6;
    if (used.length && ky > bottom + 4) {
      const parts = used.map((k) => `${k} ${CODE_NAME[k]}`);
      let lineS = '略号: ';
      for (const part of parts) {
        const next = lineS === '略号: ' ? lineS + part : `${lineS}、${part}`;
        if (font.widthOfTextAtSize(next, 6) > LEGEND_W - 6 && lineS !== '略号: ') { txt(c, lineS, lx, ky, 6, GRAY); ky -= 8.5; lineS = part; if (ky < bottom) break; } else lineS = next;
      }
      if (ky >= bottom) txt(c, lineS, lx, ky, 6, GRAY);
    }
  }
  // 線の色
  const sys = [...new Set([...p.pipes.map((q) => q.system), ...p.risers.map((q) => q.system)])];
  let sx = lx;
  const sy = M + 30;
  for (const s of sys) {
    page.drawLine({ start: { x: sx, y: sy + 2.5 }, end: { x: sx + 12, y: sy + 2.5 }, thickness: 1.8, color: hex(colors[s] ?? '#475569') });
    const label = SYS_LABEL[s] ?? s;
    txt(c, label, sx + 14, sy, 6.5);
    sx += 20 + font.widthOfTextAtSize(label, 6.5);
    if (sx > lx + LEGEND_W - 30) break;
  }
  txt(c, '○ 縦管　記号の位置は目安です。現場で確認してください', lx, M + 18, 6.3, GRAY);
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
  for (const p of dr.pages) drawPage(pdf, font, p, meta, colors);
  partsPages(pdf, font, dr.parts, meta);
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    const s = `${i + 1} / ${pages.length}`;
    pg.drawText(s, { x: PAGE[0] / 2 - font.widthOfTextAtSize(s, 7) / 2, y: M - 18, size: 7, font, color: GRAY });
  });
  return pdf.save();
}
