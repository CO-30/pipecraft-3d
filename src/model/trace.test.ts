import { describe, expect, test } from 'vitest';
import { createBuildingFromDims } from './building';
import type { Doc } from './doc';
import { placeFixture, portNodes } from './fixtures';
import { addPolyline, emptyNetwork, insertValve, type Network } from './network';
import { traceFrom, traceSeed, traceSystem } from './trace';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const W = { system: 'water' as const, diameter: 20 };
const W13 = { system: 'water' as const, diameter: 13 };

function base(): Doc {
  const building = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  return { building, network: emptyNetwork(), fixtures: {}, site: {} };
}
const port = (doc: Doc, fid: string, portId: string) => portNodes(doc.network, fid).find((n) => n.portId === portId)!.id;
const withNet = (doc: Doc, network: Network): Doc => ({ ...doc, network });

describe('系統をたどる', () => {
  test('同じ種類の管はたどり、種類が変わる所（給水 → 給湯）で止まる', () => {
    const r0 = addPolyline(emptyNetwork(), [v(0, 0), v(1000, 0), v(1000, 1000)], W);
    const net = addPolyline(r0.net, [v(1000, 1000), v(2000, 1000)], { system: 'hotWater', diameter: 13 }, { startNodeId: r0.nodeIds[2] }).net;
    const doc = withNet(base(), net);
    const first = Object.values(net.segments).find((s) => s.system === 'water')!;
    const t = traceSystem(doc, first.id)!;
    expect(t.family).toBe('water');
    expect(t.segmentIds).toHaveLength(2);
    expect(t.totalLength).toBeCloseTo(2000, 6);
  });

  test('汚水と雑排水は 1 つの排水系統として続く。通気は別', () => {
    const r0 = addPolyline(emptyNetwork(), [v(0, 0), v(1000, 0)], { system: 'drain', diameter: 50 });
    const j = r0.nodeIds[1];
    let net = addPolyline(r0.net, [v(1000, 0), v(3000, 0)], { system: 'sewage', diameter: 100 }, { startNodeId: j }).net;
    net = addPolyline(net, [v(1000, 0), v(1000, 0, 2000)], { system: 'vent', diameter: 50 }, { startNodeId: j }).net;
    const doc = withNet(base(), net);
    const d = Object.values(net.segments).find((s) => s.system === 'drain')!;
    const t = traceSystem(doc, d.id)!;
    expect(t.family).toBe('drain');
    expect(t.segmentIds).toHaveLength(2);
    expect(t.byDiameter).toEqual([{ diameter: 100, length: 2000 }, { diameter: 50, length: 1000 }]);
  });

  test('メーター・ヘッダーは通り抜けて先の器具まで。給湯器は給水と給湯で止まる。届いた器具も入る', () => {
    let doc = base();
    const f = doc.building.floors[0].id;
    let r = placeFixture(doc, f, 'waterMeter', { x: -3000, y: 0 }); doc = r.doc; const meter = r.fixtureId!;
    r = placeFixture(doc, f, 'waterHeader', { x: 0, y: 0 }); doc = r.doc; const header = r.fixtureId!;
    r = placeFixture(doc, f, 'washbasin', { x: 2000, y: 2000 }); doc = r.doc; const basin = r.fixtureId!;
    r = placeFixture(doc, f, 'waterHeater', { x: -1000, y: 3000 }); doc = r.doc; const heater = r.fixtureId!;
    const nd = (id: string) => doc.network.nodes[id].pos;
    let net = doc.network;
    const feed = addPolyline(net, [v(-5000, 0), nd(port(doc, meter, 'in'))], W, { endNodeId: port(doc, meter, 'in') });
    net = feed.net;
    net = addPolyline(net, [nd(port(doc, meter, 'out')), nd(port(doc, header, 'in'))], W, { startNodeId: port(doc, meter, 'out'), endNodeId: port(doc, header, 'in') }).net;
    net = addPolyline(net, [nd(port(doc, header, 'out1')), nd(port(doc, basin, 'water'))], W13, { startNodeId: port(doc, header, 'out1'), endNodeId: port(doc, basin, 'water') }).net;
    net = addPolyline(net, [nd(port(doc, header, 'out2')), nd(port(doc, heater, 'in'))], W13, { startNodeId: port(doc, header, 'out2'), endNodeId: port(doc, heater, 'in') }).net;
    const hot = addPolyline(net, [nd(port(doc, heater, 'out')), nd(port(doc, basin, 'hot'))], { system: 'hotWater', diameter: 13 }, { startNodeId: port(doc, heater, 'out'), endNodeId: port(doc, basin, 'hot') });
    net = hot.net;
    doc = withNet(doc, net);
    const t = traceSystem(doc, feed.segmentIds[0])!;
    expect(t.segmentIds).toHaveLength(4);
    expect(new Set(t.fixtureIds)).toEqual(new Set([meter, header, basin, heater]));
    expect(t.fixtureCount).toBe(4);
    const h = traceSystem(doc, hot.segmentIds[0])!;
    expect(h.family).toBe('hotWater');
    expect(h.segmentIds).toHaveLength(1);
    expect(new Set(h.fixtureIds)).toEqual(new Set([heater, basin]));
  });

  test('長さは実測があれば実測。バルブの数も数える', () => {
    let net = addPolyline(emptyNetwork(), [v(0, 0), v(2000, 0)], W).net;
    const sid = Object.keys(net.segments)[0];
    net = insertValve(net, sid, v(500, 0))!.net;
    const ids = Object.keys(net.segments);
    net = { ...net, segments: { ...net.segments, [ids[0]]: { ...net.segments[ids[0]], measuredLength: 800 } } };
    const doc = withNet(base(), net);
    const t = traceSystem(doc, ids[1])!;
    expect(t.valveCount).toBe(1);
    const other = ids[1];
    const otherLen = Math.hypot(net.nodes[net.segments[other].a].pos.x - net.nodes[net.segments[other].b].pos.x, 0);
    expect(t.totalLength).toBeCloseTo(800 + otherLen, 6);
  });

  test('無い区間は null', () => {
    expect(traceSystem(base(), 'nope')).toBeNull();
  });

  test('たどり始めた管を分けても（バルブ・分岐）、残った端からたどり続ける', () => {
    const r0 = addPolyline(emptyNetwork(), [v(0, 0), v(2000, 0), v(2000, 2000)], W);
    const seed = traceSeed(withNet(base(), r0.net), r0.segmentIds[0])!;
    const net = insertValve(r0.net, r0.segmentIds[0], v(700, 0))!.net;
    expect(net.segments[r0.segmentIds[0]]).toBeUndefined();
    const t = traceFrom(withNet(base(), net), seed)!;
    expect(t.segmentIds).toHaveLength(3);
    expect(t.valveCount).toBe(1);
  });

  test('マス（1 つの点に汚水・雑排水）は通り抜け、通気は入れない。雨水だけなら雨水', () => {
    let doc = base();
    const f = doc.building.floors[0].id;
    let r = placeFixture(doc, f, 'manholeSewage', { x: 0, y: -2000 }); doc = r.doc; const mh = r.fixtureId!;
    const p = doc.network.nodes[port(doc, mh, 'pipe')];
    let net = addPolyline(doc.network, [v(-3000, -2000, p.pos.z), p.pos], { system: 'drain', diameter: 75 }, { endNodeId: p.id }).net;
    net = addPolyline(net, [p.pos, v(3000, -2000, p.pos.z - 50)], { system: 'sewage', diameter: 100 }, { startNodeId: p.id }).net;
    const vent = addPolyline(net, [p.pos, v(0, -2000, 3000)], { system: 'vent', diameter: 50 }, { startNodeId: p.id });
    doc = withNet(doc, vent.net);
    const first = Object.values(doc.network.segments).find((s) => s.system === 'drain')!;
    const t = traceSystem(doc, first.id)!;
    expect(t.segmentIds).toHaveLength(2);
    expect(t.counts).toEqual({ fixtures: 0, manholes: 1, equipment: 0 });
    expect(t.label).toBe('排水（汚水・雑排水）');

    let rd = base();
    r = placeFixture(rd, rd.building.floors[0].id, 'manholeRain', { x: 0, y: 0 }); rd = r.doc;
    const q = rd.network.nodes[port(rd, r.fixtureId!, 'pipe')];
    const rain = addPolyline(rd.network, [v(-2000, 0, q.pos.z), q.pos], { system: 'drain', diameter: 100 }, { endNodeId: q.id });
    expect(traceSystem(withNet(rd, rain.net), rain.segmentIds[0])!.label).toBe('雨水');
  });
});
