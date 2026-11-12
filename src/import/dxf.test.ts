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

  test('大きな図面（7 万本の線）でも落ちない', () => {
    const ents: string[] = [];
    for (let i = 0; i < 70000; i++) ents.push('0', 'LINE', '8', '0', '10', String(i % 1000), '20', String(Math.floor(i / 1000) * 10), '11', String((i % 1000) + 5), '21', String(Math.floor(i / 1000) * 10));
    const d = parseDxf(utf8(dxf([], ents)));
    expect(d.lines).toHaveLength(70000);
    expect(d.bounds.maxX).toBeGreaterThan(1000);
  });
  test('押し出し方向が裏（230 = -1）の円・ブロックは左右反転した位置', () => {
    const d = parseDxf(utf8(dxf([], ['0', 'CIRCLE', '8', '0', '10', '100', '20', '0', '40', '10', '230', '-1'])));
    const xs = d.lines.map((l) => l.x1);
    expect(Math.max(...xs)).toBeLessThan(-80);
  });
  test('遠くに離れた図形（消し忘れ）は範囲に入れない。文字の広がりは入れる', () => {
    const L = (x1: number, y1: number, x2: number, y2: number) => ['0', 'LINE', '8', '0', '10', String(x1), '20', String(y1), '11', String(x2), '21', String(y2)];
    const ents = [...L(0, 0, 9100, 0), ...L(9100, 0, 9100, 7280), ...L(9100, 7280, 0, 7280), ...L(0, 7280, 0, 0)];
    for (let i = 0; i < 200; i++) ents.push(...L(100 + i * 40, 100, 100 + i * 40, 7000));
    ents.push(...L(1_000_000, 0, 1_000_100, 0), '0', 'TEXT', '8', '0', '10', '8900', '20', '3000', '40', '300', '1', '洗面所');
    const d = parseDxf(utf8(dxf([], ents)));
    expect(d.bounds.maxX).toBeLessThan(20000);
    expect(d.bounds.maxX).toBeGreaterThan(9100); // 右端の文字の分
    expect(d.notes.join('')).toContain('離れた');
  });
  test('配列の挿入（列・行）と、見えない属性文字', () => {
    const d = parseDxf(utf8(dxf([], [
      '0', 'INSERT', '8', '0', '2', 'B', '10', '0', '20', '0', '70', '3', '71', '2', '44', '1000', '45', '500',
      '0', 'ATTRIB', '8', '0', '10', '0', '20', '0', '40', '100', '1', 'かくし', '70', '1',
    ], ['0', 'BLOCK', '8', '0', '2', 'B', '70', '0', '10', '0', '20', '0', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '100', '21', '0', '0', 'ENDBLK'])));
    expect(d.lines).toHaveLength(6);
    expect(d.texts).toHaveLength(0);
  });
  test('バイナリ形式の DXF は、テキスト形式で保存し直すよう案内', () => {
    expect(() => parseDxf(utf8('AutoCAD Binary DXF\r\n\x1a\0'))).toThrow('テキスト');
  });
  test('空行が混じっても読める', () => {
    const d = parseDxf(utf8(['0', 'SECTION', '2', 'ENTITIES', '', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '10', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n')));
    expect(d.lines).toHaveLength(1);
  });
});

