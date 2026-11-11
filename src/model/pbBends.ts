/**
 * PB（ポリブテン管）の曲げ配管の見た目: 継手なしで曲げる角を、なめらかな曲線で描くための形（純粋関数）。
 * 曲げ半径は最小曲げ半径以上で、両側の直線に収まるいちばん大きい半径（最小の NICE_R_FACTOR 倍まで）。
 * 2D・3D とも、区間の端を接線長だけ縮め、角は 2 次ベジェ曲線（制御点 = 角）でつなぐ。積算・図面には使わない。
 */
import { adjacency, type Network, type Vec3 } from './network';
import type { NodeFitting } from './fittings';

/** 見た目の曲げ半径の上限（最小曲げ半径の何倍まで大きく曲げるか） */
export const NICE_R_FACTOR = 3;

export type BendArc = {
  nodeId: string;
  /** 曲がりの始まり・終わり（区間 id ごと）と、角（制御点） */
  ends: Record<string, Vec3>;
  from: Vec3; to: Vec3; corner: Vec3;
  segs: [string, string];
  r: number;
};

const sub = (p: Vec3, q: Vec3): Vec3 => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const along = (p: Vec3, v: Vec3, t: number): Vec3 => ({ x: p.x + v.x * t, y: p.y + v.y * t, z: p.z + v.z * t });

/** 継手なしで曲げる角（部品が「なし」で、PB の曲げにできると判定された点）の曲線 */
export function pbBendArcs(net: Network, fittings: NodeFitting[]): Map<string, BendArc> {
  const bendIds = new Set(fittings.filter((f) => f.type === 'none' && f.bendR).map((f) => f.nodeId));
  const rOf = new Map(fittings.filter((f) => f.bendR).map((f) => [f.nodeId, f.bendR!]));
  const adj = adjacency(net);
  const out = new Map<string, BendArc>();
  for (const id of bendIds) {
    const segs = adj.get(id) ?? [];
    if (segs.length !== 2) continue;
    const p = net.nodes[id].pos;
    const others = segs.map((sg) => net.nodes[sg.a === id ? sg.b : sg.a]);
    const vs = others.map((o) => sub(o.pos, p));
    const ls = vs.map(len);
    if (ls.some((l) => l < 1)) continue;
    const us = vs.map((v, i) => ({ x: v.x / ls[i], y: v.y / ls[i], z: v.z / ls[i] }));
    const cos = Math.max(-1, Math.min(1, us[0].x * us[1].x + us[0].y * us[1].y + us[0].z * us[1].z));
    const defl = Math.PI - Math.acos(cos); // 曲がり角
    if (defl < 0.01) continue;
    const tanHalf = Math.tan(defl / 2);
    // 向こう端も曲げなら、間の直線を半分ずつ使う
    const avail = Math.min(...others.map((o, i) => (bendIds.has(o.id) ? ls[i] / 2 : ls[i])));
    const rMin = rOf.get(id)!;
    const r = Math.max(rMin, Math.min(rMin * NICE_R_FACTOR, avail / tanHalf));
    const t = Math.min(r * tanHalf, avail);
    const ends: Record<string, Vec3> = {};
    const pts = us.map((u) => along(p, u, t));
    segs.forEach((sg, i) => { ends[sg.id] = pts[i]; });
    out.set(id, { nodeId: id, ends, from: pts[0], to: pts[1], corner: p, segs: [segs[0].id, segs[1].id], r });
  }
  return out;
}

/** 区間の両端（曲げの所は曲がりの始まりまで縮めた点） */
export function trimmedEnds(net: Network, arcs: Map<string, BendArc>, segId: string): [Vec3, Vec3] {
  const s = net.segments[segId];
  return [arcs.get(s.a)?.ends[segId] ?? net.nodes[s.a].pos, arcs.get(s.b)?.ends[segId] ?? net.nodes[s.b].pos];
}

/** 曲線上の点（2 次ベジェ）。n 等分 */
export function arcPoints(a: BendArc, n = 12): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({
      x: u * u * a.from.x + 2 * u * t * a.corner.x + t * t * a.to.x,
      y: u * u * a.from.y + 2 * u * t * a.corner.y + t * t * a.to.y,
      z: u * u * a.from.z + 2 * u * t * a.corner.z + t * t * a.to.z,
    });
  }
  return pts;
}
