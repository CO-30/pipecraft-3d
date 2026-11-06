import { describe, expect, it } from 'vitest';
import { addOpening, addRoomRect, addWall, createBuildingFromDims, roomArea, validateBuilding, wallLength, wallsOnFloor, type Building } from './building';
import { elevationFromWall } from './elevation';
import { addFaceMember, addFaceStair, bumpFace, bumpWall, faceWallAt, memberCorners, stairSteps, updateMember } from './members';
import { buildingBoxes } from './building3d';

// 8000×6000・2階（階高 2900・床厚 200）。南の外壁 (0,0)→(8000,0)
const base = () => createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
function south(b: Building, floor = 0) {
  return wallsOnFloor(b, b.floors[floor].id).find((w) => {
    const A = b.corners[w.a], B = b.corners[w.b];
    return A.y === 0 && B.y === 0;
  })!;
}

describe('立面から部材', () => {
  it('南面の立面: 左端が西、外向きが南', () => {
    const b = base();
    const el = elevationFromWall(b, south(b).id);
    expect(el.normal).toEqual({ x: 0, y: -1 });
    expect(el.origin).toEqual({ x: 0, y: 0 });
    expect(faceWallAt(b, el, 4000, 100)?.wall.id).toBe(south(b).id);
    expect(faceWallAt(b, el, 4000, 3000)?.floorId).toBe(b.floors[1].id);
  });
  it('軒: 四角の上端から厚さ分、外へ出幅だけ張り出す', () => {
    const b = base();
    const el = elevationFromWall(b, south(b).id);
    const r = addFaceMember(b, el, 'eave', { u0: 0, u1: 8000, v0: 5600, v1: 5800 }, 600);
    if (!r.ok) throw new Error(r.error);
    const m = r.b.members![r.ids[0]];
    expect(m.kind).toBe('eave');
    expect(m.floorId).toBe(r.b.floors[1].id);
    expect(m.z1).toBe(5800 - 2900);
    expect(m.width).toBe(600);
    // 中心線は外壁の外面(−75)から外へ 300
    expect(m.a.y).toBeCloseTo(-375);
    const ys = memberCorners(m).map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(-75);
  });
  it('梁: 内側に幅をとって天井から下がる', () => {
    const b = base();
    const el = elevationFromWall(b, south(b).id);
    const r = addFaceMember(b, el, 'beam', { u0: 1000, u1: 5000, v0: 2100, v1: 2700 }, 300);
    if (!r.ok) throw new Error(r.error);
    const m = r.b.members![r.ids[0]];
    expect(m.floorId).toBe(r.b.floors[0].id);
    expect([m.z0, m.z1]).toEqual([2100, 2700]);
    const ys = memberCorners(m).map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(-75); // 外面を壁の外面にそろえる
    expect(Math.max(...ys)).toBeCloseTo(225); // 内側へ 300
  });
  it('バルコニー: 下端を近い床にそろえ、手すり付きの箱になる', () => {
    const b = base();
    const el = elevationFromWall(b, south(b).id);
    const r = addFaceMember(b, el, 'balcony', { u0: 2000, u1: 6000, v0: 3050, v1: 4100 }, 910);
    if (!r.ok) throw new Error(r.error);
    const m = r.b.members![r.ids[0]];
    expect(m.floorId).toBe(r.b.floors[1].id);
    expect(m.z1).toBe(1200); // 四角の高さ（床から 1200）を手すりの高さに
    const boxes = buildingBoxes(r.b).filter((x) => x.elementId === m.id);
    expect(boxes.map((x) => x.key.split(':')[1]).sort()).toEqual(['rail', 'railA', 'railB', 'slab']);
  });
  it('階段: 斜め線から外壁沿いに段をつくる', () => {
    const b = base();
    const el = elevationFromWall(b, south(b).id);
    const r = addFaceStair(b, el, { u: 7800, v: 0 }, { u: 3800, v: 2900 });
    if (!r.ok) throw new Error(r.error);
    const m = r.b.members![r.ids[0]];
    expect(m.a.x).toBeCloseTo(7800); // 下の端が a
    expect(stairSteps(m)).toBe(15);
    expect(buildingBoxes(r.b).filter((x) => x.elementId === m.id)).toHaveLength(15);
    expect(addFaceStair(b, el, { u: 1000, v: 0 }, { u: 1100, v: 2900 }).ok).toBe(false);
  });
});

describe('張り出し・押し込み', () => {
  it('壁の途中を外へ出すと 5 本の壁になり、窓は新しい壁へ移る', () => {
    let b = base();
    const w = south(b);
    b = addOpening(b, w.id, 'window', 1000, { width: 800 }).b;
    const r = bumpWall(b, w.id, 3000, 5000, 910, { x: 0, y: -1 });
    if (!r.ok) throw new Error(r.error);
    const f1 = wallsOnFloor(r.b, b.floors[0].id);
    expect(f1).toHaveLength(8);
    expect(validateBuilding(r.b)).toEqual([]);
    const o = Object.values(r.b.openings)[0];
    expect(o.offset).toBe(1000);
    expect(Math.round(wallLength(r.b, o.wallId))).toBe(3000);
  });
  it('壁全体を押し込むと壁ごと動く（2Fだけ小さい形）', () => {
    const b = base();
    const el = elevationFromWall(b, south(b).id);
    const r = bumpFace(b, el, { u0: 0, u1: 8000, v0: 2950, v1: 5700 }, -910);
    if (!r.ok) throw new Error(r.error);
    const w2 = south(b, 1);
    const A = r.b.corners[w2.a];
    expect(A.y).toBe(910);
    expect(r.b.corners[south(b, 0).a].y).toBe(0); // 1階はそのまま
  });
  it('窓にかかる範囲は拒否', () => {
    let b = base();
    const w = south(b);
    b = addOpening(b, w.id, 'window', 3000, { width: 800 }).b;
    expect(bumpWall(b, w.id, 3200, 5000, 910, { x: 0, y: -1 }).ok).toBe(false);
  });
  it('立面の四角が階の半分にかからなければ拒否', () => {
    const b = base();
    const el = elevationFromWall(b, south(b).id);
    expect(bumpFace(b, el, { u0: 2000, u1: 4000, v0: 100, v1: 500 }, 910).ok).toBe(false);
  });
});

describe('レビュー指摘の回帰', () => {
  it('張り出しで部屋の形も出っ張る。端に寄せて押し込むと隣の確定済みの壁は未確定に戻る', () => {
    let b = base();
    const f1 = b.floors[0].id;
    b = addRoomRect(b, f1, { x: 0, y: 0 }, { x: 8000, y: 6000 }).b;
    const r = bumpWall(b, south(b).id, 3000, 5000, 900, { x: 0, y: -1 });
    if (!r.ok) throw new Error(r.error);
    const room = Object.values(r.b.rooms)[0];
    expect(room.polygon).toHaveLength(8);
    expect(roomArea(room)).toBeCloseTo(48 + 1.8);
    // 西の角まで押し込み（端に寄せる）
    let c = base();
    c = { ...c, walls: Object.fromEntries(Object.entries(c.walls).map(([k, w]) => [k, { ...w, lengthSet: true }])) };
    const r2 = bumpWall(c, south(c).id, 0, 3000, -900, { x: 0, y: -1 });
    if (!r2.ok) throw new Error(r2.error);
    expect(validateBuilding(r2.b)).toEqual([]);
    const west = Object.values(r2.b.walls).find((w) => w.floorId === c.floors[0].id && Object.values(c.walls).some((x) => x.id === w.id) && r2.b.corners[w.a].x === 0 && r2.b.corners[w.b].x === 0)!;
    expect(west.lengthSet).toBe(false);
  });
  it('T字の角（内壁がつながる角）は端に寄せず、その手前から出す', () => {
    let b = base();
    const f1 = b.floors[0].id;
    b = addWall(b, f1, { x: 3000, y: 0 }, { x: 3000, y: 6000 }).b; // 南の外壁が 0-3000 と 3000-8000 に分かれる
    const piece = wallsOnFloor(b, f1).find((w) => { const A = b.corners[w.a], B = b.corners[w.b]; return A.y === 0 && B.y === 0 && Math.min(A.x, B.x) === 3000; })!;
    const r = bumpWall(b, piece.id, 0, 2000, 900, { x: 0, y: -1 });
    if (!r.ok) throw new Error(r.error);
    expect(validateBuilding(r.b)).toEqual([]);
    expect(r.b.corners[Object.values(r.b.corners).find((c) => c.floorId === f1 && c.x === 3000 && c.y === 6000)!.id]).toBeTruthy();
    // 内壁は斜めにならない
    const inner = Object.values(r.b.walls).find((w) => w.kind === 'interior')!;
    expect(r.b.corners[inner.a].x).toBe(r.b.corners[inner.b].x);
  });
  it('出幅を変えても壁側の辺は動かない', () => {
    const b = base();
    const el = elevationFromWall(b, south(b).id);
    const r = addFaceMember(b, el, 'eave', { u0: 0, u1: 8000, v0: 5600, v1: 5800 }, 600);
    if (!r.ok) throw new Error(r.error);
    const nb = updateMember(r.b, r.ids[0], { width: 1000 });
    const ys = memberCorners(nb.members![r.ids[0]]).map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(-75);
    expect(Math.min(...ys)).toBeCloseTo(-1075);
  });
});
