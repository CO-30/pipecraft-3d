import { describe, expect, test } from 'vitest';
import { createBuildingFromDims } from './building';
import { compareDocs } from './compare';
import type { Doc } from './doc';
import { moveFixture, placeFixture } from './fixtures';
import { addPolyline, emptyNetwork, insertValve } from './network';

const v = (x: number, y: number, z = 300) => ({ x, y, z });
const W = { system: 'water' as const, diameter: 20, material: 'HIVP' };

function base(): { doc: Doc; segId: string; fid: string } {
  const building = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  const r = addPolyline(emptyNetwork(), [v(0, 0), v(4000, 0)], W);
  const p = placeFixture({ building, network: r.net, fixtures: {} }, building.floors[0].id, 'washbasin', { x: 6000, y: 3000 });
  return { doc: p.doc, segId: r.segmentIds[0], fid: p.fixtureId! };
}

describe('版との比較', () => {
  test('同じなら差は無い', () => {
    const { doc } = base();
    const c = compareDocs(doc, doc);
    expect(c.segments).toEqual({ added: [], removed: [], removedParts: [], changed: [] });
    expect(c.fixtures).toEqual({ added: [], removed: [], moved: [], changed: [] });
    expect(c.total).toBe(0);
  });

  test('バルブを入れて区間を分けても、形が同じなら変わっていない', () => {
    const { doc, segId } = base();
    const now = { ...doc, network: insertValve(doc.network, segId, v(1500, 0))!.net };
    const c = compareDocs(doc, now);
    expect(c.segments.added).toEqual([]);
    expect(c.segments.removed).toEqual([]);
    expect(c.lengths.find((l) => l.system === 'water')).toMatchObject({ before: 4000, after: 4000 });
  });

  test('足した管は増えた、消した管はなくなった、口径を変えた管は変わった', () => {
    const { doc, segId } = base();
    const more = addPolyline(doc.network, [v(4000, 0), v(4000, 2000)], W, { startNodeId: doc.network.segments[segId].b });
    const now: Doc = { ...doc, network: { ...more.net, segments: { ...more.net.segments, [segId]: { ...more.net.segments[segId], diameter: 25 } } } };
    const c = compareDocs(doc, now);
    expect(c.segments.added).toEqual(more.segmentIds);
    expect(c.segments.changed).toEqual([{ id: segId, oldId: segId, what: ['口径 φ20→φ25'] }]);
    expect(c.lengths.find((l) => l.system === 'water')).toMatchObject({ before: 4000, after: 6000 });
    const back = compareDocs(now, doc);
    expect(back.segments.removed).toEqual(more.segmentIds);
  });

  test('器具: 動かした・向きを変えた・足した・消した', () => {
    const { doc, fid } = base();
    let now = moveFixture(doc, fid, { x: 6500, y: 3000 }, 90);
    const p = placeFixture(now, doc.building.floors[0].id, 'toilet', { x: 1000, y: 3000 });
    now = p.doc;
    const c = compareDocs(doc, now);
    expect(c.fixtures.moved).toEqual([{ id: fid, from: { x: 6000, y: 3000 }, what: ['500mm 動いた', '向き 0°→90°'] }]);
    expect(c.fixtures.added).toEqual([p.fixtureId]);
    expect(compareDocs(now, doc).fixtures.removed).toEqual([p.fixtureId]);
    expect(c.total).toBe(2);
  });

  test('建物の違いは数だけ', () => {
    const { doc } = base();
    const walls = { ...doc.building.walls };
    delete walls[Object.keys(walls)[0]];
    const c = compareDocs(doc, { ...doc, building: { ...doc.building, walls } });
    expect(c.building).toEqual({ walls: -1, rooms: 0, openings: 0, changed: true });
  });
});

describe('版との比較（レビューの指摘）', () => {
  const W2 = { system: 'water' as const, diameter: 20, material: 'HIVP' };
  const building = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  const docOf = (net: ReturnType<typeof emptyNetwork>): Doc => ({ building, network: net, fixtures: {} });
  const moveB = (net: ReturnType<typeof emptyNetwork>, segId: string, x: number) => {
    const s = net.segments[segId];
    return { ...net, nodes: { ...net.nodes, [s.b]: { ...net.nodes[s.b], pos: { ...net.nodes[s.b].pos, x } } } };
  };

  test('短くした・延ばした管は「変わった（長さ）」', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0), v(4000, 0)], W2);
    const old = docOf(r.net);
    const short = compareDocs(old, docOf(moveB(r.net, r.segmentIds[0], 500)));
    expect(short.segments.changed).toEqual([{ id: r.segmentIds[0], oldId: r.segmentIds[0], what: ['長さ 4000→500mm'] }]);
    expect(short.total).toBe(1);
    const long = compareDocs(docOf(moveB(r.net, r.segmentIds[0], 1000)), old);
    expect(long.segments.changed[0].what).toEqual(['長さ 1000→4000mm']);
  });

  test('ID の消えた管: 途中を消した所は「なくなった（一部）」、つないで 1 本にした管で口径が違えば「変わった」', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0), v(4000, 0)], W2);
    const a = addPolyline(emptyNetwork(), [v(0, 0), v(1000, 0)], W2), b = addPolyline(a.net, [v(3000, 0), v(4000, 0)], W2);
    const c = compareDocs(docOf(r.net), docOf(b.net));
    expect(c.segments.added).toEqual([]);
    expect(c.segments.removedParts).toHaveLength(1);
    expect(c.segments.removedParts[0]).toMatchObject({ oldId: r.segmentIds[0], length: 2000 });
    expect(c.total).toBe(1);
    // φ20 0–2000 + φ25 2000–4000 → φ20 0–4000
    const o1 = addPolyline(emptyNetwork(), [v(0, 0), v(2000, 0), v(4000, 0)], W2);
    const o2 = { ...o1.net, segments: { ...o1.net.segments, [o1.segmentIds[1]]: { ...o1.net.segments[o1.segmentIds[1]], diameter: 25 } } };
    const m = compareDocs(docOf(o2), docOf(r.net));
    expect(m.segments.changed).toHaveLength(1);
    expect(m.segments.changed[0].what).toContain('口径 φ25→φ20（一部）');
    expect(m.segments.removed).toEqual([]);
  });

  test('排水の高さが計算し直しで変わっても、平面が同じなら変わっていない', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0, -300), v(4000, 0, -400)], { system: 'sewage', diameter: 100, material: 'VU' });
    const s = r.net.segments[r.segmentIds[0]];
    const lowered = { ...r.net, nodes: { ...r.net.nodes, [s.a]: { ...r.net.nodes[s.a], pos: { ...r.net.nodes[s.a].pos, z: -360 } } } };
    expect(compareDocs(docOf(r.net), docOf(lowered)).total).toBe(0);
  });

  test('同じ線の上に描いた別の種類の管は「増えた」', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0), v(4000, 0)], W2);
    const h = addPolyline(r.net, [v(0, 0), v(4000, 0)], { system: 'hotWater', diameter: 20, material: 'HTVP' });
    expect(compareDocs(docOf(r.net), docOf(h.net)).segments.added).toEqual(h.segmentIds);
  });

  test('種類を変えて動かした器具は 1 つと数える', () => {
    const { doc, fid } = base();
    const f = doc.fixtures[fid];
    const now = { ...doc, fixtures: { ...doc.fixtures, [fid]: { ...f, x: f.x + 500, type: 'kitchen' as const } } };
    const c = compareDocs(doc, now);
    expect(c.fixtures.moved).toHaveLength(1);
    expect(c.fixtures.moved[0].what).toEqual(['洗面台→キッチン', '500mm 動いた']);
    expect(c.fixtures.changed).toEqual([]);
    expect(c.total).toBe(1);
  });

  test('1000 区間どうしでも速い（同じ ID は ID で比べる）', () => {
    let net = emptyNetwork();
    for (let i = 0; i < 1000; i++) net = addPolyline(net, [v((i % 40) * 200, Math.floor(i / 40) * 200), v((i % 40) * 200 + 150, Math.floor(i / 40) * 200)], W2).net;
    const t0 = performance.now();
    expect(compareDocs(docOf(net), docOf(net)).total).toBe(0);
    expect(performance.now() - t0).toBeLessThan(150);
  });
});
