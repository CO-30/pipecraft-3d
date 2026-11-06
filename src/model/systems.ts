/**
 * 配管の種類どうしの接続可否。給水・給湯・排水系・ガス・冷媒・電気・通信は互いにつながない。
 * 排水系（排水・汚水・通気・ドレン）は同じ系統としてつなげる。「その他」は何とでもつなげる。
 */
import type { Network, SegmentAttrs, SystemType } from './network';
import type { Fixture } from './fixtures';
import { FIXTURE_CATALOG } from './fixtures';

const GROUP: Record<SystemType, string> = {
  water: 'water', hotWater: 'hotWater', drain: 'drain', sewage: 'drain', vent: 'drain', condensate: 'drain',
  gas: 'gas', refrigerant: 'refrigerant', electric: 'electric', telecom: 'telecom', other: 'other',
};
export const SYSTEM_NAME: Record<SystemType, string> = {
  water: '給水', hotWater: '給湯', drain: '排水', sewage: '汚水', vent: '通気', gas: 'ガス',
  refrigerant: '冷媒', condensate: 'ドレン', electric: '電気', telecom: '通信', other: 'その他',
};

export const canJoin = (a: SystemType, b: SystemType) => a === 'other' || b === 'other' || GROUP[a] === GROUP[b];

/** ノードにつながっている配管・器具の接続口の種類と、代表の属性 */
export function nodeAttrs(net: Network, fixtures: Record<string, Fixture>, nodeId: string): { systems: SystemType[]; attrs?: SegmentAttrs } {
  const n = net.nodes[nodeId];
  if (!n) return { systems: [] };
  const segs = Object.values(net.segments).filter((s) => s.a === nodeId || s.b === nodeId);
  const systems = segs.map((s) => s.system);
  let attrs: SegmentAttrs | undefined = segs[0] && { system: segs[0].system, diameter: segs[0].diameter, ...(segs[0].material ? { material: segs[0].material } : {}) };
  const fx = n.fixtureId ? fixtures[n.fixtureId] : undefined;
  const port = fx ? FIXTURE_CATALOG[fx.type].ports.find((p) => p.id === n.portId) : undefined;
  if (port) {
    systems.push(port.system);
    attrs ??= { system: port.system, diameter: port.diameter };
  }
  return { systems, attrs };
}

/** 種類 system の配管をノードにつないでよいか。だめなら相手の種類 */
export function conflictAt(net: Network, fixtures: Record<string, Fixture>, nodeId: string, system: SystemType): SystemType | null {
  return nodeAttrs(net, fixtures, nodeId).systems.find((s) => !canJoin(s, system)) ?? null;
}

/** 2つのノードを1つにしてよいか。だめなら衝突する2種類 */
export function conflictBetween(net: Network, fixtures: Record<string, Fixture>, a: string, b: string): [SystemType, SystemType] | null {
  const sa = nodeAttrs(net, fixtures, a).systems, sb = nodeAttrs(net, fixtures, b).systems;
  for (const x of sa) for (const y of sb) if (!canJoin(x, y)) return [x, y];
  return null;
}

export const conflictMessage = (a: SystemType, b: SystemType) => `${SYSTEM_NAME[a]}と${SYSTEM_NAME[b]}の配管はつなげません`;
