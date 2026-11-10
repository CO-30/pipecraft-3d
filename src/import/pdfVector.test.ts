import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { opsToSegments, readVectorPages, textItemsToTexts, type OpCodes } from './pdfVector';

const OPS: OpCodes = { save: 1, restore: 2, transform: 3, setLineWidth: 4, constructPath: 5, stroke: 6, closeStroke: 7, fillStroke: 8, eoFillStroke: 9, closeFillStroke: 10, closeEOFillStroke: 11, paintFormXObjectBegin: 12, paintFormXObjectEnd: 13 };
const FILL = 99;
/** 紙の高さ 100pt（PDF は y 上向き → 紙は y 下向き） */
const VIEW = [1, 0, 0, -1, 0, 100];
const path = (paint: number, ...d: number[]) => [paint, [new Float32Array(d)], null];
const run = (list: [number, unknown][]) => opsToSegments({ fnArray: list.map((x) => x[0]), argsArray: list.map((x) => x[1]) }, OPS, VIEW);

describe('PDF の線と文字を読む', () => {
  it('線を紙の座標（左上原点・y 下向き）にし、太さを持たせる', () => {
    const s = run([[OPS.setLineWidth, [0.5]], [OPS.constructPath, path(OPS.stroke, 0, 10, 20, 1, 30, 20)]]);
    expect(s).toEqual([{ x1: 10, y1: 80, x2: 30, y2: 80, w: 0.5 }]);
  });
  it('拡大・移動（transform）と save / restore、部品（Form XObject）を追う', () => {
    const s = run([
      [OPS.save, null], [OPS.transform, [2, 0, 0, 2, 10, 0]], [OPS.setLineWidth, [0.25]],
      [OPS.constructPath, path(OPS.stroke, 0, 0, 0, 1, 5, 0)],
      [OPS.restore, null],
      [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 0, 50], null]], [OPS.constructPath, path(OPS.stroke, 0, 0, 0, 1, 5, 0)], [OPS.paintFormXObjectEnd, null],
      [OPS.constructPath, path(OPS.stroke, 0, 0, 0, 1, 5, 0)],
    ]);
    expect(s.map((x) => [x.x1, x.y1, x.x2, x.y2, x.w])).toEqual([[10, 100, 20, 100, 0.5], [0, 50, 5, 50, 1], [0, 100, 5, 100, 1]]);
  });
  it('塗りだけの図形は読まない。閉じた経路は最後の辺も線にする。曲線は終点へ移るだけ', () => {
    expect(run([[OPS.constructPath, path(FILL, 0, 0, 0, 1, 5, 0)]])).toEqual([]);
    expect(run([[OPS.constructPath, path(OPS.stroke, 0, 0, 0, 1, 10, 0, 1, 10, 10, 4)]])).toHaveLength(3);
    expect(run([[OPS.constructPath, path(OPS.closeStroke, 0, 0, 0, 1, 10, 0, 1, 10, 10)]])).toHaveLength(3);
    const c = run([[OPS.constructPath, path(OPS.stroke, 0, 0, 0, 2, 1, 1, 2, 2, 10, 0, 1, 20, 0)]]);
    expect(c).toEqual([{ x1: 10, y1: 100, x2: 20, y2: 100, w: 1 }]);
  });
  it('文字は中心の位置で返す（縦書きの寸法も向きに合わせる）', () => {
    const [a, b] = textItemsToTexts([
      { str: 'X1', transform: [8, 0, 0, 8, 10, 20], width: 10, height: 8 },
      { str: '910', transform: [0, 8, -8, 0, 50, 20], width: 12, height: 8 },
      { str: '  ', transform: [8, 0, 0, 8, 0, 0], width: 4, height: 8 },
    ], VIEW);
    expect(a).toEqual({ x: 15, y: 76, h: 8, s: 'X1' });
    expect([b.x, b.y]).toEqual([46, 74]);
  });
  it('実際の PDF（pdf-lib で作る）から線と文字を読める', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    page.drawLine({ start: { x: 50, y: 250 }, end: { x: 350, y: 250 }, thickness: 0.5 });
    page.drawRectangle({ x: 100, y: 100, width: 80, height: 40, borderWidth: 0.25 });
    page.drawText('X1', { x: 60, y: 40, size: 8, font: await doc.embedFont(StandardFonts.Helvetica) });
    const bytes = await doc.save();
    const [p] = await readVectorPages(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, pdfjs);
    expect([p.widthPt, p.heightPt]).toEqual([400, 300]);
    const long = p.segs.find((s) => Math.abs(s.x2 - s.x1) > 250)!;
    expect([Math.round(long.y1), Math.round(Math.min(long.x1, long.x2)), long.w]).toEqual([50, 50, 0.5]);
    expect(p.segs.filter((s) => Math.abs(s.w - 0.25) < 1e-6)).toHaveLength(4);
    const t = p.texts.find((x) => x.s === 'X1')!;
    expect(Math.abs(t.x - 64.5)).toBeLessThan(2);
    expect(Math.abs(t.y - 257)).toBeLessThan(4);
  });
});
