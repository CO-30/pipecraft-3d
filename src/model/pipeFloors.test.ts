import { describe, expect, it } from 'vitest';
import { addFloor, deleteFloor, emptyBuilding, updateFloor } from './building';
import { addPolyline, addRiser, emptyNetwork, segmentLength, validateNetwork, type Network } from './network';
import { floorIndexForZ, followFloors, tagNodeFloors } from './pipeFloors';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const W = { system: 'water' as const, diameter: 20 };
function threeFloors() {
  let b = addFloor(emptyBuilding(), { height: 3000 }).b;
  b = addFloor(b, { height: 3000 }).b;
  b = addFloor(b, { height: 3000 }).b;
  return b;
}
const zs = (net: Network) => Object.values(net.nodes).map((n) => n.pos.z).sort((a, b) => a - b);

describe('配管の階追従', () => {
  it('高さから階を判定', () => {
    const b = threeFloors();
    expect(floorIndexForZ(b.floors, -300)).toBe(0);
    expect(floorIndexForZ(b.floors, 3100)).toBe(1);
    expect(floorIndexForZ(b.floors, 6000)).toBe(2);
  });
  it('既定の階の床下配管はその階に属する', () => {
    const b = threeFloors();
    const r = addPolyline(emptyNetwork(), [v(0, 0, 2700), v(1000, 0, 2700)], W);
    const t = tagNodeFloors(r.net, b.floors, b.floors[1].id);
    expect(Object.values(t.nodes).every((n) => n.floorId === b.floors[1].id)).toBe(true);
  });
  it('1F 階高 3000→3500 で 2F 以上の配管が +500、1F は不変', () => {
    const b = threeFloors();
    let net = addPolyline(emptyNetwork(), [v(0, 0, 100), v(1000, 0, 100)], W).net;
    net = addPolyline(net, [v(0, 0, 3100), v(1000, 0, 3100)], W).net;
    net = tagNodeFloors(net, b.floors);
    const b2 = updateFloor(b, b.floors[0].id, { height: 3500 });
    const out = followFloors(net, b.floors, b2.floors);
    expect(zs(out)).toEqual([100, 100, 3600, 3600]);
    expect(validateNetwork(out)).toEqual([]);
  });
  it('riser spanning floors stays connected after floor height change', () => {
    const b = threeFloors();
    const r = addPolyline(emptyNetwork(), [v(0, 0, 100), v(1000, 0, 100)], W);
    const up = addRiser(tagNodeFloors(r.net, b.floors), r.nodeIds[1], 3100)!;
    const net = tagNodeFloors(up.net, b.floors);
    expect(net.nodes[up.nodeId].floorId).toBe(b.floors[1].id);
    const b2 = updateFloor(b, b.floors[0].id, { height: 3500 });
    const out = followFloors(net, b.floors, b2.floors);
    expect(validateNetwork(out)).toEqual([]);
    expect(out.nodes[up.nodeId].pos).toEqual({ x: 1000, y: 0, z: 3600 });
    expect(segmentLength(out, up.segmentId)).toBe(3500);
  });
  it('2F を削除すると 3F の配管が −3000、2F の配管は動かない。実測長は変えない', () => {
    const b = threeFloors();
    const r = addPolyline(emptyNetwork(), [v(0, 0, 3100), v(1000, 0, 3100)], W);
    const r3 = addPolyline(r.net, [v(0, 0, 6100), v(1000, 0, 6100)], W);
    const sid = r3.segmentIds[0];
    let net = tagNodeFloors(r3.net, b.floors);
    net = { ...net, segments: { ...net.segments, [sid]: { ...net.segments[sid], measuredLength: 1234 } } };
    const b2 = deleteFloor(b, b.floors[1].id);
    const out = followFloors(net, b.floors, b2.floors);
    expect(zs(out)).toEqual([3100, 3100, 3100, 3100]);
    expect(out.segments[sid].measuredLength).toBe(1234);
    expect(Object.values(out.nodes).every((n) => b2.floors.some((f) => f.id === n.floorId))).toBe(true);
  });
});
