/**
 * 申請図面の用紙描画。図面は「用紙 mm 座標の描画命令列（Sheet）」として作り、
 * プレビューは SVG に、出力は pdf-lib で PDF に変換する（同じ命令から作るので見た目が一致する）。
 * 座標: 原点は用紙の左上、x 右向き、y 下向き、単位 mm。
 */
import { degrees, PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { MunicipalityProfile } from '../model/municipality';

export type Op =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w?: number; color?: string; dash?: boolean }
  | { t: 'poly'; pts: [number, number][]; w?: number; color?: string; close?: boolean; fill?: string }
  | { t: 'rect'; x: number; y: number; w: number; h: number; stroke?: string; fill?: string; lw?: number }
  | { t: 'circle'; cx: number; cy: number; r: number; stroke?: string; fill?: string; lw?: number }
  | { t: 'text'; x: number; y: number; s: string; size: number; anchor?: 'start' | 'middle' | 'end'; color?: string; rotate?: -90 | 0; bold?: boolean };
export type Sheet = { width: number; height: number; ops: Op[] };

export const PAPER_MM = { A3: [420, 297], A4: [297, 210] } as const;
export const INK = '#1f2328';
export const GRAY = '#8b8f96';
export const RED = '#d91e18';
/** 警告の色（新設の赤と区別するため橙） */
export const WARN = '#ea580c';
export const PT_PER_MM = 72 / 25.4;

export function paperSize(p: MunicipalityProfile['paper']): { width: number; height: number } {
  const [l, s] = PAPER_MM[p.size];
  return p.orientation === 'landscape' ? { width: l, height: s } : { width: s, height: l };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 色は #rrggbb だけを属性に入れる（それ以外は既定色。プロファイルの色が属性に入るので注入を防ぐ） */
const col = (c: string | undefined, fallback = INK) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback);
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** プレビュー用 SVG（単位 mm、viewBox = 用紙） */
export function sheetToSvg(sheet: Sheet): string {
  const parts: string[] = [];
  for (const o of sheet.ops) {
    switch (o.t) {
      case 'line':
        parts.push(`<line x1="${n(o.x1)}" y1="${n(o.y1)}" x2="${n(o.x2)}" y2="${n(o.y2)}" stroke="${col(o.color)}" stroke-width="${n(o.w ?? 0.25)}"${o.dash ? ' stroke-dasharray="2 1"' : ''} stroke-linecap="round"/>`);
        break;
      case 'poly':
        parts.push(`<${o.close ? 'polygon' : 'polyline'} points="${o.pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${o.fill ? col(o.fill) : 'none'}" stroke="${col(o.color)}" stroke-width="${n(o.w ?? 0.25)}" stroke-linejoin="round"/>`);
        break;
      case 'rect':
        parts.push(`<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" fill="${o.fill ? col(o.fill) : 'none'}" stroke="${col(o.stroke)}" stroke-width="${n(o.lw ?? 0.25)}"/>`);
        break;
      case 'circle':
        parts.push(`<circle cx="${n(o.cx)}" cy="${n(o.cy)}" r="${n(o.r)}" fill="${o.fill ? col(o.fill) : 'none'}" stroke="${col(o.stroke)}" stroke-width="${n(o.lw ?? 0.25)}"/>`);
        break;
      case 'text': {
        const anchor = o.anchor ?? 'start';
        const tr = o.rotate ? ` transform="rotate(${o.rotate} ${n(o.x)} ${n(o.y)})"` : '';
        parts.push(`<text x="${n(o.x)}" y="${n(o.y)}" font-size="${n(o.size)}" text-anchor="${anchor}" fill="${col(o.color)}"${o.bold ? ' font-weight="bold"' : ''}${tr}>${esc(o.s)}</text>`);
        break;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(sheet.width)} ${n(sheet.height)}" width="${n(sheet.width)}mm" height="${n(sheet.height)}mm" font-family="'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif">`
    + `<rect x="0" y="0" width="${n(sheet.width)}" height="${n(sheet.height)}" fill="#fff"/>` + parts.join('') + '</svg>';
}

/** 複数ページを縦に並べた 1 つの SVG（SVG 書き出し用） */
export function sheetsToSvg(sheets: Sheet[]): string {
  if (sheets.length === 1) return sheetToSvg(sheets[0]);
  const width = Math.max(...sheets.map((s) => s.width));
  const height = sheets.reduce((a, s) => a + s.height, 0);
  let y = 0;
  const pages = sheets.map((s) => {
    const inner = sheetToSvg(s).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const out = `<g transform="translate(0 ${n(y)})">${inner}</g>`;
    y += s.height;
    return out;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}" width="${n(width)}mm" height="${n(height)}mm" font-family="'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif">${pages.join('')}</svg>`;
}

const hex = (h: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return rgb(0.5, 0.5, 0.5);
  const v = parseInt(m[1], 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
};

/** 1 Sheet = 1 ページの PDF */
/** 同梱フォント（JIS 範囲）に無い字の置き換え。無ければ 〓 */
const SUBST: Record<string, string> = { '髙': '高', '﨑': '崎', '德': '徳', '栁': '柳', '瀨': '瀬', '濵': '濱', '𠮷': '吉', '塚': '塚', '曻': '昇', '隆': '隆' };
const charSets = new WeakMap<PDFFont, Set<number>>();
/** フォントに無い文字を置き換える（pdf-lib は未対応の字で例外を投げる）。missing に元の字を集める */
export function fontSafe(font: PDFFont, s: string, missing?: Set<string>): string {
  let cs = charSets.get(font);
  if (!cs) { cs = new Set(font.getCharacterSet()); charSets.set(font, cs); }
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cs.has(cp)) { out += ch; continue; }
    const r = SUBST[ch];
    const rr = r && cs.has(r.codePointAt(0)!) ? r : '〓';
    missing?.add(ch);
    out += rr;
  }
  return out;
}

export type PdfOpts = { /** フォントに無かった文字（呼び出し側で警告に使う） */ missing?: Set<string> };

export async function sheetsToPdf(sheets: Sheet[], fontBytes: Uint8Array | ArrayBuffer, opts: PdfOpts = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false });
  for (const sheet of sheets) {
    const page = pdf.addPage([sheet.width * PT_PER_MM, sheet.height * PT_PER_MM]);
    drawSheetOnPage(page, font, sheet, { x: 0, top: 0, w: sheet.width * PT_PER_MM, h: sheet.height * PT_PER_MM }, opts);
  }
  return pdf.save();
}

/** 既存のページの枠 box（pt、top は上端からの距離）に Sheet を縮小して描く。様式 PDF の図面欄に載せるときに使う（用紙の向きは枠に合わせておくこと。A4 縦の枠に A3 横を入れると約 0.4 倍になる） */
export function drawSheetOnPage(page: PDFPage, font: PDFFont, sheet: Sheet, box: { x: number; top: number; w: number; h: number }, opts: PdfOpts = {}): void {
  const k = Math.min(box.w / (sheet.width * PT_PER_MM), box.h / (sheet.height * PT_PER_MM));
  const pageH = page.getHeight();
  const X = (x: number) => box.x + x * PT_PER_MM * k, Y = (y: number) => pageH - (box.top + y * PT_PER_MM * k), W = (w: number) => w * PT_PER_MM * k;
  {
    for (const o of sheet.ops) {
      switch (o.t) {
        case 'line':
          page.drawLine({ start: { x: X(o.x1), y: Y(o.y1) }, end: { x: X(o.x2), y: Y(o.y2) }, thickness: W(o.w ?? 0.25), color: hex(o.color ?? INK), ...(o.dash ? { dashArray: [W(2), W(1)] } : {}) });
          break;
        case 'poly': {
          // PDF では塗りつぶしを省略して輪郭だけ描く（記号の白塗りは背景と同じなので見た目は変わらない）
          const pts = o.close ? [...o.pts, o.pts[0]] : o.pts;
          for (let i = 1; i < pts.length; i++) page.drawLine({ start: { x: X(pts[i - 1][0]), y: Y(pts[i - 1][1]) }, end: { x: X(pts[i][0]), y: Y(pts[i][1]) }, thickness: W(o.w ?? 0.25), color: hex(o.color ?? INK) });
          break;
        }
        case 'rect':
          page.drawRectangle({ x: X(o.x), y: Y(o.y + o.h), width: W(o.w), height: W(o.h), borderColor: hex(o.stroke ?? INK), borderWidth: W(o.lw ?? 0.25), ...(o.fill ? { color: hex(o.fill) } : {}) });
          break;
        case 'circle':
          page.drawCircle({ x: X(o.cx), y: Y(o.cy), size: W(o.r), borderColor: hex(o.stroke ?? INK), borderWidth: W(o.lw ?? 0.25), ...(o.fill ? { color: hex(o.fill) } : { opacity: 0 }) });
          break;
        case 'text': {
          const size = W(o.size);
          const str = fontSafe(font, o.s, opts.missing);
          const tw = font.widthOfTextAtSize(str, size);
          const anchor = o.anchor ?? 'start';
          const dx = anchor === 'middle' ? -tw / 2 : anchor === 'end' ? -tw : 0;
          if (o.rotate === -90) {
            page.drawText(str, { x: X(o.x), y: Y(o.y) + dx, size, font, color: hex(o.color ?? INK), rotate: degrees(90) });
          } else {
            page.drawText(str, { x: X(o.x) + dx, y: Y(o.y), size, font, color: hex(o.color ?? INK) });
          }
          break;
        }
      }
    }
  }
}

/** 図面記号。r は半径(mm) */
export function drawSymbol(sheet: Sheet, id: string, x: number, y: number, r: number, color = INK): void {
  const ops = sheet.ops;
  switch (id) {
    case 'square':
      ops.push({ t: 'rect', x: x - r, y: y - r, w: r * 2, h: r * 2, stroke: color, fill: '#ffffff', lw: 0.3 });
      break;
    case 'squareCross':
      ops.push({ t: 'rect', x: x - r, y: y - r, w: r * 2, h: r * 2, stroke: color, fill: '#ffffff', lw: 0.3 });
      ops.push({ t: 'line', x1: x - r, y1: y - r, x2: x + r, y2: y + r, color }, { t: 'line', x1: x - r, y1: y + r, x2: x + r, y2: y - r, color });
      break;
    case 'circleDot':
      ops.push({ t: 'circle', cx: x, cy: y, r, stroke: color, fill: '#ffffff', lw: 0.3 }, { t: 'circle', cx: x, cy: y, r: r * 0.35, stroke: color, fill: color });
      break;
    case 'triangle':
      ops.push({ t: 'poly', pts: [[x, y - r], [x + r, y + r], [x - r, y + r]], close: true, color, fill: '#ffffff' });
      break;
    case 'meter':
      ops.push({ t: 'circle', cx: x, cy: y, r, stroke: color, fill: '#ffffff', lw: 0.3 }, { t: 'text', x, y: y + r * 0.6, s: 'M', size: r * 1.6, anchor: 'middle', color });
      break;
    case 'valve':
      ops.push({ t: 'poly', pts: [[x - r, y - r], [x + r, y + r], [x + r, y - r], [x - r, y + r]], close: true, color, fill: '#ffffff' });
      break;
    case 'faucet':
      ops.push({ t: 'line', x1: x, y1: y, x2: x, y2: y - r * 1.5, color }, { t: 'line', x1: x, y1: y - r * 1.5, x2: x + r * 1.5, y2: y - r * 1.5, color }, { t: 'circle', cx: x, cy: y, r: r * 0.5, stroke: color, fill: color });
      break;
    default:
      ops.push({ t: 'circle', cx: x, cy: y, r, stroke: color, fill: '#ffffff', lw: 0.3 });
  }
}

export const TITLE_W = 120;
/** 表題欄の幅: 用紙幅の 40% まで（A4 縦では 84mm） */
export const titleWidth = (sheetWidth: number) => Math.min(TITLE_W, Math.round(sheetWidth * 0.4));
export const DISCLAIMER = '本図は作図支援ツール（PipeCraft 3D）の出力です。自治体の審査基準への適合を保証しません。';

/** 右下の表題欄（幅 120mm、1 行 7mm）。免責は表題欄の下に小さく */
export function drawTitleBlock(sheet: Sheet, fields: { label: string; value: string }[], disclaimer = DISCLAIMER): void {
  const rowH = 7, w = titleWidth(sheet.width), labelW = Math.min(28, Math.round(w * 0.3));
  const h = rowH * fields.length;
  const x0 = sheet.width - 10 - w, y0 = sheet.height - 10 - h;
  sheet.ops.push({ t: 'rect', x: x0, y: y0, w, h, lw: 0.5 });
  fields.forEach((f, i) => {
    const y = y0 + rowH * i;
    if (i > 0) sheet.ops.push({ t: 'line', x1: x0, y1: y, x2: x0 + w, y2: y });
    sheet.ops.push({ t: 'line', x1: x0 + labelW, y1: y, x2: x0 + labelW, y2: y + rowH });
    sheet.ops.push({ t: 'text', x: x0 + 2, y: y + rowH - 2.2, s: f.label, size: 3, color: GRAY });
    sheet.ops.push({ t: 'text', x: x0 + labelW + 2, y: y + rowH - 2.2, s: f.value, size: 3.2 });
  });
  sheet.ops.push({ t: 'text', x: sheet.width - 10, y: sheet.height - 4, s: disclaimer, size: 2.2, anchor: 'end', color: GRAY });
}

/** 用紙の枠 */
export function drawFrame(sheet: Sheet): void {
  sheet.ops.push({ t: 'rect', x: 10, y: 10, w: sheet.width - 20, h: sheet.height - 20, lw: 0.5 });
}

/** 文字列が幅 w(mm) に収まるように切り詰める（文字幅 ≒ size×0.95、半角は半分） */
export function fitText(s: string, size: number, w: number): string {
  const width = (t: string) => [...t].reduce((a, c) => a + (c.charCodeAt(0) < 0x100 ? 0.55 : 1) * size, 0);
  if (width(s) <= w) return s;
  let t = s;
  while (t.length > 1 && width(t + '…') > w) t = t.slice(0, -1);
  return t + '…';
}

/** 右上の受付欄（「受付番号 | — | 水道番号 | — | 縮尺 | NO SCALE」）。fields が空なら何も描かない。戻り値は欄の下端 y */
export function drawHeaderBlock(sheet: Sheet, fields: string[], values: Record<string, string>, top = 12): number {
  if (!fields.length) return top;
  const labelW = 16, valueW = 22, h = 7;
  const w = fields.length * (labelW + valueW);
  const x0 = sheet.width - 10 - w;
  sheet.ops.push({ t: 'rect', x: x0, y: top, w, h, stroke: INK, lw: 0.4 });
  fields.forEach((f, i) => {
    const x = x0 + i * (labelW + valueW);
    if (i > 0) sheet.ops.push({ t: 'line', x1: x, y1: top, x2: x, y2: top + h, color: INK, w: 0.4 });
    sheet.ops.push({ t: 'line', x1: x + labelW, y1: top, x2: x + labelW, y2: top + h, color: INK, w: 0.25 });
    sheet.ops.push({ t: 'text', x: x + labelW / 2, y: top + h / 2 + 1, s: fitText(f, 2.6, labelW - 1), size: 2.6, anchor: 'middle' });
    sheet.ops.push({ t: 'text', x: x + labelW + valueW / 2, y: top + h / 2 + 1, s: fitText(values[f] ?? '—', 2.6, valueW - 1), size: 2.6, anchor: 'middle' });
  });
  return top + h;
}
