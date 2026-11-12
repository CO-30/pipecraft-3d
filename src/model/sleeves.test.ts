import { describe, expect, test } from 'vitest';
import { addWall, createBuildingFromDims, type Building } from './building';
import type { Doc } from './doc';
import { withMember } from './members';
import { addPolyline, emptyNetwork, type Network, type SegmentAttrs } from './network';
import { sleeveSchedule, sleeveSize } from './sleeves';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const W: SegmentAttrs = { system: 'water', diameter: 20, material: 'HIVP' };
const D: SegmentAttrs = { system: 'sewage', diameter: 100, material: 'VU' };
const house = (): Building => ({ ...createBuildingFromDims({ width: 9100, depth: 7280, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), foundation: { slabTop: -450 } });
const docOf = (b: Building, net: Network): Doc => ({ building: b, network: net, fixtures: {} });

describe('スリーブの径（一般値）', () => {
  test('内径 ≥ 外径＋30（給湯は保温＋20）のいちばん小さい呼び径', () => {
    expect(sleeveSize(114, 'sewage')).toBe(150);
    expect(sleeveSize(26, 'water')).toBe(65);
    expect(sleeveSize(23, 'hotWater')).toBe(75);
    expect(sleeveSize(400, 'sewage')).toBe(450); // 表より太い → 50 刻みで切り上げ
  });
});

describe('スリーブ表の拾い出し', () => {
  test('外から床下へ入る給水は「基礎（外周）」、1 階、FL-300', () => {
    const b = house();
    const net = addPolyline(emptyNetwork(), [v(-1000, 1000, -300), v(1000, 1000, -300)], W).net;
    const rows = sleeveSchedule(docOf(b, net));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ no: 1, part: 'footingOuter', floorName: b.floors[0].name, flz: -300, sleeve: 65, diameter: 20 });
    expect(rows[0].point.x).toBeCloseTo(0, 3);
  });
  test('1 階→2 階の立て管は 2 階の床、床下→地中の排水は基礎スラブ。外の地中は拾わない', () => {
    const b = house();
    let net = addPolyline(emptyNetwork(), [v(3000, 3000, 1000), v(3000, 3000, 4000)], W).net;
    net = addPolyline(net, [v(5000, 3000, -300), v(5000, 3000, -900)], D).net;
    net = addPolyline(net, [v(12000, 3000, -300), v(12000, 3000, -900)], D).net; // 建物の外
    const rows = sleeveSchedule(docOf(b, net));
    expect(rows.map((r) => r.part).sort()).toEqual(['baseSlab', 'floor']);
    const fl = rows.find((r) => r.part === 'floor')!;
    expect(fl.floorName).toBe(b.floors[1].name);
    expect(rows.find((r) => r.part === 'baseSlab')!.sleeve).toBe(150);
  });
  test('間仕切壁・梁の貫通（印のある部材）・基礎の立上り（部材）', () => {
    let b = house();
    const f1 = b.floors[0].id;
    b = addWall(b, f1, { x: 4000, y: 0 }, { x: 4000, y: 7280 }, { kind: 'interior', thickness: 120 }).b;
    const beam = withMember(b, { kind: 'beam', floorId: f1, a: { x: 6000, y: 0 }, b: { x: 6000, y: 7280 }, width: 120, z0: 2500, z1: 2800 });
    b = beam.b;
    const foot = withMember(b, { kind: 'footing', floorId: f1, a: { x: 2000, y: 0 }, b: { x: 2000, y: 7280 }, width: 150, z0: -600, z1: -50 });
    b = foot.b;
    let r = addPolyline(emptyNetwork(), [v(3000, 2000, 500), v(5000, 2000, 500)], W); // 間仕切壁
    let net = r.net;
    r = addPolyline(net, [v(5500, 3000, 2650), v(6500, 3000, 2650)], W); // 梁
    net = r.net;
    const beamSeg = r.segmentIds[0];
    net = { ...net, segments: { ...net.segments, [beamSeg]: { ...net.segments[beamSeg], penetrations: [beam.id] } } };
    net = addPolyline(net, [v(1500, 4000, -300), v(2500, 4000, -300)], D).net; // 基礎の立上り
    const rows = sleeveSchedule(docOf(b, net));
    expect(rows.map((x) => x.part).sort()).toEqual(['beam', 'footing', 'interiorWall']);
    expect(rows.map((x) => x.no)).toEqual([1, 2, 3]);
  });
  test('壁の線の上で折れる配管は 1 か所と数える', () => {
    const b = house();
    const net = addPolyline(emptyNetwork(), [v(-1000, 1000, -300), v(0, 1000, -300), v(1000, 2000, -300)], W).net;
    expect(sleeveSchedule(docOf(b, net))).toHaveLength(1);
  });
  test('貫通の印が無い梁にぶつかる配管は拾わない（干渉として要確認に出る）', () => {
    let b = house();
    b = withMember(b, { kind: 'beam', floorId: b.floors[0].id, a: { x: 6000, y: 0 }, b: { x: 6000, y: 7280 }, width: 120, z0: 2500, z1: 2800 }).b;
    const net = addPolyline(emptyNetwork(), [v(5500, 3000, 2650), v(6500, 3000, 2650)], W).net;
    expect(sleeveSchedule(docOf(b, net))).toEqual([]);
  });
});
