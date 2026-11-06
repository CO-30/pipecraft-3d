import { describe, expect, it } from 'vitest';
import { hitTestPlan, orthoSnap, simplify } from './geometry';
import { addPolyline, emptyNetwork } from './network';

describe('手描き補正', () => {
  it('ほぼ直線の手描き軌跡は2点に単純化', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i * 100, y: (i % 2) * 5 }));
    expect(simplify(pts, 20)).toHaveLength(2);
  });

  it('L字の軌跡は3点に単純化', () => {
    const pts = [
      ...Array.from({ length: 20 }, (_, i) => ({ x: i * 100, y: 0 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 1900, y: (i + 1) * 100 })),
    ];
    expect(simplify(pts, 20)).toHaveLength(3);
  });

  it('直角スナップ: 少し傾いた線は水平/垂直に揃う', () => {
    const r = orthoSnap([{ x: 0, y: 0 }, { x: 3000, y: 150 }, { x: 3100, y: 2000 }], 15);
    expect(r).toEqual([{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 2000 }]);
  });

  it('斜め(45°)はスナップ角15°では補正しない（自動補正を強制しない）', () => {
    const r = orthoSnap([{ x: 0, y: 0 }, { x: 1000, y: 1000 }], 15);
    expect(r).toEqual([{ x: 0, y: 0 }, { x: 1000, y: 1000 }]);
  });

  it('補正なし設定(0°)では元のまま', () => {
    const pts = [{ x: 0, y: 0 }, { x: 3000, y: 150 }];
    expect(orthoSnap(pts, 0)).toEqual(pts);
  });

  it('補正で一直線になった中間点は除去', () => {
    const r = orthoSnap([{ x: 0, y: 0 }, { x: 1000, y: 30 }, { x: 2000, y: -20 }], 15);
    expect(r).toEqual([{ x: 0, y: 0 }, { x: 2000, y: 0 }]);
  });
});

describe('ヒットテスト', () => {
  const { net, nodeIds, segmentIds } = addPolyline(emptyNetwork(), [{ x: 0, y: 0, z: 0 }, { x: 4000, y: 0, z: 0 }], { system: 'water', diameter: 20 });
  it('ノード近くはノード優先', () => {
    expect(hitTestPlan(net, { x: 30, y: 30 }, 100)).toEqual({ type: 'node', id: nodeIds[0] });
  });
  it('区間の途中は区間', () => {
    expect(hitTestPlan(net, { x: 2000, y: 50 }, 100)).toEqual({ type: 'segment', id: segmentIds[0] });
  });
  it('離れていれば null', () => {
    expect(hitTestPlan(net, { x: 2000, y: 500 }, 100)).toBeNull();
  });
});
