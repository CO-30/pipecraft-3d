import { describe, expect, it } from 'vitest';
import { hitTestBuilding } from './buildingHit';
import { addOpening, createBuildingFromDims, wallsOnFloor } from './building';

const b0 = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
const f = b0.floors[0].id;
const south = wallsOnFloor(b0, f).find((w) => b0.corners[w.a].y === 0 && b0.corners[w.b].y === 0)!;

describe('建物ヒットテスト', () => {
  it('角 > 壁 > 部屋 の優先順', () => {
    expect(hitTestBuilding(b0, f, { x: 20, y: 20 }, 100)?.kind).toBe('corner');
    expect(hitTestBuilding(b0, f, { x: 4000, y: 60 }, 100)).toMatchObject({ kind: 'wall', id: south.id });
    expect(hitTestBuilding(b0, f, { x: 4000, y: 3000 }, 100)?.kind).toBe('room');
    expect(hitTestBuilding(b0, f, { x: 9000, y: 3000 }, 100)).toBeNull();
  });
  it('開口部の範囲は開口を返す、角を除外できる', () => {
    const startX = b0.corners[south.a].x;
    const o = addOpening(b0, south.id, 'door', Math.abs(4000 - startX));
    expect(hitTestBuilding(o.b, f, { x: 4200, y: 0 }, 100)).toEqual({ kind: 'opening', id: o.openingId });
    expect(hitTestBuilding(o.b, f, { x: 20, y: 20 }, 100, false)?.kind).toBe('wall');
  });
});
