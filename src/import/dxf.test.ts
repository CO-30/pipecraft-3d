import { describe, expect, test } from 'vitest';
import { encodeSjis } from './sjis';
import { parseDxf } from './dxf';
import { sheetsToDxf } from '../export/dxf';

/** グループコードと値の組から DXF を作る */
const dxf = (head: string[], ents: string[], blocks: string[] = [], tables: string[] = []) => [
  '0', 'SECTION', '2', 'HEADER', ...head, '0', 'ENDSEC',
  ...(tables.length ? ['0', 'SECTION', '2', 'TABLES', ...tables, '0', 'ENDSEC'] : []),
  ...(blocks.length ? ['0', 'SECTION', '2', 'BLOCKS', ...blocks, '0', 'ENDSEC'] : []),
  '0', 'SECTION', '2', 'ENTITIES', ...ents, '0', 'ENDSEC', '0', 'EOF',
].join('\n');
const utf8 = (s: string) => new TextEncoder().encode(s);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe('DXF の読み込み', () => {
  test('線・円・円弧・折れ線（ふくらみ）。単位 mm・縮尺 1', () => {
    const d = parseDxf(utf8(dxf(['9', '$ACADVER', '1', 'AC1027', '9', '$INSUNITS', '70', '4'], [
      '0', 'LINE', '8', 'A', '10', '0', '20', '0', '11', '1000', '21', '0',
      '0', 'CIRCLE', '8', 'A', '10', '500', '20', '500', '40', '100',
      '0', 'ARC', '8', 'A', '10', '0', '20', '0', '40', '200', '50', '0', '51', '90',
      '0', 'LWPOLYLINE', '8', 'A', '90', '3', '70', '1', '10', '0', '20', '1000', '42', '1', '10', '100', '20', '1000', '10', '100', '20', '1100',
    ])));
    expect(d.empty).toBe(false);
    expect(d.scale).toBe(1);
    expect(d.lines.some((l) => near(l.x1, 0) && near(l.x2, 1000) && near(l.y1, 0))).toBe(true);
    // 円は折れ線（36 本程度）、半径 100
    const circle = d.lines.filter((l) => Math.abs(Math.hypot(l.x1 - 500, l.y1 - 500) - 100) < 1e-6);
    expect(circle.length).toBeGreaterThanOrEqual(24);
    // 円弧は 0°〜90° の範囲だけ
    const arc = d.lines.filter((l) => Math.abs(Math.hypot(l.x1, l.y1) - 200) < 1e-6 && Math.abs(Math.hypot(l.x2, l.y2) - 200) < 1e-6);
    expect(arc.every((l) => l.x1 >= -1e-6 && l.y1 >= -1e-6)).toBe(true);
    // ふくらみ 1 = 半円（0,1000)→(100,1000) の下側へ半径 50
    expect(d.lines.some((l) => Math.abs(l.y2 - 950) < 2)).toBe(true);
    expect(d.bounds.maxX).toBeGreaterThanOrEqual(1000);
  });
  test('$INSUNITS が m なら mm に直す', () => {
    const d = parseDxf(utf8(dxf(['9', '$INSUNITS', '70', '6'], ['0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '2.5', '21', '0'])));
    expect(d.lines[0].x2).toBeCloseTo(2500, 6);
  });
  test('文字: Shift_JIS（R12）・UTF-8・MTEXT の書式と改行・中央揃え・%%c', () => {
    const sj = encodeSjis(dxf(['9', '$ACADVER', '1', 'AC1009', '9', '$DWGCODEPAGE', '3', 'ANSI_932'], ['0', 'TEXT', '8', '0', '10', '100', '20', '200', '40', '250', '1', '洗面所 %%c75']));
    const t = parseDxf(sj).texts[0];
    expect(t.content).toBe('洗面所 φ75');
    expect([t.x, t.y, t.h]).toEqual([100, 200, 250]);
    const m = parseDxf(utf8(dxf(['9', '$ACADVER', '1', 'AC1027'], ['0', 'MTEXT', '8', '0', '10', '0', '20', '1000', '40', '200', '71', '1', '1', '{\\fMS Gothic|b0;台所}\\P\\H1.2x;浴室'])));
    expect(m.texts.map((x) => x.content)).toEqual(['台所', '浴室']);
    expect(m.texts[1].y).toBeLessThan(m.texts[0].y);
    const c = parseDxf(utf8(dxf([], ['0', 'TEXT', '8', '0', '10', '0', '20', '0', '40', '100', '1', 'ABCD', '72', '1', '11', '1000', '21', '500'])));
    expect(c.texts[0].x).toBeLessThan(1000); // 中央揃えの基準点から左へ
    expect(c.texts[0].y).toBe(500);
  });
  test('ブロックの挿入（基点・倍率・回転）と、見えない画層は飛ばす', () => {
    const d = parseDxf(utf8(dxf([], [
      '0', 'INSERT', '8', '0', '2', 'B1', '10', '1000', '20', '0', '41', '2', '42', '2', '50', '90',
      '0', 'LINE', '8', 'HIDE', '10', '0', '20', '0', '11', '5', '21', '5',
    ], ['0', 'BLOCK', '8', '0', '2', 'B1', '70', '0', '10', '100', '20', '0', '0', 'LINE', '8', '0', '10', '100', '20', '0', '11', '200', '21', '0', '0', 'ENDBLK'],
    ['0', 'TABLE', '2', 'LAYER', '0', 'LAYER', '2', 'HIDE', '70', '0', '62', '-7', '0', 'ENDTAB'])));
    expect(d.lines).toHaveLength(1);
    const l = d.lines[0];
    // ブロック内 (100,0)-(200,0)、基点 (100,0) → (0,0)-(100,0) → ×2 → 90° 回転 → (1000,0)-(1000,200)
    expect(l.x1).toBeCloseTo(1000, 6); expect(l.y1).toBeCloseTo(0, 6); expect(l.x2).toBeCloseTo(1000, 6); expect(l.y2).toBeCloseTo(200, 6);
  });
  test('書き出した DXF を読み戻せる（線・文字の数）', () => {
    const sheet = { width: 297, height: 210, ops: [{ t: 'line' as const, x1: 10, y1: 10, x2: 100, y2: 10 }, { t: 'rect' as const, x: 20, y: 30, w: 40, h: 20 }, { t: 'text' as const, x: 50, y: 50, s: '給水装置 立面図', size: 5 }] };
    const d = parseDxf(sheetsToDxf([sheet]).bytes);
    expect(d.lines).toHaveLength(1 + 4);
    expect(d.texts.map((t) => t.content)).toEqual(['給水装置 立面図']);
  });
  test('線も文字も無ければ空', () => {
    expect(parseDxf(utf8(dxf([], []))).empty).toBe(true);
  });
});
