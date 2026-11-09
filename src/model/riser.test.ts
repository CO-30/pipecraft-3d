import { describe, expect, test } from 'vitest';
import { addFloor, emptyBuilding } from './building';
import type { Doc } from './doc';
import { addPolyline, emptyNetwork, insertValve } from './network';
import { placeFixture, portNodes } from './fixtures';
import { STANDARD_PROFILE } from './municipality';
import { buildRiser, defaultRiserRoot, riserNodes } from './riser';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const W = { system: 'water' as const, diameter: 20, material: 'HIVP' };

/** 2 階建て: メーター(1F) → 1F 水栓、立て管 → 2F 水栓 */
function twoFloors() {
  const b1 = addFloor(emptyBuilding(), { height: 3000 });
  const b2 = addFloor(b1.b, { height: 3000 });
  let doc: Doc = { building: b2.b, network: emptyNetwork(), fixtures: {}, site: { designGL: -300 } };
  const f1 = b1.floorId, f2 = b2.floorId;
  const m = placeFixture(doc, f1, 'waterMeter', { x: 0, y: 0 }); doc = m.doc;
  const out = portNodes(doc.network, m.fixtureId!).find((n) => n.portId === 'out')!;
  const t1 = placeFixture(doc, f1, 'faucet', { x: 4000, y: 0 }); doc = t1.doc;
  const p1 = portNodes(doc.network, t1.fixtureId!)[0];
  const t2 = placeFixture(doc, f2, 'faucet', { x: 4000, y: 0 }); doc = t2.doc;
  const p2 = portNodes(doc.network, t2.fixtureId!)[0];
  // メーター出口 → 2000 で分岐点 → 1F 水栓
  let r = addPolyline(doc.network, [out.pos, v(2000, 0, out.pos.z), p1.pos], W, { startNodeId: out.id, endNodeId: p1.id });
  const branchAt = r.nodeIds[1];
  // 分岐点 → 立て管 → 2F 水栓
  r = addPolyline(r.net, [v(2000, 0, out.pos.z), v(2000, 0, p2.pos.z), p2.pos], { ...W, diameter: 13 }, { startNodeId: branchAt, endNodeId: p2.id });
  doc = { ...doc, network: r.net };
  return { doc, out: out.id, p1: p1.id, p2: p2.id, f2 };
}

describe('給水立面図（系統図）', () => {
  test('defaultRiserRoot はメーターの出口。メーターが無ければ止水栓（バルブ）。どちらも無ければ null', () => {
    const { doc, out } = twoFloors();
    expect(defaultRiserRoot(doc)).toBe(out);
    const d2: Doc = { building: doc.building, network: emptyNetwork(), fixtures: {} };
    const r = addPolyline(d2.network, [v(0, 0), v(3000, 0)], W);
    const vv = insertValve(r.net, r.segmentIds[0], v(1000, 0))!;
    expect(defaultRiserRoot({ ...d2, network: vv.net })).toBe(vv.nodeId);
    expect(defaultRiserRoot(d2)).toBeNull();
  });
  test('2 階建て: 木構造・階と高さ・列', () => {
    const { doc, out, p1, p2 } = twoFloors();
    const m = buildRiser(doc, out, STANDARD_PROFILE, '給水装置 立面図');
    expect(m.root.nodeId).toBe(out);
    expect(m.root.children).toHaveLength(1);
    const branch = m.root.children[0].to;
    expect(branch.children).toHaveLength(2);
    const all = riserNodes(m.root);
    const leaves = all.filter((n) => n.children.length === 0);
    expect(new Set(leaves.map((l) => l.nodeId))).toEqual(new Set([p1, p2]));
    const leaf2 = leaves.find((l) => l.nodeId === p2)!;
    expect(leaf2.heightLabel).toBe('FL+1040'); // 2F FL=3000、壁付水栓 base 1000 + 接続口 dz 40
    expect(leaf2.floorName).toBe(doc.building.floors[1].name);
    expect(leaf2.fixture?.type).toBe('faucet');
    expect(m.root.fixture?.type).toBe('waterMeter');
    expect(m.columns).toBe(3); // メーター・立て管の列 0、1F 水栓、2F 水栓（器具は必ず別の列）
    expect(m.floors.map((f) => f.z)).toEqual([0, 3000]);
    expect(m.root.children[0]).toMatchObject({ diameter: 20, system: 'water', material: 'HIVP' });
    expect(m.warnings).toEqual([]);
  });
  test("heightLabel 'GL+' は設計GL 基準", () => {
    const { doc, out, p1 } = twoFloors();
    const m = buildRiser(doc, out, { ...STANDARD_PROFILE, riser: { ...STANDARD_PROFILE.riser, heightLabel: 'GL+' } }, 't');
    const leaf = riserNodes(m.root).find((l) => l.nodeId === p1)!;
    expect(leaf.heightLabel).toBe('GL+1340'); // 1040 − (−300)
  });
  test('輪になった配管は省略して warnings', () => {
    const d: Doc = { building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {} };
    const a = addPolyline(d.network, [v(0, 0), v(3000, 0), v(3000, 3000)], W);
    const loop = addPolyline(a.net, [v(3000, 3000), v(0, 0)], W, { startNodeId: a.nodeIds[2], endNodeId: a.nodeIds[0] });
    const m = buildRiser({ ...d, network: loop.net }, a.nodeIds[0], STANDARD_PROFILE, 't');
    expect(m.warnings).toEqual(['輪になった配管を省略しました']);
  });
  test('給湯は給湯器を経由した枝として含める', () => {
    let doc: Doc = { building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {} };
    const f1 = doc.building.floors[0].id;
    const m = placeFixture(doc, f1, 'waterMeter', { x: 0, y: 0 }); doc = m.doc;
    const out = portNodes(doc.network, m.fixtureId!).find((n) => n.portId === 'out')!;
    const h = placeFixture(doc, f1, 'waterHeater', { x: 3000, y: 0 }); doc = h.doc;
    const hin = portNodes(doc.network, h.fixtureId!).find((n) => n.portId === 'in')!;
    const hout = portNodes(doc.network, h.fixtureId!).find((n) => n.portId === 'out')!;
    const t = placeFixture(doc, f1, 'mixFaucet', { x: 6000, y: 0 }); doc = t.doc;
    const hot = portNodes(doc.network, t.fixtureId!).find((n) => n.portId === 'hot')!;
    let r = addPolyline(doc.network, [out.pos, hin.pos], W, { startNodeId: out.id, endNodeId: hin.id });
    r = addPolyline(r.net, [hout.pos, hot.pos], { system: 'hotWater', diameter: 13 }, { startNodeId: hout.id, endNodeId: hot.id });
    doc = { ...doc, network: r.net };
    const model = buildRiser(doc, out.id, STANDARD_PROFILE, 't');
    const heater = model.root.children[0].to;
    expect(heater.fixture?.type).toBe('waterHeater');
    expect(heater.children).toHaveLength(1);
    expect(heater.children[0].system).toBe('hotWater');
    expect(heater.children[0].to.nodeId).toBe(hot.id);
  });
});
