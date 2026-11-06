import { describe, expect, it } from 'vitest';
import { createBuildingFromDims, wallsOnFloor } from './building';
import { addPolyline, emptyNetwork } from './network';
import {
  applyMount, DEFAULT_MOUNT, elevationFromWall, elevationStandalone, elevToWorld, facadeHeight, faceNodes, pipeDepth, snapOrtho, worldToElev,
} from './elevation';

// 幅 10m(東西) × 奥行 6m(南北)、3階、階高 3000、壁厚 200
const bld = () => createBuildingFromDims({ width: 10000, depth: 6000, floors: 3, floorHeight: 3000, wallThickness: 200, slabThickness: 200 });

function southWall(b: ReturnType<typeof bld>) {
  const f = b.floors[0].id;
  return wallsOnFloor(b, f).find((w) => {
    const a = b.corners[w.a], c = b.corners[w.b];
    return Math.abs(a.y - c.y) < 1 && Math.min(a.y, c.y) === Math.min(...Object.values(b.corners).map((k) => k.y));
  })!;
}

describe('立面（外壁）', () => {
  it('外壁から外向き・左右を求める（南面は外から見て左が西）', () => {
    const b = bld();
    const w = southWall(b);
    const el = elevationFromWall(b, w.id);
    expect(el.normal.y).toBeCloseTo(-1); // 南向き
    expect(el.dir.x).toBeCloseTo(1); // 外から北を向いて見ると右が東
    expect(el.width).toBeCloseTo(10000);
    expect(el.height).toBe(9000); // 1階床〜最上階の上端
    expect(el.faceOffset).toBe(100);
    expect(el.mount).toEqual(DEFAULT_MOUNT);
    expect(DEFAULT_MOUNT).toEqual({ type: 'tBracket', standoff: 60 });
  });

  it('北面は外から見て左が東', () => {
    const b = bld();
    const ys = Object.values(b.corners).map((k) => k.y);
    const w = wallsOnFloor(b, b.floors[0].id).find((x) => b.corners[x.a].y === Math.max(...ys) && b.corners[x.b].y === Math.max(...ys))!;
    const el = elevationFromWall(b, w.id);
    expect(el.normal.y).toBeCloseTo(1);
    expect(el.dir.x).toBeCloseTo(-1);
  });

  it('壁が1枚だけなら a→b の右側を外とする（東向きの壁は南面）', () => {
    const b0 = { floors: [{ id: 'f', name: '1階', elevation: 0, height: 3000, slabThickness: 200 }], corners: { a: { id: 'a', floorId: 'f', x: 0, y: 0 }, c: { id: 'c', floorId: 'f', x: 6000, y: 0 } }, walls: { w: { id: 'w', floorId: 'f', a: 'a', b: 'c', thickness: 150, kind: 'exterior' as const } }, openings: {}, rooms: {} };
    const el = elevationFromWall(b0, 'w');
    expect(el.normal.y).toBeCloseTo(-1);
    expect(el.origin).toEqual({ x: 0, y: 0 });
    expect(el.label).toBe('南面');
  });

  it('外壁の高さ: 2階の壁なら2階床から最上階の上端まで', () => {
    const b = bld();
    expect(facadeHeight(b, b.floors[1].id)).toBe(6000);
  });

  it('立面座標 ⇔ 3D: T字金具 60mm 浮かせは 壁厚/2 + 60 + 口径/2 だけ外へ', () => {
    const b = bld();
    const el = elevationFromWall(b, southWall(b).id);
    expect(pipeDepth(el, 50)).toBe(60 + 25);
    const p = elevToWorld(el, 1000, 2500, 50);
    const minY = Math.min(...Object.values(b.corners).map((k) => k.y));
    expect(p.z).toBe(2500);
    expect(p.y).toBeCloseTo(minY - 100 - 85);
    const back = worldToElev(el, p);
    expect(back.u).toBeCloseTo(1000);
    expect(back.v).toBeCloseTo(2500);
    expect(back.depth).toBeCloseTo(85);
    const saddle = { ...el, mount: { type: 'saddle' as const, standoff: 0 } };
    expect(pipeDepth(saddle, 50)).toBe(25);
  });

  it('壁がないときは寸法だけで立面を作れる', () => {
    const el = elevationStandalone('f1', 8000, 7000);
    expect(el.width).toBe(8000);
    expect(el.height).toBe(7000);
    expect(el.wallId).toBeUndefined();
    const p = elevToWorld(el, 0, 0, 0);
    expect(p).toEqual({ x: 0, y: -60, z: 0 });
  });

  it('縦・横への補正（10°以内）', () => {
    expect(snapOrtho({ u: 0, v: 0 }, { u: 1000, v: 80 })).toEqual({ u: 1000, v: 0 });
    expect(snapOrtho({ u: 0, v: 0 }, { u: 60, v: -900 })).toEqual({ u: 0, v: -900 });
    expect(snapOrtho({ u: 0, v: 0 }, { u: 700, v: 700 })).toEqual({ u: 700, v: 700 });
  });

  it('壁面上のノードを拾う（離れた室内の配管は除く）', () => {
    const b = bld();
    const el = elevationFromWall(b, southWall(b).id);
    const p1 = elevToWorld(el, 500, 0, 50), p2 = elevToWorld(el, 500, 3000, 50);
    let r = addPolyline(emptyNetwork(), [p1, p2], { system: 'drain', diameter: 50 });
    const inside = { x: 5000, y: 3000, z: 1000 };
    r = addPolyline(r.net, [inside, { ...inside, x: 6000 }], { system: 'water', diameter: 20 });
    const ids = faceNodes(r.net, el).map((n) => n.id).sort();
    expect(ids).toHaveLength(2);
  });

  it('取付を変えると、その面に描いた配管が壁からの距離を変える（サドル直付け ⇔ T字金具）', () => {
    const b = bld();
    const el = elevationFromWall(b, southWall(b).id);
    const p1 = elevToWorld(el, 500, 0, 50), p2 = elevToWorld(el, 500, 3000, 50);
    const r = addPolyline(emptyNetwork(), [p1, p2], { system: 'drain', diameter: 50 });
    const seg = r.segmentIds[0];
    const net0 = { ...r.net, segments: { [seg]: { ...r.net.segments[seg], face: el.id, support: 'tBracket' as const } } };
    const saddle = { ...el, mount: { type: 'saddle' as const, standoff: 0 } };
    const net1 = applyMount(net0, saddle)!;
    expect(worldToElev(saddle, net1.nodes[r.nodeIds[0]].pos).depth).toBeCloseTo(25);
    expect(worldToElev(saddle, net1.nodes[r.nodeIds[1]].pos).u).toBeCloseTo(500);
    expect(net1.segments[seg].support).toBe('saddle');
    const back = applyMount(net1, { ...el, mount: { type: 'tBracket', standoff: 100 } });
    expect(worldToElev(el, back!.nodes[r.nodeIds[0]].pos).depth).toBeCloseTo(125);
    expect(back!.segments[seg].support).toBe('tBracket');
  });

  it('取付の変更: この面以外の配管ともつながるノード（壁の貫通）は動かさない', () => {
    const b = bld();
    const el = elevationFromWall(b, southWall(b).id);
    const p1 = elevToWorld(el, 500, 0, 50), p2 = elevToWorld(el, 500, 3000, 50);
    let r = addPolyline(emptyNetwork(), [p1, p2], { system: 'drain', diameter: 50 });
    const face = { ...r.net.segments[r.segmentIds[0]], face: el.id };
    r = { ...r, net: { ...r.net, segments: { [face.id]: face } } };
    const inside = { ...p1, y: p1.y + 1000 };
    const r2 = addPolyline(r.net, [inside, p1], { system: 'drain', diameter: 50 }, { endNodeId: r.nodeIds[0] });
    const out = applyMount(r2.net, { ...el, mount: { type: 'saddle', standoff: 0 } })!;
    expect(out.nodes[r.nodeIds[0]].pos).toEqual(p1);
    expect(worldToElev(el, out.nodes[r.nodeIds[1]].pos).depth).toBeCloseTo(25);
  });
});
