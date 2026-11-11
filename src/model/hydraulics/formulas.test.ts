import { describe, expect, test } from 'vitest';
import { gradient, hazenGradient, MPA_HEAD, velocity, westonGradient } from './formulas';

/** 図から読んだ値との差（川崎市の計算例は流量図の読み取り） */
const near = (got: number, want: number, rel = 0.06) => expect(Math.abs(got - want) / want).toBeLessThanOrEqual(rel);

describe('ウエストン公式（川崎市の計算例と同じ値）', () => {
  test('12 L/min・13mm → 約 230‰', () => near(westonGradient(12, 13), 230));
  test('12 L/min・20mm → 約 34‰', () => near(westonGradient(12, 20), 34));
  test('20 L/min・20mm → 約 80‰', () => near(westonGradient(20, 20), 80));
  test('32 L/min・25mm → 約 65‰', () => near(westonGradient(32, 25), 65));
  test('流速 12 L/min・13mm → 1.51 m/s', () => expect(velocity(12, 13)).toBeCloseTo(1.51, 2));
});

describe('gradient', () => {
  test('流れていなければ 0', () => expect(gradient(0, 20)).toBe(0));
  test('50 以下はウエストン', () => expect(gradient(30, 50)).toBe(westonGradient(30, 50)));
  test('75 以上はヘーゼン・ウィリアムス（ウエストンと同じ桁）', () => {
    const h = hazenGradient(300, 75);
    expect(gradient(300, 75)).toBe(h);
    const w = westonGradient(300, 75);
    expect(h / w).toBeGreaterThan(0.5);
    expect(h / w).toBeLessThan(2);
  });
  test('1 MPa は 102 m', () => expect(MPA_HEAD).toBe(102));
});
