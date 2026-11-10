import { describe, expect, test } from 'vitest';
import { alongLine, around, findTextOverlaps, LabelPlacer, segHitsRect, spread1D, textRects, textWidth } from './labelLayout';
import { readFileSync } from 'node:fs';
import { sheetsToPdf, sheetToSvg, type Sheet } from './sheet';

const blank = (): Sheet => ({ width: 200, height: 200, ops: [] });
const all = { x1: 0, y1: 0, x2: 200, y2: 200 };

describe('文字の重なり回避', () => {
  test('文字幅: 全角は 1 文字ぶん、半角は狭い', () => {
    expect(textWidth('汚水マス', 2)).toBeCloseTo(8);
    expect(textWidth('0.1', 2)).toBeLessThan(4);
  });

  test('文字の範囲: 中央寄せ・縦書き', () => {
    const [r] = textRects({ t: 'text', x: 50, y: 50, s: '汚水', size: 2, anchor: 'middle' });
    expect(r.x1).toBeCloseTo(48); expect(r.x2).toBeCloseTo(52);
    expect(r.y1).toBeLessThan(50); expect(r.y2).toBeGreaterThan(50);
    const [v] = textRects({ t: 'text', x: 50, y: 50, s: '汚水', size: 2, rotate: -90 });
    expect(v.y1).toBeCloseTo(46); expect(v.y2).toBeCloseTo(50); // 下から上へ読む
    expect(v.x1).toBeLessThan(50);
  });

  test('線分と矩形の交差', () => {
    const r = { x1: 10, y1: 10, x2: 20, y2: 20 };
    expect(segHitsRect({ x1: 0, y1: 0, x2: 30, y2: 30 }, r)).toBe(true);
    expect(segHitsRect({ x1: 0, y1: 25, x2: 30, y2: 25 }, r)).toBe(false);
  });

  test('同じ点に 3 つの札を置いても重ならない。離した札には引出線', () => {
    const sheet = blank();
    const p = new LabelPlacer(sheet, all);
    for (const s of ['トイレ', '汚水マス', 'VU75×0.1']) p.place(around(100, 100, [{ s, size: 2.2 }]));
    expect(findTextOverlaps(sheet)).toEqual([]);
    expect(sheet.ops.filter((o) => o.t === 'text')).toHaveLength(3);
  });

  test('ふさがっている場所は避けて、引出線でつなぐ', () => {
    const sheet = blank();
    const p = new LabelPlacer(sheet, all);
    p.block({ x1: 90, y1: 90, x2: 125, y2: 110 }); // 点のまわりが全部ふさがっている
    const c = p.place(around(100, 100, [{ s: '洗面', size: 2.2 }]))!;
    expect(c.leader).toBeDefined();
    expect(sheet.ops.some((o) => o.t === 'line')).toBe(true);
  });

  test('すでにある文字は障害物になる', () => {
    const sheet = blank();
    sheet.ops.push({ t: 'text', x: 102, y: 100.5, s: '既存の文字', size: 2.2 });
    new LabelPlacer(sheet, all).place(around(100, 100, [{ s: '新しい札', size: 2.2 }]));
    expect(findTextOverlaps(sheet)).toEqual([]);
  });

  test('枠の外には置かない', () => {
    const sheet = blank();
    const p = new LabelPlacer(sheet, { x1: 0, y1: 0, x2: 105, y2: 200 });
    const c = p.place(around(100, 100, [{ s: '長い名前の器具です', size: 2.2 }]))!;
    for (const t of c.texts) for (const r of textRects(t)) expect(r.x2).toBeLessThanOrEqual(105);
  });

  test('線に沿う札: 斜めの線と平行に回す。短い線には置かない', () => {
    const c = alongLine(0, 0, 40, 20, { s: 'VU100×6.0', size: 2.2 });
    expect(c[0].texts[0].rotate).toBeCloseTo(26.57, 1);
    expect(alongLine(0, 0, 2, 1, { s: 'VU100×6.0', size: 2.2 })).toEqual([]);
    // 右から左へ引いた線でも文字は左から右へ読む
    expect(Math.abs(alongLine(40, 20, 0, 0, { s: 'VU100×6.0', size: 2.2 })[0].texts[0].rotate!)).toBeLessThan(90);
  });

  test('斜めの文字は SVG で回転して出る', () => {
    const svg = sheetToSvg({ width: 50, height: 50, ops: [{ t: 'text', x: 10, y: 10, s: 'A', size: 2, rotate: 30 }] });
    expect(svg).toContain('rotate(30 10 10)');
  });

  test('spread1D: 近すぎる位置だけを最小限ずらす。順番は保つ', () => {
    expect(spread1D([10, 50, 90], 4, 0, 100)).toEqual([10, 50, 90]);
    const out = spread1D([50, 50.5, 51, 90], 4, 0, 100);
    expect(out[1] - out[0]).toBeGreaterThanOrEqual(4 - 1e-6);
    expect(out[2] - out[1]).toBeGreaterThanOrEqual(4 - 1e-6);
    expect(out[3]).toBe(90);
    expect((out[0] + out[1] + out[2]) / 3).toBeCloseTo(50.5, 1); // 塊は元の位置の中心に
  });

  test('spread1D: 端からはみ出さない。入りきらないときは均等に詰める', () => {
    const out = spread1D([98, 99, 100], 4, 0, 100);
    expect(out[2]).toBeLessThanOrEqual(100);
    expect(out[1] - out[0]).toBeGreaterThanOrEqual(4 - 1e-6);
    const tight = spread1D([1, 2, 3, 4, 5], 10, 0, 20);
    expect(tight[0]).toBeGreaterThanOrEqual(0); expect(tight[4]).toBeLessThanOrEqual(20);
    expect(tight[1] - tight[0]).toBeCloseTo(5);
  });

  test('findTextOverlaps: 重なった文字を見つける', () => {
    const sheet = blank();
    sheet.ops.push({ t: 'text', x: 10, y: 10, s: 'トイレ', size: 2.2 }, { t: 'text', x: 11, y: 10.5, s: 'VU75×0.3', size: 2.2 }, { t: 'text', x: 60, y: 10, s: '離れた文字', size: 2.2 });
    expect(findTextOverlaps(sheet)).toEqual([{ a: 'トイレ', b: 'VU75×0.3' }]);
  });

  test('斜めの文字を含む図面も PDF にできる', async () => {
    const sheet: Sheet = { width: 50, height: 50, ops: [{ t: 'text', x: 10, y: 10, s: 'VU100×6.0', size: 2, rotate: 30, anchor: 'middle' }, { t: 'text', x: 20, y: 20, s: '縦', size: 2, rotate: -90 }] };
    const bytes = await sheetsToPdf([sheet], readFileSync('public/fonts/NotoSansJP-JIS.ttf'));
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
