/**
 * 器具の接続口へつなぐ。配管の端（または器具の接続口）から、まだつながっていない器具の接続口へ仮のルートを作る。
 * 別の階・屋上の器具（メーター → 屋上タンクなど）も1回でつなげる。ルートは 始点で上下 → 平面で L 字。
 * あとで点をドラッグして直せる前提の「仮ルート」。
 */
import type { Doc } from './doc';
import { segmentsAt, type Vec3 } from './network';
import { FIXTURE_CATALOG } from './fixtures';
import { canJoin, nodeAttrs } from './systems';

export type PortCandidate = { nodeId: string; fixtureId: string; label: string; dist: number };

/** つなげる接続口の候補（近い順）。始点は 端点（区間1本）か、つながっていない接続口 */
export function portCandidates(doc: Doc, fromId: string, limit = 6): PortCandidate[] {
  const net = doc.network;
  const n = net.nodes[fromId];
  if (!n) return [];
  const deg = segmentsAt(net, fromId).length;
  if (deg > 1 || (n.fixtureId && deg > 0)) return [];
  const from = nodeAttrs(net, doc.fixtures, fromId);
  if (!from.attrs) return [];
  const out: PortCandidate[] = [];
  for (const m of Object.values(net.nodes)) {
    if (m.id === fromId || !m.fixtureId || m.fixtureId === n.fixtureId) continue;
    if (segmentsAt(net, m.id).length > 0) continue;
    const fx = doc.fixtures[m.fixtureId];
    const port = fx && FIXTURE_CATALOG[fx.type].ports.find((p) => p.id === m.portId);
    if (!port || !from.systems.every((s) => canJoin(s, port.system))) continue;
    const dist = Math.abs(m.pos.x - n.pos.x) + Math.abs(m.pos.y - n.pos.y) + Math.abs(m.pos.z - n.pos.z);
    const floor = doc.building.floors.find((f) => f.id === fx.floorId)?.name;
    out.push({ nodeId: m.id, fixtureId: fx.id, label: `${FIXTURE_CATALOG[fx.type].label}（${port.label}${floor ? `・${floor}` : ''}）`, dist });
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, limit);
}

/** 始点で上下に動き、平面で x → y の順に L 字で接続口へ。同じ点は省く */
export function routeToPort(a: Vec3, b: Vec3): Vec3[] {
  const raw: Vec3[] = [a, { x: a.x, y: a.y, z: b.z }, { x: b.x, y: a.y, z: b.z }, b];
  const pts: Vec3[] = [];
  for (const p of raw) {
    const q = pts.at(-1);
    if (!q || Math.abs(q.x - p.x) > 0.5 || Math.abs(q.y - p.y) > 0.5 || Math.abs(q.z - p.z) > 0.5) pts.push(p);
  }
  return pts;
}
