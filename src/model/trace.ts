/**
 * 系統をたどる（Rebro の系統選択）。選んだ区間と同じ系統につながる管・器具を集め、長さ・口径別・器具数を出す。
 * 汚水と雑排水は 1 つの排水系統。器具に届いたら、同じ系統の別の接続口から先へ続ける（メーター・ヘッダー・マスなど）。
 * 長さは実測があれば実測（材料表・積算と同じ）。
 */
import type { Doc } from './doc';
import { isManhole, portSystem, type FixtureType } from './fixtures';
import { adjacency, segmentLength, type SystemType } from './network';

export type SystemFamily = Exclude<SystemType, 'sewage'>;
export type Trace = {
  family: SystemFamily;
  segmentIds: string[];
  nodeIds: string[];
  fixtureIds: string[];
  totalLength: number;
  /** 口径ごとの長さ（太い順） */
  byDiameter: { diameter: number; length: number }[];
  fixtureCount: number;
  /** 器具（衛生器具など）・マス・設備（メーター・ヘッダー・ポンプ・タンク・給湯器）の数 */
  counts: { fixtures: number; manholes: number; equipment: number };
  valveCount: number;
  /** 帯に出す系統の名前（雨水マスだけにつながる排水は「雨水」） */
  label: string;
};

/** たどり始めの手がかり。区間が分けられて ID が変わっても、両端の点から同じ系統をたどり直す */
export type TraceSeed = { segId: string; nodeIds: [string, string]; family: SystemFamily };

const EQUIPMENT = new Set<FixtureType>(['waterMeter', 'waterHeader', 'hotWaterHeader', 'pump', 'roofTank', 'waterHeater']);
const RAIN = new Set<FixtureType>(['manholeRain', 'publicRain']);
const LABEL: Record<SystemFamily, string> = {
  water: '給水', hotWater: '給湯', drain: '排水（汚水・雑排水）', vent: '通気', gas: 'ガス', refrigerant: '冷媒', condensate: 'ドレン', electric: '電気', telecom: '弱電', other: 'その他',
};

export const familyOf = (s: SystemType): SystemFamily => (s === 'sewage' ? 'drain' : s);

export function traceSeed(doc: Doc, segId: string): TraceSeed | null {
  const s = doc.network.segments[segId];
  return s ? { segId, nodeIds: [s.a, s.b], family: familyOf(s.system) } : null;
}

/** 手がかりからたどる。区間が残っていればそこから、無ければ両端の点にある同じ系統の区間から */
export function traceFrom(doc: Doc, seed: TraceSeed): Trace | null {
  if (doc.network.segments[seed.segId]) return traceSystem(doc, seed.segId);
  for (const n of seed.nodeIds) {
    const s = Object.values(doc.network.segments).find((g) => (g.a === n || g.b === n) && familyOf(g.system) === seed.family);
    if (s) return traceSystem(doc, s.id);
  }
  return null;
}

export function traceSystem(doc: Doc, startSegId: string): Trace | null {
  const net = doc.network;
  const s0 = net.segments[startSegId];
  if (!s0) return null;
  const fam = familyOf(s0.system);
  const adj = adjacency(net);
  // 器具ごとの接続口
  const ports = new Map<string, string[]>();
  for (const n of Object.values(net.nodes)) if (n.fixtureId) { const a = ports.get(n.fixtureId); if (a) a.push(n.id); else ports.set(n.fixtureId, [n.id]); }

  const segs = new Set<string>([s0.id]), nodes = new Set<string>(), fixtures = new Set<string>();
  const stack = [s0.a, s0.b];
  while (stack.length) {
    const nid = stack.pop()!;
    if (nodes.has(nid)) continue;
    nodes.add(nid);
    for (const s of adj.get(nid) ?? []) {
      if (familyOf(s.system) !== fam) continue;
      segs.add(s.id);
      stack.push(s.a === nid ? s.b : s.a);
    }
    const n = net.nodes[nid];
    if (n?.fixtureId && doc.fixtures[n.fixtureId]) {
      fixtures.add(n.fixtureId);
      for (const pid of ports.get(n.fixtureId) ?? []) {
        if (pid === nid || nodes.has(pid)) continue;
        const ps = portSystem(doc.fixtures, net.nodes[pid]);
        if (ps && familyOf(ps) === fam) stack.push(pid);
      }
    }
  }

  const byDia = new Map<number, number>();
  let total = 0;
  for (const id of segs) {
    const s = net.segments[id];
    const len = s.measuredLength ?? segmentLength(net, id);
    total += len;
    byDia.set(s.diameter, (byDia.get(s.diameter) ?? 0) + len);
  }
  const valveCount = [...nodes].filter((id) => net.nodes[id]?.kind === 'valve').length;
  const types = [...fixtures].map((id) => doc.fixtures[id].type);
  const counts = { fixtures: 0, manholes: 0, equipment: 0 };
  for (const t of types) counts[isManhole(t) ? 'manholes' : EQUIPMENT.has(t) ? 'equipment' : 'fixtures']++;
  const manholes = types.filter((t) => isManhole(t));
  const label = fam === 'drain' && manholes.length > 0 && manholes.every((t) => RAIN.has(t)) && !types.some((t) => !isManhole(t)) ? '雨水' : LABEL[fam];
  return {
    family: fam,
    segmentIds: [...segs],
    nodeIds: [...nodes],
    fixtureIds: [...fixtures],
    totalLength: total,
    byDiameter: [...byDia].sort((a, b) => b[0] - a[0]).map(([diameter, length]) => ({ diameter, length })),
    fixtureCount: fixtures.size,
    counts,
    valveCount,
    label,
  };
}
