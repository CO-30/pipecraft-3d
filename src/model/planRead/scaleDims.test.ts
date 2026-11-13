import { describe, expect, it } from 'vitest';
import { scaleFromDimLines, sheetScale } from './sheet';
import { THIN, line, sketch, text } from './testHouse';

/** 寸法線（細い線）とその真ん中の上に寸法の数字。1/n の図面 */
function dims(n: number, list: [number, number, number, number, string][]) {
  const s = sketch(n);
  for (const [x1, y1, x2, y2, label] of list) {
    line(s, x1, y1, x2, y2, THIN);
    const v = y1 === y2;
    text(s, (x1 + x2) / 2 + (v ? 0 : -2.5 * n), (y1 + y2) / 2 + (v ? 2.5 * n : 0), label);
  }
  return s;
}

describe('縮尺: 寸法線と寸法の数字（通り芯も縮尺の文字も無い図面）', () => {
  it('寸法線の紙の長さ × 縮尺 が寸法の数字に合う縮尺（3 か所以上）', () => {
    const s = dims(100, [[0, 0, 7280, 0, '7,280'], [0, 0, 0, 11830, '11,830'], [0, 5000, 1365, 5000, '1,365']]);
    // 数字のそばの別の線（引出線など）は、いちばん近い線だけを見る
    line(s, 3640 - 500, 3 * 100, 3640 + 500, 3 * 100, THIN);
    expect(scaleFromDimLines(s.texts, s.segs)).toBe(100);
    expect(sheetScale(s.texts, null, s.segs)).toEqual({ scale: 100, guessed: true, byDims: true });
  });
  it('「11,147.5」「≒8,259」の書き方も読む。1/150 の図面', () => {
    const s = dims(150, [[0, 0, 11147.5, 0, '11,147.5'], [0, 0, 0, 8259, '≒8,259'], [0, 9000, 2730, 9000, '2,730']]);
    expect(scaleFromDimLines(s.texts, s.segs)).toBe(150);
  });
  it('合うのが 2 か所以下・合う数字が半分に満たない・数字から離れた線は決めない', () => {
    const one = dims(100, [[0, 0, 7280, 0, '7,280'], [0, 0, 0, 11830, '11,830']]);
    expect(scaleFromDimLines(one.texts, one.segs)).toBeUndefined();
    const few = dims(100, [[0, 0, 7280, 0, '7,280'], [0, 0, 0, 11830, '11,830'], [0, 5000, 1365, 5000, '1,365']]);
    for (const [i, v] of ['5,000', '6,000', '7,000', '8,000'].entries()) text(few, 20000 + i * 3000, 20000, v);
    expect(scaleFromDimLines(few.texts, few.segs)).toBeUndefined();
    expect(scaleFromDimLines(one.texts, one.segs)).toBeUndefined();
    const far = sketch(100);
    line(far, 0, 0, 7280, 0, THIN); line(far, 0, 0, 0, 11830, THIN);
    text(far, 3640, 3000, '7,280'); text(far, 3000, 5915, '11,830');
    expect(scaleFromDimLines(far.texts, far.segs)).toBeUndefined();
  });
});
