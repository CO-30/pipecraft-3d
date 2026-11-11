/** 床下の排水の自動勾配（土間を起点に器具へ 2/100、足りなければ 1.5/100）とレベルバンド */
import { describe, expect, it } from 'vitest';
import { emptyDoc } from '../state/store';
import type { Doc } from './doc';
import { dropFixturePipes } from './dropPipes';
import { placeFixture, portNodes } from './fixtures';
import { addPolyline, segmentsAt, validateNetwork, type Network, type SegmentAttrs } from './network';
import { addFloor, addWall, emptyBuilding, type Building } from './building';
import { buildFromSheets } from './planRead/assemble';
import { foundationSheet, planSheet } from './planRead/testHouse';
import { bandHeight, slopeUnderfloor, underfloorLevels, underfloorRatio } from './underfloorSlope';
import { computeSupports, defaultSupportSettings, supportKindOf } from './supports';
import { computeEstimate, defaultEstimate } from './estimate';

const D100: SegmentAttrs = { system: 'sewage', diameter: 100 };
const v = (x: number, y: number, z: number) => ({ x, y, z });

/** 床 1 枚（FL=0）・土間 FL−550・基礎の立上りなし（管頂の上限は FL−150）。walls: 西の外壁 x=0 */
function plain(walls = false): Doc {
  const f = addFloor(emptyBuilding(), { height: 2900 });
  let b: Building = { ...f.b, foundation: { slabTop: -550 } };
  if (walls) b = addWall(b, f.floorId, { x: 0, y: -5000 }, { x: 0, y: 5000 }, { kind: 'exterior' }).b;
  return { ...emptyDoc(), building: b };
}
const zs = (net: Network) => Object.values(net.nodes).map((n) => n.pos.z);

describe('床下の排水の自動勾配（slopeUnderfloor）', () => {
  it('高さの基準: 土間＝スラブ天端、管頂の上限＝基礎天端（立上りが無ければ FL−150）、土間が無ければ FL−500', () => {
    const r = buildFromSheets([{ name: 'a', page: planSheet() }, { name: 'b', page: foundationSheet() }]);
    expect(underfloorLevels(r)).toMatchObject({ floor: 0, slab: -550, top: -200, slabKnown: true });
    expect(underfloorLevels(plain())).toMatchObject({ slab: -550, top: -150 });
    const nf = addFloor(emptyBuilding()).b;
    expect(underfloorLevels({ building: nf })).toMatchObject({ slab: -500, slabKnown: false });
  });

  it('勾配: 標準 2/100、足りなければ 1.5/100。自治体の最小勾配・管径別の最小勾配が急ならそちら', () => {
    expect(underfloorRatio(100)).toBe(0.02);
    expect(underfloorRatio(100, {}, true)).toBe(0.015);
    expect(underfloorRatio(75, { slopeFor: (d) => (d <= 75 ? 0.03 : 0.02) })).toBe(0.03);
    expect(underfloorRatio(100, { slopeFor: () => 0.02 }, true)).toBe(0.02);
    expect(underfloorRatio(40, {}, true)).toBe(1 / 50); // φ65 以下は 1/50 が最小
  });

  it('描いた床下の排水: 外壁に近い端（起点）の管底を土間に置き、そこから 2/100 で上げる', () => {
    let doc = plain(true);
    const r = addPolyline(doc.network, [v(500, 0, -305), v(4500, 0, -305)], D100);
    doc = { ...doc, network: r.net };
    const out = slopeUnderfloor(doc);
    expect(out).toMatchObject({ systems: 1, low: 0, over: 0, failed: 0 });
    const [a, b] = r.nodeIds.map((id) => out.net.nodes[id].pos.z);
    expect(a).toBe(-550); // 外壁（x=0）に近い端 = 土間
    expect(b).toBeCloseTo(-550 + 4000 * 0.02, 1);
    expect(out.net.segments[r.segmentIds[0]].slope).toBe(0.02);
    expect(validateNetwork(out.net)).toEqual([]);
  });

  it('床下の高さが足りない系統は 1.5/100 に下げ、それでも足りなければ知らせる', () => {
    let doc = plain(true);
    // 2/100 で 16m 上がると 320 → 管頂 −550+320+114 = −116 が上限 −150 を超える。1.5/100 なら 240 → −196
    const r = addPolyline(doc.network, [v(500, 0, -300), v(16500, 0, -300)], D100);
    doc = { ...doc, network: r.net };
    const out = slopeUnderfloor(doc);
    expect(out).toMatchObject({ systems: 1, low: 1, over: 0 });
    expect(out.net.nodes[r.nodeIds[1]].pos.z).toBeCloseTo(-550 + 16000 * 0.015, 1);
    const long = addPolyline(plain(true).network, [v(500, 0, -300), v(30500, 0, -300)], D100);
    expect(slopeUnderfloor({ ...plain(true), network: long.net })).toMatchObject({ low: 1, over: 1 });
  });

  it('分岐も起点から各器具の方へ上がる（途中に逆勾配が無い）。床より上・土間より下の配管は触らない', () => {
    let doc = plain(true);
    const main = addPolyline(doc.network, [v(500, 0, -300), v(3000, 0, -300), v(6000, 0, -300)], D100);
    const br = addPolyline(main.net, [v(3000, 0, -300), v(3000, 2000, -300)], { system: 'drain', diameter: 50 }, { startNodeId: main.nodeIds[1] });
    const above = addPolyline(br.net, [v(500, 3000, 100), v(3000, 3000, 100)], { system: 'drain', diameter: 50 });
    doc = { ...doc, network: above.net };
    const out = slopeUnderfloor(doc);
    expect(out.systems).toBe(1);
    const z = (id: string) => out.net.nodes[id].pos.z;
    expect(z(main.nodeIds[0])).toBe(-550);
    expect(z(main.nodeIds[1])).toBeCloseTo(-500, 1);
    expect(z(main.nodeIds[2])).toBeCloseTo(-440, 1);
    // φ50 の枝は 1/50（= 2/100）で上がる
    expect(z(br.nodeIds[1])).toBeCloseTo(-500 + 2000 * 0.02, 1);
    expect(z(above.nodeIds[0])).toBe(100);
  });

  it('マス・地中へ下がる配管につながっていれば、その点が起点。マスが浅ければ起点をマスより上にして知らせる', () => {
    let doc = plain(true);
    const m = placeFixture(doc, doc.building.floors[0].id, 'manholeSewage', { x: -700, y: 0 });
    doc = m.doc;
    const port = portNodes(doc.network, m.fixtureId!)[0];
    // マス ← 地中（斜めに下がる）← 床下の点 x=300 ← 器具側 x=4300
    const r = addPolyline(doc.network, [v(4300, 0, -300), v(300, 0, -300), v(-200, 0, port.pos.z + 20)], D100, { endNodeId: port.id });
    doc = { ...doc, network: r.net };
    const out = slopeUnderfloor(doc);
    expect(out).toMatchObject({ systems: 1, raised: 0 });
    expect(out.net.nodes[r.nodeIds[1]].pos.z).toBe(-550);
    expect(out.net.nodes[r.nodeIds[0]].pos.z).toBeCloseTo(-550 + 4000 * 0.02, 1);
    expect(out.net.nodes[port.id].pos.z).toBe(port.pos.z); // マスは動かさない
  });

  it('器具から落とした立て管の下の端につながる配管: 器具の接続口は動かさず、立て管の長さが変わる', () => {
    const r0 = buildFromSheets([{ name: 'a', page: planSheet() }, { name: 'b', page: foundationSheet() }]);
    let doc: Doc = { ...emptyDoc(), building: r0.building, site: { designGL: -600 } };
    doc = dropFixturePipes(placeFixture(doc, r0.building.floors[0].id, 'toilet', { x: 1000, y: 4500 }).doc).doc;
    const bottom = Object.values(doc.network.nodes).find((n) => !n.fixtureId && Math.abs(n.pos.z + 300) < 1 && segmentsAt(doc.network, n.id).some((s) => s.system === 'sewage'))!;
    const portBefore = Object.values(doc.network.nodes).filter((n) => n.fixtureId).map((n) => n.pos.z);
    // 立て管の下の端から北の外壁（y = 5460 付近）の外まで描く
    const r = addPolyline(doc.network, [bottom.pos, v(1000, 6000, -300)], { system: 'sewage', diameter: 75 }, { startNodeId: bottom.id });
    doc = { ...doc, network: r.net };
    const out = slopeUnderfloor(doc, {}, r.nodeIds);
    expect(out.systems).toBe(1);
    expect(out.net.nodes[r.nodeIds.at(-1)!].pos.z).toBe(-550);
    expect(out.net.nodes[bottom.id].pos.z).toBeCloseTo(-550 + 1450 * 0.02, 1);
    expect(Object.values(out.net.nodes).filter((n) => n.fixtureId).map((n) => n.pos.z)).toEqual(portBefore);
    expect(Math.max(...zs(out.net).filter((z) => z < 0))).toBeLessThan(0);
  });

  it('床下の排水の横管はレベルバンドで支持し、支持点の土間からの高さが分かる', () => {
    let doc = plain(true);
    const r = addPolyline(doc.network, [v(500, 0, -300), v(4500, 0, -300)], D100);
    doc = { ...doc, network: slopeUnderfloor({ ...doc, network: r.net }).net };
    const s = doc.network.segments[r.segmentIds[0]];
    expect(supportKindOf(doc, s)).toBe('levelBand');
    expect(bandHeight(doc, s, -550 + 40)).toBe(40);
    const e = computeEstimate({ ...doc, estimate: defaultEstimate() });
    const sup = computeSupports(doc, defaultSupportSettings(), e.measures, new Set());
    expect(sup.supports).toEqual([expect.objectContaining({ kind: 'levelBand', diameter: 100, count: 2, maxHeight: 60 })]);
    expect(sup.marks.every((m) => m.kind === 'levelBand' && m.height !== undefined)).toBe(true);
  });
});

describe('床下の排水の自動勾配: 建物の外の管', () => {
  /** 8000 × 6000 の外壁で囲んだ家 */
  function boxed(): Doc {
    const f = addFloor(emptyBuilding(), { height: 2900 });
    let b: Building = { ...f.b, foundation: { slabTop: -550 } };
    const P = [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 }];
    for (let i = 0; i < 4; i++) b = addWall(b, f.floorId, P[i], P[(i + 1) % 4], { kind: 'exterior' }).b;
    return { ...emptyDoc(), building: b };
  }
  it('外だけを通る浅い管は床下とみなさず動かさない。外壁をまたいだ所が起点で、外の管より上に置いて知らせる', () => {
    let doc = boxed();
    const out = addPolyline(doc.network, [v(-8000, 3000, -500), v(-1000, 3000, -500)], D100);
    const inn = addPolyline(out.net, [v(-1000, 3000, -500), v(4000, 3000, -500)], D100, { startNodeId: out.nodeIds[1] });
    doc = { ...doc, network: inn.net };
    const r = slopeUnderfloor(doc);
    expect(r).toMatchObject({ systems: 1, raised: 1 });
    expect(r.net.nodes[out.nodeIds[0]].pos.z).toBe(-500); // 外の端はそのまま
    expect(r.net.nodes[out.nodeIds[1]].pos.z).toBe(-450); // 起点 = 外の管 + 50
    expect(r.net.nodes[inn.nodeIds[1]].pos.z).toBeCloseTo(-450 + 5000 * 0.02, 1); // 家の中の端が上流
  });
});
