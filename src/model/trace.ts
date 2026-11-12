/**
 * 系統をたどる（Rebro の系統選択）。選んだ区間と同じ系統につながる管・器具を集め、長さ・口径別・器具数を出す。
 * 汚水と雑排水は 1 つの排水系統。器具に届いたら、同じ系統の別の接続口から先へ続ける（メーター・ヘッダー・マスなど）。
 * 長さは実測があれば実測（材料表・積算と同じ）。
 */
import type { Doc } from './doc';
import { portSystem } from './fixtures';
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
  valveCount: number;
};

export const familyOf = (s: SystemType): SystemFamily => (s === 'sewage' ? 'drain' : s);

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
  return {
    family: fam,
    segmentIds: [...segs],
    nodeIds: [...nodes],
    fixtureIds: [...fixtures],
    totalLength: total,
    byDiameter: [...byDia].sort((a, b) => b[0] - a[0]).map(([diameter, length]) => ({ diameter, length })),
    fixtureCount: fixtures.size,
    valveCount,
  };
}
