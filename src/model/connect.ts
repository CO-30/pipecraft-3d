/**
 * 近くの配管へつなぐ。選んだ端点（または器具の接続口）から平面で一番近い、つなげる配管（同じ系統）を探す。
 * 交差してはみ出した端・少し手前で止まった端を、ワンタップで本管につなぐ（T字）／端どうしをつなぐ。
 */
import { connectNodeToSegment, mergeNodes, moveNode, segmentsAt, validateNetwork, type Network, type SystemType, type Vec3 } from './network';
import type { Fixture } from './fixtures';
import { conflictAt, conflictBetween } from './systems';

export type ConnectCandidate = { type: 'node' | 'segment'; id: string; point: Vec3; planDist: number; dz: number; system: SystemType; diameter: number };
/** 探す範囲（平面距離 mm） */
export const CONNECT_SEARCH_MM = 600;

function planFoot(a: Vec3, b: Vec3, p: Vec3): { pos: Vec3; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return { pos: { x: a.x + dx * t, y: a.y + dy * t, z: a.z + (b.z - a.z) * t }, t };
}

export function findConnectCandidate(net: Network, fixtures: Record<string, Fixture>, nodeId: string, maxPlan = CONNECT_SEARCH_MM): ConnectCandidate | null {
  const n = net.nodes[nodeId];
  if (!n) return null;
  const mine = segmentsAt(net, nodeId);
  if (mine.length > 1) return null; // 端点（または器具の接続口）だけ
  const near = new Set([nodeId, ...mine.map((s) => (s.a === nodeId ? s.b : s.a))]);
  let best: ConnectCandidate | null = null;
  const better = (c: ConnectCandidate) => !best || c.planDist < best.planDist - 1e-6 || (c.type === 'node' && best.type === 'segment' && c.planDist <= best.planDist + 50);
  for (const m of Object.values(net.nodes)) {
    if (near.has(m.id)) continue;
    const d = Math.hypot(m.pos.x - n.pos.x, m.pos.y - n.pos.y);
    if (d > maxPlan || conflictBetween(net, fixtures, m.id, nodeId)) continue;
    const segs = segmentsAt(net, m.id);
    if (!segs.length && !(m.fixtureId)) continue;
    if (n.fixtureId && m.fixtureId) continue; // 接続口どうしはつながない
    const ref = segs[0];
    const c: ConnectCandidate = { type: 'node', id: m.id, point: m.pos, planDist: d, dz: m.pos.z - n.pos.z, system: ref?.system ?? 'other', diameter: ref?.diameter ?? 0 };
    if (ref && better(c)) best = c;
  }
  for (const s of Object.values(net.segments)) {
    if (s.a === nodeId || s.b === nodeId) continue;
    if (conflictAt(net, fixtures, nodeId, s.system)) continue;
    const f = planFoot(net.nodes[s.a].pos, net.nodes[s.b].pos, n.pos);
    if (f.t < 0.001 || f.t > 0.999) continue; // 端に近いなら点として扱う
    const d = Math.hypot(f.pos.x - n.pos.x, f.pos.y - n.pos.y);
    if (d > maxPlan) continue;
    const c: ConnectCandidate = { type: 'segment', id: s.id, point: f.pos, planDist: d, dz: f.pos.z - n.pos.z, system: s.system, diameter: s.diameter };
    if (better(c)) best = c;
  }
  return best;
}

/** 候補へつなぐ。端点は候補の位置（高さも）へ動かす。器具の接続口は動かさず、配管の方を接続口へ寄せる */
export function connectToCandidate(net: Network, nodeId: string, c: ConnectCandidate): Network {
  const n = net.nodes[nodeId];
  if (!n) return net;
  let out: Network;
  if (c.type === 'node') {
    out = n.fixtureId ? mergeNodes(net, nodeId, c.id) : mergeNodes(net, c.id, nodeId);
  } else if (n.fixtureId) {
    out = connectNodeToSegment(net, nodeId, c.id);
  } else {
    const moved = moveNode(net, nodeId, c.point);
    if (moved === net && (n.pos.x !== c.point.x || n.pos.y !== c.point.y || n.pos.z !== c.point.z)) return net;
    out = connectNodeToSegment(moved, nodeId, c.id);
    if (out === moved) return net;
  }
  return validateNetwork(out).length ? net : out;
}
