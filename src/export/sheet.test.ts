import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, test } from 'vitest';
import { STANDARD_PROFILE } from '../model/municipality';
import { drawSymbol, drawTitleBlock, paperSize, sheetsToPdf, sheetToSvg, type Sheet } from './sheet';

const font = () => readFileSync('public/fonts/NotoSansJP-JIS.ttf');

describe('用紙描画', () => {
  test('paperSize: A3 横 = 420×297、A4 縦 = 210×297', () => {
    expect(paperSize(STANDARD_PROFILE.paper)).toEqual({ width: 420, height: 297 });
    expect(paperSize({ size: 'A4', orientation: 'portrait', titleBlockFields: [] })).toEqual({ width: 210, height: 297 });
  });
  test('sheetToSvg は viewBox と line/text を含む', () => {
    const sheet: Sheet = { width: 420, height: 297, ops: [{ t: 'line', x1: 0, y1: 0, x2: 100, y2: 50 }, { t: 'text', x: 10, y: 10, s: 'テスト<&>', size: 3 }] };
    const svg = sheetToSvg(sheet);
    expect(svg).toContain('viewBox="0 0 420 297"');
    expect(svg).toContain('<line');
    expect(svg).toContain('テスト&lt;&amp;&gt;');
  });
  test('sheetsToPdf: 2 Sheet で 2 ページ、A3 横のサイズ', async () => {
    const s: Sheet = { width: 420, height: 297, ops: [{ t: 'text', x: 10, y: 10, s: '排水設備 縦断図', size: 5 }, { t: 'circle', cx: 50, cy: 50, r: 3 }, { t: 'rect', x: 1, y: 1, w: 10, h: 10 }, { t: 'poly', pts: [[0, 0], [10, 10], [20, 0]] }] };
    const bytes = await sheetsToPdf([s, s], font());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(1191);
    expect(Math.round(height)).toBe(842);
  });
  test('sheetToSvg は色を検証し、#rrggbb 以外は既定色にする（属性への注入を防ぐ）', () => {
    const sheet: Sheet = { width: 100, height: 100, ops: [{ t: 'line', x1: 0, y1: 0, x2: 1, y2: 1, color: '"/><img src=x onerror=alert(1)>' }, { t: 'text', x: 1, y: 1, s: 'a', size: 3, color: 'red' }] };
    const svg = sheetToSvg(sheet);
    expect(svg).not.toContain('<img');
    expect(svg).not.toContain('onerror');
    expect(svg).not.toContain('stroke="red"');
  });
  test('drawSymbol と drawTitleBlock は命令を追加する', () => {
    const sheet: Sheet = { width: 420, height: 297, ops: [] };
    drawSymbol(sheet, 'square', 10, 10, 2);
    expect(sheet.ops.some((o) => o.t === 'rect')).toBe(true);
    drawSymbol(sheet, 'nope', 20, 10, 2);
    expect(sheet.ops.some((o) => o.t === 'circle')).toBe(true);
    drawTitleBlock(sheet, [{ label: '工事名', value: 'テスト' }], '免責');
    const svg = sheetToSvg(sheet);
    expect(svg).toContain('工事名');
    expect(svg).toContain('免責');
  });
});
