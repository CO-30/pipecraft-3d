/**
 * 建物モデル（階・角・壁・開口部・部屋）。共通座標(mm)の平面座標で保持し、高さは階の elevation/height から求める。
 * 壁は芯線（中心線）で表す。すべて純粋関数。不変条件を壊す操作は元の Building を返す。
 */
import { newId } from './id';

import type { Member } from './members';

export type Vec2 = { x: number; y: number };

export type Floor = {
  id: string;
  name: string;
  /** 床面の高さ(mm)。下の階の elevation + height で自動計算 */
  elevation: number;
  /** 階高(mm)：床から上階の床まで */
  height: number;
  slabThickness: number;
};
export type Corner = { id: string; floorId: string; x: number; y: number };
export type WallKind = 'exterior' | 'interior';
/** lengthSet: false = 手描きで寸法未確定（「?」表示）。省略は確定扱い */
export type Wall = { id: string; floorId: string; a: string; b: string; thickness: number; kind: WallKind; lengthSet?: boolean };
export type OpeningType = 'door' | 'window';
export type Opening = {
  id: string;
  wallId: string;
  type: OpeningType;
  /** 壁の a 端から開口中心までの距離(mm) */
  offset: number;
  width: number;
  height: number;
  /** 床からの下端高さ(mm) */
  sill: number;
};
export type Room = { id: string; floorId: string; name: string; polygon: Vec2[] };

export type Building = {
  floors: Floor[];
  corners: Record<string, Corner>;
  walls: Record<string, Wall>;
  openings: Record<string, Opening>;
  rooms: Record<string, Room>;
  /** 梁・軒/庇・バルコニー・階段（省略可） */
  members?: Record<string, Member>;
};

export const SNAP_CORNER_MM = 150;
export const MIN_WALL_MM = 100;
export const DEFAULT_FLOOR_HEIGHT = 2900;
export const DEFAULT_SLAB = 200;
export const OPENING_DEFAULTS: Record<OpeningType, { width: number; height: number; sill: number }> = {
  door: { width: 800, height: 2000, sill: 0 },
  window: { width: 1200, height: 1000, sill: 900 },
};
const EPS = 1e-6;

export const emptyBuilding = (): Building => ({ floors: [], corners: {}, walls: {}, openings: {}, rooms: {} });

const d2 = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function wallLength(b: Building, wallId: string): number {
  const w = b.walls[wallId];
  return d2(b.corners[w.a], b.corners[w.b]);
}

export const wallsOnFloor = (b: Building, floorId: string) => Object.values(b.walls).filter((w) => w.floorId === floorId);
export const floorById = (b: Building, floorId: string) => b.floors.find((f) => f.id === floorId);

/** 面積(㎡) */
export function roomArea(r: Room): number {
  let s = 0;
  const p = r.polygon;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], c = p[(i + 1) % p.length];
    s += a.x * c.y - c.x * a.y;
  }
  return Math.abs(s) / 2 / 1e6;
}

function recomputeElevations(floors: Floor[]): Floor[] {
  let z = 0;
  return floors.map((f) => {
    const out = f.elevation === z ? f : { ...f, elevation: z };
    z += f.height;
    return out;
  });
}

/** 開口部が壁に収まっているか */
function openingFits(o: Opening, len: number): boolean {
  return o.width <= len + EPS && o.offset - o.width / 2 >= -EPS && o.offset + o.width / 2 <= len + EPS;
}

/** 階の天井高（階高 - 床厚） */
/** 床から天井までの高さ（階高 − 床厚） */
export function clearHeight(b: Building, floorId: string): number {
  const f = floorById(b, floorId);
  return f ? f.height - f.slabThickness : 0;
}

/** 開口部の妥当性: 壁に収まる・同じ壁の他の開口と重ならない・天井高に収まる */
function openingProblem(b: Building, o: Opening): string | null {
  const w = b.walls[o.wallId];
  if (!w || !b.corners[w.a] || !b.corners[w.b]) return '壁が存在しない';
  if (!openingFits(o, wallLength(b, o.wallId))) return '壁に収まらない';
  if (!(o.height > 0) || o.sill < 0 || o.sill + o.height > clearHeight(b, w.floorId) + EPS) return '天井高に収まらない';
  for (const p of Object.values(b.openings)) {
    if (p.id === o.id || p.wallId !== o.wallId) continue;
    if (Math.abs(p.offset - o.offset) < (p.width + o.width) / 2 - EPS) return '他の開口と重なる';
  }
  return null;
}

/** 壁の整合性（長さ・開口部・重複）が保たれているかを、変更された壁だけ検査 */
export function wallsOk(b: Building, wallIds: Iterable<string>): boolean {
  const ids = new Set(wallIds);
  const pairs = new Set<string>();
  for (const w of Object.values(b.walls)) {
    const k = pairKey(w.a, w.b);
    if (pairs.has(k)) return false;
    pairs.add(k);
  }
  for (const id of ids) {
    const w = b.walls[id];
    if (!w) continue;
    const len = wallLength(b, id);
    if (len < MIN_WALL_MM) return false;
    for (const o of Object.values(b.openings)) if (o.wallId === id && !openingFits(o, len)) return false;
  }
  return true;
}

/** 壁に属さない角を除去 */
function pruneCorners(b: Building): Building {
  const used = new Set<string>();
  for (const w of Object.values(b.walls)) { used.add(w.a); used.add(w.b); }
  const corners = Object.fromEntries(Object.entries(b.corners).filter(([id]) => used.has(id)));
  return Object.keys(corners).length === Object.keys(b.corners).length ? b : { ...b, corners };
}

// ---------- 階 ----------

export function addFloor(b: Building, opts: { copyExteriorFrom?: string; height?: number; slabThickness?: number } = {}): { b: Building; floorId: string } {
  const last = b.floors.at(-1);
  const id = newId('f');
  const floor: Floor = {
    id,
    name: `${b.floors.length + 1}階`,
    elevation: 0,
    height: opts.height ?? last?.height ?? DEFAULT_FLOOR_HEIGHT,
    slabThickness: opts.slabThickness ?? last?.slabThickness ?? DEFAULT_SLAB,
  };
  let next: Building = { ...b, floors: recomputeElevations([...b.floors, floor]) };
  if (opts.copyExteriorFrom) {
    const map = new Map<string, string>();
    const corners = { ...next.corners };
    const walls = { ...next.walls };
    for (const w of wallsOnFloor(b, opts.copyExteriorFrom).filter((x) => x.kind === 'exterior')) {
      for (const cid of [w.a, w.b]) {
        if (!map.has(cid)) {
          const nid = newId('c');
          map.set(cid, nid);
          corners[nid] = { ...b.corners[cid], id: nid, floorId: id };
        }
      }
      const wid = newId('w');
      walls[wid] = { ...w, id: wid, floorId: id, a: map.get(w.a)!, b: map.get(w.b)! };
    }
    next = { ...next, corners, walls };
  }
  return { b: next, floorId: id };
}

/** 階の設定変更。開口部が天井高に収まらなくなる変更は拒否 */
export function updateFloor(b: Building, floorId: string, patch: Partial<Pick<Floor, 'name' | 'height' | 'slabThickness'>>): Building {
  if (!floorById(b, floorId)) return b;
  if (patch.height !== undefined && !(patch.height > 0)) return b;
  if (patch.slabThickness !== undefined && !(patch.slabThickness >= 0)) return b;
  const next = { ...b, floors: recomputeElevations(b.floors.map((f) => (f.id === floorId ? { ...f, ...patch } : f))) };
  if (clearHeight(next, floorId) <= 0) return b;
  for (const o of Object.values(next.openings)) if (next.walls[o.wallId]?.floorId === floorId && openingProblem(next, o)) return b;
  return next;
}

/** 階を削除（その階の壁・開口・部屋も削除）。最後の1階は削除しない */
export function deleteFloor(b: Building, floorId: string): Building {
  if (b.floors.length <= 1 || !floorById(b, floorId)) return b;
  const walls = Object.fromEntries(Object.entries(b.walls).filter(([, w]) => w.floorId !== floorId));
  const openings = Object.fromEntries(Object.entries(b.openings).filter(([, o]) => walls[o.wallId]));
  const rooms = Object.fromEntries(Object.entries(b.rooms).filter(([, r]) => r.floorId !== floorId));
  const corners = Object.fromEntries(Object.entries(b.corners).filter(([, c]) => c.floorId !== floorId));
  const members = Object.fromEntries(Object.entries(b.members ?? {}).filter(([, m]) => m.floorId !== floorId));
  return { floors: recomputeElevations(b.floors.filter((f) => f.id !== floorId)), corners, walls, openings, rooms, ...(b.members ? { members } : {}) };
}

// ---------- 壁 ----------

/** 壁を a 端から距離 s の位置で分割。開口部の範囲内ならその外側へずらす。分割できなければ null */
function splitWallAt(b: Building, wallId: string, sIn: number): { b: Building; cornerId: string } | null {
  const w = b.walls[wallId];
  const A = b.corners[w.a], B = b.corners[w.b];
  const L = d2(A, B);
  let s = sIn;
  const ops = Object.values(b.openings).filter((o) => o.wallId === wallId);
  for (const o of ops) {
    const lo = o.offset - o.width / 2, hi = o.offset + o.width / 2;
    if (s > lo && s < hi) s = s - lo < hi - s ? lo : hi;
  }
  if (s < MIN_WALL_MM || s > L - MIN_WALL_MM) return null;
  const cid = newId('c');
  const corner: Corner = { id: cid, floorId: w.floorId, x: A.x + ((B.x - A.x) * s) / L, y: A.y + ((B.y - A.y) * s) / L };
  const w1: Wall = { ...w, id: newId('w'), b: cid };
  const w2: Wall = { ...w, id: newId('w'), a: cid };
  const walls = { ...b.walls };
  delete walls[wallId];
  walls[w1.id] = w1;
  walls[w2.id] = w2;
  const openings = { ...b.openings };
  for (const o of ops) {
    openings[o.id] = o.offset <= s ? { ...o, wallId: w1.id } : { ...o, wallId: w2.id, offset: o.offset - s };
  }
  return { b: { ...b, corners: { ...b.corners, [cid]: corner }, walls, openings }, cornerId: cid };
}

/** 点を既存の角／壁にスナップして角IDを得る（必要なら壁を分割、なければ新しい角） */
function resolveCorner(b: Building, floorId: string, p: Vec2): { b: Building; cornerId: string } {
  let best: Corner | null = null, bestD = SNAP_CORNER_MM;
  for (const c of Object.values(b.corners)) {
    if (c.floorId !== floorId) continue;
    const d = d2(c, p);
    if (d <= bestD) { best = c; bestD = d; }
  }
  if (best) return { b, cornerId: best.id };
  for (const w of wallsOnFloor(b, floorId)) {
    const A = b.corners[w.a], B = b.corners[w.b];
    const L = d2(A, B);
    const t = ((p.x - A.x) * (B.x - A.x) + (p.y - A.y) * (B.y - A.y)) / (L * L);
    if (t <= 0 || t >= 1) continue;
    const proj = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
    if (d2(proj, p) <= Math.max(SNAP_CORNER_MM, w.thickness / 2)) {
      const r = splitWallAt(b, w.id, t * L);
      if (r) return r;
    }
  }
  const id = newId('c');
  return { b: { ...b, corners: { ...b.corners, [id]: { id, floorId, x: p.x, y: p.y } } }, cornerId: id };
}

/**
 * 壁を追加。端点は既存の角（150mm以内）に接続し、壁の途中なら壁を分割してT字接続する。
 * 短すぎる・既存と重複する壁は作らない（元の Building を返す）。
 */
export function addWall(b: Building, floorId: string, p: Vec2, q: Vec2, opts: { thickness?: number; kind?: WallKind } = {}): { b: Building; wallIds: string[] } {
  if (!floorById(b, floorId) || d2(p, q) < MIN_WALL_MM) return { b, wallIds: [] };
  const r1 = resolveCorner(b, floorId, p);
  const r2 = resolveCorner(r1.b, floorId, q);
  if (r1.cornerId === r2.cornerId) return { b, wallIds: [] };
  const id = newId('w');
  const kind = opts.kind ?? 'interior';
  const wall: Wall = { id, floorId, a: r1.cornerId, b: r2.cornerId, thickness: opts.thickness ?? (kind === 'exterior' ? 150 : 120), kind };
  const next = { ...r2.b, walls: { ...r2.b.walls, [id]: wall } };
  if (!wallsOk(next, [id])) return { b, wallIds: [] };
  return { b: next, wallIds: [id] };
}

/** 部屋の頂点のうち、移動前の角位置（1mm以内）にあるものを角と一緒に動かす */
const ROOM_FOLLOW_MM = 1;
/** 多角形が自己交差していないか（隣接しない辺どうしが交わらない） */
export function isSimplePolygon(p: Vec2[]): boolean {
  const n = p.length;
  const orient = (a: Vec2, c: Vec2, d: Vec2) => Math.sign((c.x - a.x) * (d.y - a.y) - (c.y - a.y) * (d.x - a.x));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = p[i], c = p[(i + 1) % n], d = p[j], e = p[(j + 1) % n];
      const o1 = orient(a, c, d), o2 = orient(a, c, e), o3 = orient(d, e, a), o4 = orient(d, e, c);
      if (o1 !== o2 && o3 !== o4) return false;
    }
  }
  return true;
}
const MIN_ROOM_M2 = 0.1;

/** 部屋の頂点を角に追従させる。追従で部屋がつぶれる・ねじれる場合は null（移動を拒否） */
export function followRooms(b: Building, moves: { floorId: string; from: Vec2; to: Vec2 }[]): Building | null {
  let changed = false;
  const rooms: Record<string, Room> = {};
  for (const r of Object.values(b.rooms)) {
    let rc = false;
    const polygon = r.polygon.map((v) => {
      const m = moves.find((mv) => mv.floorId === r.floorId && d2(mv.from, v) <= ROOM_FOLLOW_MM);
      if (!m) return v;
      rc = true;
      return { x: m.to.x, y: m.to.y };
    });
    if (rc && (!isSimplePolygon(polygon) || roomArea({ ...r, polygon }) < MIN_ROOM_M2)) return null;
    rooms[r.id] = rc ? { ...r, polygon } : r;
    changed ||= rc;
  }
  return changed ? { ...b, rooms } : b;
}

/** 手描きで寸法を管理している壁（lengthSet あり）の長さが変わったら未確定に戻す */
export function unsetLengths(b: Building, wallIds: string[]): Building {
  const ids = wallIds.filter((id) => b.walls[id]?.lengthSet === true);
  if (!ids.length) return b;
  const walls = { ...b.walls };
  for (const id of ids) walls[id] = { ...walls[id], lengthSet: false };
  return { ...b, walls };
}

export function moveCorner(b: Building, cornerId: string, p: Vec2): Building {
  const c = b.corners[cornerId];
  if (!c || (c.x === p.x && c.y === p.y)) return b;
  const next = { ...b, corners: { ...b.corners, [cornerId]: { ...c, x: p.x, y: p.y } } };
  const affected = Object.values(b.walls).filter((w) => w.a === cornerId || w.b === cornerId).map((w) => w.id);
  return wallsOk(next, affected) ? followRooms(unsetLengths(next, affected), [{ floorId: c.floorId, from: c, to: p }]) ?? b : b;
}

export function moveWall(b: Building, wallId: string, dx: number, dy: number): Building {
  const w = b.walls[wallId];
  if (!w || (dx === 0 && dy === 0)) return b;
  const corners = { ...b.corners };
  for (const cid of [w.a, w.b]) corners[cid] = { ...corners[cid], x: corners[cid].x + dx, y: corners[cid].y + dy };
  const next = { ...b, corners };
  const affected = Object.values(b.walls).filter((x) => [w.a, w.b].includes(x.a) || [w.a, w.b].includes(x.b)).map((x) => x.id);
  if (!wallsOk(next, affected)) return b;
  return followRooms(unsetLengths(next, affected.filter((id) => id !== wallId)), [w.a, w.b].map((cid) => ({ floorId: w.floorId, from: b.corners[cid], to: corners[cid] }))) ?? b;
}

export function updateWall(b: Building, wallId: string, patch: Partial<Pick<Wall, 'thickness' | 'kind'>>): Building {
  const w = b.walls[wallId];
  if (!w || (patch.thickness !== undefined && !(patch.thickness > 0))) return b;
  return { ...b, walls: { ...b.walls, [wallId]: { ...w, ...patch } } };
}

export function deleteWall(b: Building, wallId: string): Building {
  if (!b.walls[wallId]) return b;
  const walls = { ...b.walls };
  delete walls[wallId];
  const openings = Object.fromEntries(Object.entries(b.openings).filter(([, o]) => o.wallId !== wallId));
  return pruneCorners({ ...b, walls, openings });
}

// ---------- 開口部 ----------

export function addOpening(
  b: Building, wallId: string, type: OpeningType, offset: number,
  overrides: Partial<Pick<Opening, 'width' | 'height' | 'sill'>> = {},
): { b: Building; openingId: string | null } {
  if (!b.walls[wallId]) return { b, openingId: null };
  const L = wallLength(b, wallId);
  const spec = { ...OPENING_DEFAULTS[type], ...overrides };
  if (spec.width > L) return { b, openingId: null };
  const id = newId('o');
  const o: Opening = { id, wallId, type, ...spec, offset: Math.min(L - spec.width / 2, Math.max(spec.width / 2, offset)) };
  if (openingProblem(b, o)) return { b, openingId: null };
  return { b: { ...b, openings: { ...b.openings, [id]: o } }, openingId: id };
}

export function updateOpening(b: Building, openingId: string, patch: Partial<Pick<Opening, 'offset' | 'width' | 'height' | 'sill'>>): Building {
  const o = b.openings[openingId];
  if (!o) return b;
  const n = { ...o, ...patch };
  return openingProblem(b, n) ? b : { ...b, openings: { ...b.openings, [openingId]: n } };
}

export function deleteOpening(b: Building, openingId: string): Building {
  if (!b.openings[openingId]) return b;
  const openings = { ...b.openings };
  delete openings[openingId];
  return { ...b, openings };
}

// ---------- 部屋 ----------

export function addRoomRect(b: Building, floorId: string, p: Vec2, q: Vec2, name = '部屋'): { b: Building; roomId: string } {
  const id = newId('r');
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  const room: Room = { id, floorId, name, polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] };
  return { b: { ...b, rooms: { ...b.rooms, [id]: room } }, roomId: id };
}

export function renameRoom(b: Building, roomId: string, name: string): Building {
  const r = b.rooms[roomId];
  return r ? { ...b, rooms: { ...b.rooms, [roomId]: { ...r, name } } } : b;
}

export function deleteRoom(b: Building, roomId: string): Building {
  if (!b.rooms[roomId]) return b;
  const rooms = { ...b.rooms };
  delete rooms[roomId];
  return { ...b, rooms };
}

// ---------- 作成・検証 ----------

export function createBuildingFromDims(d: { width: number; depth: number; floors: number; floorHeight: number; wallThickness: number; slabThickness: number }): Building {
  let b = emptyBuilding();
  const pts: Vec2[] = [{ x: 0, y: 0 }, { x: d.width, y: 0 }, { x: d.width, y: d.depth }, { x: 0, y: d.depth }];
  for (let i = 0; i < Math.max(1, d.floors); i++) {
    const f = addFloor(b, { height: d.floorHeight, slabThickness: d.slabThickness });
    b = f.b;
    for (let k = 0; k < 4; k++) b = addWall(b, f.floorId, pts[k], pts[(k + 1) % 4], { kind: 'exterior', thickness: d.wallThickness }).b;
    b = addRoomRect(b, f.floorId, pts[0], pts[2], i === 0 ? 'LDK' : `${i + 1}階ホール`).b;
  }
  return b;
}

export function validateBuilding(b: Building): string[] {
  const e: string[] = [];
  if (b.floors.length === 0) e.push('階が1つもない');
  const floorIds = new Set(b.floors.map((f) => f.id));
  if (floorIds.size !== b.floors.length) e.push('階IDの重複');
  for (const [name, rec] of [['corner', b.corners], ['wall', b.walls], ['opening', b.openings], ['room', b.rooms]] as const) {
    for (const [k, v] of Object.entries(rec)) if (k !== v.id) e.push(`${name} ${k}: キーとIDが不一致`);
  }
  let z = 0;
  for (const f of b.floors) {
    if (f.elevation !== z) e.push(`floor ${f.id}: 高さ不整合`);
    if (!(f.height > 0)) e.push(`floor ${f.id}: 階高不正`);
    z += f.height;
  }
  const used = new Set<string>();
  const pairs = new Set<string>();
  for (const w of Object.values(b.walls)) {
    const A = b.corners[w.a], B = b.corners[w.b];
    if (!A || !B) { e.push(`wall ${w.id}: 角が存在しない`); continue; }
    if (!floorIds.has(w.floorId) || A.floorId !== w.floorId || B.floorId !== w.floorId) e.push(`wall ${w.id}: 階不一致`);
    if (d2(A, B) < MIN_WALL_MM) e.push(`wall ${w.id}: 短すぎる`);
    const k = pairKey(w.a, w.b);
    if (pairs.has(k)) e.push(`wall ${w.id}: 重複`);
    pairs.add(k);
    used.add(w.a); used.add(w.b);
  }
  for (const c of Object.values(b.corners)) if (!used.has(c.id)) e.push(`corner ${c.id}: 孤立`);
  for (const o of Object.values(b.openings)) {
    const p = openingProblem(b, o);
    if (p) e.push(`opening ${o.id}: ${p}`);
  }
  for (const r of Object.values(b.rooms)) {
    if (!floorIds.has(r.floorId)) e.push(`room ${r.id}: 階が存在しない`);
    if (r.polygon.length < 3) e.push(`room ${r.id}: 形状不正`);
  }
  return e;
}
