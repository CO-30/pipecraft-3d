/**
 * 建物 → 3D表示用の箱リスト（純粋関数）。表示データであり保存しない。
 * 壁は開口部を避けて分割した箱。床スラブ・天井は階ごとに壁外形の外接矩形（Phase 1）。
 */
import type { Building, Opening, Wall } from './building';
import { wallLength } from './building';
import { memberBoxes } from './members3d';
import { SLAB_THICKNESS } from './levels';
import { groundZ } from './fixtures';
import type { SiteSettings } from './doc';
import type { Vec3 } from './network';

export type BoxCategory = 'exteriorWall' | 'interiorWall' | 'floor' | 'ceiling' | 'door' | 'window' | 'member';

export type Box = {
  key: string;
  elementId: string;
  /** 属する階（階ごとの表示に使う） */
  floorId: string;
  category: BoxCategory;
  /** 中心(mm, 共通座標) */
  center: Vec3;
  /** x=長さ方向(壁長), y=厚み, z=高さ (mm) */
  size: { x: number; y: number; z: number };
  /** 平面上の回転(rad)。x軸から長さ方向へ */
  rotationZ: number;
};

const CEILING_THICKNESS = 10;

/**
 * 壁端の延長量。角に一直線の続きの壁がなく、角度のついた壁がある場合（出隅・入隅・T字の足）に、
 * それらの最大厚さ/2 だけ延長して角の欠けを埋める。
 */
function endExtension(b: Building, w: Wall, cornerId: string, ux: number, uy: number): number {
  let ext = 0;
  for (const o of Object.values(b.walls)) {
    if (o.id === w.id || (o.a !== cornerId && o.b !== cornerId)) continue;
    const far = b.corners[o.a === cornerId ? o.b : o.a], here = b.corners[cornerId];
    const lo = Math.hypot(far.x - here.x, far.y - here.y);
    const cross = (ux * (far.y - here.y) - uy * (far.x - here.x)) / lo;
    if (Math.abs(cross) <= 0.1) return 0; // 一直線の続きがある
    ext = Math.max(ext, o.thickness / 2);
  }
  return ext;
}

function wallPieces(b: Building, w: Wall, elevation: number, clearHeight: number): Box[] {
  const A = b.corners[w.a], B = b.corners[w.b];
  const L = wallLength(b, w.id);
  const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
  const extA = endExtension(b, w, w.a, ux, uy), extB = endExtension(b, w, w.b, ux, uy);
  const rot = Math.atan2(uy, ux);
  const cat: BoxCategory = w.kind === 'exterior' ? 'exteriorWall' : 'interiorWall';
  const out: Box[] = [];
  const piece = (s0: number, s1: number, z0: number, z1: number, tag: string, category: BoxCategory = cat, thickness = w.thickness, id = w.id) => {
    if (s1 - s0 <= 1e-6 || z1 - z0 <= 1e-6) return;
    const sm = (s0 + s1) / 2;
    out.push({
      key: `${id}:${tag}`,
      elementId: id,
      floorId: w.floorId,
      category,
      center: { x: A.x + ux * sm, y: A.y + uy * sm, z: elevation + (z0 + z1) / 2 },
      size: { x: s1 - s0, y: thickness, z: z1 - z0 },
      rotationZ: rot,
    });
  };
  const ops: Opening[] = Object.values(b.openings).filter((o) => o.wallId === w.id).sort((p, q) => p.offset - q.offset);
  let s = -extA;
  ops.forEach((o, i) => {
    const lo = o.offset - o.width / 2, hi = o.offset + o.width / 2;
    const top = Math.min(clearHeight, o.sill + o.height);
    piece(s, lo, 0, clearHeight, `s${i}`);
    piece(lo, hi, top, clearHeight, `t${i}`);
    piece(lo, hi, 0, o.sill, `b${i}`);
    piece(lo, hi, o.sill, top, o.type, o.type, o.type === 'window' ? 20 : 40, o.id);
    s = Math.max(s, hi);
  });
  piece(s, L + extB, 0, clearHeight, 'end');
  return out;
}

export function buildingBoxes(b: Building, site?: SiteSettings): Box[] {
  const out: Box[] = [];
  for (const f of b.floors) {
    const clear = f.height - f.slabThickness;
    for (const w of Object.values(b.walls)) if (w.floorId === f.id) out.push(...wallPieces(b, w, f.elevation, clear));
    // 床スラブ・天井: 階ごとに1枚。壁の外形（壁厚の半分を外側へ）、壁がなければ部屋の外形
    const walls = Object.values(b.walls).filter((w) => w.floorId === f.id);
    const pts = walls.length
      ? walls.flatMap((w) => [w.a, w.b].map((c) => ({ x: b.corners[c].x, y: b.corners[c].y, pad: w.thickness / 2 })))
      : Object.values(b.rooms).filter((r) => r.floorId === f.id).flatMap((r) => r.polygon.map((p) => ({ ...p, pad: 0 })));
    if (pts.length) {
      const x0 = Math.min(...pts.map((p) => p.x - p.pad)), x1 = Math.max(...pts.map((p) => p.x + p.pad));
      const y0 = Math.min(...pts.map((p) => p.y - p.pad)), y1 = Math.max(...pts.map((p) => p.y + p.pad));
      const base = { elementId: f.id, floorId: f.id, rotationZ: 0 };
      out.push({ ...base, key: `${f.id}:floor`, category: 'floor', center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: f.elevation - f.slabThickness / 2 }, size: { x: x1 - x0, y: y1 - y0, z: f.slabThickness } });
      out.push({ ...base, key: `${f.id}:ceiling`, category: 'ceiling', center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: f.elevation + clear - CEILING_THICKNESS / 2 }, size: { x: x1 - x0, y: y1 - y0, z: CEILING_THICKNESS } });
    }
  }
  // 床下の底（ベタ基礎のスラブ）: いちばん下の階の外形いっぱい、天端が foundation.slabTop
  const f0 = [...b.floors].sort((p, q) => p.elevation - q.elevation)[0];
  const walls0 = f0 ? Object.values(b.walls).filter((w) => w.floorId === f0.id) : [];
  if (b.foundation && walls0.length) {
    const pts = walls0.flatMap((w) => [w.a, w.b].map((c) => ({ x: b.corners[c].x, y: b.corners[c].y, pad: w.thickness / 2 })));
    const x0 = Math.min(...pts.map((p) => p.x - p.pad)), x1 = Math.max(...pts.map((p) => p.x + p.pad));
    const y0 = Math.min(...pts.map((p) => p.y - p.pad)), y1 = Math.max(...pts.map((p) => p.y + p.pad));
    const top = f0.elevation + b.foundation.slabTop;
    out.push({ key: `${f0.id}:foundation`, elementId: f0.id, floorId: f0.id, rotationZ: 0, category: 'floor', center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: top - SLAB_THICKNESS / 2 }, size: { x: x1 - x0, y: y1 - y0, z: SLAB_THICKNESS } });
  }
  // 基礎の目安: 基礎の立上りが無い建物で GL が床より下なら、外壁の下を GL まで埋める（建物が浮いて見えないように）。外壁の一部として選べる
  const hasFooting = Object.values(b.members ?? {}).some((m) => m.kind === 'footing');
  if (f0 && site?.designGL !== undefined && !hasFooting) {
    const gl = groundZ(b, site), under = f0.elevation - f0.slabThickness;
    if (under - gl > 1) for (const w of walls0.filter((x) => x.kind === 'exterior')) {
      const A = b.corners[w.a], B = b.corners[w.b], L = Math.hypot(B.x - A.x, B.y - A.y);
      if (L < 1) continue;
      out.push({ key: `${w.id}:skirt`, elementId: w.id, floorId: f0.id, category: 'exteriorWall', center: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, z: (gl + under) / 2 }, size: { x: L + w.thickness, y: w.thickness, z: under - gl }, rotationZ: Math.atan2(B.y - A.y, B.x - A.x) });
    }
  }
  out.push(...memberBoxes(b));
  return out;
}
