import { describe, expect, it } from 'vitest';
import { addFloor, emptyBuilding } from './building';
import type { Doc } from './doc';
import { addPolyline, emptyNetwork, segmentsAt, validateNetwork } from './network';
import { deleteFixture, fixtureConnected, moveFixture, placeFixture, portNodes, validateFixtures, FIXTURE_CATALOG, FIXTURE_TYPES } from './fixtures';
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
  it('カタログは設計書の13種、接続口は重ならない', () => {
    expect(FIXTURE_TYPES).toHaveLength(13);
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
    const p = { schemaVersion: SCHEMA_VERSION, id: 'p1', name: 'x', createdAt: 1, updatedAt: 1, ...doc };
    expect(() => parseProject(JSON.stringify(p))).not.toThrow();
    const bad = { ...p, fixtures: {} };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/器具/);
    expect(id).toBeTruthy();
  });
  it('v2 の保存データは v3 に変換される', () => {
    const d = doc0();
    const v2 = { schemaVersion: 2, id: 'p1', name: 'x', createdAt: 1, updatedAt: 1, building: d.building, network: d.network };
    const p = parseProject(JSON.stringify(v2));
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.fixtures).toEqual({});
  });
});
