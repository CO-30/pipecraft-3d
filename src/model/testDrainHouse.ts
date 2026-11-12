/**
 * テスト用: 器具やマスが近くに固まった排水の現場（トイレ → 短い管 → 汚水マス 2 つ → トラップマス → 6m → 公共桝）。
 * noOverlap.test.ts の crowdedDrain と同じ形（テストのファイルから読むとそのテストも走るため、こちらに置く）。
 */
import { addFloor, emptyBuilding } from './building';
import type { Doc } from './doc';
import { addPolyline, emptyNetwork } from './network';
import { placeFixture, portNodes } from './fixtures';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const S = { system: 'sewage' as const, diameter: 75, material: 'VU' };

export function drainHouse(): { doc: Doc; outlet: string } {
  let doc: Doc = { building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {}, site: { designGL: 0 } };
  const f = doc.building.floors[0].id;
  const put = (type: Parameters<typeof placeFixture>[2], x: number, y: number, z?: number) => {
    const r = placeFixture(doc, f, type, { x, y });
    doc = r.doc;
    const port = portNodes(doc.network, r.fixtureId!).find((n) => n.portId === 'sewage' || n.portId === 'pipe')!;
    if (z !== undefined) {
      const fx = doc.fixtures[r.fixtureId!];
      doc = { ...doc, fixtures: { ...doc.fixtures, [fx.id]: { ...fx, params: { invertZ: z } } }, network: { ...doc.network, nodes: { ...doc.network.nodes, [port.id]: { ...port, pos: { ...port.pos, z } } } } };
    }
    return doc.network.nodes[port.id];
  };
  const t = put('toilet', 0, 0);
  const m1 = put('manholeSewage', 1000, 300, -400);
  const m2 = put('manholeSewage', 1350, 300, -410);
  const m3 = put('manholeTrap', 1700, 300, -420);
  const pub = put('publicSewage', 7700, 300, -600);
  let r = addPolyline(doc.network, [t.pos, v(t.pos.x, t.pos.y, -300), v(100, 300, -300), m1.pos], S, { startNodeId: t.id, endNodeId: m1.id });
  r = addPolyline(r.net, [m1.pos, m2.pos], { ...S, diameter: 100 }, { startNodeId: m1.id, endNodeId: m2.id });
  r = addPolyline(r.net, [m2.pos, m3.pos], { ...S, diameter: 100 }, { startNodeId: m2.id, endNodeId: m3.id });
  r = addPolyline(r.net, [m3.pos, pub.pos], { ...S, diameter: 100 }, { startNodeId: m3.id, endNodeId: pub.id });
  return { doc: { ...doc, network: r.net }, outlet: pub.id };
}
