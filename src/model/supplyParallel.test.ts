/** 床下の給水・給湯の管どうしの離れ（parallelConflict） */
import { describe, expect, test } from 'vitest';
import { parallelConflict } from './supplyRoute';

const v = (x: number, y: number) => ({ x, y });
describe('同じ向きに走る給水・給湯の管がぶつかるか', () => {
  test('長さ方向に重なって近くを走る → ぶつかる（今までどおり）', () => {
    expect(parallelConflict(v(0, 0), v(1000, 0), v(500, 20), v(1500, 20), 40)).toBe(true);
  });
  test('同じ線の上で端と端が突き当たる（10mm だけ重なる・少し離れる）→ ぶつかる（2026-11-18 実物の干渉）', () => {
    expect(parallelConflict(v(3827, 7481), v(4498, 7481), v(4488, 7482), v(6088, 7482), 40)).toBe(true);
    expect(parallelConflict(v(0, 0), v(1000, 0), v(1020, 0), v(2000, 0), 40)).toBe(true);
  });
  test('端を共有して続く管・十分に離れた管・横の管はぶつからない', () => {
    expect(parallelConflict(v(0, 0), v(1000, 0), v(1000, 0), v(2000, 0), 40)).toBe(false);
    expect(parallelConflict(v(0, 0), v(1000, 0), v(1100, 0), v(2000, 0), 40)).toBe(false);
    expect(parallelConflict(v(0, 0), v(1000, 0), v(0, 60), v(1000, 60), 40)).toBe(false);
    expect(parallelConflict(v(0, 0), v(1000, 0), v(500, -500), v(500, 500), 40)).toBe(false);
  });
});
