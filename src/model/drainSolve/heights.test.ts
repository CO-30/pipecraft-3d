/** 高さの計算（solveHeights）: 手計算の値で確かめる */
import { describe, expect, it } from 'vitest';
import { emptyDoc } from '../../state/store';
import type { Doc } from '../doc';
import { addFloor, addWall, emptyBuilding, type Building } from '../building';
import { placeFixture, portNodes } from '../fixtures';
import { addPolyline, validateNetwork, type SegmentAttrs } from '../network';
import { BUILTIN_PROFILES } from '../municipality';
import { resolveDrainRules } from '../drainRules';
import { solveHeights } from './heights';

const NAHA = resolveDrainRules(BUILTIN_PROFILES.find((p) => p.id === 'naha')!);
const S: SegmentAttrs = { system: 'sewage', diameter: 100 };
const v = (x: number, y: number, z: number) => ({ x, y, z });

/** 8000 × 6000 の外壁で囲んだ平屋（FL 0、土間 −550）。西の外に公共ます（管底 pubZ） */
function site(pubZ = -1200, pubX = -10700): { doc: Doc; pub: string; floorId: string } {
  const f = addFloor(emptyBuilding(), { height: 2900 });
  let b: Building = { ...f.b, foundation: { slabTop: -550 } };
  const P = [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 }];
  for (let i = 0; i < 4; i++) b = addWall(b, f.floorId, P[i], P[(i + 1) % 4], { kind: 'exterior' }).b;
  const p = placeFixture({ ...emptyDoc(), building: b }, f.floorId, 'publicSewage', { x: pubX, y: 3000 }, 0, { invertZ: pubZ });
  return { doc: p.doc, pub: portNodes(p.doc.network, p.fixtureId!)[0].id, floorId: f.floorId };
}
const z = (d: Doc, id: string) => d.network.nodes[id].pos.z;

describe('高さの計算（solveHeights）', () => {
  it('一直線: 公共ますから 2.2/100 で上がり、基礎の外で立ち上げ、床下は土間から 2/100', () => {
    const { doc, pub } = site();
    // 公共ます → 地中の点 B（10m）→ 立ち上げ → 外壁の外 E → 家の中 I（1.7m）
    const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-700, 3000, -900), v(-700, 3000, -300), v(1000, 3000, -300)], S, { startNodeId: pub });
    const [, B, E, I] = r.nodeIds;
    const out = solveHeights({ ...doc, network: r.net }, NAHA);
    expect(z(out.doc, pub)).toBe(-1200);
    expect(z(out.doc, B)).toBeCloseTo(-1200 + 10000 * 0.022, 1);
    expect(z(out.doc, E)).toBe(-550);
    expect(z(out.doc, I)).toBeCloseTo(-550 + 1700 * 0.02, 1);
    expect(out.segSlopes[r.segmentIds[0]]).toBeCloseTo(0.022, 6);
    expect(out.doc.network.segments[r.segmentIds[0]].slope).toBeCloseTo(0.022, 6);
    expect(validateNetwork(out.doc.network)).toEqual([]);
  });

  it('合流あり: マスの流出は公共ますから、流入はどれもマスの管底 + 落差 20 から上がる（深い流入に合わせる）', () => {
    const { doc: d0, pub, floorId } = site();
    const m = placeFixture(d0, floorId, 'manholeSewage', { x: -5700, y: 3000 });
    let doc = m.doc;
    const mh = portNodes(doc.network, m.fixtureId!)[0].id;
    const a = addPolyline(doc.network, [doc.network.nodes[pub].pos, doc.network.nodes[mh].pos], S, { startNodeId: pub, endNodeId: mh });
    const b1 = addPolyline(a.net, [doc.network.nodes[mh].pos, v(-5700, 6000, -900)], S, { startNodeId: mh });
    const b2 = addPolyline(b1.net, [doc.network.nodes[mh].pos, v(-5700, -3000, -700)], S, { startNodeId: mh });
    doc = { ...doc, network: b2.net };
    const out = solveHeights(doc, NAHA);
    const mz = -1200 + 5000 * 0.022;
    expect(z(out.doc, mh)).toBeCloseTo(mz, 1);
    expect(out.doc.fixtures[m.fixtureId!].params?.invertZ).toBeCloseTo(mz, 1);
    expect(out.doc.network.nodes[mh].dropIn).toBe(20);
    expect(z(out.doc, b1.nodeIds.at(-1)!)).toBeCloseTo(mz + 20 + 3000 * 0.022, 1);
    expect(z(out.doc, b2.nodeIds.at(-1)!)).toBeCloseTo(mz + 20 + 6000 * 0.022, 1);
  });

  it('両端固定で勾配が足りない: 間の区間に割り振る（0.1/100）', () => {
    const { doc, pub } = site(-700);
    const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-700, 3000, -690)], S, { startNodeId: pub });
    const B = r.nodeIds[1];
    const net = { ...r.net, nodes: { ...r.net.nodes, [B]: { ...r.net.nodes[B], zPin: true } } };
    const out = solveHeights({ ...doc, network: net }, NAHA);
    expect(z(out.doc, B)).toBe(-690);
    expect(out.segSlopes[r.segmentIds[0]]).toBeCloseTo(0.001, 6);
  });

  it('急すぎ: 公共ます −2500・固定 −600 の 10m は 19/100 を割り振る（検査で知らせる）', () => {
    const { doc, pub } = site(-2500);
    const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-700, 3000, -600)], S, { startNodeId: pub });
    const B = r.nodeIds[1];
    const net = { ...r.net, nodes: { ...r.net.nodes, [B]: { ...r.net.nodes[B], zPin: true } } };
    expect(solveHeights({ ...doc, network: net }, NAHA).segSlopes[r.segmentIds[0]]).toBeCloseTo(0.19, 6);
  });

  it('手で固定した勾配（3/100）は変えない', () => {
    const { doc, pub } = site();
    const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-700, 3000, -900)], S, { startNodeId: pub });
    const sid = r.segmentIds[0];
    const net = { ...r.net, segments: { ...r.net.segments, [sid]: { ...r.net.segments[sid], slope: 0.03, slopePin: true } } };
    const out = solveHeights({ ...doc, network: net }, NAHA);
    expect(z(out.doc, r.nodeIds[1])).toBeCloseTo(-1200 + 300, 1);
    expect(out.doc.network.segments[sid].slope).toBe(0.03);
  });

  it('マスを足すと流入側が落差 20 上がり、無ければ元どおり', () => {
    const base = site();
    const r0 = addPolyline(base.doc.network, [base.doc.network.nodes[base.pub].pos, v(-700, 3000, -900)], S, { startNodeId: base.pub });
    expect(z(solveHeights({ ...base.doc, network: r0.net }, NAHA).doc, r0.nodeIds[1])).toBeCloseTo(-980, 1);
    const { doc: d0, pub, floorId } = site();
    const m = placeFixture(d0, floorId, 'manholeSewage', { x: -5700, y: 3000 });
    const mh = portNodes(m.doc.network, m.fixtureId!)[0].id;
    const a = addPolyline(m.doc.network, [m.doc.network.nodes[pub].pos, m.doc.network.nodes[mh].pos], S, { startNodeId: pub, endNodeId: mh });
    const b = addPolyline(a.net, [m.doc.network.nodes[mh].pos, v(-700, 3000, -900)], S, { startNodeId: mh });
    expect(z(solveHeights({ ...m.doc, network: b.net }, NAHA).doc, b.nodeIds[1])).toBeCloseTo(-960, 1);
  });

  it('器具の接続口は動かさず、輪があっても止まらない', () => {
    const { doc: d0, pub, floorId } = site();
    const w = placeFixture(d0, floorId, 'washbasin', { x: 1000, y: 3000 });
    const port = portNodes(w.doc.network, w.fixtureId!).find((n) => n.portId === 'drain')!;
    const r = addPolyline(w.doc.network, [w.doc.network.nodes[pub].pos, v(-700, 3000, -900), v(-700, 3000, -300), v(port.pos.x, 3000, -300), port.pos], { system: 'drain', diameter: 50 }, { startNodeId: pub, endNodeId: port.id });
    const out = solveHeights({ ...w.doc, network: r.net }, NAHA);
    expect(z(out.doc, port.id)).toBe(port.pos.z);
    expect(validateNetwork(out.doc.network)).toEqual([]);
    const loop = addPolyline(out.doc.network, [v(-700, 3000, -300), v(-700, 5000, -300), v(port.pos.x, 5000, -300), v(port.pos.x, 3000, -300)].map((p, i) => (i === 0 ? out.doc.network.nodes[r.nodeIds[2]].pos : i === 3 ? out.doc.network.nodes[r.nodeIds[3]].pos : p)), { system: 'drain', diameter: 50 }, { startNodeId: r.nodeIds[2], endNodeId: r.nodeIds[3] });
    const again = solveHeights({ ...out.doc, network: loop.net }, NAHA);
    expect(again.trees.some((t) => t.loops.length > 0)).toBe(true);
    expect(validateNetwork(again.doc.network)).toEqual([]);
  });
});
