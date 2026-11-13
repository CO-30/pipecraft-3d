import { describe, expect, it } from 'vitest';
import { addFloor, addOpening, addWall, emptyBuilding, wallsOnFloor } from '../model/building';
import type { Fixture } from '../model/fixtures';
import { truthFromDoc } from './fromDoc';

function doc() {
  let b = emptyBuilding();
  const f1 = addFloor(b, { height: 2970 }); b = f1.b;
  b = addWall(b, f1.floorId, { x: 0, y: 0 }, { x: 4000, y: 0 }, { thickness: 120 }).b;
  b = addOpening(b, wallsOnFloor(b, f1.floorId)[0].id, 'window', 2000).b;
  const f2 = addFloor(b, { height: 2800 }); b = f2.b;
  b = addWall(b, f2.floorId, { x: 0, y: 0 }, { x: 0, y: 3000 }, { thickness: 100 }).b;
  const fx = (id: string, floorId: string, type: Fixture['type'], x: number, y: number, params?: Fixture['params']): Fixture => ({ id, floorId, type, x, y, rotation: 0, ...(params ? { params } : {}) });
  const fixtures: Record<string, Fixture> = {
    a: fx('a', f1.floorId, 'toilet', 100, 200),
    b: fx('b', f2.floorId, 'kitchen', 300, 400),
    c: fx('c', f1.floorId, 'publicSewage', -1000, 5000),
    d: fx('d', f1.floorId, 'manholeSewage', 500, 5000, { auto: true }),
    e: fx('e', f1.floorId, 'waterHeader', 0, 0),
    g: fx('g', f1.floorId, 'outdoorFaucet', 5000, 0),
  };
  return { building: b, fixtures, site: { designGL: -611 } };
}

describe('直した工事（書き出した .pipecraft.json）→ 正解', () => {
  it('階高・GL〜床・壁・開口の数・器具・配置図の物を、人が直した値として取り出す', () => {
    const t = truthFromDoc(doc(), { id: 'k', kind: 'detached' });
    expect(t.floors).toEqual([{ n: 1, height: 2970 }, { n: 2, height: 2800 }]);
    expect(t.glToFl).toBe(611);
    expect(t.walls).toEqual([
      { floor: 1, a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 120 },
      { floor: 2, a: { x: 0, y: 0 }, b: { x: 0, y: 3000 }, thickness: 100 },
    ]);
    expect(t.openings).toEqual([{ floor: 1, count: 1 }, { floor: 2, count: 0 }]);
    expect(t.fixtures).toEqual([{ floor: 1, type: 'toilet', x: 100, y: 200 }, { floor: 2, type: 'kitchen', x: 300, y: 400 }]);
  });
  it('配置図の物は公共ます・ます・メーター・立水栓。自動で置いたマスとヘッダーは入れない', () => {
    const t = truthFromDoc(doc(), { id: 'k', kind: 'detached' });
    expect(t.site).toEqual([{ type: 'publicSewage', x: -1000, y: 5000 }, { type: 'outdoorFaucet', x: 5000, y: 0 }]);
  });
  it('上書き（truth.json）の値が優先。人の確認の記録もそこから', () => {
    const t = truthFromDoc(doc(), { id: 'k', kind: 'apartment', confirmedBy: '新垣', confirmedAt: '2026-11-13', glToFl: 600 });
    expect(t).toMatchObject({ kind: 'apartment', glToFl: 600, confirmed: true });
  });
});
