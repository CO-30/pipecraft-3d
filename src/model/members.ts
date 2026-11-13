/**
 * 建物の付属部材（梁・軒/庇・バルコニー・階段）と、外壁の一部の張り出し/押し込み。
 * 部材は「平面の中心線 a→b・幅・床からの高さ z0〜z1」の箱で表す（配管のぶつかり判定にもそのまま使う）。
 * 立面（外壁を外から見た図）に描いた四角・斜め線から作る。すべて純粋関数。
 */
import { MIN_WALL_MM, floorById, followRooms, isSimplePolygon, moveWall, roomArea, unsetLengths, wallLength, wallsOk, wallsOnFloor, type Building, type Opening, type Room, type Vec2, type Wall } from './building';
import { worldToElev, type Elevation, type UV } from './elevation';
import { newId } from './id';

/** footing: 基礎の立上り（図面から読み取る。高さは 1 階の床基準で負）*/
export type MemberKind = 'beam' | 'eave' | 'balcony' | 'stair' | 'footing';
export type Member = {
  id: string;
  kind: MemberKind;
  floorId: string;
  /** 平面の中心線の両端(mm)。階段は a が下、b が上 */
  a: Vec2;
  b: Vec2;
  /** 中心線に直角な幅(mm) */
  width: number;
  /** 階の床からの下端・上端(mm)。階段は a 端の床面〜b 端の床面 */
  z0: number;
  z1: number;
  /** バルコニーの外向き（手すりを付ける側） */
  outward?: Vec2;
};

export const MEMBER_LABEL: Record<MemberKind, string> = { beam: '梁', eave: '軒・庇', balcony: 'バルコニー', stair: '階段', footing: '基礎の立上り' };
export const BALCONY_SLAB = 150;
export const BALCONY_RAIL = 1100;
export const STAIR_RISE = 200;
export const STAIR_WIDTH = 900;
/** 外壁の表面と階段・バルコニーのすき間(mm) */
const GAP = 0;

const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
const add = (p: Vec2, v: Vec2, k: number): Vec2 => ({ x: p.x + v.x * k, y: p.y + v.y * k });
const r10 = (v: number) => Math.round(v / 10) * 10;

export const membersOf = (b: Building) => Object.values(b.members ?? {});

/** 平面の四隅（a 側左, b 側左, b 側右, a 側右） */
export function memberCorners(m: Pick<Member, 'a' | 'b' | 'width'>): Vec2[] {
  const L = dist(m.a, m.b) || 1;
  const n = { x: -(m.b.y - m.a.y) / L, y: (m.b.x - m.a.x) / L };
  const h = m.width / 2;
  return [add(m.a, n, h), add(m.b, n, h), add(m.b, n, -h), add(m.a, n, -h)];
}

/** 立面の高さ v（床基準 el.baseZ から）の階。最上階はその上も含む */
export function floorAtZ(b: Building, z: number) {
  const fs = b.floors;
  return fs.find((f, i) => z >= f.elevation - 1 && (i === fs.length - 1 || z < f.elevation + f.height - 1)) ?? fs[0];
}

export type FaceWall = { wall: Wall; floorId: string; offset: number; uA: number; uB: number };

/** 立面の横位置 u・高さ v にある外壁（壁芯がこの面の上にある壁）と、壁の a 端からの距離 */
export function faceWallAt(b: Building, el: Elevation, u: number, v: number): FaceWall | null {
  const f = floorAtZ(b, el.baseZ + v);
  if (!f) return null;
  let best: FaceWall | null = null;
  for (const w of wallsOnFloor(b, f.id)) {
    if (w.kind !== 'exterior') continue;
    const A = b.corners[w.a], B = b.corners[w.b];
    const ea = worldToElev(el, { x: A.x, y: A.y, z: 0 }), eb = worldToElev(el, { x: B.x, y: B.y, z: 0 });
    if (Math.abs(ea.depth + el.faceOffset) > 60 || Math.abs(eb.depth + el.faceOffset) > 60) continue;
    const lo = Math.min(ea.u, eb.u), hi = Math.max(ea.u, eb.u);
    if (u < lo - 1 || u > hi + 1) continue;
    best = { wall: w, floorId: f.id, offset: Math.abs(u - ea.u), uA: ea.u, uB: eb.u };
    break;
  }
  return best;
}

/** 立面の (u, v) → 平面座標（壁芯の線上から外向きに out mm） */
const planAt = (el: Elevation, u: number, out: number): Vec2 => add(add(el.origin, el.dir, u), el.normal, out);

export type FaceRect = { u0: number; u1: number; v0: number; v1: number };
export type MemberResult = { ok: true; b: Building; ids: string[] } | { ok: false; error: string };

export function withMember(b: Building, m: Omit<Member, 'id'>): { b: Building; id: string } {
  const id = newId('m');
  return { b: { ...b, members: { ...(b.members ?? {}), [id]: { ...m, id } } }, id };
}

/**
 * 立面の四角から 梁・軒/庇・バルコニーを作る。
 * 梁: 壁の内側の天井から下がる（四角の上端〜下端、壁の内側に幅 width）。
 * 軒・庇: 四角の上端〜下端の厚さで、外へ projection 張り出す。
 * バルコニー: 四角の下端（近い階の床にそろえる）から、外へ projection 張り出す床と手すり。
 */
export function addFaceMember(b: Building, el: Elevation, kind: Exclude<MemberKind, 'stair'>, r: FaceRect, projection: number): MemberResult {
  const u0 = Math.max(0, Math.min(r.u0, r.u1)), u1 = Math.min(el.width, Math.max(r.u0, r.u1));
  let v0 = Math.min(r.v0, r.v1);
  const v1 = Math.max(r.v0, r.v1);
  if (u1 - u0 < MIN_WALL_MM) return { ok: false, error: '幅が短すぎます' };
  if (!(projection >= 50 && projection <= 5000)) return { ok: false, error: '出幅は 50〜5000mm で入力してください' };
  if (kind === 'balcony') {
    // 下端を近い床にそろえる（300mm 以内）
    const z = el.baseZ + v0;
    const f = b.floors.find((x) => Math.abs(x.elevation - z) <= 300);
    if (f) v0 = f.elevation - el.baseZ;
  }
  const zBottom = el.baseZ + v0, zTop = el.baseZ + v1;
  const f = floorAtZ(b, kind === 'beam' ? zTop - 1 : zBottom);
  if (!f) return { ok: false, error: '階が見つかりません' };
  const face = el.faceOffset;
  let m: Omit<Member, 'id'>;
  if (kind === 'beam') {
    if (v1 - v0 < 50) return { ok: false, error: '梁の高さ（下がり）が小さすぎます' };
    // 外面を壁の外面にそろえ、内側へ幅 projection
    const c = face - projection / 2;
    m = { kind, floorId: f.id, a: planAt(el, u0, c), b: planAt(el, u1, c), width: projection, z0: Math.max(0, zBottom - f.elevation), z1: zTop - f.elevation, outward: { ...el.normal } };
  } else if (kind === 'eave') {
    const t = Math.max(100, v1 - v0);
    const c = face + projection / 2;
    m = { kind, floorId: f.id, a: planAt(el, u0, c), b: planAt(el, u1, c), width: projection, z0: zTop - t - f.elevation, z1: zTop - f.elevation, outward: { ...el.normal } };
  } else {
    const c = face + GAP + projection / 2;
    const rail = v1 - v0 >= 600 && v1 - v0 <= 1500 ? v1 - v0 : BALCONY_RAIL;
    m = { kind, floorId: f.id, a: planAt(el, u0, c), b: planAt(el, u1, c), width: projection, z0: -BALCONY_SLAB, z1: rail, outward: { ...el.normal } };
  }
  const r2 = withMember(b, m);
  return { ok: true, b: r2.b, ids: [r2.id] };
}

/** 立面の斜め線（下の端 → 上の端）から、外壁に沿った外階段を作る */
export function addFaceStair(b: Building, el: Elevation, p: UV, q: UV, width = STAIR_WIDTH): MemberResult {
  const [lo, hi] = p.v <= q.v ? [p, q] : [q, p];
  if (Math.abs(hi.u - lo.u) < 600) return { ok: false, error: '階段は斜めに線を引いてください（横の長さが足りません）' };
  if (hi.v - lo.v < 400) return { ok: false, error: '階段の高さが足りません' };
  const z0 = el.baseZ + Math.max(0, lo.v), z1 = el.baseZ + Math.min(el.height, hi.v);
  // 下端の床（地面＝最下階の床）
  const f = floorAtZ(b, z0);
  if (!f) return { ok: false, error: '階が見つかりません' };
  const c = el.faceOffset + GAP + width / 2;
  const u0 = Math.max(0, Math.min(el.width, lo.u)), u1 = Math.max(0, Math.min(el.width, hi.u));
  const m: Omit<Member, 'id'> = { kind: 'stair', floorId: f.id, a: planAt(el, u0, c), b: planAt(el, u1, c), width, z0: z0 - f.elevation, z1: z1 - f.elevation, outward: { ...el.normal } };
  const r = withMember(b, m);
  return { ok: true, b: r.b, ids: [r.id] };
}

export function updateMember(b: Building, id: string, patch: Partial<Pick<Member, 'width' | 'z0' | 'z1'>>): Building {
  const m = b.members?.[id];
  if (!m) return b;
  const n = { ...m, ...patch };
  if (!(n.width >= 50) || !(n.z1 > n.z0)) return b;
  // 幅を変えたら壁側の辺は動かさない（梁は内側へ、軒・バルコニー・階段は外側へ伸びる）
  if (patch.width !== undefined && m.outward) {
    const k = ((m.kind === 'beam' ? -1 : 1) * (n.width - m.width)) / 2;
    n.a = add(m.a, m.outward, k);
    n.b = add(m.b, m.outward, k);
  }
  return { ...b, members: { ...b.members, [id]: n } };
}

export function deleteMember(b: Building, id: string): Building {
  if (!b.members?.[id]) return b;
  const members = { ...b.members };
  delete members[id];
  return { ...b, members };
}

/** 階段の段数（蹴上げ約 STAIR_RISE） */
export const stairSteps = (m: Member) => Math.max(2, Math.round((m.z1 - m.z0) / STAIR_RISE));

// ---------- 張り出し・押し込み ----------

/**
 * 外壁の一部（a 端から o0〜o1）を外向き normal の方向へ depth だけ出す（負なら押し込む）。
 * 壁全体なら壁ごと平行移動（両隣の壁が伸び縮みする）。窓・ドアは位置に合わせて新しい壁へ移す。
 */
export function bumpWall(b: Building, wallId: string, o0: number, o1: number, depth: number, normal: Vec2): MemberResult {
  const w = b.walls[wallId];
  if (!w) return { ok: false, error: '壁が見つかりません' };
  if (Math.abs(depth) < 50) return { ok: false, error: '出す・押し込む長さは 50mm 以上にしてください' };
  const L = wallLength(b, wallId);
  let s0 = Math.max(0, Math.min(o0, o1)), s1 = Math.min(L, Math.max(o0, o1));
  const snapEnd = Math.max(MIN_WALL_MM, 200);
  // 端まで寄せるのは、その角の隣が直角の壁1本だけのとき（一直線の続き・T字の角は動かさない）
  const canMoveEnd = (cid: string) => {
    const others = Object.values(b.walls).filter((x) => x.id !== wallId && (x.a === cid || x.b === cid));
    if (others.length !== 1) return false;
    const o = others[0], P = b.corners[cid], R = b.corners[o.a === cid ? o.b : o.a];
    const Lo = dist(P, R) || 1;
    return Math.abs(((R.x - P.x) * normal.x + (R.y - P.y) * normal.y) / Lo) > 0.99;
  };
  if (s0 < snapEnd) s0 = canMoveEnd(w.a) ? 0 : Math.min(snapEnd, s1 - MIN_WALL_MM);
  if (s1 > L - snapEnd) s1 = canMoveEnd(w.b) ? L : Math.max(L - snapEnd, s0 + MIN_WALL_MM);
  if (s1 - s0 < MIN_WALL_MM) return { ok: false, error: '範囲が短すぎます' };
  if (s0 === 0 && s1 === L) {
    const nb = moveWall(b, wallId, normal.x * depth, normal.y * depth);
    return nb === b ? { ok: false, error: 'この位置には動かせません（他の壁と重なります）' } : { ok: true, b: nb, ids: [wallId] };
  }
  const ops = Object.values(b.openings).filter((o) => o.wallId === wallId);
  for (const o of ops) {
    const lo = o.offset - o.width / 2, hi = o.offset + o.width / 2;
    if ((lo < s0 - 1 && hi > s0 + 1) || (lo < s1 - 1 && hi > s1 + 1)) return { ok: false, error: '窓・ドアにかかっています。範囲を変えるか、先に窓・ドアを動かしてください' };
  }
  const A = b.corners[w.a], B = b.corners[w.b];
  const u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
  const p0 = add(A, u, s0), p1 = add(A, u, s1);
  const q0 = add(p0, normal, depth), q1 = add(p1, normal, depth);
  const corners = { ...b.corners };
  const walls = { ...b.walls };
  delete walls[wallId];
  const mkCorner = (p: Vec2) => { const id = newId('c'); corners[id] = { id, floorId: w.floorId, x: r10(p.x), y: r10(p.y) }; return id; };
  const flag = w.lengthSet === undefined ? {} : { lengthSet: false };
  const mkWall = (a: string, c: string, extra: Partial<Wall> = {}) => {
    const id = newId('w');
    walls[id] = { id, floorId: w.floorId, a, b: c, thickness: w.thickness, kind: w.kind, ...flag, ...(w.locked ? { locked: true } : {}), ...extra };
    return id;
  };
  // 端にかかる場合は端の角を動かす（隣の壁が伸び縮みする）
  const chain: string[] = [];
  const moves: { floorId: string; from: Vec2; to: Vec2 }[] = [];
  const moved: string[] = [];
  const moveEnd = (cid: string, q: Vec2) => {
    const to = { x: r10(q.x), y: r10(q.y) };
    moves.push({ floorId: w.floorId, from: { ...b.corners[cid] }, to });
    corners[cid] = { ...corners[cid], ...to };
    moved.push(cid);
  };
  if (s0 === 0) { moveEnd(w.a, q0); chain.push(w.a); }
  else { const c0 = mkCorner(p0), d0 = mkCorner(q0); chain.push(w.a, c0, d0); }
  if (s1 === L) { moveEnd(w.b, q1); chain.push(w.b); }
  else { const d1 = mkCorner(q1), c1 = mkCorner(p1); chain.push(d1, c1, w.b); }
  const newWalls: { id: string; from: number; to: number }[] = [];
  // chain の各区間に壁を作る。どの区間が元の壁のどの範囲かを記録して窓・ドアを移す
  const segRange = (i: number): { from: number; to: number } | null => {
    // 区間 i: chain[i] → chain[i+1]
    const pa = corners[chain[i]], pb = corners[chain[i + 1]];
    const along = (p: Vec2) => (p.x - A.x) * u.x + (p.y - A.y) * u.y;
    const fa = along(pa), fb = along(pb);
    if (Math.abs(fa - fb) < 1) return null; // 出し入れの側面の壁
    return { from: fa, to: fb };
  };
  for (let i = 0; i < chain.length - 1; i++) {
    const id = mkWall(chain[i], chain[i + 1], segRange(i) === null ? { lengthSet: w.lengthSet === undefined ? undefined : true } : {});
    if (walls[id].lengthSet === undefined) delete walls[id].lengthSet;
    const r = segRange(i);
    if (r) newWalls.push({ id, ...r });
  }
  const openings: Record<string, Opening> = { ...b.openings };
  for (const o of ops) {
    const nw = newWalls.find((x) => o.offset >= x.from - 1 && o.offset <= x.to + 1);
    if (!nw) return { ok: false, error: '窓・ドアを移せませんでした' };
    openings[o.id] = { ...o, wallId: nw.id, offset: o.offset - nw.from };
  }
  let nb: Building = { ...b, corners, walls, openings };
  for (const x of Object.values(nb.walls)) if (wallLength(nb, x.id) < MIN_WALL_MM) return { ok: false, error: '短くなりすぎる壁があります' };
  // 動かした角につながる壁（新しい壁と、端の角の隣の壁）が他の壁と交差・重複しないか
  const touched = Object.values(nb.walls).filter((x) => !b.walls[x.id] || moved.includes(x.a) || moved.includes(x.b)).map((x) => x.id);
  if (!wallsOk(nb, touched)) return { ok: false, error: '他の壁と重なる・交差するため作れません' };
  // 端の角を動かした隣の壁は、寸法管理中なら未確定に戻す
  nb = unsetLengths(nb, Object.values(nb.walls).filter((x) => b.walls[x.id] && (moved.includes(x.a) || moved.includes(x.b))).map((x) => x.id));
  // 部屋: 壁の線上の辺に出し入れの形を入れ、動かした角に追従させる
  const rooms = insertBumpIntoRooms(nb, w.floorId, A, u, s0, s1, p0, q0, q1, p1, s0 === 0, s1 === L);
  if (!rooms) return { ok: false, error: '部屋の形が崩れるため作れません' };
  nb = { ...nb, rooms };
  if (moves.length) {
    const fr = followRooms(nb, moves);
    if (!fr) return { ok: false, error: '部屋の形が崩れるため作れません' };
    nb = fr;
  }
  return { ok: true, b: nb, ids: newWalls.map((x) => x.id) };
}

/** 部屋の辺のうち元の壁の線上で範囲 s0〜s1 を含むものに、出し入れの4点を差し込む（端に寄せた場合は追従に任せる） */
function insertBumpIntoRooms(b: Building, floorId: string, A: Vec2, u: Vec2, s0: number, s1: number, p0: Vec2, q0: Vec2, q1: Vec2, p1: Vec2, atStart: boolean, atEnd: boolean): Record<string, Room> | null {
  const out: Record<string, Room> = {};
  const off = (p: Vec2) => Math.abs((p.x - A.x) * -u.y + (p.y - A.y) * u.x);
  const along = (p: Vec2) => (p.x - A.x) * u.x + (p.y - A.y) * u.y;
  for (const r of Object.values(b.rooms)) {
    if (r.floorId !== floorId) { out[r.id] = r; continue; }
    const poly: Vec2[] = [];
    let changed = false;
    r.polygon.forEach((v, i) => {
      poly.push(v);
      const nxt = r.polygon[(i + 1) % r.polygon.length];
      if (off(v) > 1 || off(nxt) > 1) return;
      const fa = along(v), fb = along(nxt);
      const lo = Math.min(fa, fb), hi = Math.max(fa, fb);
      if (lo > s0 + 1 || hi < s1 - 1) return;
      // 端に寄せた側の点は角の追従（followRooms）で動くので差し込まない
      const fwd = [...(atStart ? [] : [p0, q0]), ...(atEnd ? [] : [q1, p1])];
      const pts = fa <= fb ? fwd : [...fwd].reverse();
      for (const p of pts) if (Math.hypot(p.x - poly[poly.length - 1].x, p.y - poly[poly.length - 1].y) > 1 && Math.hypot(p.x - nxt.x, p.y - nxt.y) > 1) poly.push({ x: r10(p.x), y: r10(p.y) });
      changed = true;
    });
    if (changed && (!isSimplePolygon(poly) || roomArea({ ...r, polygon: poly }) < 0.1)) return null;
    out[r.id] = changed ? { ...r, polygon: poly } : r;
  }
  return out;
}

/** 立面の四角の範囲で、その高さにかかる各階の外壁を張り出す／押し込む */
export function bumpFace(b: Building, el: Elevation, r: FaceRect, depth: number): MemberResult {
  const u0 = Math.min(r.u0, r.u1), u1 = Math.max(r.u0, r.u1);
  const v0 = Math.min(r.v0, r.v1), v1 = Math.max(r.v0, r.v1);
  let nb = b;
  const ids: string[] = [];
  let hit = 0;
  for (const f of b.floors) {
    // 階の高さの半分以上が範囲に入る階だけ
    const lo = Math.max(v0, f.elevation - el.baseZ), hi = Math.min(v1, f.elevation + f.height - el.baseZ);
    if (hi - lo < f.height / 2) continue;
    const fw = faceWallAt(nb, el, (u0 + u1) / 2, f.elevation - el.baseZ + 1);
    if (!fw) continue;
    const sign = fw.uB >= fw.uA ? 1 : -1;
    const a0 = (u0 - fw.uA) * sign, a1 = (u1 - fw.uA) * sign;
    const res = bumpWall(nb, fw.wall.id, a0, a1, depth, el.normal);
    if (!res.ok) return { ok: false, error: `${floorById(b, f.id)?.name ?? ''}: ${res.error}` };
    nb = res.b;
    ids.push(...res.ids);
    hit++;
  }
  if (!hit) return { ok: false, error: '張り出し・押し込みは、四角を外壁の上に「階の高さの半分以上」かかるように描いてください' };
  return { ok: true, b: nb, ids };
}
