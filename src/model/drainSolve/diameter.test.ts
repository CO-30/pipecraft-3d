/** 管径の自動決定（器具排水負荷単位・器具の接続口・屋外 φ100） */
import { describe, expect, it } from 'vitest';
import type { Doc } from '../doc';
import { placeFixture, portNodes, type FixtureType } from '../fixtures';
import { addPolyline, type Network, type SegmentAttrs } from '../network';
import { autoDiameters, diameterForUnits, FIXTURE_UNITS } from './diameter';
import { testSite } from './testSite';

const v = (x: number, y: number, z: number) => ({ x, y, z });
const D20: SegmentAttrs = { system: 'drain', diameter: 20 };

/** 公共ます ← 屋外（地中）← 外壁の外 ← 床下の本管 x=300..6000（y=3000）。器具は本管の北に置き、立て管と枝でつなぐ */
function house(types: FixtureType[]): { doc: Doc; outdoor: string; main: string[]; branches: string[] } {
  const { doc: d0, pub, floorId } = testSite();
  let doc = d0;
  const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-700, 3000, -900), v(-700, 3000, -500)], D20, { startNodeId: pub });
  const outdoor = r.segmentIds[0];
  let net: Network = r.net;
  let tail = r.nodeIds.at(-1)!;
  const main: string[] = [], branches: string[] = [];
  types.forEach((t, i) => {
    const x = 1000 + i * 1200;
    const m = addPolyline(net, [net.nodes[tail].pos, v(x, 3000, -500)], D20, { startNodeId: tail });
    main.push(...m.segmentIds);
    net = m.net; tail = m.nodeIds.at(-1)!;
    const f = placeFixture({ ...doc, network: net }, floorId, t, { x, y: 4500 });
    doc = f.doc; net = f.doc.network;
    const port = portNodes(net, f.fixtureId!).find((p) => p.portId === 'sewage' || p.portId === 'drain')!;
    const b = addPolyline(net, [net.nodes[tail].pos, v(port.pos.x, port.pos.y, -500), port.pos], D20, { startNodeId: tail, endNodeId: port.id });
    branches.push(b.segmentIds[0]);
    net = b.net;
  });
  return { doc: { ...doc, network: net }, outdoor, main, branches };
}
const dia = (doc: Doc, id: string) => doc.network.segments[id].diameter;

describe('管径の自動決定（autoDiameters）', () => {
  it('負荷単位の表（HASS 206 の排水横枝管）', () => {
    expect(diameterForUnits(1)).toBe(40);
    expect(diameterForUnits(3)).toBe(40);
    expect(diameterForUnits(4)).toBe(50);
    expect(diameterForUnits(12)).toBe(65);
    expect(diameterForUnits(20)).toBe(75);
    expect(diameterForUnits(21)).toBe(100);
    expect(FIXTURE_UNITS.toilet).toBe(4);
  });

  it('洗面台の枝は φ40、トイレの枝は φ75、合流後はトイレ以上、屋外は φ100。下流ほど細くならない', () => {
    const h = house(['washbasin', 'toilet']);
    const out = autoDiameters(h.doc);
    expect(dia(out, h.branches[0])).toBe(40);
    expect(dia(out, h.branches[1])).toBe(75);
    expect(dia(out, h.main[1])).toBe(75); // トイレの分岐まで
    expect(dia(out, h.main[0])).toBe(75);
    expect(dia(out, h.outdoor)).toBe(100);
  });

  it('キッチン（φ50）と洗面台（φ40）: 負荷 3 でも接続口の φ50 以上', () => {
    const h = house(['washbasin', 'kitchen']);
    const out = autoDiameters(h.doc);
    expect(dia(out, h.main[0])).toBe(50);
    expect(dia(out, h.branches[0])).toBe(40);
  });

  it('負荷の合計が 20 を超えると屋内も φ100', () => {
    const h = house(['toilet', 'toilet', 'toilet', 'kitchen', 'bathtub', 'washer', 'washbasin', 'shower']);
    const out = autoDiameters(h.doc);
    expect(dia(out, h.main[0])).toBe(100);
  });

  it('手で決めた管径（📌）は変えない。器具につながっていない管はそのまま', () => {
    const h = house(['washbasin']);
    const net = { ...h.doc.network, segments: { ...h.doc.network.segments, [h.branches[0]]: { ...h.doc.network.segments[h.branches[0]], diameter: 50, diameterPin: true } } };
    const out = autoDiameters({ ...h.doc, network: net });
    expect(dia(out, h.branches[0])).toBe(50);
    expect(dia(out, h.main[0])).toBe(50); // 上流の固定した管径以上
    const { doc } = testSite();
    const lone = addPolyline(doc.network, [v(1000, 1000, -500), v(3000, 1000, -500)], D20);
    expect(dia(autoDiameters({ ...doc, network: lone.net }), lone.segmentIds[0])).toBe(20);
  });

  it('変わらなければ同じ doc', () => {
    const h = house(['washbasin']);
    const once = autoDiameters(h.doc);
    expect(autoDiameters(once)).toBe(once);
  });
});

describe('管径の自動決定: 細くはしない', () => {
  it('描いた・以前の工事の太い管径（φ125）は細くしない', () => {
    const h = house(['toilet']);
    const segs = Object.fromEntries(Object.entries(h.doc.network.segments).map(([id, s]) => [id, { ...s, diameter: 125 }]));
    const out = autoDiameters({ ...h.doc, network: { ...h.doc.network, segments: segs } });
    expect(dia(out, h.main[0])).toBe(125);
    expect(dia(out, h.branches[0])).toBe(125);
  });
});
