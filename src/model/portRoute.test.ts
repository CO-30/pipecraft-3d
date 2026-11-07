import { describe, expect, it } from 'vitest';
import { addFloor, emptyBuilding } from './building';
import type { Doc } from './doc';
import { addPolyline, emptyNetwork } from './network';
import { placeFixture } from './fixtures';
import { portCandidates, routeToPort } from './portRoute';

function house(): { doc: Doc; meter: string; tank: string; toilet: string } {
  let b = addFloor(emptyBuilding(), { height: 2900 }).b;
  b = addFloor(b, { height: 2900 }).b;
  let doc: Doc = { building: b, network: emptyNetwork(), fixtures: {} };
  let r = placeFixture(doc, b.floors[0].id, 'waterMeter', { x: -1000, y: 3000 }); doc = r.doc; const meter = r.fixtureId!;
  r = placeFixture(doc, b.floors[1].id, 'roofTank', { x: 4000, y: 3500 }); doc = r.doc; const tank = r.fixtureId!;
  r = placeFixture(doc, b.floors[0].id, 'toilet', { x: 1000, y: 1000 }); doc = r.doc; const toilet = r.fixtureId!;
  return { doc, meter, tank, toilet };
}
const port = (d: Doc, f: string, p: string) => Object.values(d.network.nodes).find((n) => n.fixtureId === f && n.portId === p)!;

describe('器具の接続口へつなぐ（候補とルート）', () => {
  it('メーター出口の候補: つながっていない給水の接続口（別の階も）を近い順。自分の器具・汚水は除く', () => {
    const { doc, meter, tank, toilet } = house();
    const c = portCandidates(doc, port(doc, meter, 'out').id);
    const ids = c.map((x) => x.nodeId);
    expect(ids).toContain(port(doc, tank, 'in').id);
    expect(ids).toContain(port(doc, toilet, 'water').id);
    expect(ids).not.toContain(port(doc, toilet, 'sewage').id);
    expect(ids).not.toContain(port(doc, meter, 'in').id);
    expect(c[0].label).toMatch(/屋上タンク|トイレ/);
  });
  it('つながっている接続口・途中の点は候補にならない／配管の端からも探せる', () => {
    const { doc, meter, toilet } = house();
    const tw = port(doc, toilet, 'water');
    const net = addPolyline(doc.network, [tw.pos, { ...tw.pos, x: tw.pos.x + 1000 }], { system: 'water', diameter: 20 }, { startNodeId: tw.id }).net;
    const d2 = { ...doc, network: net };
    const end = Object.values(net.nodes).find((n) => !n.fixtureId && Object.values(net.segments).some((s) => s.a === n.id || s.b === n.id))!;
    const ids = portCandidates(d2, end.id).map((x) => x.nodeId);
    expect(ids).not.toContain(tw.id);
    expect(ids).toContain(port(d2, meter, 'out').id);
  });
  it('ルート: 始点で上下 → 平面で L 字 → 接続口。すべて水平か垂直', () => {
    const { doc, meter, tank } = house();
    const a = port(doc, meter, 'out').pos, b = port(doc, tank, 'in').pos;
    const pts = routeToPort(a, b);
    expect(pts[0]).toEqual(a);
    expect(pts.at(-1)).toEqual(b);
    expect(pts[1]).toEqual({ x: a.x, y: a.y, z: b.z });
    for (let i = 1; i < pts.length; i++) {
      const changed = ['x', 'y', 'z'].filter((k) => pts[i][k as 'x'] !== pts[i - 1][k as 'x']);
      expect(changed.length).toBe(1);
    }
  });
  it('同じ高さ・一直線なら余分な点を作らない', () => {
    expect(routeToPort({ x: 0, y: 0, z: 100 }, { x: 1000, y: 0, z: 100 })).toEqual([{ x: 0, y: 0, z: 100 }, { x: 1000, y: 0, z: 100 }]);
  });
});

describe('レビュー対応: 同じ器具・向き', () => {
  it('メーター出口から描いた配管の端からは、メーター自身の入口を候補にしない', () => {
    const { doc, meter } = house();
    const mo = port(doc, meter, 'out');
    const net = addPolyline(doc.network, [mo.pos, { ...mo.pos, x: mo.pos.x + 800 }], { system: 'water', diameter: 20 }, { startNodeId: mo.id }).net;
    const d2 = { ...doc, network: net };
    const end = Object.values(net.nodes).find((n) => !n.fixtureId && Object.values(net.segments).some((s) => s.a === n.id || s.b === n.id))!;
    expect(portCandidates(d2, end.id).map((c) => c.nodeId)).not.toContain(port(d2, meter, 'in').id);
  });
  it('出口（供給側）からは別の出口を候補にしない。入口からは器具の給水口を候補にしない', () => {
    const { doc, meter, tank, toilet } = house();
    const fromTankOut = portCandidates(doc, port(doc, tank, 'out').id).map((c) => c.nodeId);
    expect(fromTankOut).not.toContain(port(doc, meter, 'out').id);
    expect(fromTankOut).toContain(port(doc, toilet, 'water').id);
    const fromTankIn = portCandidates(doc, port(doc, tank, 'in').id).map((c) => c.nodeId);
    expect(fromTankIn).toContain(port(doc, meter, 'out').id);
    expect(fromTankIn).not.toContain(port(doc, toilet, 'water').id);
    expect(fromTankIn).not.toContain(port(doc, meter, 'in').id);
  });
  it('口径が違う接続口は候補に印をつける', () => {
    const { doc, tank, toilet } = house();
    const c = portCandidates(doc, port(doc, tank, 'out').id).find((x) => x.nodeId === port(doc, toilet, 'water').id)!;
    expect(c.diameterNote).toBe('φ25→φ13');
  });
});
