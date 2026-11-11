/** 床下の排水を描いたら土間から自動で勾配（ストア） */
import { beforeEach, describe, expect, it } from 'vitest';
import { setUnderfloorRulesSource, useStore } from './store';
import { createBuildingFromDims } from '../model/building';
import { emptyNetwork } from '../model/network';

const s = () => useStore.getState();
const v = (x: number, y: number, z: number) => ({ x, y, z });

describe('床下の排水の自動勾配（ストア）', () => {
  beforeEach(() => {
    setUnderfloorRulesSource(() => ({}));
    s().setAutoUnderfloorSlope(true);
    const b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    s().newDoc({ building: { ...b, foundation: { slabTop: -550 } }, network: emptyNetwork(), fixtures: {} }, { id: 'p', name: 'テスト', createdAt: 1 });
    s().setDrawAttrs({ system: 'sewage', diameter: 100 });
  });
  const zs = () => Object.values(s().doc.network.nodes).map((n) => n.pos.z).sort((a, b) => a - b);

  it('描くと外壁に近い端（床下から出る所）が土間、器具の方が 2/100 で高くなり、知らせる。1 回で戻せる', () => {
    s().drawPolyline([v(4000, 3000, -300), v(300, 3000, -300)]);
    const [lo, hi] = zs();
    expect(lo).toBe(-550);
    expect(hi).toBeCloseTo(-550 + 3700 * 0.02, 1);
    expect(s().notice).toContain('土間');
    s().undo();
    expect(Object.keys(s().doc.network.nodes)).toHaveLength(0);
  });

  it('自治体の最小勾配が急ならそれ。切り替えで自動をやめられ、ボタンで付け直せる', () => {
    setUnderfloorRulesSource(() => ({ slopeFor: () => 0.03 }));
    s().drawPolyline([v(4000, 3000, -300), v(300, 3000, -300)]);
    expect(zs()[1]).toBeCloseTo(-550 + 3700 * 0.03, 1);
    s().setAutoUnderfloorSlope(false);
    s().drawPolyline([v(4000, 1000, -300), v(300, 1000, -300)]);
    expect(zs().filter((z) => z === -300)).toHaveLength(2);
    setUnderfloorRulesSource(() => ({}));
    expect(s().slopeUnderfloorDrains()).toBe(2);
    expect(zs().filter((z) => z === -550)).toHaveLength(2);
  });

  it('給水・床上の排水には付けない', () => {
    s().setDrawAttrs({ system: 'water', diameter: 20 });
    s().drawPolyline([v(4000, 3000, -300), v(300, 3000, -300)]);
    s().setDrawAttrs({ system: 'drain', diameter: 50 });
    s().drawPolyline([v(4000, 1000, 100), v(300, 1000, 100)]);
    expect(zs()).toEqual([-300, -300, 100, 100]);
  });
});
