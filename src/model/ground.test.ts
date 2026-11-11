import { describe, expect, it } from 'vitest';
import { groundAt } from './ground';

describe('敷地の高さ（groundAt）', () => {
  const site = { groundPoints: [{ x: 0, y: 0, gl: 0 }, { x: 4000, y: 0, gl: -800 }, { x: 0, y: 4000, gl: -400 }] };
  it('配置図の高さの点が無ければ 0（設計 GL のまま）', () => {
    expect(groundAt(undefined, { x: 1, y: 1 })).toBe(0);
    expect(groundAt({}, { x: 1, y: 1 })).toBe(0);
  });
  it('点の上はその値、間は近い点の重み付き平均（遠い点ほど軽い）', () => {
    expect(groundAt(site, { x: 10, y: 0 })).toBe(0);
    const mid = groundAt(site, { x: 2000, y: 0 });
    expect(mid).toBeLessThan(0);
    expect(mid).toBeGreaterThan(-800);
    expect(groundAt(site, { x: 3900, y: 0 })).toBeLessThan(-700);
  });
});
