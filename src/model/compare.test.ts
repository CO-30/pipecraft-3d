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
    expect(c.segments).toEqual({ added: [], removed: [], changed: [] });
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
