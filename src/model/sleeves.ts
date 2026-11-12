/**
 * スリーブ表: 配管が構造を通る所を拾う。
 * 基礎（外周＝1 階の外壁の線を床より下で通る）・基礎の立上り（部材）・貫通の印のある梁など・外壁・間仕切壁・2 階以上の床・基礎スラブ。
 * スリーブの径は一般値（内径 ≥ 管の外径＋30mm、給湯は保温材の分 ＋20mm）。構造の確認は別に必要。
 */
import type { Building, Floor, Vec2 } from './building';
import type { Doc } from './doc';
import { MEMBER_LABEL, membersOf, type Member } from './members';
import type { Segment, SystemType, Vec3 } from './network';
import { pointInPolygon } from './roomOps';
import { outlineLoop } from './sketch';
import { outerDiameter } from './slope';

export type SleevePart = 'footingOuter' | 'footing' | 'beam' | 'member' | 'exteriorWall' | 'interiorWall' | 'floor' | 'baseSlab';
export const SLEEVE_PART_LABEL: Record<SleevePart, string> = {
  footingOuter: '基礎（外周）', footing: '基礎の立上り', beam: '梁', member: '部材', exteriorWall: '外壁', interiorWall: '間仕切壁', floor: '床', baseSlab: '基礎スラブ',
};
const PART_ORDER: SleevePart[] = ['baseSlab', 'footingOuter', 'footing', 'exteriorWall', 'interiorWall', 'beam', 'member', 'floor'];

export type SleeveRow = {
  no: number; part: SleevePart; partLabel: string;
  /** その階（床は上の階、基礎・スラブは 1 階） */
  floorId: string; floorName: string;
  /** 通る点（mm、図面の座標） */
  point: Vec3;
  /** その階の床からの高さ(mm) */
  flz: number;
  segId: string; system: SystemType; material: string; diameter: number;
  /** 管の外径(mm) */ od: number;
  /** スリーブの呼び径（一般値） */ sleeve: number;
};

export const SLEEVE_SIZES = [50, 65, 75, 100, 125, 150, 200, 250, 300] as const;
export const SLEEVE_RULE = 'スリーブ径は一般値（内径 ≥ 管の外径＋30mm、給湯は保温材の分＋20mm）。構造の確認をしてください';

/** スリーブの呼び径（一般値）。表より太いときは 50 刻みで切り上げ */
export function sleeveSize(od: number, system: SystemType): number {
  const need = od + 30 + (system === 'hotWater' ? 20 : 0);
  return SLEEVE_SIZES.find((s) => s >= need) ?? Math.ceil(need / 50) * 50;
}

type Hit = { part: SleevePart; partLabel?: string; floor: Floor; point: Vec3 };

const lerp = (p: Vec3, q: Vec3, t: number): Vec3 => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t });

/** 線 c-d に対して点がどちら側か（-1・0・1。0 は線の上） */
const side = (c: Vec2, d: Vec2, r: Vec2) => { const v = (d.x - c.x) * (r.y - c.y) - (d.y - c.y) * (r.x - c.x); return Math.abs(v) < 1e-6 * Math.hypot(d.x - c.x, d.y - c.y) ? 0 : Math.sign(v); };

/** 平面で配管 p-q が線 c-d を横切る（端で触れるのを含む）ときの配管上の t */
function crossPlan(p: Vec3, q: Vec3, c: Vec2, d: Vec2): number | null {
  const rx = q.x - p.x, ry = q.y - p.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null; // 平行（壁に沿う配管）
  const t = ((c.x - p.x) * sy - (c.y - p.y) * sx) / den;
  const u = ((c.x - p.x) * ry - (c.y - p.y) * rx) / den;
  const e = 1e-6;
  return t >= -e && t <= 1 + e && u >= -e && u <= 1 + e ? Math.min(1, Math.max(0, t)) : null;
}

/** 部材の箱（中心線 a-b・幅・その階の床からの z0〜z1）を配管が通る区間の真ん中の t */
function clipMember(m: Member, elev: number, p: Vec3, q: Vec3): number | null {
  const L = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
  if (L < 1) return null;
  const ux = (m.b.x - m.a.x) / L, uy = (m.b.y - m.a.y) / L;
  const loc = (r: Vec3) => ({ u: (r.x - m.a.x) * ux + (r.y - m.a.y) * uy, n: -(r.x - m.a.x) * uy + (r.y - m.a.y) * ux, z: r.z });
  const P = loc(p), Q = loc(q);
  let t0 = 0, t1 = 1;
  for (const [a, b, lo, hi] of [[P.u, Q.u, 0, L], [P.n, Q.n, -m.width / 2, m.width / 2], [P.z, Q.z, elev + m.z0, elev + m.z1]] as const) {
    const d = b - a;
    if (Math.abs(d) < 1e-9) { if (a < lo || a > hi) return null; continue; }
    let ta = (lo - a) / d, tb = (hi - a) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return (t0 + t1) / 2;
}

function outline(b: Building, floorId: string): Vec2[] | null {
  const loop = outlineLoop(b, floorId);
  return loop ? loop.corners.map((id) => b.corners[id]) : null;
}

export function sleeveSchedule(doc: Doc): SleeveRow[] {
  const b = doc.building, net = doc.network;
  const floors = [...b.floors].sort((x, y) => x.elevation - y.elevation);
  if (!floors.length) return [];
  const f0 = floors[0];
  const rows: (Omit<SleeveRow, 'no'> & { order: number })[] = [];
  const members = membersOf(b);
  const outlines = new Map(floors.map((f) => [f.id, outline(b, f.id)]));
  const insideOf = (f: Floor, pt: Vec3) => { const o = outlines.get(f.id) ?? outlines.get(f0.id); return !!o && pointInPolygon(pt, o); };

  const byNode = new Map<string, Segment[]>();
  for (const s of Object.values(net.segments)) for (const n of [s.a, s.b]) byNode.set(n, [...(byNode.get(n) ?? []), s]);
  /** 区間の端 nodeId が線 c-d の上にあるとき、その先の区間が反対側へ抜けるか（抜けなければ壁の中で終わる・下りるだけ） */
  const passesThrough = (s: Segment, nodeId: string, c: Vec2, d: Vec2) => {
    const far = net.nodes[nodeId === s.a ? s.b : s.a]?.pos;
    const mine = far ? side(c, d, far) : 0;
    if (!mine) return false;
    return (byNode.get(nodeId) ?? []).some((o) => {
      if (o.id === s.id) return false;
      const f = net.nodes[o.a === nodeId ? o.b : o.a]?.pos;
      return !!f && side(c, d, f) === -mine;
    });
  };
  const all: (Hit & { s: Segment })[] = [];
  for (const s of Object.values(net.segments)) {
    const A = net.nodes[s.a], B = net.nodes[s.b];
    if (!A || !B) continue;
    const p = A.pos, q = B.pos;
    const hits: Hit[] = [];
    // 壁（外壁は 1 階の床より下なら基礎の外周）
    for (const w of Object.values(b.walls)) {
      const f = floors.find((x) => x.id === w.floorId), c = b.corners[w.a], d = b.corners[w.b];
      if (!f || !c || !d) continue;
      const t = crossPlan(p, q, c, d);
      if (t === null) continue;
      // 端が壁の線の上: 次の区間が反対側へ抜けるときだけ（壁の中で終わる・下りるだけなら貫通ではない）
      if (t < 1e-6 && !passesThrough(s, s.a, c, d)) continue;
      if (t > 1 - 1e-6 && !passesThrough(s, s.b, c, d)) continue;
      const pt = lerp(p, q, t);
      if (w.kind === 'exterior' && f.id === f0.id && pt.z < f0.elevation) hits.push({ part: 'footingOuter', floor: f0, point: pt });
      else if (pt.z >= f.elevation && pt.z < f.elevation + f.height) hits.push({ part: w.kind === 'exterior' ? 'exteriorWall' : 'interiorWall', floor: f, point: pt });
    }
    // 基礎の立上り（部材）・貫通の印のある部材
    for (const m of members) {
      const isFoot = m.kind === 'footing';
      if (!isFoot && !s.penetrations?.includes(m.id)) continue;
      const f = floors.find((x) => x.id === m.floorId);
      if (!f) continue;
      const t = clipMember(m, f.elevation, p, q);
      if (t === null) continue;
      hits.push({ part: isFoot ? 'footing' : m.kind === 'beam' ? 'beam' : 'member', partLabel: isFoot || m.kind === 'beam' ? undefined : MEMBER_LABEL[m.kind], floor: f, point: lerp(p, q, t) });
    }
    // 2 階以上の床（スラブの真ん中の高さ）・基礎スラブ
    const planes: { z: number; part: SleevePart; floor: Floor }[] = floors.slice(1).map((f) => ({ z: f.elevation - f.slabThickness / 2, part: 'floor' as const, floor: f }));
    if (b.foundation?.slabTop !== undefined) planes.push({ z: f0.elevation + b.foundation.slabTop, part: 'baseSlab', floor: f0 });
    for (const pl of planes) {
      if ((p.z - pl.z) * (q.z - pl.z) > 0 || Math.abs(q.z - p.z) < 1e-9) continue;
      const pt = lerp(p, q, (pl.z - p.z) / (q.z - p.z));
      if (insideOf(pl.floor, pt)) hits.push({ part: pl.part, floor: pl.floor, point: pt });
    }
    for (const h of hits) all.push({ ...h, s });
  }
  // 同じ所は 1 つ: 同じ部位・同じ管（系統と口径）で 80mm 以内（壁の継ぎ目・角、部材の中で区切られた配管の前後など）
  for (const h of all) {
    const dup = rows.some((r) => r.part === h.part && r.system === h.s.system && r.diameter === h.s.diameter
      && Math.hypot(r.point.x - h.point.x, r.point.y - h.point.y) < 80 && Math.abs(r.point.z - h.point.z) < 80);
    if (!dup) rows.push(rowOf(h.s, h, floors.indexOf(h.floor)));
  }
  // 外周の基礎に重ねて置いた立上りの部材は、外周と同じ所（250mm 以内）なら外周の 1 か所にまとめる
  const outer = rows.filter((r) => r.part === 'footingOuter');
  // 基礎貫通スリーブ（前澤 KSA・KSS）の形: 外周の基礎を地中で抜けて基礎の中で縦に上がる所は、縦の管が通る立上り・土間も同じ 1 か所
  const vertical = (r: (typeof rows)[number]) => { const sg = net.segments[r.segId]; const a = sg && net.nodes[sg.a]?.pos, c = sg && net.nodes[sg.b]?.pos; return !!a && !!c && Math.hypot(a.x - c.x, a.y - c.y) < 1; };
  const kept = rows.filter((r) => {
    if (r.part !== 'footing' && r.part !== 'baseSlab') return true;
    return !outer.some((o) => Math.hypot(o.point.x - r.point.x, o.point.y - r.point.y) < 250
      && (r.part === 'footing' && Math.abs(o.point.z - r.point.z) < 250 || (vertical(r) && o.system === r.system && o.diameter === r.diameter && r.point.z > o.point.z)));
  });
  rows.length = 0; rows.push(...kept);
  rows.sort((x, y) => x.order - y.order || PART_ORDER.indexOf(x.part) - PART_ORDER.indexOf(y.part) || x.point.y - y.point.y || x.point.x - y.point.x);
  return rows.map(({ order: _o, ...r }, i) => ({ ...r, no: i + 1 }));
}

function rowOf(s: Segment, h: Hit, order: number): Omit<SleeveRow, 'no'> & { order: number } {
  const od = outerDiameter(s.diameter);
  return {
    order, part: h.part, partLabel: h.partLabel ?? SLEEVE_PART_LABEL[h.part], floorId: h.floor.id, floorName: h.floor.name,
    point: h.point, flz: Math.round(h.point.z - h.floor.elevation), segId: s.id, system: s.system, material: s.material ?? '', diameter: s.diameter, od, sleeve: sleeveSize(od, s.system),
  };
}
