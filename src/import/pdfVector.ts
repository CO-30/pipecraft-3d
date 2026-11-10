/**
 * PDF 図面のページから線と文字を取り出す（CAD から出力した PDF は線がデータで入っている）。
 * 画像にしないので、線の位置は PDF の精度のまま。曲線は読まない（壁・基礎は直線で拾う）。
 */
import type { PSeg, PText, VectorPage } from '../model/planRead/sheet';

type Mat = [number, number, number, number, number, number];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const scaleOf = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

export type OpList = { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> };
export type TextItemLike = { str?: string; transform?: number[]; width?: number; height?: number };
/** pdf.js の OPS のうち使うもの */
export type OpCodes = Record<'save' | 'restore' | 'transform' | 'setLineWidth' | 'constructPath' | 'stroke' | 'closeStroke' | 'fillStroke' | 'eoFillStroke' | 'closeFillStroke' | 'closeEOFillStroke' | 'paintFormXObjectBegin' | 'paintFormXObjectEnd', number>;

/** これより多い線は読まない（端末のメモリを守る。住宅の図面 1 枚は数万本） */
export const MAX_PAGE_SEGS = 600_000;
// constructPath の経路データ（pdf.js の DrawOPS）: 命令の番号 → 続く数値の個数
const MOVE = 0, LINE = 1, CLOSE = 4;
const ARGC = [2, 2, 6, 4, 0];

/** 描画命令の列 → 線分（紙の座標: 左上原点・y 下向き・ポイント）。viewport は pdf.js の viewport.transform（scale 1） */
export function opsToSegments(ops: OpList, OPS: OpCodes, viewport: number[]): PSeg[] {
  const strokes = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const closing = new Set([OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const out: PSeg[] = [];
  const stack: { m: Mat; lw: number }[] = [];
  let m = viewport as Mat, lw = 1;
  const line = (ax: number, ay: number, bx: number, by: number, w: number) => {
    if (out.length >= MAX_PAGE_SEGS) return;
    const [x1, y1] = apply(m, ax, ay), [x2, y2] = apply(m, bx, by);
    if (Math.abs(x1 - x2) + Math.abs(y1 - y2) > 1e-3) out.push({ x1, y1, x2, y2, w });
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i] as unknown[] | null;
    if (fn === OPS.save) stack.push({ m, lw });
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) ({ m, lw } = s); }
    else if (fn === OPS.transform) m = mul(m, args as unknown as Mat);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push({ m, lw }); if (args?.[0]) m = mul(m, args[0] as Mat); }
    else if (fn === OPS.paintFormXObjectEnd) { const s = stack.pop(); if (s) ({ m, lw } = s); }
    else if (fn === OPS.setLineWidth) lw = Number(args?.[0]) || 0;
    else if (fn === OPS.constructPath) {
      const paint = args?.[0] as number, data = (args?.[1] as ArrayLike<number>[] | undefined)?.[0];
      if (!data || !strokes.has(paint)) continue;
      const w = lw * scaleOf(m);
      let sx = 0, sy = 0, cx = 0, cy = 0, open = false;
      for (let k = 0; k < data.length;) {
        const op = data[k++];
        const n = ARGC[op];
        if (n === undefined) break; // 知らない命令: この経路はここまで
        if (op === MOVE) { sx = cx = data[k]; sy = cy = data[k + 1]; open = true; }
        else if (op === LINE) { line(cx, cy, data[k], data[k + 1], w); cx = data[k]; cy = data[k + 1]; }
        else if (op === CLOSE) { if (open) line(cx, cy, sx, sy, w); cx = sx; cy = sy; }
        else { cx = data[k + n - 2]; cy = data[k + n - 1]; } // 曲線は終点へ移るだけ
        k += n;
      }
      if (closing.has(paint) && open) line(cx, cy, sx, sy, w);
    }
  }
  return out;
}

/** 文字（PDF の座標）→ 紙の座標の中心と高さ */
export function textItemsToTexts(items: TextItemLike[], viewport: number[]): PText[] {
  const out: PText[] = [];
  for (const it of items) {
    const s = it.str?.trim();
    if (!s || !it.transform) continue;
    const t = it.transform as Mat;
    const h = it.height || Math.hypot(t[2], t[3]);
    const ux = Math.hypot(t[0], t[1]) || 1;
    // 文字列の中心 = 書き出し位置 + 幅の半分（文字の向き） + 高さの半分（文字の上向き）
    const cx = t[4] + ((it.width ?? 0) / 2) * (t[0] / ux) + (h / 2) * (-t[1] / ux);
    const cy = t[5] + ((it.width ?? 0) / 2) * (t[1] / ux) + (h / 2) * (t[0] / ux);
    const [x, y] = apply(viewport as Mat, cx, cy);
    out.push({ x, y, h, s });
  }
  return out;
}

type PdfJs = { getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDocLike>; destroy(): unknown }; OPS: Record<string, number> };
type PdfDocLike = { numPages: number; getPage(n: number): Promise<PdfPageLike> };
type PdfPageLike = { cleanup?(): unknown; getViewport(o: { scale: number }): { width: number; height: number; transform: number[] }; getOperatorList(): Promise<OpList>; getTextContent(): Promise<{ items: unknown[] }> };

/** PDF のページ（先頭から maxPages まで）を線と文字にする。lib は pdf.js（省略時はブラウザ用を読み込む。テストでは Node 用を渡す） */
export async function readVectorPages(data: ArrayBuffer, lib?: unknown, maxPages = Infinity): Promise<VectorPage[]> {
  const pdfjs = (lib ?? (await import('./pdf')).pdfjsLib) as PdfJs;
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  try {
    const doc = await task.promise;
    const pages: VectorPage[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const segs = opsToSegments(await page.getOperatorList(), pdfjs.OPS as OpCodes, vp.transform);
      const texts = textItemsToTexts((await page.getTextContent()).items as TextItemLike[], vp.transform);
      pages.push({ widthPt: vp.width, heightPt: vp.height, segs, texts, ...(segs.length >= MAX_PAGE_SEGS ? { truncated: true } : {}) });
      page.cleanup?.(); // 描画命令の控えを手放す（枚数が多いとメモリを圧迫する）
    }
    return pages;
  } finally {
    void task.destroy();
  }
}

/** 1 ページだけ読む（n は 1 から） */
export async function readVectorPage(data: ArrayBuffer, n: number, lib?: unknown): Promise<VectorPage> {
  const pages = await readVectorPages(data, lib);
  if (!pages[n - 1]) throw new Error('ページがありません');
  return pages[n - 1];
}
