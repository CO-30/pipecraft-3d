import { describe, expect, test } from 'vitest';
import { projectSchema, SCHEMA_VERSION } from './schema';
import { emptyDoc } from '../state/store';

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
