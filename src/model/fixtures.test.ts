import { defaultEstimate } from './estimate';
import { describe, expect, it } from 'vitest';
import { addFloor, emptyBuilding } from './building';
import type { Doc } from './doc';
import { addPolyline, emptyNetwork, segmentsAt, validateNetwork } from './network';
import { deleteFixture, fixtureConnected, fixtureSize, groundZ, isManhole, manholeDepth, MANHOLE_TYPES, moveFixture, placeFixture, portNodes, validateFixtures, FIXTURE_CATALOG, FIXTURE_GROUPS, FIXTURE_TYPES } from './fixtures';
import { parseProject } from '../storage/repository';
import { SCHEMA_VERSION } from './schema';

const doc0 = (): Doc => ({ building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {} });
const W = { system: 'water' as const, diameter: 13 };

function toilet() {
  const d = doc0();
  const r = placeFixture(d, d.building.floors[0].id, 'toilet', { x: 1000, y: 1000 });
  return { doc: r.doc, id: r.fixtureId! };
}
const port = (d: Doc, fid: string, pid: string) => portNodes(d.network, fid).find((n) => n.portId === pid)!;

describe('設備機器', () => {
  it('カタログは設計書の13種＋水栓3種＋屋上タンク＋マス6種、接続口は重ならない', () => {
    expect(FIXTURE_TYPES).toHaveLength(23);
    expect(new Set(FIXTURE_TYPES)).toEqual(new Set(Object.keys(FIXTURE_CATALOG)));
    for (const t of FIXTURE_TYPES) {
      const ps = FIXTURE_CATALOG[t].ports;
      expect(ps.length).toBeGreaterThan(0);
      expect(new Set(ps.map((p) => `${p.dx},${p.dy},${p.dz}`)).size).toBe(ps.length);
    }
  });
  it('トイレを置くと 給水・汚水 の接続口ノード', () => {
    const { doc, id } = toilet();
    const ps = portNodes(doc.network, id);
    expect(ps.map((n) => n.portId).sort()).toEqual(['sewage', 'water']);
    expect(ps.every((n) => n.kind === 'fixture' && n.fixedKind)).toBe(true);
    expect(port(doc, id, 'water').pos).toEqual({ x: 1150, y: 1300, z: 150 });
    expect(validateNetwork(doc.network)).toEqual([]);
    expect(validateFixtures(doc)).toEqual([]);
  });
  it('90°回転で接続口が回る', () => {
    const { doc, id } = toilet();
    const d2 = moveFixture(doc, id, { x: 1000, y: 1000 }, 90);
    expect(port(d2, id, 'water').pos).toEqual({ x: 700, y: 1150, z: 150 });
  });
  it('接続口から描いた配管は器具の移動に追従', () => {
    const { doc, id } = toilet();
    const w = port(doc, id, 'water');
    const r = addPolyline(doc.network, [w.pos, { x: 3000, y: 1300, z: 150 }], W, { startNodeId: w.id });
    const d1 = { ...doc, network: r.net };
    expect(fixtureConnected(d1, id)).toBe(true);
    const d2 = moveFixture(d1, id, { x: 1500, y: 1000 });
    expect(d2.network.nodes[w.id].pos.x).toBe(1650);
    expect(segmentsAt(d2.network, w.id)).toHaveLength(1);
    expect(validateNetwork(d2.network)).toEqual([]);
  });
  it('moveFixture rejects zero-length', () => {
    const { doc, id } = toilet();
    const w = port(doc, id, 'water');
    const r = addPolyline(doc.network, [w.pos, { x: 1650, y: 1300, z: 150 }], W, { startNodeId: w.id });
    const d1 = { ...doc, network: r.net };
    expect(moveFixture(d1, id, { x: 1500, y: 1000 })).toBe(d1);
  });
  it('削除しても配管は残り、接続口は通常の端点に戻る', () => {
    const { doc, id } = toilet();
    const w = port(doc, id, 'water');
    const r = addPolyline(doc.network, [w.pos, { x: 3000, y: 1300, z: 150 }], W, { startNodeId: w.id });
    const d = deleteFixture({ ...doc, network: r.net }, id);
    expect(d.fixtures[id]).toBeUndefined();
    expect(Object.keys(d.network.segments)).toHaveLength(1);
    expect(d.network.nodes[w.id].kind).toBe('end');
    expect(d.network.nodes[w.id].fixtureId).toBeUndefined();
    expect(Object.keys(d.network.nodes)).toHaveLength(2);
    expect(validateNetwork(d.network)).toEqual([]);
    expect(validateFixtures(d)).toEqual([]);
  });
  it('parseProject rejects dangling fixture port', () => {
    const { doc, id } = toilet();
    const p = { schemaVersion: SCHEMA_VERSION, id: 'p1', name: 'x', createdAt: 1, updatedAt: 1, estimate: defaultEstimate(), underlays: {}, ...doc };
    expect(() => parseProject(JSON.stringify(p))).not.toThrow();
    const bad = { ...p, fixtures: {} };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/器具/);
    expect(id).toBeTruthy();
  });
  it('v2 の保存データは現行形式に変換される', () => {
    const d = doc0();
    const v2 = { schemaVersion: 2, id: 'p1', name: 'x', createdAt: 1, updatedAt: 1, building: d.building, network: d.network };
    const p = parseProject(JSON.stringify(v2));
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.fixtures).toEqual({});
  });
});

it('接続口の位置が器具とずれている・カタログにない接続口は検出', () => {
  const d = { building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {} } as Doc;
  const r = placeFixture(d, d.building.floors[0].id, 'toilet', { x: 0, y: 0 });
  const n = Object.values(r.doc.network.nodes)[0];
  const moved = { ...r.doc, network: { ...r.doc.network, nodes: { ...r.doc.network.nodes, [n.id]: { ...n, pos: { ...n.pos, x: n.pos.x + 500 } } } } };
  expect(validateFixtures(moved).join()).toMatch(/ずれ/);
  const unknown = { ...r.doc, network: { ...r.doc.network, nodes: { ...r.doc.network.nodes, [n.id]: { ...n, portId: 'zzz' } } } };
  expect(validateFixtures(unknown).join()).toMatch(/ない接続口/);
});

describe('屋上タンク・器具の見出し', () => {
  it('屋上タンクは最上階の屋上面に載り、入口(上)・出口(下)とも給水', () => {
    let b = addFloor(emptyBuilding(), { height: 3000 }).b;
    b = addFloor(b, { height: 2800 }).b;
    const top = b.floors[1];
    const d: Doc = { building: b, network: emptyNetwork(), fixtures: {} };
    const r = placeFixture(d, top.id, 'roofTank', { x: 2000, y: 2000 });
    const roof = top.elevation + top.height;
    expect(port(r.doc, r.fixtureId!, 'in').pos.z).toBe(roof + 1100);
    expect(port(r.doc, r.fixtureId!, 'out').pos.z).toBe(roof + 100);
    expect(FIXTURE_CATALOG.roofTank.ports.every((p) => p.system === 'water')).toBe(true);
  });
  it('見出しは全種類を過不足なく含む', () => {
    const all = FIXTURE_GROUPS.flatMap((g) => g.types);
    expect(all).toHaveLength(FIXTURE_TYPES.length);
    expect(new Set(all)).toEqual(new Set(FIXTURE_TYPES));
  });
});

describe('マス（排水）', () => {
  const floorOf = (d: Doc) => d.building.floors[0];
  it('6 種類あり、すべて排水系の接続口を 1 つ持つ', () => {
    expect(MANHOLE_TYPES).toHaveLength(6);
    for (const t of MANHOLE_TYPES) {
      expect(isManhole(t)).toBe(true);
      expect(FIXTURE_CATALOG[t].ports).toHaveLength(1);
      expect(['drain', 'sewage']).toContain(FIXTURE_CATALOG[t].ports[0].system);
    }
    expect(isManhole('toilet')).toBe(false);
    expect(FIXTURE_GROUPS.some((g) => g.types.includes('publicSewage'))).toBe(true);
  });
  it('マスを置くと接続口の高さは GL−600（designGL 反映）、深さ 600', () => {
    const d0: Doc = { ...doc0(), site: { designGL: -400 } };
    const { doc, fixtureId } = placeFixture(d0, floorOf(d0).id, 'manholeSewage', { x: 1000, y: 0 });
    const port = portNodes(doc.network, fixtureId!)[0];
    expect(groundZ(doc.building, doc.site)).toBe(-400);
    expect(port.pos.z).toBe(-1000);
    expect(manholeDepth(doc.fixtures[fixtureId!], doc.building, doc.site)).toBe(600);
    expect(validateFixtures(doc)).toEqual([]);
  });
  it('invertZ を変えると接続口ノードと深さが変わる（配管の端も追従）', () => {
    const d0 = doc0();
    const { doc: d1, fixtureId } = placeFixture(d0, floorOf(d0).id, 'publicSewage', { x: 1000, y: 0 });
    const port = portNodes(d1.network, fixtureId!)[0];
    const d2 = { ...d1, network: addPolyline(d1.network, [{ x: 1000, y: 0, z: port.pos.z }, { x: 5000, y: 0, z: port.pos.z }], { system: 'sewage', diameter: 100 }, { startNodeId: port.id }).net };
    const f = d2.fixtures[fixtureId!];
    const d3 = moveFixture(d2, fixtureId!, f, undefined, { invertZ: -1200 });
    expect(portNodes(d3.network, fixtureId!)[0].pos.z).toBe(-1200);
    expect(manholeDepth(d3.fixtures[fixtureId!], d3.building, d3.site)).toBe(1200);
    expect(validateFixtures(d3)).toEqual([]);
    expect(validateNetwork(d3.network)).toEqual([]);
  });
  it('fixtureSize: マスは口径と深さ、トイレは catalog', () => {
    const d0 = doc0();
    const { doc, fixtureId } = placeFixture(d0, floorOf(d0).id, 'manholeRain', { x: 0, y: 0 });
    expect(fixtureSize(doc.fixtures[fixtureId!], doc.building, doc.site)).toEqual({ w: 300, d: 300, h: 600 });
    const d2 = moveFixture(doc, fixtureId!, doc.fixtures[fixtureId!], undefined, { diameter: 450 });
    expect(fixtureSize(d2.fixtures[fixtureId!], d2.building, d2.site).w).toBe(450);
    const t = toilet();
    expect(fixtureSize(t.doc.fixtures[t.id], t.doc.building, t.doc.site)).toEqual(FIXTURE_CATALOG.toilet.size);
  });
  it('params 付きのマスを保存形式で往復できる', () => {
    const d0 = doc0();
    const { doc, fixtureId } = placeFixture(d0, floorOf(d0).id, 'manholeTrap', { x: 0, y: 0 });
    const d2 = moveFixture(doc, fixtureId!, doc.fixtures[fixtureId!], undefined, { diameter: 350, shape: 'square', invertZ: -900 });
    const json = JSON.stringify({ schemaVersion: SCHEMA_VERSION, id: 'x', name: 'n', createdAt: 1, updatedAt: 1, building: d2.building, network: d2.network, fixtures: d2.fixtures, estimate: defaultEstimate(), underlays: {} });
    const p = parseProject(json);
    expect(p.fixtures[fixtureId!].params).toEqual({ diameter: 350, shape: 'square', invertZ: -900 });
  });
});
