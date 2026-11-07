import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state/store';
import { segmentsAt, validateNetwork } from '../model/network';
import { computeEstimate } from '../model/estimate';
import { validateFixtures } from '../model/fixtures';
import { buildSample, SAMPLE_NAME } from './sample';

const s = () => useStore.getState();

describe('サンプル工事', () => {
  beforeEach(() => buildSample({ id: 'p1', name: SAMPLE_NAME, createdAt: 1 }));

  it('建物・メーター・屋上タンク・器具・配管（分岐あり）がそろい、壊れていない', () => {
    const d = s().doc;
    expect(Object.keys(d.building.walls).length).toBeGreaterThan(0);
    const types = Object.values(d.fixtures).map((f) => f.type);
    for (const t of ['waterMeter', 'roofTank', 'toilet', 'washbasin', 'kitchen'] as const) expect(types).toContain(t);
    expect(Object.keys(d.network.segments).length).toBeGreaterThan(0);
    const branches = Object.keys(d.network.nodes).filter((id) => segmentsAt(d.network, id).length >= 3);
    expect(branches.length).toBeGreaterThanOrEqual(1);
    expect(validateNetwork(d.network)).toEqual([]);
    expect(validateFixtures(d)).toEqual([]);
  });

  it('メーター出口 → 屋上タンク入口、タンク出口 → 各器具まで配管がつながる', () => {
    const d = s().doc;
    const port = (type: string, pid: string) => {
      const f = Object.values(d.fixtures).find((x) => x.type === type)!;
      return Object.values(d.network.nodes).find((n) => n.fixtureId === f.id && n.portId === pid)!;
    };
    for (const [t, p] of [['waterMeter', 'out'], ['roofTank', 'in'], ['roofTank', 'out'], ['toilet', 'water'], ['washbasin', 'water'], ['kitchen', 'water'], ['toilet', 'sewage']] as const) {
      expect(segmentsAt(d.network, port(t, p).id).length, `${t}.${p}`).toBe(1);
    }
  });

  it('積算で配管の数量と継手が出る。履歴は空（「戻す」で消えない）', () => {
    const est = computeEstimate(s().doc);
    expect(est.pipes.length).toBeGreaterThan(0);
    expect(s().past).toEqual([]);
    expect(s().meta?.name).toBe(SAMPLE_NAME);
  });

  it('2回作っても同じ形（毎回新しく作る）', () => {
    const n1 = Object.keys(s().doc.network.segments).length;
    buildSample({ id: 'p2', name: SAMPLE_NAME, createdAt: 2 });
    expect(Object.keys(s().doc.network.segments).length).toBe(n1);
    expect(s().meta?.id).toBe('p2');
  });
});
