/**
 * 配管と建物の部材（梁・軒/庇・バルコニー）のぶつかり判定と、避け方（迂回ルート）。
 * 継手の数は迂回後の配管の曲がりから既存の自動判定（fittings.ts）でそのまま数える。
 * 貫通（スリーブ）は構造の確認が必要なため自動では選ばず、区間に印を付けて「要確認」にする。
 */
import type { Building, Vec2 } from './building';
import type { Doc } from './doc';
import { newId } from './id';
import { membersOf, type Member, type MemberKind } from './members';
import { normalize, type Network, type PipeNode, type Segment, type Vec3 } from './network';
import { isDrain } from './slope';
import { outlineLoop } from './sketch';
import { pointInPolygon } from './roomOps';

/** 部材と配管の間にとるすき間(mm) */
export const AVOID_CLEAR = 50;
export type AvoidKind = 'beam' | 'eave' | 'balcony';
export const AVOID_LABEL: Record<AvoidKind, string> = { beam: '梁かわし', eave: '軒下', balcony: 'バルコニーかわし' };

type Obstacle = { m: Member; a: Vec2; u: Vec2; n: Vec2; L: number; w: number; z0: number; z1: number };

const sub = (p: Vec3, q: Vec3): Vec3 => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
const addv = (p: Vec3, v: Vec3, k: number): Vec3 => ({ x: p.x + v.x * k, y: p.y + v.y * k, z: p.z + v.z * k });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len3 = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

function obstacles(b: Building): Obstacle[] {
  const out: Obstacle[] = [];
  for (const m of membersOf(b)) {
    // 基礎の立上りは配管が貫通（スリーブ）する前提なので、ぶつかり・かわしの対象にしない
    if (m.kind === 'stair' || m.kind === 'footing') continue;
    const f = b.floors.find((x) => x.id === m.floorId);
    if (!f) continue;
    const L = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
    if (L < 1) continue;
    const u = { x: (m.b.x - m.a.x) / L, y: (m.b.y - m.a.y) / L };
    // バルコニーは床（スラブ）だけを障害にする（手すりの内側は通れる）
    const z0 = f.elevation + m.z0, z1 = f.elevation + (m.kind === 'balcony' ? 0 : m.z1);
    out.push({ m, a: m.a, u, n: { x: -u.y, y: u.x }, L, w: m.width, z0, z1 });
  }
  return out;
}

/** 線分 p→q（半径 r）が箱の中を通る区間 [t0, t1]（0〜1）。かすめる程度（1mm 未満）なら null */
function clip(o: Obstacle, p: Vec3, q: Vec3, r: number): [number, number] | null {
  const loc = (v: Vec3) => ({ s: (v.x - o.a.x) * o.u.x + (v.y - o.a.y) * o.u.y, t: (v.x - o.a.x) * o.n.x + (v.y - o.a.y) * o.n.y, z: v.z });
  const P = loc(p), Q = loc(q);
  const lo = [-r, -o.w / 2 - r, o.z0 - r], hi = [o.L + r, o.w / 2 + r, o.z1 + r];
  const p0 = [P.s, P.t, P.z], d = [Q.s - P.s, Q.t - P.t, Q.z - P.z];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (p0[i] <= lo[i] || p0[i] >= hi[i]) return null; continue; }
    let a = (lo[i] - p0[i]) / d[i], c = (hi[i] - p0[i]) / d[i];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 >= t1) return null;
  }
  return (t1 - t0) * len3(sub(q, p)) >= 1 ? [t0, t1] : null;
}

export type Hit = { segId: string; memberId: string; kind: MemberKind; t0: number; t1: number };

/** 部材にぶつかっている区間（貫通の印を付けた部材は除く） */
export function findHits(doc: Doc, segIds?: string[]): Hit[] {
  const obs = obstacles(doc.building);
  if (!obs.length) return [];
  const net = doc.network;
  const out: Hit[] = [];
  for (const s of segIds ? segIds.map((id) => net.segments[id]).filter(Boolean) : Object.values(net.segments)) {
    const p = net.nodes[s.a].pos, q = net.nodes[s.b].pos;
    for (const o of obs) {
      if (s.penetrations?.includes(o.m.id)) continue;
      const c = clip(o, p, q, s.diameter / 2);
      if (c) out.push({ segId: s.id, memberId: o.m.id, kind: o.m.kind, t0: c[0], t1: c[1] });
    }
  }
  return out;
}

export type DetourStyle = 'square' | 'diagonal';
export type Detour = { style: DetourStyle; points: Vec3[]; dir: Vec3; h: number; label: string } | { style: DetourStyle; error: string };

const MIN_LEG = 50;

function floorOfZ(b: Building, z: number) {
  const fs = b.floors;
  return fs.find((f, i) => z >= f.elevation - 1 && (i === fs.length - 1 || z < f.elevation + f.height)) ?? null;
}

/** 平面で線分 a-b と c-d が交わるか（端の接触は除く） */
function cross2(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 1e-6 && d2 < -1e-6) || (d1 < -1e-6 && d2 > 1e-6)) && ((d3 > 1e-6 && d4 < -1e-6) || (d3 < -1e-6 && d4 > 1e-6));
}

/** 迂回ルートが、元の区間が横切っていない壁（その高さの階の壁）を横切るか */
function crossesNewWall(b: Building, P: Vec3, Q: Vec3, route: Vec3[]): boolean {
  const zl = Math.min(...route.map((p) => p.z)), zh = Math.max(...route.map((p) => p.z));
  for (const w of Object.values(b.walls)) {
    const f = b.floors.find((x) => x.id === w.floorId);
    if (!f || zh < f.elevation || zl > f.elevation + f.height) continue;
    const A = b.corners[w.a], B = b.corners[w.b];
    const before = cross2(P, Q, A, B) ? 1 : 0;
    let after = 0;
    for (let i = 0; i < route.length - 1; i++) if (cross2(route[i], route[i + 1], A, B)) after++;
    if (after > before) return true;
  }
  return false;
}

const DIR_NAME = (o: Vec3) => (o.z < -0.5 ? '下をくぐる' : o.z > 0.5 ? '上を越える' : '横へ回る');

/**
 * ぶつかった区間の迂回ルート。区間の向きに直角な候補の方向（下・上・部材の幅方向・長さ方向）のうち、
 * 部材を一番短く避けられる方向へ h だけずらす。square = 90° ×4、diagonal = 45° ×4。
 */
export function detour(doc: Doc, hit: Hit, style: DetourStyle): Detour {
  const net = doc.network, s = net.segments[hit.segId];
  const o = obstacles(doc.building).find((x) => x.m.id === hit.memberId);
  if (!s || !o) return { style, error: '区間または部材が見つかりません' };
  const P = net.nodes[s.a].pos, Q = net.nodes[s.b].pos;
  const D = sub(Q, P), L = len3(D);
  const d = { x: D.x / L, y: D.y / L, z: D.z / L };
  const r = s.diameter / 2;
  const mid = addv(P, D, (hit.t0 + hit.t1) / 2);
  const corners: Vec3[] = [];
  for (const sv of [0, o.L]) for (const tv of [-o.w / 2, o.w / 2]) for (const zv of [o.z0, o.z1]) {
    corners.push({ x: o.a.x + o.u.x * sv + o.n.x * tv, y: o.a.y + o.u.y * sv + o.n.y * tv, z: zv });
  }
  let cands: Vec3[] = [{ x: 0, y: 0, z: -1 }, { x: o.n.x, y: o.n.y, z: 0 }, { x: -o.n.x, y: -o.n.y, z: 0 }, { x: o.u.x, y: o.u.y, z: 0 }, { x: -o.u.x, y: -o.u.y, z: 0 }];
  // 梁・軒の上は天井・屋根なので上へは逃げない（バルコニーの床は上を越えられる）
  if (o.m.kind === 'balcony') cands.push({ x: 0, y: 0, z: 1 });
  // 勾配のある排水は上下に回すとトラップ（逆勾配）になるので横へだけ
  const drainLike = isDrain(s.system) || s.slope !== undefined;
  if (drainLike) cands = cands.filter((c) => c.z === 0);
  // 立面（外壁）で描いた配管は壁の面の中でだけ回す
  const face = s.face ? doc.elevations?.[s.face] : undefined;
  if (face) cands = cands.filter((c) => Math.abs(c.x * face.normal.x + c.y * face.normal.y) < 0.5);
  let best: { dir: Vec3; h: number } | null = null;
  for (const c0 of cands) {
    // 区間の向きと直交する成分だけ使う
    // 横へ回すときは水平に（勾配の向きに引きずられて斜めにしない）
    const dd = c0.z === 0 ? (() => { const hl = Math.hypot(d.x, d.y) || 1; return { x: d.x / hl, y: d.y / hl, z: 0 }; })() : d;
    const k = dot(c0, dd);
    const c = { x: c0.x - dd.x * k, y: c0.y - dd.y * k, z: c0.z - dd.z * k };
    const cl = len3(c);
    if (cl < 0.7) continue;
    const dir = { x: c.x / cl, y: c.y / cl, z: c.z / cl };
    // 壁の中へは回らない: 軒・バルコニーは建物側へ、梁は外側（壁の中）へ逃げない
    const out = o.m.outward ? dir.x * o.m.outward.x + dir.y * o.m.outward.y : 0;
    if ((o.m.kind === 'beam' && out > 0.5) || (o.m.kind !== 'beam' && out < -0.5)) continue;
    const h = Math.max(...corners.map((v) => dot(sub(v, mid), dir))) + r + AVOID_CLEAR;
    if (h <= 0) continue;
    if (!best || h < best.h) best = { dir, h: Math.ceil(h / 10) * 10 };
  }
  if (!best) return { style, error: drainLike ? '勾配のある排水は横にしか回せませんが、横に回る方向がありません（貫通を検討してください）' : '避ける方向が見つかりません' };
  const m = r + AVOID_CLEAR;
  const sIn = hit.t0 * L - m, sOut = hit.t1 * L + m;
  const need = style === 'diagonal' ? best.h : 0;
  if (sIn - need < MIN_LEG || sOut + need > L - MIN_LEG) return { style, error: '区間の端が部材に近すぎて回れません（区間を長くするか、端を動かしてください）' };
  const p1 = addv(P, d, sIn - need), p4 = addv(P, d, sOut + need);
  const p2 = style === 'square' ? addv(p1, best.dir, best.h) : addv(addv(p1, d, best.h), best.dir, best.h);
  const p3 = style === 'square' ? addv(p4, best.dir, best.h) : addv(addv(p4, d, -best.h), best.dir, best.h);
  const points = [p1, p2, p3, p4].map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) }));
  // 床より下へは回らない
  const fl = floorOfZ(doc.building, Math.min(P.z, Q.z));
  if (fl && Math.min(...points.map((p) => p.z)) < fl.elevation + r) return { style, error: '床より下になるため回れません' };
  // 回った先で、元の配管が通っていない壁を横切らない
  if (crossesNewWall(doc.building, P, Q, [P, ...points, Q])) return { style, error: '回った先で壁を横切ります' };
  // 迂回した先で別の部材にぶつからないか
  const test: Doc = { ...doc, network: applyPoints(net, s, points, o.m.kind as AvoidKind).net };
  const newSegs = Object.keys(test.network.segments).filter((id) => !net.segments[id]);
  if (findHits(test, newSegs).length) return { style, error: '回った先で別の部材にぶつかります' };
  return { style, points, dir: best.dir, h: best.h, label: `${DIR_NAME(best.dir)}（${best.h}mm ずらす）` };
}

function applyPoints(net: Network, s: Segment, points: Vec3[], avoid: AvoidKind): { net: Network; segIds: string[] } {
  const nodes = { ...net.nodes };
  const segments = { ...net.segments };
  delete segments[s.id];
  const ids = [s.a];
  const floorId = net.nodes[s.a].floorId ?? net.nodes[s.b].floorId;
  for (const p of points) {
    const id = newId('n');
    const node: PipeNode = { id, kind: 'joint', pos: p, avoid, ...(floorId ? { floorId } : {}) };
    nodes[id] = node;
    ids.push(id);
  }
  ids.push(s.b);
  const { measuredLength: _m, measuredApprox: _a, ...attrs } = s;
  const segIds: string[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const id = newId('s');
    const seg: Segment = { ...attrs, id, a: ids[i], b: ids[i + 1] };
    // 迂回の脚（2本目・4本目）には勾配を付けない
    if (i === 1 || i === 3) delete seg.slope;
    segments[id] = seg;
    segIds.push(id);
  }
  return { net: normalize({ nodes, segments }), segIds };
}

export type AvoidResult = { ok: true; doc: Doc; segIds: string[] } | { ok: false; error: string };

/** 迂回する（実測長が入っている区間は上書きしないため拒否） */
export function applyDetour(doc: Doc, hit: Hit, style: DetourStyle): AvoidResult {
  const s = doc.network.segments[hit.segId];
  if (!s) return { ok: false, error: '区間が見つかりません' };
  if (s.measuredLength !== undefined) return { ok: false, error: '実測長が入っている区間は自動で回せません（実測長を消すか、手で描き直してください）' };
  const dt = detour(doc, hit, style);
  if ('error' in dt) return { ok: false, error: dt.error };
  const r = applyPoints(doc.network, s, dt.points, hit.kind as AvoidKind);
  return { ok: true, doc: { ...doc, network: r.net }, segIds: r.segIds };
}

/** 貫通する（スリーブ）。区間に印を付け、積算では「要確認」にする */
export function markPenetration(doc: Doc, hit: Hit, on = true): Doc {
  const s = doc.network.segments[hit.segId];
  if (!s) return doc;
  const cur = s.penetrations ?? [];
  const penetrations = on ? [...new Set([...cur, hit.memberId])] : cur.filter((x) => x !== hit.memberId);
  const next: Segment = { ...s, penetrations };
  if (!penetrations.length) delete next.penetrations;
  return { ...doc, network: { ...doc.network, segments: { ...doc.network.segments, [s.id]: next } } };
}

/** 貫通の印のうち、まだ実際に部材を通っているもの（スリーブの数） */
export function penetrationsOf(doc: Doc): { segId: string; memberId: string; kind: MemberKind }[] {
  const obs = obstacles(doc.building);
  const out: { segId: string; memberId: string; kind: MemberKind }[] = [];
  for (const s of Object.values(doc.network.segments)) {
    for (const mid of s.penetrations ?? []) {
      const o = obs.find((x) => x.m.id === mid);
      if (o && clip(o, doc.network.nodes[s.a].pos, doc.network.nodes[s.b].pos, s.diameter / 2)) out.push({ segId: s.id, memberId: mid, kind: o.m.kind });
    }
  }
  return out;
}

/**
 * 継手の点がどこで使われているか（数量表の内訳用）。
 * 迂回で作った点 → 梁かわし・軒下 等。軒の下 400mm 以内で軒の範囲 → 軒下。外壁の角の近く(400mm) → 出隅・入隅。
 */
export function fittingContext(doc: Doc, nodeId: string): string | null {
  const n = doc.network.nodes[nodeId];
  if (!n) return null;
  if (n.avoid) return AVOID_LABEL[n.avoid];
  const b = doc.building;
  for (const o of obstacles(b)) {
    if (o.m.kind !== 'eave') continue;
    const s = (n.pos.x - o.a.x) * o.u.x + (n.pos.y - o.a.y) * o.u.y, t = (n.pos.x - o.a.x) * o.n.x + (n.pos.y - o.a.y) * o.n.y;
    if (s >= -100 && s <= o.L + 100 && Math.abs(t) <= o.w / 2 + 100 && n.pos.z <= o.z0 && n.pos.z >= o.z0 - 400) return '軒下';
  }
  // 建物の外（外壁のループの外側）で、外壁の角の近くを回る曲がり
  const f = floorOfZ(b, n.pos.z);
  const loop = f && outlineLoop(b, f.id);
  if (!loop) return null;
  const poly = loop.corners.map((id) => b.corners[id]);
  if (pointInPolygon(n.pos, poly)) return null;
  for (const c of poly) if (Math.hypot(c.x - n.pos.x, c.y - n.pos.y) <= 400) return '出隅・入隅';
  return null;
}
