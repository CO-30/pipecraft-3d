import { describe, expect, it } from 'vitest';
import { buildingBoxes } from './building3d';
import { addFloor, addOpening, addRoomRect, addWall, createBuildingFromDims, wallLength, type Building } from './building';

function withWall(): { b: Building; w: string } {
  const b0 = createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  const r = addWall(b0, b0.floors[0].id, { x: 2000, y: 2000 }, { x: 6000, y: 2000 });
  return { b: r.b, w: r.wallIds[0] };
}
const wallBoxes = (b: Building, w: string) => buildingBoxes(b).filter((x) => x.elementId === w && x.category.endsWith('Wall'));

describe('3D形状生成', () => {
  it('開口なしの壁は1つの箱、長さ=壁長、高さ=階高-スラブ厚', () => {
    const { b, w } = withWall();
    const boxes = wallBoxes(b, w);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].size.x).toBeCloseTo(4000, 6);
    expect(boxes[0].size.z).toBeCloseTo(2700, 6);
    expect(boxes[0].center.z).toBeCloseTo(1350, 6);
  });

  it('ドア1つ: 左・右・上の3箱、ドア自体の箱1つ、壁箱の長さ合計は壁長以上を覆う', () => {
    const { b, w } = withWall();
    const o = addOpening(b, w, 'door', 2000);
    const boxes = wallBoxes(o.b, w);
    expect(boxes).toHaveLength(3);
    const full = boxes.filter((x) => Math.abs(x.size.z - 2700) < 1e-6).reduce((a, x) => a + x.size.x, 0);
    expect(full).toBeCloseTo(wallLength(o.b, w) - 800, 6);
    expect(buildingBoxes(o.b).filter((x) => x.category === 'door')).toHaveLength(1);
  });

  it('窓1つ: 左・右・上・下（腰壁）の4箱', () => {
    const { b, w } = withWall();
    const o = addOpening(b, w, 'window', 2000);
    expect(wallBoxes(o.b, w)).toHaveLength(4);
    expect(buildingBoxes(o.b).filter((x) => x.category === 'window')).toHaveLength(1);
  });

  it('2階の壁は2階の床高さ基準、床スラブと天井が各階に生成', () => {
    const { b } = withWall();
    const f2 = b.floors[1];
    const ext2 = buildingBoxes(b).filter((x) => x.category === 'exteriorWall' && b.walls[x.elementId].floorId === f2.id);
    expect(ext2).toHaveLength(4);
    expect(ext2[0].center.z).toBeCloseTo(2900 + 1350, 6);
    expect(buildingBoxes(b).filter((x) => x.category === 'floor')).toHaveLength(2);
    expect(buildingBoxes(b).filter((x) => x.category === 'ceiling')).toHaveLength(2);
  });

  it('床・天井は階ごとに1枚（壁の外形）。部屋が重なっても重複しない、部屋のない階にも出る', () => {
    const b0 = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    const a = addFloor(b0, { copyExteriorFrom: b0.floors[0].id });
    const r = addRoomRect(a.b, b0.floors[0].id, { x: 0, y: 0 }, { x: 3000, y: 3000 });
    const floors = buildingBoxes(r.b).filter((x) => x.category === 'floor');
    expect(floors).toHaveLength(2);
    expect(floors[0].size.x).toBeCloseTo(8000 + 150, 6);
    expect(floors[1].center.z).toBeCloseTo(2900 - 100, 6);
  });

  it('壁の向き: 南北方向の壁は rotationZ = ±π/2', () => {
    const b0 = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    const rots = buildingBoxes(b0).filter((x) => x.category === 'exteriorWall').map((x) => Math.abs(Math.cos(x.rotationZ)));
    expect(rots.filter((c) => c < 1e-9)).toHaveLength(2);
  });
});
