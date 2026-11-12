import { describe, expect, test } from 'vitest';
import { projectSchema, SCHEMA_VERSION } from './schema';
import { emptyDoc } from '../state/store';
import { isSlopePinned } from './slope';

const base = () => {
  const d = emptyDoc();
  return { schemaVersion: SCHEMA_VERSION, id: 'p1', name: 't', createdAt: 1, updatedAt: 2, building: d.building, network: d.network, fixtures: {}, estimate: d.estimate!, underlays: {} };
};

describe('v5 の省略可フィールド（申請図面）', () => {
  test('site・slopeLocked・groundLevel が無い v5 データを受け付ける', () => {
    expect(projectSchema.safeParse(base()).success).toBe(true);
  });
  test('site 付きを往復できる', () => {
    const r = projectSchema.safeParse({ ...base(), site: { designGL: -450, municipalityProfileId: 'standard' } });
    expect(r.success && r.data.site).toEqual({ designGL: -450, municipalityProfileId: 'standard' });
  });
  test('区間と器具の existing（既設）を受け付ける', () => {
    const p = base();
    const network = {
      nodes: { a: { id: 'a', kind: 'end', pos: { x: 0, y: 0, z: 0 } }, b: { id: 'b', kind: 'end', pos: { x: 1000, y: 0, z: -10 } } },
      segments: { s: { id: 's', a: 'a', b: 'b', system: 'drain', diameter: 100, existing: true } },
    };
    const fixtures = { f: { id: 'f', floorId: p.building.floors[0].id, type: 'manholeSewage', x: 0, y: 0, rotation: 0, params: { existing: true } } };
    const r = projectSchema.safeParse({ ...p, network, fixtures });
    expect(r.success).toBe(true);
    expect(r.success && r.data.network.segments.s.existing).toBe(true);
    expect(r.success && r.data.fixtures.f.params?.existing).toBe(true);
  });
  test('区間の slopeLocked とノードの groundLevel を受け付ける', () => {
    const p = base();
    const network = {
      nodes: { a: { id: 'a', kind: 'end', pos: { x: 0, y: 0, z: 0 }, groundLevel: -100 }, b: { id: 'b', kind: 'end', pos: { x: 1000, y: 0, z: -10 } } },
      segments: { s: { id: 's', a: 'a', b: 'b', system: 'drain', diameter: 100, slope: 0.01, slopeLocked: true } },
    };
    const r = projectSchema.safeParse({ ...p, network });
    expect(r.success).toBe(true);
    expect(r.success && r.data.network.segments.s.slopeLocked).toBe(true);
    expect(r.success && r.data.network.nodes.a.groundLevel).toBe(-100);
  });
});

describe('排水の自動計算のピン（手で固定した値）', () => {
  test('区間の slopePin・diameterPin、点の zPin、マスの invertPin を往復できる。無い古いデータもそのまま', () => {
    const p = base();
    const network = {
      nodes: { a: { id: 'a', kind: 'end', pos: { x: 0, y: 0, z: 0 }, zPin: true }, b: { id: 'b', kind: 'end', pos: { x: 1000, y: 0, z: -10 } } },
      segments: { s: { id: 's', a: 'a', b: 'b', system: 'drain', diameter: 100, slope: 0.03, slopePin: true, diameterPin: true } },
    };
    const fixtures = { f: { id: 'f', floorId: p.building.floors[0].id, type: 'manholeSewage', x: 0, y: 0, rotation: 0, params: { invertZ: -900, invertPin: true } } };
    const r = projectSchema.safeParse({ ...p, network, fixtures });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.network.nodes.a.zPin).toBe(true);
    expect(r.data.network.segments.s).toMatchObject({ slopePin: true, diameterPin: true });
    expect(r.data.fixtures.f.params?.invertPin).toBe(true);
  });
  test('isSlopePinned: slopePin、または以前の slopeLocked', () => {
    const s: { slopePin?: boolean; slopeLocked?: boolean } = {};
    expect(isSlopePinned(s)).toBe(false);
    expect(isSlopePinned({ ...s, slopePin: true })).toBe(true);
    expect(isSlopePinned({ ...s, slopeLocked: true })).toBe(true);
  });
});
