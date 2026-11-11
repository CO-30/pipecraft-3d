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
  /** 曲がりの始まり・終わり（区間 id ごと）と、角・円の中心 */
  ends: Record<string, Vec3>;
  from: Vec3; to: Vec3; corner: Vec3; center: Vec3;
  segs: [string, string];
  /** 曲げ半径(mm)・曲がり角(rad) */
  r: number;
  angle: number;
};

const sub = (p: Vec3, q: Vec3): Vec3 => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const along = (p: Vec3, v: Vec3, t: number): Vec3 => ({ x: p.x + v.x * t, y: p.y + v.y * t, z: p.z + v.z * t });
const unit = (v: Vec3): Vec3 => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** 継手なしで曲げる角（部品が「なし」で、PB の曲げにできると判定された点）の曲線（円弧） */
export function pbBendArcs(net: Network, fittings: NodeFitting[]): Map<string, BendArc> {
  const rOf = new Map(fittings.filter((f) => f.type === 'none' && f.bendR).map((f) => [f.nodeId, f.bendR!]));
  const adj = adjacency(net);
  type C = { id: string; p: Vec3; segs: [string, string]; others: string[]; us: Vec3[]; ls: number[]; tanHalf: number; angle: number; rMin: number };
  const cands = new Map<string, C>();
  for (const [id, rMin] of rOf) {
    const segs = adj.get(id) ?? [];
    if (segs.length !== 2) continue;
    const p = net.nodes[id].pos;
    const others = segs.map((sg) => (sg.a === id ? sg.b : sg.a));
    const vs = others.map((o) => sub(net.nodes[o].pos, p));
    const ls = vs.map(len);
    if (ls.some((l) => l < 1)) continue;
    const us = vs.map(unit);
    const angle = Math.PI - Math.acos(Math.max(-1, Math.min(1, dot(us[0], us[1])))); // 曲がり角
    if (angle < 0.01 || angle > Math.PI - 0.01) continue;
    cands.set(id, { id, p, segs: [segs[0].id, segs[1].id], others, us, ls, tanHalf: Math.tan(angle / 2), angle, rMin });
  }
  // 曲げの大きい（最小の接線長が長い）所から順に、間の直線を取り合う（積算の判定と同じ順）
  const minT = (c: C) => c.rMin * c.tanHalf;
  const order = [...cands.values()].sort((a, b) => minT(b) - minT(a) || (a.id < b.id ? -1 : 1));
  const used = new Map<string, number>(); // 決めた接線長
  const out = new Map<string, BendArc>();
  for (const c of order) {
    // 向こう端も曲げなら、その曲げに取られた（まだなら最小の）接線長を残す
    const avail = Math.min(...c.others.map((o, i) => c.ls[i] - (used.get(o) ?? (cands.has(o) ? minT(cands.get(o)!) : 0))));
    const t = Math.max(0, Math.min(c.rMin * NICE_R_FACTOR * c.tanHalf, avail));
    if (t < 1) continue;
    used.set(c.id, t);
    const r = t / c.tanHalf;
    const pts = c.us.map((u) => along(c.p, u, t));
    // 円の中心: 二等分線の上、角から r / cos(曲がり角/2)
    const bis = unit({ x: c.us[0].x + c.us[1].x, y: c.us[0].y + c.us[1].y, z: c.us[0].z + c.us[1].z });
    const center = along(c.p, bis, r / Math.cos(c.angle / 2));
    const ends: Record<string, Vec3> = { [c.segs[0]]: pts[0], [c.segs[1]]: pts[1] };
    out.set(c.id, { nodeId: c.id, ends, from: pts[0], to: pts[1], corner: c.p, center, segs: c.segs, r, angle: c.angle });
  }
  return out;
}

/** 区間の両端（曲げの所は曲がりの始まりまで縮めた点） */
export function trimmedEnds(net: Network, arcs: Map<string, BendArc>, segId: string): [Vec3, Vec3] {
  const s = net.segments[segId];
  return [arcs.get(s.a)?.ends[segId] ?? net.nodes[s.a].pos, arcs.get(s.b)?.ends[segId] ?? net.nodes[s.b].pos];
}

/** 円弧の上の点（from → to を n 等分） */
export function arcPoints(a: BendArc, n = 12): Vec3[] {
  const e1 = unit(sub(a.from, a.center));
  const t2 = sub(a.to, a.center);
  const e2 = unit(sub(t2, { x: e1.x * dot(t2, e1), y: e1.y * dot(t2, e1), z: e1.z * dot(t2, e1) }));
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const f = (a.angle * i) / n;
    pts.push(along(along(a.center, e1, a.r * Math.cos(f)), e2, a.r * Math.sin(f)));
  }
  pts[0] = a.from; pts[n] = a.to;
  return pts;
}
