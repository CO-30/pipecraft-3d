import { describe, expect, test } from 'vitest';
import { addFloor, createBuildingFromDims, type Building } from './building';
import type { Doc } from './doc';
import { computeEstimate } from './estimate';
import { placeFixture } from './fixtures';
import { addPolyline, emptyNetwork } from './network';
import { materialSummary } from './materialSummary';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const W = { system: 'water' as const, diameter: 20, material: 'HIVP' };
const D = { system: 'sewage' as const, diameter: 100, material: 'VU' };

function site(floors = 1): Doc {
  const building: Building = createBuildingFromDims({ width: 8000, depth: 6000, floors, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  let doc: Doc = { building, network: emptyNetwork(), fixtures: {}, site: { designGL: -300 } };
  let net = addPolyline(emptyNetwork(), [v(-2000, 1000, -900), v(-500, 1000, -900)], W).net; // 地中 1.5m
  net = addPolyline(net, [v(1000, 1000, -400), v(3000, 1000, -400)], W).net; // 床下 2m
  net = addPolyline(net, [v(3000, 2000, 200), v(5000, 2000, 200)], W).net; // 屋内 2m
  net = addPolyline(net, [v(-3000, 4000, -100), v(-1000, 4000, -100)], W).net; // 屋外（地面より上）2m
  net = addPolyline(net, [v(-500, 3000, -700), v(-4500, 3000, -700)], D).net; // 排水 地中 4m
  doc = { ...doc, network: net };
  const f = doc.building.floors[0].id;
  doc = placeFixture(doc, f, 'toilet', { x: 2000, y: 4000 }).doc;
  doc = placeFixture(doc, f, 'manholeSewage', { x: -2000, y: 3000 }).doc;
  return doc;
}
const row = (s: ReturnType<typeof materialSummary>, title: string, name: string) => s.sections.find((x) => x.title === title)?.items.find((i) => `${i.name} ${i.spec}`.includes(name));

describe('材料集計表', () => {
  test('屋内・床下・屋外・地中に分けて、管の長さ（m）を集計。計は積算と一致', () => {
    const doc = site();
    const s = materialSummary(doc, 'place');
    expect(s.columns.map((c) => c.label)).toEqual(['屋内', '床下', '屋外', '地中']);
    const w = row(s, '給水・給湯', 'HIVP')!;
    expect(w.unit).toBe('m');
    expect(w.qty).toMatchObject({ indoor: 2, under: 2, outdoor: 2, buried: 1.5 });
    expect(w.total).toBeCloseTo(7.5, 6);
    const est = computeEstimate(doc);
    const estWater = est.pipes.filter((p) => p.system === 'water').reduce((a, p) => a + p.usedLength, 0) / 1000;
    expect(w.total).toBeCloseTo(estWater, 6);
    expect(row(s, '排水・通気', 'VU')!.qty).toMatchObject({ buried: 4 });
    expect(row(s, '排水・通気', '汚水マス')).toMatchObject({ unit: '個', total: 1, qty: { outdoor: 1 } });
    expect(row(s, '器具', 'トイレ')).toMatchObject({ unit: '台', total: 1, qty: { indoor: 1 } });
  });
  test('階ごと: 2 階の管は 2 階の列、床下・地中は別の列', () => {
    const doc = site(2);
    doc.network = addPolyline(doc.network, [v(1000, 5000, 3200), v(4000, 5000, 3200)], W).net; // 2 階 3m
    const s = materialSummary(doc, 'floor');
    expect(s.columns.map((c) => c.label)).toEqual(['床下・地中', doc.building.floors[0].name, doc.building.floors[1].name]);
    const w = row(s, '給水・給湯', 'HIVP')!;
    expect(w.qty[doc.building.floors[1].id]).toBeCloseTo(3, 6);
    expect(w.qty.below).toBeCloseTo(3.5, 6); // 床下 2 + 地中 1.5
  });
  test('新設・既設: 既設の区間・器具は既設の列', () => {
    const doc = site();
    const sid = Object.keys(doc.network.segments)[0];
    doc.network.segments[sid] = { ...doc.network.segments[sid], existing: true };
    const s = materialSummary(doc, 'status');
    expect(s.columns.map((c) => c.label)).toEqual(['新設', '既設']);
    expect(row(s, '給水・給湯', 'HIVP')!.qty).toMatchObject({ new: 6, existing: 1.5 });
  });
  test('配管が無ければ区分は器具だけ／何も無ければ空', () => {
    const empty: Doc = { building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), network: emptyNetwork(), fixtures: {} };
    expect(materialSummary(empty, 'place').sections).toEqual([]);
    void addFloor;
  });
});
