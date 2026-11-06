import { describe, expect, it } from 'vitest';
import { createBuildingFromDims, wallsOnFloor, type Building } from './building';
import { elevationFromWall } from './elevation';
import { addFaceMember } from './members';
import { addPolyline, emptyNetwork } from './network';
import { analyzeFittings } from './fittings';
import { applyDetour, detour, findHits, fittingContext, markPenetration, penetrationsOf } from './obstacles';
import type { Doc } from './doc';

const base = () => createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
const south = (b: Building) => wallsOnFloor(b, b.floors[0].id).find((w) => b.corners[w.a].y === 0 && b.corners[w.b].y === 0)!;

function withBeam() {
  const b0 = base();
  const el = elevationFromWall(b0, south(b0).id);
  const r = addFaceMember(b0, el, 'beam', { u0: 1000, u1: 5000, v0: 2100, v1: 2700 }, 300);
  if (!r.ok) throw new Error(r.error);
  return { b: r.b, el };
}
const docWith = (b: Building, pts: { x: number; y: number; z: number }[], diameter = 20): Doc =>
  ({ building: b, network: addPolyline(emptyNetwork(), pts, { system: 'water', diameter }).net, fixtures: {} });

describe('ぶつかり判定', () => {
  it('梁を横切る配管を見つけ、梁の下を通る配管は対象外', () => {
    const { b } = withBeam();
    const d = docWith(b, [{ x: 3000, y: 1500, z: 2400 }, { x: 3000, y: -1000, z: 2400 }]);
    expect(findHits(d)).toHaveLength(1);
    const ok = docWith(b, [{ x: 3000, y: 1500, z: 2000 }, { x: 3000, y: -1000, z: 2000 }]);
    expect(findHits(ok)).toHaveLength(0);
  });
  it('A 下をくぐる: 90°エルボ4つ、内訳は梁かわし', () => {
    const { b } = withBeam();
    const d = docWith(b, [{ x: 3000, y: 1500, z: 2400 }, { x: 3000, y: -1000, z: 2400 }]);
    const hit = findHits(d)[0];
    const dt = detour(d, hit, 'square');
    if ('error' in dt) throw new Error(dt.error);
    expect(dt.dir.z).toBeCloseTo(-1);
    expect(dt.h).toBe(360); // 2400-2100 + 半径10 + すき間50
    const r = applyDetour(d, hit, 'square');
    if (!r.ok) throw new Error(r.error);
    expect(findHits(r.doc)).toHaveLength(0);
    const fs = analyzeFittings(r.doc.network);
    expect(fs.filter((f) => f.type === 'elbow90')).toHaveLength(4);
    expect(fs.filter((f) => f.type === 'elbow90').map((f) => fittingContext(r.doc, f.nodeId))).toEqual(['梁かわし', '梁かわし', '梁かわし', '梁かわし']);
  });
  it('B 45°で逃げる: 45°エルボ4つ', () => {
    const { b } = withBeam();
    const d = docWith(b, [{ x: 3000, y: 2500, z: 2400 }, { x: 3000, y: -1000, z: 2400 }]);
    const r = applyDetour(d, findHits(d)[0], 'diagonal');
    if (!r.ok) throw new Error(r.error);
    expect(analyzeFittings(r.doc.network).filter((f) => f.type === 'elbow45')).toHaveLength(4);
    expect(findHits(r.doc)).toHaveLength(0);
  });
  it('端が近すぎる・実測長がある区間は回さない', () => {
    const { b } = withBeam();
    const d = docWith(b, [{ x: 3000, y: 300, z: 2400 }, { x: 3000, y: -50, z: 2400 }]);
    expect(applyDetour(d, findHits(d)[0], 'square').ok).toBe(false);
    const d2 = docWith(b, [{ x: 3000, y: 1500, z: 2400 }, { x: 3000, y: -1000, z: 2400 }]);
    const sid = Object.keys(d2.network.segments)[0];
    d2.network.segments[sid] = { ...d2.network.segments[sid], measuredLength: 1550 };
    expect(applyDetour(d2, findHits(d2)[0], 'square').ok).toBe(false);
  });
  it('C 貫通: 印を付けるとぶつかりから外れ、スリーブとして数える', () => {
    const { b } = withBeam();
    const d = docWith(b, [{ x: 3000, y: 1500, z: 2400 }, { x: 3000, y: -1000, z: 2400 }]);
    const nd = markPenetration(d, findHits(d)[0]);
    expect(findHits(nd)).toHaveLength(0);
    expect(penetrationsOf(nd)).toHaveLength(1);
  });
  it('軒にぶつかる外の縦管は、建物側ではなく外へ回る', () => {
    const b0 = base();
    const el = elevationFromWall(b0, south(b0).id);
    const r = addFaceMember(b0, el, 'eave', { u0: 0, u1: 8000, v0: 5600, v1: 5800 }, 600);
    if (!r.ok) throw new Error(r.error);
    const d = docWith(r.b, [{ x: 2000, y: -200, z: 4000 }, { x: 2000, y: -200, z: 7000 }], 75);
    const hit = findHits(d)[0];
    const dt = detour(d, hit, 'square');
    if ('error' in dt) throw new Error(dt.error);
    expect(dt.dir.y).toBeCloseTo(-1); // 南（外）へ
  });
});

describe('レビュー指摘の回帰', () => {
  it('勾配のある排水は上下に回さず横へ回る（脚に勾配を付けない）', () => {
    const { b } = withBeam();
    const d = docWith(b, [{ x: 3000, y: 1500, z: 2400 }, { x: 3000, y: -1000, z: 2400 }], 75);
    const sid = Object.keys(d.network.segments)[0];
    d.network.segments[sid] = { ...d.network.segments[sid], system: 'drain', slope: 0.02 };
    const dt = detour(d, findHits(d)[0], 'square');
    if ('error' in dt) throw new Error(dt.error);
    expect(dt.dir.z).toBe(0);
  });
  it('出隅・入隅は建物の外の曲がりだけ（室内の角の近くは付けない）', () => {
    const b = base();
    const inner = addPolyline(emptyNetwork(), [{ x: 100, y: 1000, z: 300 }, { x: 100, y: 100, z: 300 }, { x: 1000, y: 100, z: 300 }], { system: 'water', diameter: 20 }).net;
    const din: Doc = { building: b, network: inner, fixtures: {} };
    const elbowIn = analyzeFittings(inner).find((f) => f.type === 'elbow90')!;
    expect(fittingContext(din, elbowIn.nodeId)).toBeNull();
    const outer = addPolyline(emptyNetwork(), [{ x: -200, y: 1000, z: 300 }, { x: -200, y: -200, z: 300 }, { x: 1000, y: -200, z: 300 }], { system: 'water', diameter: 20 }).net;
    const dout: Doc = { building: b, network: outer, fixtures: {} };
    const elbowOut = analyzeFittings(outer).find((f) => f.type === 'elbow90')!;
    expect(fittingContext(dout, elbowOut.nodeId)).toBe('出隅・入隅');
  });
});
