import { describe, expect, test } from 'vitest';
import { sheetsToDxf } from './dxf';
import type { Sheet } from './sheet';

const text = (b: Uint8Array) => new TextDecoder('shift_jis').decode(b);
/** グループコードと値の組 */
const pairs = (s: string) => { const l = s.split(/\r?\n/); const out: [number, string][] = []; for (let i = 0; i + 1 < l.length; i += 2) out.push([Number(l[i].trim()), l[i + 1]]); return out; };
const entities = (s: string) => { const p = pairs(s); const i = p.findIndex(([c, v], k) => c === 2 && v === 'ENTITIES' && p[k - 1][1] === 'SECTION'); const out: [number, string][][] = []; for (let k = i + 1; k < p.length && !(p[k][0] === 0 && p[k][1] === 'ENDSEC'); k++) { if (p[k][0] === 0) out.push([p[k]]); else out.at(-1)!.push(p[k]); } return out; };
const val = (e: [number, string][], code: number) => e.find(([c]) => c === code)?.[1];

const sheet: Sheet = { width: 297, height: 210, ops: [
  { t: 'line', x1: 10, y1: 10, x2: 100, y2: 10, color: '#d91e18' },
  { t: 'rect', x: 20, y: 30, w: 40, h: 20 },
  { t: 'circle', cx: 150, cy: 100, r: 5 },
  { t: 'text', x: 148.5, y: 200, s: '排水設備 縦断図', size: 5, anchor: 'middle' },
  { t: 'poly', pts: [[0, 0], [10, 5], [20, 0]], close: false },
] };

describe('DXF の書き出し（R12・Shift_JIS）', () => {
  test('ヘッダ・線・四角・円・文字。y は上向きに直す', () => {
    const { bytes, notes } = sheetsToDxf([sheet]);
    const s = text(bytes);
    expect(s).toContain('AC1009');
    expect(s).toContain('ANSI_932');
    expect(notes).toEqual([]);
    const es = entities(s);
    const line = es.find((e) => e[0][1] === 'LINE')!;
    expect([val(line, 10), val(line, 20), val(line, 11), val(line, 21)].map(Number)).toEqual([10, 200, 100, 200]);
    expect(val(line, 62)).toBe('1'); // 赤
    expect(es.filter((e) => e[0][1] === 'POLYLINE')).toHaveLength(2);
    const rect = es.find((e) => e[0][1] === 'POLYLINE' && val(e, 70) === '1')!;
    expect(rect).toBeTruthy();
    expect(es.filter((e) => e[0][1] === 'VERTEX')).toHaveLength(4 + 3);
    const c = es.find((e) => e[0][1] === 'CIRCLE')!;
    expect([val(c, 10), val(c, 20), val(c, 40)].map(Number)).toEqual([150, 110, 5]);
    const t = es.find((e) => e[0][1] === 'TEXT')!;
    expect(val(t, 1)).toBe('排水設備 縦断図');
    expect(val(t, 72)).toBe('1'); // 中央揃え
    expect(Number(val(t, 21))).toBeCloseTo(10, 3);
  });
  test('複数ページは横に並べる。画像は入れられないので知らせる', () => {
    const img: Sheet = { width: 210, height: 297, ops: [{ t: 'image', x: 0, y: 0, w: 10, h: 10, href: 'data:image/png;base64,AAAA' }, { t: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }] };
    const { bytes, notes } = sheetsToDxf([sheet, img]);
    const lines = entities(text(bytes)).filter((e) => e[0][1] === 'LINE');
    expect(Number(val(lines[1], 10))).toBeCloseTo(297 + 20, 3);
    expect(notes.join('')).toContain('画像');
  });

  test('日本語の大フォント・図の範囲（$EXTMIN/$EXTMAX）・NaN と改行は書かない', () => {
    const bad: Sheet = { width: 100, height: 50, ops: [{ t: 'line', x1: NaN, y1: 0, x2: 10, y2: 0 }, { t: 'text', x: 5, y: 5, s: '一行目\n二行目', size: 3 }] };
    const s = text(sheetsToDxf([sheet, bad]).bytes);
    expect(s).toContain('extfont2.shx');
    expect(s).toContain('$EXTMIN');
    expect(s).toContain('$EXTMAX');
    expect(s).not.toContain('NaN');
    expect(s).toContain('一行目 二行目');
  });
});

