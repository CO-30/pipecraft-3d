import { describe, expect, it } from 'vitest';
import { findFloorRoute } from './floorRoute';

// 10m 四方の床下。x = 5000 に立上り（gap があれば y 4000〜4600 が人通口）。始点 (2000, 2000) → 終点 (8000, 2000) に東向きで着く
const wall = (gap: boolean) => (p: { x: number; y: number }) => Math.abs(p.x - 5000) < 140 && !(gap && p.y > 4000 && p.y < 4600);
const run = (gap: boolean) => findFloorRoute({
  start: { x: 2000, y: 2000 }, allowed: () => true, footing: wall(gap),
  goals: [{ a: { x: 8000, y: 2000 }, b: { x: 8000, y: 2000 }, dir: 0, tag: 0 }], bounds: { x0: 0, y0: 0, x1: 10000, y1: 10000 },
});

describe('床下のルート（floorRoute）', () => {
  it('人通口が遠ければ回らず、立上りを貫通パイプでまっすぐ抜ける（2026-11-13: 迂回は極力しない）', () => {
    const r = run(true)!;
    expect(r.crossings).toBe(1);
    expect(r.points).toEqual([{ x: 2000, y: 2000 }, { x: 8000, y: 2000 }]);
  });
  it('人通口がすぐ横（曲がり 2 つより近い）なら人通口を通る。縦横だけで、終点にぴったり着く', () => {
    const near = (p: { x: number; y: number }) => Math.abs(p.x - 5000) < 140 && !(p.y > 2000 && p.y < 2600);
    const r = findFloorRoute({ start: { x: 2000, y: 2200 }, allowed: () => true, footing: near, goals: [{ a: { x: 8000, y: 2200 }, b: { x: 8000, y: 2200 }, dir: 0, tag: 0 }], bounds: { x0: 0, y0: 0, x1: 10000, y1: 10000 } })!;
    expect(r.crossings).toBe(0);
    expect(r.points.at(-1)).toEqual({ x: 8000, y: 2200 });
    for (let i = 1; i < r.points.length; i++) { const a = r.points[i - 1], b = r.points[i]; expect(a.x === b.x || a.y === b.y).toBe(true); }
  });
  it('切れ目が無ければ 1 か所だけ貫通してまっすぐ', () => {
    const r = run(false)!;
    expect(r.crossings).toBe(1);
    expect(r.points).toEqual([{ x: 2000, y: 2000 }, { x: 8000, y: 2000 }]);
  });
});
