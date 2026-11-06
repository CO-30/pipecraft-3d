import type { Network, Vec3 } from './network';

export type Vec2 = { x: number; y: number };

const d2 = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** 点と線分の距離（平面） */
export function distToSegment2(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return d2(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return d2(p, { x: a.x + dx * t, y: a.y + dy * t });
}

/** Ramer–Douglas–Peucker で手描きの軌跡を単純化 */
export function simplify(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 2) return points.slice();
  let maxD = -1, idx = 0;
  const a = points[0], b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToSegment2(points[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tolerance) return [a, b];
  const left = simplify(points.slice(0, idx + 1), tolerance);
  const right = simplify(points.slice(idx), tolerance);
  return [...left.slice(0, -1), ...right];
}

/**
 * 水平・垂直への補正。各区間の角度が軸から snapDeg 以内なら軸に合わせる。
 * snapDeg=45 にすると常に直角（強制）、0 で補正なし（自由）。
 */
export function orthoSnap(points: Vec2[], snapDeg: number): Vec2[] {
  if (points.length < 2 || snapDeg <= 0) return points.slice();
  const out: Vec2[] = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const prev = out[i - 1];
    const p = points[i];
    const dx = p.x - prev.x, dy = p.y - prev.y;
    const ang = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI; // 0=水平, 90=垂直
    if (ang <= snapDeg) out.push({ x: p.x, y: prev.y });
    else if (90 - ang <= snapDeg) out.push({ x: prev.x, y: p.y });
    else out.push({ ...p });
  }
  // 補正で生じた同一点・一直線上の中間点を除去
  return dedupeCollinear(out);
}

function dedupeCollinear(pts: Vec2[]): Vec2[] {
  const r: Vec2[] = [];
  for (const p of pts) {
    if (r.length && d2(r[r.length - 1], p) < 1e-6) continue;
    if (r.length >= 2) {
      const a = r[r.length - 2], b = r[r.length - 1];
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
      const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y);
      if (Math.abs(cross) < 1e-6 && dot > 0) { r[r.length - 1] = p; continue; }
    }
    r.push(p);
  }
  return r;
}

export type Hit = { type: 'node'; id: string } | { type: 'segment'; id: string } | null;

/** 平面上のヒットテスト（ノード優先）。tolerance は mm */
export function hitTestPlan(net: Network, p: Vec2, tolerance: number): Hit {
  let best: Hit = null, bestD = Infinity;
  for (const n of Object.values(net.nodes)) {
    const d = d2(p, n.pos);
    if (d <= tolerance && d < bestD) { best = { type: 'node', id: n.id }; bestD = d; }
  }
  if (best) return best;
  for (const s of Object.values(net.segments)) {
    const d = distToSegment2(p, net.nodes[s.a].pos, net.nodes[s.b].pos);
    if (d <= tolerance && d < bestD) { best = { type: 'segment', id: s.id }; bestD = d; }
  }
  return best;
}

export const to3 = (p: Vec2, z: number): Vec3 => ({ x: p.x, y: p.y, z });
