import { describe, expect, it } from 'vitest';
import { addFloor, addWall, emptyBuilding } from './building';
import type { Doc } from './doc';
import { addPolyline, emptyNetwork } from './network';
import { placeFixture } from './fixtures';
import { currentStep, guideSteps } from './guide';

const empty = (): Doc => ({ building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {} });
const withWalls = (): Doc => {
  const d = empty();
  return { ...d, building: addWall(d.building, d.building.floors[0].id, { x: 0, y: 0 }, { x: 5000, y: 0 }).b };
};

describe('作業手順ガイド', () => {
  it('8工程を順番どおりに返す', () => {
    expect(guideSteps(empty()).map((s) => s.id)).toEqual(['info', 'drawing', 'layout', 'fixtures', 'pipes', 'lengths', 'quantities', 'quote']);
    expect(guideSteps(empty()).map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('空の工事は「間取り」から（図面の取り込みは任意なので飛ばす）', () => {
    const s = guideSteps(empty());
    expect(s[0].done).toBe(true);
    expect(s[1].optional).toBe(true);
    expect(currentStep(s).id).toBe('layout');
  });
  it('壁があれば「設備の配置」、器具があれば「配管ルート」', () => {
    const d = withWalls();
    expect(currentStep(guideSteps(d)).id).toBe('fixtures');
    const f = placeFixture(d, d.building.floors[0].id, 'toilet', { x: 1000, y: 1000 }).doc;
    expect(currentStep(guideSteps(f)).id).toBe('pipes');
  });
  it('配管があれば集計へ進み、実測の入力数を表示する', () => {
    const d = withWalls();
    const f = placeFixture(d, d.building.floors[0].id, 'toilet', { x: 1000, y: 1000 }).doc;
    const net = addPolyline(f.network, [{ x: 0, y: 0, z: 100 }, { x: 1000, y: 0, z: 100 }, { x: 1000, y: 1000, z: 100 }], { system: 'water', diameter: 20 }).net;
    const s = guideSteps({ ...f, network: net });
    expect(currentStep(s).id).toBe('quantities');
    const len = s.find((x) => x.id === 'lengths')!;
    expect(len.done).toBe(false);
    expect(len.progress).toBe('実測 0/2区間');
  });
  it('全部の区間に実測があれば長さの工程も完了', () => {
    const d = withWalls();
    const r = addPolyline(d.network, [{ x: 0, y: 0, z: 100 }, { x: 1000, y: 0, z: 100 }], { system: 'water', diameter: 20 });
    const segs = Object.fromEntries(Object.entries(r.net.segments).map(([k, v]) => [k, { ...v, measuredLength: 1000 }]));
    const s = guideSteps({ ...d, network: { ...r.net, segments: segs } });
    expect(s.find((x) => x.id === 'lengths')!.done).toBe(true);
    expect(s.find((x) => x.id === 'lengths')!.progress).toBe('実測 1/1区間');
  });
  it('下敷きがあれば図面の取り込みは完了', () => {
    const d = empty();
    const u = { id: 'u1' } as unknown as NonNullable<Doc['underlays']>[string];
    expect(guideSteps({ ...d, underlays: { u1: u } })[1].done).toBe(true);
  });
});

describe('レビュー対応', () => {
  it('壁がなくても配管があれば 間取り・設備 の工程で止めない（白紙で描いた工事）', () => {
    const d = empty();
    const net = addPolyline(d.network, [{ x: 0, y: 0, z: 100 }, { x: 1000, y: 0, z: 100 }], { system: 'water', diameter: 20 }).net;
    expect(currentStep(guideSteps({ ...d, network: net })).id).toBe('quantities');
  });
});
