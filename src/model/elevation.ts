/**
 * 立面（外壁を外から正面に見た面）。外壁の写真を実寸で敷き、その上で配管を描く。
 * 立面座標: u = 外から見た左端からの距離(mm)、v = 基準の床からの高さ(mm)。
 * 3D 座標 = origin + dir·u + normal·(faceOffset + depth)、z = baseZ + v。
 * depth = 外壁の表面から配管の中心まで（取付: T字金具なら 浮かせ寸法 + 口径/2、サドル直付けなら 口径/2）。
 */
import { clearHeight, floorById, type Building, type Vec2 } from './building';
import { newId } from './id';
import { isWire } from './fittings';
import { validateNetwork, type Network, type PipeNode, type Vec3 } from './network';

export type MountType = 'tBracket' | 'saddle';
/** 外壁への配管の取付。standoff = 壁の表面から配管の表面までのすき間(mm) */
export type WallMount = { type: MountType; standoff: number };
export const DEFAULT_MOUNT: WallMount = { type: 'tBracket', standoff: 60 };
export const MOUNT_LABEL: Record<MountType, string> = { tBracket: 'T字金具（浮かせ）', saddle: 'サドル直付け' };

export type ElevationPhoto = { src: string; w: number; h: number };
export type Elevation = {
  id: string;
  label: string;
  /** 元にした壁（壁がない場合は未設定） */
  wallId?: string;
  floorId: string;
  /** 外から見た左端（壁芯上）の平面座標 */
  origin: Vec2;
  /** 左→右の単位ベクトル */
  dir: Vec2;
  /** 外向きの単位ベクトル */
  normal: Vec2;
  /** 壁芯から外壁の表面まで(mm) = 壁厚/2 */
  faceOffset: number;
  /** 基準の床の高さ(mm) */
  baseZ: number;
  /** 実測の横幅・高さ(mm) */
  width: number;
  height: number;
  mount: WallMount;
  /** 正面に補正した写真（画像の幅 = width、高さ = height） */
  photo?: ElevationPhoto;
  opacity: number;
};

const norm = (v: Vec2): Vec2 => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };

/** 階の床から最上階の上端まで(mm) */
export function facadeHeight(b: Building, floorId: string): number {
  const f = floorById(b, floorId);
  const top = b.floors.at(-1);
  if (!f || !top) return 3000;
  return Math.max(clearHeight(b, floorId), top.elevation + top.height - f.elevation);
}

/** 壁から立面を作る。外向きは、その階の角の重心から離れる向き */
export function elevationFromWall(b: Building, wallId: string, opts: { width?: number; height?: number; label?: string } = {}): Elevation {
  const w = b.walls[wallId];
  const A = b.corners[w.a], B = b.corners[w.b];
  const d = norm({ x: B.x - A.x, y: B.y - A.y });
  const cs = Object.values(b.corners).filter((c) => c.floorId === w.floorId);
  const cx = cs.reduce((s, c) => s + c.x, 0) / cs.length, cy = cs.reduce((s, c) => s + c.y, 0) / cs.length;
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  // 壁が1枚だけ（重心が壁の上）なら、a→b の右側を外とする（東向きに描いた壁なら南面）
  let n: Vec2 = { x: d.y, y: -d.x };
  const side = n.x * (mid.x - cx) + n.y * (mid.y - cy);
  if (side < -1e-6) n = { x: -n.x, y: -n.y };
  // 外から壁を見る向き = -n。そのときの右手方向 = (-n.y, n.x)
  const right = { x: -n.y, y: n.x };
  const aLeft = d.x * right.x + d.y * right.y > 0;
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  const f = floorById(b, w.floorId);
  return {
    id: newId('el'),
    label: opts.label ?? `${dirName(n)}面`,
    wallId,
    floorId: w.floorId,
    origin: aLeft ? { x: A.x, y: A.y } : { x: B.x, y: B.y },
    dir: aLeft ? d : { x: -d.x, y: -d.y },
    normal: n,
    faceOffset: w.thickness / 2,
    baseZ: f?.elevation ?? 0,
    width: opts.width ?? len,
    height: opts.height ?? facadeHeight(b, w.floorId),
    mount: { ...DEFAULT_MOUNT },
    opacity: 0.85,
  };
}

/** 壁がないときの立面（原点から東へ、南向き） */
export function elevationStandalone(floorId: string, width: number, height: number, baseZ = 0): Elevation {
  return {
    id: newId('el'), label: '外壁', floorId, origin: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, normal: { x: 0, y: -1 },
    faceOffset: 0, baseZ, width, height, mount: { ...DEFAULT_MOUNT }, opacity: 0.85,
  };
}

export function dirName(n: Vec2): string {
  const a = (Math.atan2(n.y, n.x) * 180) / Math.PI; // 0 = 東, 90 = 北
  const names = ['東', '北東', '北', '北西', '西', '南西', '南', '南東'];
  return names[(Math.round(a / 45) + 8) % 8];
}

/** 外壁の表面から配管の中心まで(mm) */
export const pipeDepth = (el: Pick<Elevation, 'mount'>, diameter: number) =>
  (el.mount.type === 'saddle' ? 0 : el.mount.standoff) + diameter / 2;

/** 立面座標 → 3D */
export function elevToWorld(el: Elevation, u: number, v: number, diameter: number, depth = pipeDepth(el, diameter)): Vec3 {
  const k = el.faceOffset + depth;
  const r = (x: number) => Math.round(x * 1000) / 1000 + 0; // -0 を 0 に
  return { x: r(el.origin.x + el.dir.x * u + el.normal.x * k), y: r(el.origin.y + el.dir.y * u + el.normal.y * k), z: r(el.baseZ + v) };
}

/** 3D → 立面座標（depth = 外壁の表面からの距離） */
export function worldToElev(el: Elevation, p: Vec3): { u: number; v: number; depth: number } {
  const dx = p.x - el.origin.x, dy = p.y - el.origin.y;
  return { u: dx * el.dir.x + dy * el.dir.y, v: p.z - el.baseZ, depth: dx * el.normal.x + dy * el.normal.y - el.faceOffset };
}

export type UV = { u: number; v: number };
/** 前の点から tolDeg 以内なら水平・垂直にそろえる */
export function snapOrtho(prev: UV, p: UV, tolDeg = 10): UV {
  const du = p.u - prev.u, dv = p.v - prev.v;
  if (Math.hypot(du, dv) < 1e-9) return p;
  const ang = Math.abs((Math.atan2(dv, du) * 180) / Math.PI);
  if (ang <= tolDeg || ang >= 180 - tolDeg) return { u: p.u, v: prev.v };
  if (Math.abs(ang - 90) <= tolDeg) return { u: prev.u, v: p.v };
  return p;
}

/** この立面の近く（壁の表面から外へ -50〜maxDepth mm、横は面の範囲＋余白）にあるノード */
export function faceNodes(net: Network, el: Elevation, maxDepth = 400): PipeNode[] {
  const m = 300;
  return Object.values(net.nodes).filter((n) => {
    const e = worldToElev(el, n.pos);
    return e.depth >= -50 && e.depth <= maxDepth && e.u >= -m && e.u <= el.width + m && e.v >= -m - 1000 && e.v <= el.height + m;
  });
}

/**
 * 取付の変更をこの面に描いた配管（segment.face = el.id）に反映する。
 * ノードを壁の法線方向だけ動かして、壁の表面からの距離を 新しい取付の値 にする（高さ・横位置は変えない）。
 * 支持金具の種類も取付に合わせる（配線は除く）。この面以外の配管ともつながるノード（壁の貫通・別の面への回り込み）は動かさない。
 * 配管が壊れる場合は null。
 */
export function applyMount(net: Network, el: Elevation): Network | null {
  const segs = Object.values(net.segments).filter((s) => s.face === el.id);
  if (!segs.length) return net;
  const shared = new Set<string>();
  for (const s of Object.values(net.segments)) if (s.face !== el.id) { shared.add(s.a); shared.add(s.b); }
  const dia = new Map<string, number>();
  for (const s of segs) for (const id of [s.a, s.b]) dia.set(id, Math.max(dia.get(id) ?? 0, s.diameter));
  const nodes = { ...net.nodes };
  for (const [id, d] of dia) {
    const n = nodes[id];
    if (!n || n.fixtureId || shared.has(id)) continue;
    const e = worldToElev(el, n.pos);
    const p = elevToWorld(el, e.u, e.v, d);
    nodes[id] = { ...n, pos: { ...p, z: n.pos.z } };
  }
  const segments = { ...net.segments };
  for (const s of segs) if (!isWire(s.system)) segments[s.id] = { ...s, support: el.mount.type };
  const next = { nodes, segments };
  return validateNetwork(next).length ? null : next;
}
