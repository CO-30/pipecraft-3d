/**
 * テスト用の給水の現場（川崎市の計算例に近い形）。
 * メーター → 25 で 4.5m → 分岐 F → 20 で 3.5m → 分岐 E → 13 で キッチン（いちばん遠い）・洗面台・トイレ
 *                                     F → 20 → 給湯器（20 L/min）
 */
import { addFloor, emptyBuilding } from '../building';
import type { Doc } from '../doc';
import { placeFixture, portNodes, type FixtureType } from '../fixtures';
import { addPolyline, emptyNetwork, type Network, type SegmentAttrs, type Vec3 } from '../network';

export const W = (diameter: number): SegmentAttrs => ({ system: 'water', diameter, material: 'HIVP' });

export function newDoc(): { doc: Doc; floorId: string } {
  const b = addFloor(emptyBuilding(), { height: 3000 });
  return { doc: { building: b.b, network: emptyNetwork(), fixtures: {}, site: { designGL: 0 } }, floorId: b.floorId };
}

export function put(doc: Doc, floorId: string, type: FixtureType, x: number, y: number): { doc: Doc; id: string } {
  const r = placeFixture(doc, floorId, type, { x, y });
  return { doc: r.doc, id: r.fixtureId! };
}

export const port = (net: Network, fixtureId: string, portId: string) => portNodes(net, fixtureId).find((n) => n.portId === portId)!;

/** from の点から to の点へ、横 → 縦 → 高さの順に曲がる管を引く。最後の点の id を返す */
export function route(net: Network, fromId: string, to: Vec3 | string, dia: number): { net: Network; endId: string; segIds: string[] } {
  const a = net.nodes[fromId].pos;
  const endNodeId = typeof to === 'string' ? to : undefined;
  const b = typeof to === 'string' ? net.nodes[to].pos : to;
  const same = (p: Vec3, q: Vec3) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1;
  // 曲がり角が端や前の点と重なるときは省く（重なった点に別の点ができて、つながらなくなるのを防ぐ）
  const corners = [{ x: b.x, y: a.y, z: a.z }, { x: b.x, y: b.y, z: a.z }];
  const pts: Vec3[] = [a];
  for (const c of corners) if (!same(c, pts.at(-1)!) && !same(c, b)) pts.push(c);
  pts.push(b);
  const r = addPolyline(net, pts, W(dia), { startNodeId: fromId, ...(endNodeId ? { endNodeId } : {}) });
  return { net: r.net, endId: r.nodeIds.at(-1)!, segIds: r.segmentIds };
}

/** 器具が近くに固まった現場（文字の重なりの確認用）: メーター → 幹線から 300mm おきに 11 本の枝 → 水栓・洗面台など ＋ 給湯器 */
export function crowdedSupply(): Doc {
  let { doc, floorId } = newDoc();
  let r = put(doc, floorId, 'waterMeter', 0, 0); doc = r.doc; const meter = r.id;
  const types: FixtureType[] = ['faucet', 'washbasin', 'toilet', 'kitchen', 'washer', 'shower', 'mixFaucet', 'faucet', 'outdoorFaucet', 'washbasin', 'toilet'];
  const ids: string[] = [];
  types.forEach((ty, i) => { r = put(doc, floorId, ty, 1500 + i * 300 + 2000 * Math.floor(i / 6), 1500 + (i % 3) * 400); doc = r.doc; ids.push(r.id); });
  r = put(doc, floorId, 'waterHeater', 1150, -1200); doc = r.doc; const heater = r.id;
  let net = doc.network;
  const out = port(net, meter, 'out');
  let prev = out.id;
  const taps: string[] = [];
  for (let i = 0; i < types.length; i++) {
    const wp = port(net, ids[i], 'water');
    const t = route(net, prev, { x: wp.pos.x, y: 0, z: out.pos.z }, i < 6 ? 25 : 20);
    net = t.net; prev = t.endId; taps.push(t.endId);
  }
  types.forEach((_, i) => { net = route(net, taps[i], port(net, ids[i], 'water').id, 13).net; });
  net = route(net, out.id, port(net, heater, 'in').id, 20).net;
  return { ...doc, network: net };
}

export function kawasakiLike():{ doc: Doc; floorId: string; ids: { meter: string; kitchen: string; washbasin: string; toilet: string; heater: string; F: string; E: string } } {
  let { doc, floorId } = newDoc();
  let r = put(doc, floorId, 'waterMeter', 0, 0); doc = r.doc; const meter = r.id;
  r = put(doc, floorId, 'kitchen', 9000, 3500); doc = r.doc; const kitchen = r.id;
  r = put(doc, floorId, 'washbasin', 5500, 4500); doc = r.doc; const washbasin = r.id;
  r = put(doc, floorId, 'toilet', 3500, 4500); doc = r.doc; const toilet = r.id;
  // 給湯器の入口（−150）が分岐 F の真下（x=4650）に来る位置
  r = put(doc, floorId, 'waterHeater', 4800, -1500); doc = r.doc; const heater = r.id;
  let net = doc.network;
  const out = port(net, meter, 'out');
  const z = out.pos.z;
  let t = route(net, out.id, { x: out.pos.x + 4500, y: 0, z }, 25); net = t.net; const F = t.endId;
  t = route(net, F, { x: net.nodes[F].pos.x, y: 3500, z }, 20); net = t.net; const E = t.endId;
  t = route(net, E, port(net, kitchen, 'water').id, 13); net = t.net;
  t = route(net, E, port(net, washbasin, 'water').id, 13); net = t.net;
  t = route(net, E, port(net, toilet, 'water').id, 13); net = t.net;
  t = route(net, F, port(net, heater, 'in').id, 20); net = t.net;
  return { doc: { ...doc, network: net }, floorId, ids: { meter, kitchen, washbasin, toilet, heater, F, E } };
}
