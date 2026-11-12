/** 排水の系統の木 */
import { describe, expect, it } from 'vitest';
import { emptyDoc } from '../../state/store';
import type { Doc } from '../doc';
import { placeFixture, portNodes } from '../fixtures';
import { addPolyline, type SegmentAttrs } from '../network';
import { buildDrainTrees } from './tree';

const S: SegmentAttrs = { system: 'sewage', diameter: 100 };
const v = (x: number, y: number, z: number) => ({ x, y, z });

function withManholes(): { doc: Doc; pub: string; mh: string } {
  let doc = emptyDoc();
  const f = doc.building.floors[0].id;
  const p = placeFixture(doc, f, 'publicSewage', { x: 0, y: -3000 }); doc = p.doc;
  const m = placeFixture(doc, f, 'manholeSewage', { x: 5000, y: -3000 }); doc = m.doc;
  return { doc, pub: portNodes(doc.network, p.fixtureId!)[0].id, mh: portNodes(doc.network, m.fixtureId!)[0].id };
}

describe('排水の系統の木（buildDrainTrees）', () => {
  it('一直線: 根は公共ますの接続口、上流の順に並ぶ', () => {
    const { doc: d0, pub, mh } = withManholes();
    const a = addPolyline(d0.network, [d0.network.nodes[pub].pos, d0.network.nodes[mh].pos], S, { startNodeId: pub, endNodeId: mh });
    const b = addPolyline(a.net, [d0.network.nodes[mh].pos, v(5000, 2000, -300)], S, { startNodeId: mh });
    const [t] = buildDrainTrees({ ...d0, network: b.net });
    expect(t.root).toBe(pub);
    expect(t.public).toBe(true);
    expect(t.order).toEqual([pub, mh, b.nodeIds.at(-1)]);
    expect(t.parent.get(mh)).toBe(a.segmentIds[0]);
    expect(t.loops).toEqual([]);
  });
  it('合流ありで同じ木。輪をつくると輪の区間が loops に入る', () => {
    const { doc: d0, pub, mh } = withManholes();
    let r = addPolyline(d0.network, [d0.network.nodes[pub].pos, d0.network.nodes[mh].pos], S, { startNodeId: pub, endNodeId: mh });
    const b1 = addPolyline(r.net, [d0.network.nodes[mh].pos, v(5000, 2000, -300)], S, { startNodeId: mh });
    const b2 = addPolyline(b1.net, [d0.network.nodes[mh].pos, v(8000, -3000, -900)], S, { startNodeId: mh });
    const trees = buildDrainTrees({ ...d0, network: b2.net });
    expect(trees).toHaveLength(1);
    expect(trees[0].order).toHaveLength(4);
    r = addPolyline(b2.net, [v(5000, 2000, -300), v(8000, -3000, -900)], S, { startNodeId: b1.nodeIds.at(-1), endNodeId: b2.nodeIds.at(-1) });
    expect(buildDrainTrees({ ...d0, network: r.net })[0].loops).toHaveLength(1);
  });
  it('公共ますが無ければ、管底のいちばん低いマスが根', () => {
    const { doc: d0, mh } = withManholes();
    const b = addPolyline(d0.network, [d0.network.nodes[mh].pos, v(5000, 2000, -300)], S, { startNodeId: mh });
    const [t] = buildDrainTrees({ ...d0, network: b.net });
    expect(t.root).toBe(mh);
    expect(t.public).toBe(false);
  });
  it('マスも無ければ、いちばん低い端', () => {
    const d0 = emptyDoc();
    const b = addPolyline(d0.network, [v(0, 0, -300), v(3000, 0, -320)], S);
    expect(buildDrainTrees({ ...d0, network: b.net })[0].root).toBe(b.nodeIds[1]);
  });
});
