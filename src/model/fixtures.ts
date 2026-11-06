/**
 * 設備機器（器具）。平面位置・回転・所属階を持ち、接続口は配管ネットワークのノード
 * （kind 'fixture'・fixedKind・fixtureId/portId）として表す。配管の始点・終点にそのまま使える。
 * 器具の移動・回転は接続口ノードを動かす（つながった配管の端も追従）。削除しても配管は消さない。
 */
import type { Building, Floor } from './building';
import { floorById } from './building';
import type { Doc } from './doc';
import { newId } from './id';
import { dist, moveNode, normalize, segmentsAt, type Network, type SystemType, type Vec3 } from './network';

export type FixtureType =
  | 'toilet' | 'washbasin' | 'kitchen' | 'bathtub' | 'shower' | 'washer' | 'waterHeater'
  | 'waterMeter' | 'pump' | 'panel' | 'outlet' | 'light' | 'aircon';
export type Rotation = 0 | 90 | 180 | 270;
export type Fixture = { id: string; floorId: string; type: FixtureType; x: number; y: number; rotation: Rotation };

export type PortDef = { id: string; system: SystemType; diameter: number; dx: number; dy: number; dz: number; label: string };
/** size: 幅(w)・奥行(d)・高さ(h)。base: 床からの設置高さ（'ceiling' は天井面から吊り下げ） */
export type FixtureDef = { label: string; size: { w: number; d: number; h: number }; base: number | 'ceiling'; ports: PortDef[] };

const P = (id: string, system: SystemType, diameter: number, dx: number, dy: number, dz: number, label: string): PortDef => ({ id, system, diameter, dx, dy, dz, label });

/** 器具カタログ（簡易形状。局所座標: 中心原点、dx=幅方向、dy=奥行方向(+が壁側)、dz=設置面から上） */
export const FIXTURE_CATALOG: Record<FixtureType, FixtureDef> = {
  toilet: { label: 'トイレ', size: { w: 400, d: 700, h: 800 }, base: 0, ports: [P('water', 'water', 13, 150, 300, 150, '給水'), P('sewage', 'sewage', 75, 0, 50, 0, '汚水')] },
  washbasin: { label: '洗面台', size: { w: 750, d: 500, h: 850 }, base: 0, ports: [P('water', 'water', 13, -100, 200, 500, '給水'), P('hot', 'hotWater', 13, 100, 200, 500, '給湯'), P('drain', 'drain', 40, 0, 200, 350, '排水')] },
  kitchen: { label: 'キッチン', size: { w: 2550, d: 650, h: 850 }, base: 0, ports: [P('water', 'water', 13, -450, 250, 400, '給水'), P('hot', 'hotWater', 13, -300, 250, 400, '給湯'), P('drain', 'drain', 50, -375, 250, 250, '排水'), P('gas', 'gas', 20, 700, 250, 400, 'ガス')] },
  bathtub: { label: '浴槽', size: { w: 1600, d: 800, h: 550 }, base: 0, ports: [P('hot', 'hotWater', 13, -700, 350, 450, '給湯'), P('drain', 'drain', 40, -650, 0, 0, '排水')] },
  shower: { label: 'シャワー', size: { w: 900, d: 900, h: 100 }, base: 0, ports: [P('water', 'water', 13, -150, 420, 1000, '給水'), P('hot', 'hotWater', 13, 150, 420, 1000, '給湯'), P('drain', 'drain', 50, 0, 0, 0, '排水')] },
  washer: { label: '洗濯機', size: { w: 640, d: 640, h: 1000 }, base: 0, ports: [P('water', 'water', 13, 0, 300, 1100, '給水'), P('drain', 'drain', 50, 200, 200, 0, '排水')] },
  waterHeater: { label: '給湯器', size: { w: 480, d: 250, h: 750 }, base: 300, ports: [P('in', 'water', 20, -150, 0, 0, '給水'), P('out', 'hotWater', 20, 150, 0, 0, '給湯'), P('gas', 'gas', 20, 0, 0, 0, 'ガス')] },
  waterMeter: { label: '水道メーター', size: { w: 300, d: 200, h: 200 }, base: 0, ports: [P('in', 'water', 20, -150, 0, 100, '入口'), P('out', 'water', 20, 150, 0, 100, '出口')] },
  pump: { label: 'ポンプ', size: { w: 400, d: 400, h: 500 }, base: 0, ports: [P('in', 'water', 25, -200, 0, 150, '吸込'), P('out', 'water', 25, 200, 0, 150, '吐出')] },
  panel: { label: '分電盤', size: { w: 500, d: 150, h: 500 }, base: 1500, ports: [P('main', 'electric', 14, 0, 0, 500, '幹線')] },
  outlet: { label: 'コンセント', size: { w: 70, d: 20, h: 120 }, base: 250, ports: [P('power', 'electric', 2, 0, 0, 120, '電源')] },
  light: { label: '照明', size: { w: 400, d: 400, h: 100 }, base: 'ceiling', ports: [P('power', 'electric', 2, 0, 0, 100, '電源')] },
  aircon: { label: 'エアコン', size: { w: 800, d: 250, h: 300 }, base: 1900, ports: [P('gasPipe', 'refrigerant', 10, -300, 0, 0, '冷媒(ガス)'), P('liquid', 'refrigerant', 6, -250, 0, 0, '冷媒(液)'), P('drain', 'condensate', 16, -350, 0, 0, 'ドレン'), P('power', 'electric', 2, 300, 0, 150, '電源')] },
};
export const FIXTURE_TYPES = Object.keys(FIXTURE_CATALOG) as FixtureType[];

/** 器具の設置面の高さ（絶対 mm） */
export function fixtureBaseZ(f: Fixture, floor: Floor): number {
  const def = FIXTURE_CATALOG[f.type];
  return floor.elevation + (def.base === 'ceiling' ? floor.height - floor.slabThickness - def.size.h : def.base);
}

/** 局所座標(dx,dy) を回転して平面座標へ */
export function localToPlan(f: Pick<Fixture, 'x' | 'y' | 'rotation'>, dx: number, dy: number): { x: number; y: number } {
  const r = (f.rotation * Math.PI) / 180;
  const c = Math.round(Math.cos(r)), s = Math.round(Math.sin(r));
  return { x: f.x + dx * c - dy * s, y: f.y + dx * s + dy * c };
}

export function portWorldPos(f: Fixture, floor: Floor, port: PortDef): Vec3 {
  return { ...localToPlan(f, port.dx, port.dy), z: fixtureBaseZ(f, floor) + port.dz };
}

/** 器具の平面上の四隅（回転済み） */
export function fixtureCorners(f: Fixture): { x: number; y: number }[] {
  const { w, d } = FIXTURE_CATALOG[f.type].size;
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([dx, dy]) => localToPlan(f, dx, dy));
}

export const portNodes = (net: Network, fixtureId: string) => Object.values(net.nodes).filter((n) => n.fixtureId === fixtureId);

export function placeFixture(doc: Doc, floorId: string, type: FixtureType, p: { x: number; y: number }, rotation: Rotation = 0): { doc: Doc; fixtureId: string | null } {
  const floor = floorById(doc.building, floorId);
  if (!floor || !FIXTURE_CATALOG[type]) return { doc, fixtureId: null };
  const f: Fixture = { id: newId('f'), floorId, type, x: p.x, y: p.y, rotation };
  const nodes = { ...doc.network.nodes };
  for (const port of FIXTURE_CATALOG[type].ports) {
    const id = newId('n');
    nodes[id] = { id, kind: 'fixture', fixedKind: true, fixtureId: f.id, portId: port.id, floorId, pos: portWorldPos(f, floor, port) };
  }
  return { doc: { ...doc, fixtures: { ...doc.fixtures, [f.id]: f }, network: { ...doc.network, nodes } }, fixtureId: f.id };
}

/** 器具の接続口ノードを器具の位置に合わせる。配管が長さ0になる場合は null */
function syncPorts(net: Network, b: Building, f: Fixture): Network | null {
  const floor = floorById(b, f.floorId);
  if (!floor) return null;
  let cur = net;
  for (const n of portNodes(net, f.id)) {
    const port = FIXTURE_CATALOG[f.type].ports.find((p) => p.id === n.portId);
    if (!port) continue;
    const pos = portWorldPos(f, floor, port);
    if (dist(cur.nodes[n.id].pos, pos) < 1e-9) continue;
    cur = moveNode(cur, n.id, pos);
    if (dist(cur.nodes[n.id].pos, pos) > 1e-6) return null;
  }
  return cur;
}

/** 器具の移動・回転（接続口につながった配管の端も追従）。配管が長さ0になる移動は拒否 */
export function moveFixture(doc: Doc, id: string, p: { x: number; y: number }, rotation?: Rotation): Doc {
  const f0 = doc.fixtures[id];
  if (!f0) return doc;
  const f = { ...f0, x: p.x, y: p.y, rotation: rotation ?? f0.rotation };
  if (f.x === f0.x && f.y === f0.y && f.rotation === f0.rotation) return doc;
  const net = syncPorts(doc.network, doc.building, f);
  if (!net) return doc;
  return { ...doc, network: net, fixtures: { ...doc.fixtures, [id]: f } };
}

/** 階の床高・階高が変わったあとに、すべての器具の接続口を合わせ直す（合わせられない器具はそのまま） */
export function syncAllFixturePorts(doc: Doc): Doc {
  let net = doc.network;
  for (const f of Object.values(doc.fixtures)) net = syncPorts(net, doc.building, f) ?? net;
  return net === doc.network ? doc : { ...doc, network: net };
}

/** 器具を削除。接続口ノードは配管がつながっていれば通常の端点に戻し、つながっていなければ消す */
export function deleteFixture(doc: Doc, id: string): Doc {
  if (!doc.fixtures[id]) return doc;
  const nodes = { ...doc.network.nodes };
  for (const n of portNodes(doc.network, id)) {
    if (segmentsAt(doc.network, n.id).length === 0) delete nodes[n.id];
    else {
      const { fixedKind: _f, fixtureId: _i, portId: _p, ...rest } = n;
      nodes[n.id] = rest;
    }
  }
  const { [id]: _removed, ...fixtures } = doc.fixtures;
  return { ...doc, fixtures, network: normalize({ ...doc.network, nodes }) };
}

/** 器具に配管がつながっているか */
export const fixtureConnected = (doc: Doc, id: string) => portNodes(doc.network, id).some((n) => segmentsAt(doc.network, n.id).length > 0);

/** 器具と接続口ノードの整合性チェック */
export function validateFixtures(doc: Doc): string[] {
  const errors: string[] = [];
  for (const f of Object.values(doc.fixtures)) {
    if (!FIXTURE_CATALOG[f.type]) { errors.push(`fixture ${f.id}: 不明な種類`); continue; }
    if (!floorById(doc.building, f.floorId)) errors.push(`fixture ${f.id}: 階が存在しない`);
    const ports = portNodes(doc.network, f.id);
    const floor = floorById(doc.building, f.floorId);
    const defs = FIXTURE_CATALOG[f.type].ports;
    for (const def of defs) {
      const ns = ports.filter((n) => n.portId === def.id);
      if (ns.length !== 1) errors.push(`fixture ${f.id}: 接続口 ${def.id} が ${ns.length} 個`);
      else if (floor && dist(ns[0].pos, portWorldPos(f, floor, def)) > 1) errors.push(`fixture ${f.id}: 接続口 ${def.id} の位置が器具とずれている`);
    }
    for (const n of ports) if (!defs.some((d) => d.id === n.portId)) errors.push(`node ${n.id}: 器具 ${f.id} にない接続口 ${n.portId}`);
  }
  for (const n of Object.values(doc.network.nodes)) {
    if (n.fixtureId && !doc.fixtures[n.fixtureId]) errors.push(`node ${n.id}: 存在しない器具 ${n.fixtureId} の接続口`);
  }
  return errors;
}
