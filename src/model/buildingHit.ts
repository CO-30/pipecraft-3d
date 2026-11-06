import type { Building, Vec2 } from './building';
import { wallLength } from './building';
import { distToSegment2 } from './geometry';

export type BuildingHit =
  | { kind: 'corner'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'wall'; id: string; offset: number }
  | { kind: 'room'; id: string }
  | null;

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 壁上の位置（a端からの距離, 0..L にクランプ） */
export function offsetOnWall(b: Building, wallId: string, p: Vec2): number {
  const w = b.walls[wallId];
  const A = b.corners[w.a], B = b.corners[w.b];
  const L = wallLength(b, wallId);
  const t = ((p.x - A.x) * (B.x - A.x) + (p.y - A.y) * (B.y - A.y)) / (L * L);
  return Math.max(0, Math.min(1, t)) * L;
}

/**
 * 平面ヒットテスト（指定階）。優先順: 角(includeCorners時) > 開口 > 壁 > 部屋。tol は mm
 */
export function hitTestBuilding(b: Building, floorId: string, p: Vec2, tol: number, includeCorners = true): BuildingHit {
  if (includeCorners) {
    let best: string | null = null, bd = tol;
    for (const c of Object.values(b.corners)) {
      if (c.floorId !== floorId) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d <= bd) { bd = d; best = c.id; }
    }
    if (best) return { kind: 'corner', id: best };
  }
  let wallHit: { id: string; d: number } | null = null;
  for (const w of Object.values(b.walls)) {
    if (w.floorId !== floorId) continue;
    const d = distToSegment2(p, b.corners[w.a], b.corners[w.b]);
    if (d <= w.thickness / 2 + tol && (!wallHit || d < wallHit.d)) wallHit = { id: w.id, d };
  }
  if (wallHit) {
    const off = offsetOnWall(b, wallHit.id, p);
    for (const o of Object.values(b.openings)) {
      if (o.wallId === wallHit.id && Math.abs(o.offset - off) <= o.width / 2) return { kind: 'opening', id: o.id };
    }
    return { kind: 'wall', id: wallHit.id, offset: off };
  }
  for (const r of Object.values(b.rooms)) {
    if (r.floorId === floorId && pointInPolygon(p, r.polygon)) return { kind: 'room', id: r.id };
  }
  return null;
}
