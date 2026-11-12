/**
 * 配管どうしの干渉（3D で管が重なっている所）。管は外径の円柱として、中心線どうしの最短距離 < 半径の和 で判定する。
 * つながっている区間（同じ点を持つ・ごく短い継手をはさんで続く）は除く。
 * 柔らかい管（PB・架橋ポリ）どうしが角度をもって交わる所は、上下にずらして通すので除く（平行に重なるのは干渉）。
 */
import type { Doc } from './doc';
import type { Segment, Vec3 } from './network';
import { outerDiameter } from './slope';
import { isPB } from './materials';

export type PipeClash = { segA: string; segB: string; /** 重なりの真ん中 */ point: Vec3; /** 重なり(mm) = 半径の和 − 中心線の距離 */ overlap: number };

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const at = (p: Vec3, d: Vec3, t: number): Vec3 => ({ x: p.x + d.x * t, y: p.y + d.y * t, z: p.z + d.z * t });

/** 線分 p1-q1 と p2-q2 の最短の 2 点（Ericson, Real-Time Collision Detection 5.1.9） */
export function closestPoints(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): { c1: Vec3; c2: Vec3; dist: number } {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  if (a <= 1e-9 && e <= 1e-9) { s = 0; t = 0; }
  else if (a <= 1e-9) { s = 0; t = clamp(f / e); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-9) { t = 0; s = clamp(-c / a); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
    }
  }
  const c1 = at(p1, d1, s), c2 = at(p2, d2, t);
  return { c1, c2, dist: Math.hypot(c1.x - c2.x, c1.y - c2.y, c1.z - c2.z) };
}

export function findPipeClashes(doc: Doc): PipeClash[] {
  const net = doc.network;
  const segs = Object.values(net.segments).filter((s) => net.nodes[s.a] && net.nodes[s.b]);
  const r = (s: Segment) => outerDiameter(s.diameter) / 2;
  const byNode = new Map<string, Segment[]>();
  for (const s of segs) for (const n of [s.a, s.b]) byNode.set(n, [...(byNode.get(n) ?? []), s]);
  const len = (s: Segment) => { const p = net.nodes[s.a].pos, q = net.nodes[s.b].pos; return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z); };
  /** つながっている: 同じ点を持つ、または短い区間（継手の長さ程度）1 本をはさんで続く */
  const connected = (A: Segment, B: Segment, reach: number) => {
    if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) return true;
    for (const n of [A.a, A.b]) for (const mid of byNode.get(n) ?? []) {
      if (mid.id === A.id || len(mid) > reach) continue;
      const other = mid.a === n ? mid.b : mid.a;
      if (B.a === other || B.b === other) return true;
    }
    return false;
  };
  const flexible = (s: Segment) => isPB(s.material) || /架橋|XPEP|ポリブテン/i.test(s.material ?? '');
  /** 向きが 20° 以上違う（平行に重なっていない） */
  const crossing = (A: Segment, B: Segment) => {
    const d = (s: Segment) => sub(net.nodes[s.b].pos, net.nodes[s.a].pos);
    const a = d(A), b = d(B), la = Math.hypot(a.x, a.y, a.z), lb = Math.hypot(b.x, b.y, b.z);
    return la > 1e-6 && lb > 1e-6 && Math.abs(dot(a, b)) / (la * lb) < Math.cos((20 * Math.PI) / 180);
  };
  const box = segs.map((s) => {
    const p = net.nodes[s.a].pos, q = net.nodes[s.b].pos, rr = r(s);
    return { s, x0: Math.min(p.x, q.x) - rr, x1: Math.max(p.x, q.x) + rr, y0: Math.min(p.y, q.y) - rr, y1: Math.max(p.y, q.y) + rr, z0: Math.min(p.z, q.z) - rr, z1: Math.max(p.z, q.z) + rr };
  }).sort((a, b) => a.x0 - b.x0);
  const out: PipeClash[] = [];
  for (let i = 0; i < box.length; i++) {
    const A = box[i];
    for (let j = i + 1; j < box.length && box[j].x0 <= A.x1; j++) {
      const B = box[j];
      if (B.y0 > A.y1 || B.y1 < A.y0 || B.z0 > A.z1 || B.z1 < A.z0) continue;
      const sum = r(A.s) + r(B.s);
      if (connected(A.s, B.s, sum * 2)) continue;
      if (flexible(A.s) && flexible(B.s) && crossing(A.s, B.s)) continue;
      const c = closestPoints(net.nodes[A.s.a].pos, net.nodes[A.s.b].pos, net.nodes[B.s.a].pos, net.nodes[B.s.b].pos);
      const overlap = sum - c.dist;
      if (overlap <= 1) continue;
      out.push({ segA: A.s.id, segB: B.s.id, point: { x: (c.c1.x + c.c2.x) / 2, y: (c.c1.y + c.c2.y) / 2, z: (c.c1.z + c.c2.z) / 2 }, overlap });
    }
  }
  return out;
}
