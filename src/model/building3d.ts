/**
 * 建物 → 3D表示用の箱リスト（純粋関数）。表示データであり保存しない。
 * 壁は開口部を避けて分割した箱。床スラブ・天井は部屋ポリゴンの外接矩形（Phase 1 は矩形部屋）。
 */
import type { Building, Opening, Wall } from './building';
import { wallLength } from './building';
import type { Vec3 } from './network';

export type BoxCategory = 'exteriorWall' | 'interiorWall' | 'floor' | 'ceiling' | 'door' | 'window';

export type Box = {
  key: string;
  elementId: string;
  category: BoxCategory;
  /** 中心(mm, 共通座標) */
  center: Vec3;
  /** x=長さ方向(壁長), y=厚み, z=高さ (mm) */
  size: { x: number; y: number; z: number };
  /** 平面上の回転(rad)。x軸から長さ方向へ */
  rotationZ: number;
};

const CEILING_THICKNESS = 10;

function wallPieces(b: Building, w: Wall, elevation: number, clearHeight: number): Box[] {
  const A = b.corners[w.a], B = b.corners[w.b];
  const L = wallLength(b, w.id);
  const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
  const rot = Math.atan2(uy, ux);
  const cat: BoxCategory = w.kind === 'exterior' ? 'exteriorWall' : 'interiorWall';
  const out: Box[] = [];
  const piece = (s0: number, s1: number, z0: number, z1: number, tag: string, category: BoxCategory = cat, thickness = w.thickness, id = w.id) => {
    if (s1 - s0 <= 1e-6 || z1 - z0 <= 1e-6) return;
    const sm = (s0 + s1) / 2;
    out.push({
      key: `${id}:${tag}`,
      elementId: id,
      category,
      center: { x: A.x + ux * sm, y: A.y + uy * sm, z: elevation + (z0 + z1) / 2 },
      size: { x: s1 - s0, y: thickness, z: z1 - z0 },
      rotationZ: rot,
    });
  };
  const ops: Opening[] = Object.values(b.openings).filter((o) => o.wallId === w.id).sort((p, q) => p.offset - q.offset);
  let s = 0;
  ops.forEach((o, i) => {
    const lo = o.offset - o.width / 2, hi = o.offset + o.width / 2;
    const top = Math.min(clearHeight, o.sill + o.height);
    piece(s, lo, 0, clearHeight, `s${i}`);
    piece(lo, hi, top, clearHeight, `t${i}`);
    piece(lo, hi, 0, o.sill, `b${i}`);
    piece(lo, hi, o.sill, top, o.type, o.type, o.type === 'window' ? 20 : 40, o.id);
    s = Math.max(s, hi);
  });
  piece(s, L, 0, clearHeight, 'end');
  return out;
}

export function buildingBoxes(b: Building): Box[] {
  const out: Box[] = [];
  for (const f of b.floors) {
    const clear = f.height - f.slabThickness;
    for (const w of Object.values(b.walls)) if (w.floorId === f.id) out.push(...wallPieces(b, w, f.elevation, clear));
    for (const r of Object.values(b.rooms)) {
      if (r.floorId !== f.id) continue;
      const xs = r.polygon.map((p) => p.x), ys = r.polygon.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const base = { elementId: r.id, rotationZ: 0 };
      out.push({ ...base, key: `${r.id}:floor`, category: 'floor', center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: f.elevation - f.slabThickness / 2 }, size: { x: x1 - x0, y: y1 - y0, z: f.slabThickness } });
      out.push({ ...base, key: `${r.id}:ceiling`, category: 'ceiling', center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: f.elevation + clear - CEILING_THICKNESS / 2 }, size: { x: x1 - x0, y: y1 - y0, z: CEILING_THICKNESS } });
    }
  }
  return out;
}
