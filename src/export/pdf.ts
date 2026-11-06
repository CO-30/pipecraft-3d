/**
 * 見積書・数量表の PDF（A4 縦）。日本語フォント（JIS X 0208 の文字にサブセット化済み）を埋め込む。
 * pdf-lib の subset: true は日本語の字形が欠ける不具合があるため使わない（PDF は約1.3MB）。
 * フォントのバイト列は呼び出し側が渡す（ブラウザ: fetch、テスト: ファイル）。
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { dateJa, DISCLAIMER, yen, type Cell, type Report, type Table } from './report';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const BLACK = rgb(0.1, 0.1, 0.12);
const GRAY = rgb(0.45, 0.45, 0.5);
const LINE = rgb(0.75, 0.77, 0.8);
const HEAD_BG = rgb(0.93, 0.95, 0.98);

type Ctx = { pdf: PDFDocument; font: PDFFont; page: PDFPage; y: number; title: string };

const fmtNum = (v: number) => (Number.isInteger(v) ? v.toLocaleString('ja-JP') : v.toLocaleString('ja-JP', { maximumFractionDigits: 3 }));
const cellText = (c: Cell, money: boolean) => (typeof c === 'number' ? (money ? yen(c) : fmtNum(c)) : c);

function fit(font: PDFFont, text: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > width) t = t.slice(0, -1);
  return t + '…';
}

function newPage(c: Ctx, title: string) {
  c.page = c.pdf.addPage(A4);
  c.title = title;
  c.y = A4[1] - MARGIN;
}

function text(c: Ctx, s: string, x: number, size: number, opts: { color?: ReturnType<typeof rgb>; right?: number; center?: boolean } = {}) {
  let px = x;
  const w = c.font.widthOfTextAtSize(s, size);
  if (opts.right !== undefined) px = opts.right - w;
  if (opts.center) px = (A4[0] - w) / 2;
  c.page.drawText(s, { x: px, y: c.y - size, size, font: c.font, color: opts.color ?? BLACK });
}

function heading(c: Ctx, s: string) {
  ensure(c, 40);
  text(c, s, MARGIN, 14);
  c.y -= 24;
}

function ensure(c: Ctx, h: number) {
  if (c.y - h < MARGIN + 24) newPage(c, c.title);
}

/** widths は比率。money[i] の列は円表記 */
function table(c: Ctx, t: Pick<Table, 'head' | 'rows' | 'numeric'>, widths: number[], money: boolean[] = []) {
  const size = 8.5, rowH = 16;
  const total = widths.reduce((a, b) => a + b, 0);
  const W = A4[0] - MARGIN * 2;
  const ws = widths.map((w) => (w / total) * W);
  const drawRow = (cells: Cell[], head: boolean) => {
    ensure(c, rowH + (head ? 0 : rowH));
    if (head) c.page.drawRectangle({ x: MARGIN, y: c.y - rowH, width: W, height: rowH, color: HEAD_BG });
    let x = MARGIN;
    cells.forEach((cell, i) => {
      const s = fit(c.font, cellText(cell, !!money[i] && !head), size, ws[i] - 6);
      const right = !head && t.numeric[i];
      const yy = c.y;
      c.y -= (rowH - size) / 2;
      text(c, s, x + 3, size, right ? { right: x + ws[i] - 3 } : {});
      c.y = yy;
      x += ws[i];
    });
    c.page.drawLine({ start: { x: MARGIN, y: c.y - rowH }, end: { x: MARGIN + W, y: c.y - rowH }, thickness: 0.5, color: LINE });
    c.y -= rowH;
  };
  drawRow(t.head, true);
  for (const r of t.rows) {
    if (c.y - rowH < MARGIN + 24) { newPage(c, c.title); drawRow(t.head, true); }
    drawRow(r, false);
  }
  c.y -= 10;
}

export async function buildPdf(r: Report, fontBytes: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false });
  pdf.setTitle(`${r.meta.name} 見積書`);
  pdf.setCreator('PipeCraft 3D');
  pdf.setCreationDate(r.meta.date);
  const c: Ctx = { pdf, font, page: pdf.addPage(A4), y: A4[1] - MARGIN, title: '見積書' };
  const s = r.settings;

  // ---- 見積書 ----
  text(c, '御 見 積 書', 0, 22, { center: true });
  c.y -= 40;
  const top = c.y;
  text(c, `${s.client ? s.client : ''}　様`, MARGIN, 14);
  c.y -= 26;
  const info: [string, string][] = [['工事名', s.title || r.meta.name], ['現場名', r.meta.name], ...(r.meta.address ? [['住所', r.meta.address] as [string, string]] : [])];
  for (const [k, v] of info) { text(c, `${k}：${fit(font, v, 10, 300)}`, MARGIN, 10); c.y -= 16; }
  const left = c.y;
  c.y = top;
  text(c, `作成日：${dateJa(r.meta.date)}`, 0, 10, { right: A4[0] - MARGIN });
  c.y -= 16;
  if (s.issuer) for (const line of s.issuer.split('\n').slice(0, 4)) { text(c, fit(font, line, 10, 220), 0, 10, { right: A4[0] - MARGIN }); c.y -= 15; }
  c.y = Math.min(left, c.y) - 10;
  // 合計金額の枠
  c.page.drawRectangle({ x: MARGIN, y: c.y - 34, width: A4[0] - MARGIN * 2, height: 34, borderColor: BLACK, borderWidth: 1 });
  c.y -= 9;
  text(c, '御見積金額（税込）', MARGIN + 10, 12);
  text(c, yen(r.est.total), 0, 16, { right: A4[0] - MARGIN - 12 });
  c.y -= 40;
  text(c, '下記のとおり御見積申し上げます。', MARGIN, 9, { color: GRAY });
  c.y -= 18;

  const widths = [26, 26, 10, 7, 13, 15];
  for (const q of r.quote) {
    ensure(c, 50);
    text(c, `■ ${q.section}`, MARGIN, 10);
    c.y -= 15;
    table(c, { head: ['項目', '仕様', '数量', '単位', '単価', '金額'], rows: q.rows, numeric: [false, false, true, false, true, true] }, widths, [false, false, false, false, true, true]);
  }
  ensure(c, r.totals.length * 16 + 10);
  for (const [k, v] of r.totals) {
    const big = k === '合計';
    text(c, k, A4[0] - MARGIN - 250, big ? 11 : 10);
    text(c, yen(v), 0, big ? 11 : 10, { right: A4[0] - MARGIN - 3 });
    c.y -= big ? 18 : 15;
  }
  if (s.note) {
    c.y -= 6;
    ensure(c, 40);
    text(c, '備考', MARGIN, 10);
    c.y -= 15;
    for (const line of s.note.split('\n')) { ensure(c, 14); text(c, fit(font, line, 9, A4[0] - MARGIN * 2), MARGIN, 9); c.y -= 13; }
  }

  // ---- 数量表・部品一覧 ----
  newPage(c, '数量表');
  heading(c, `${r.tables[0].title}（${r.meta.name}）`);
  table(c, r.tables[0], [12, 18, 10, 12, 11, 11, 10, 11]);
  heading(c, r.tables[1].title);
  table(c, r.tables[1], [22, 30, 10, 38]);
  if (r.tables[2].rows.length) {
    heading(c, r.tables[2].title);
    table(c, r.tables[2], [22, 18, 9, 7, 44]);
  }
  if (r.issues.rows.length) {
    heading(c, `${r.issues.title}（${r.issues.rows.length}件）`);
    table(c, r.issues, [18, 82]);
  }

  // ---- フッター（ページ番号・注意書き） ----
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const size = 7.5;
    p.drawText(`${i + 1} / ${pages.length}`, { x: A4[0] - MARGIN - font.widthOfTextAtSize(`${i + 1} / ${pages.length}`, size), y: MARGIN - 18, size, font, color: GRAY });
    p.drawText(fit(font, DISCLAIMER, size, A4[0] - MARGIN * 2 - 50), { x: MARGIN, y: MARGIN - 18, size, font, color: GRAY });
  });
  return pdf.save();
}
