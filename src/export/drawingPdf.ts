/**
 * 部材図 PDF（A4 横）。見積書とは別に印刷する施工用の図。
 * 1ページ目以降: 階ごとの平面図・外配管の立面図に、継手・支持金具（サドル等）・ネジ継手・器具を記号で描き、右に凡例と個数。
 * 最後: 部材一覧（金額なし。現場への持ち出し・発注のチェック用）。
 * 縮尺は 1/20〜1/1000 の切りのよい値から、図が収まるいちばん大きいものを選ぶ（A4 で印刷したときの縮尺）。
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { DrawMark, DrawPage, Drawing, LegendRow, PartsRow } from './drawing';
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

function drawPage(pdf: PDFDocument, font: PDFFont, p: DrawPage, d: { name: string; date: Date }, colors: Record<SystemType, string>) {
  const page = pdf.addPage(PAGE);
  const c: Ctx = { page, font };
  const areaX = M, areaY = M + 30, areaW = PAGE[0] - M * 2 - LEGEND_W - 10, areaH = PAGE[1] - M * 2 - 40;
  page.drawRectangle({ x: M - 6, y: M - 6, width: PAGE[0] - (M - 6) * 2, height: PAGE[1] - (M - 6) * 2, borderColor: INK, borderWidth: 0.8 });
  const w = p.bounds.maxX - p.bounds.minX, h = p.bounds.maxY - p.bounds.minY;
  const n = pickScale(w, h, areaW, areaH);
  const k = PT_PER_MM / n;
  const ox = areaX + (areaW - w * k) / 2, oy = areaY + areaH - (areaH - h * k) / 2;
  const P = (q: { x: number; y: number }) => ({ x: ox + (q.x - p.bounds.minX) * k, y: oy - (q.y - p.bounds.minY) * k });

  if (p.frame) {
    const a = P({ x: 0, y: 0 }), b = P({ x: p.frame.w, y: p.frame.h });
    page.drawRectangle({ x: a.x, y: b.y, width: b.x - a.x, height: a.y - b.y, borderColor: WALL, borderWidth: 1.2, color: rgb(0.97, 0.97, 0.98) });
    page.drawLine({ start: { x: a.x - 10, y: b.y }, end: { x: b.x + 10, y: b.y }, thickness: 1.5, color: INK });
    txt(c, 'GL', a.x - 22, b.y - 3, 7, GRAY);
  }
  for (const wl of p.walls) {
    const a = P(wl.a), b = P(wl.b);
    page.drawLine({ start: a, end: b, thickness: Math.max(1.5, wl.thickness * k), color: WALL });
  }
  for (const fx of p.fixtures) {
    const cs = fx.corners.map(P);
    for (let i = 0; i < cs.length; i++) page.drawLine({ start: cs[i], end: cs[(i + 1) % cs.length], thickness: 0.8, color: FIX });
    // 名前は器具の外（上）に出して、接続口の記号と重ねない
    const cx = cs.reduce((s, q) => s + q.x, 0) / cs.length, top = Math.max(...cs.map((q) => q.y));
    txt(c, fit(font, fx.label, 6, 90), cx, top + 3, 6, FIX, true);
  }
  for (const pp of p.pipes) page.drawLine({ start: P(pp.a), end: P(pp.b), thickness: 1.6, color: hex(colors[pp.system] ?? '#475569') });
  for (const r of p.risers) {
    const q = P(r.p);
    page.drawCircle({ x: q.x, y: q.y, size: 3.2, borderColor: hex(colors[r.system] ?? '#475569'), borderWidth: 1.4 });
    page.drawCircle({ x: q.x, y: q.y, size: 0.9, color: hex(colors[r.system] ?? '#475569') });
  }
  // 支持金具 → 継手の順（継手を上に）
  for (const m of p.marks) if (m.kind === 'support') { const q = P(m.p); drawSupport(c, q.x, q.y, m.support, m.dir ? { x: m.dir.x, y: -m.dir.y } : undefined); }
  // 平面で同じ位置に重なる継手（縦管の上下のエルボなど）は横にずらし、細い線で元の位置を示す
  const placed: { x: number; y: number }[] = [];
  for (const m of p.marks) {
    if (m.kind === 'support') continue;
    const q = P(m.p);
    let x = q.x, y = q.y, i = 0;
    while (placed.some((o) => Math.hypot(o.x - x, o.y - y) < 11) && i < 12) { i++; x = q.x + 13 * Math.ceil(i / 2) * (i % 2 ? 1 : -1); y = q.y + 9; }
    if (i > 0) page.drawLine({ start: q, end: { x, y }, thickness: 0.4, color: GRAY });
    placed.push({ x, y });
    drawFitting(c, x, y, m.code, m.kind === 'confirm');
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
  txt(c, `部材図　${p.title}`, lx, y, 9); y -= 13;
  txt(c, dateJa(d.date), lx, y, 7.5, GRAY); y -= 18;
  txt(c, '凡例（この図の個数）', lx, y, 8.5); y -= 6;
  page.drawLine({ start: { x: lx, y }, end: { x: lx + LEGEND_W - 4, y }, thickness: 0.5, color: GRAY }); y -= 13;
  const rows = p.legend;
  const bottom = M + 70;
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
  txt(c, '○ 縦管（平面）　! 要確認の点', lx, M + 30, 6.5, GRAY);
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
  for (const p of dr.pages) drawPage(pdf, font, p, meta, colors);
  partsPages(pdf, font, dr.parts, meta);
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    const s = `${i + 1} / ${pages.length}`;
    pg.drawText(s, { x: PAGE[0] / 2 - font.widthOfTextAtSize(s, 7) / 2, y: M - 18, size: 7, font, color: GRAY });
  });
  return pdf.save();
}
