/**
 * ⑩ 保存した版との比較。管は区間の ID ではなく形で比べる（バルブ・分岐で分けても変わっていない扱い）。
 * 器具は ID で（位置・向き・種類）。建物は数だけ。
 */
import type { Doc } from './doc';
import { FIXTURE_CATALOG } from './fixtures';
import { segmentLength, type Network, type Segment, type SystemType, type Vec3 } from './network';

export type SegChange = { id: string; oldId: string; what: string[] };
export type FixtureMove = { id: string; from: { x: number; y: number }; what: string[] };
export type Comparison = {
  /** added・changed は今の区間 ID、removed は版の区間 ID */
  segments: { added: string[]; removed: string[]; changed: SegChange[] };
  /** added・moved・changed は今の器具 ID、removed は版の器具 ID */
  fixtures: { added: string[]; removed: string[]; moved: FixtureMove[]; changed: { id: string; what: string[] }[] };
  /** 系統ごとの管の長さ（実測優先・割増なし）mm */
  lengths: { system: SystemType; before: number; after: number }[];
  building: { walls: number; rooms: number; openings: number; changed: boolean };
  /** 変わった所の数（管・器具） */
  total: number;
};

const ON = 1; // 管の上に乗っているとみなす距離 mm

function onSegment(net: Network, s: Segment, p: Vec3): boolean {
  const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos;
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len2 = d.x * d.x + d.y * d.y + d.z * d.z;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y + (p.z - a.z) * d.z) / len2)) : 0;
  return Math.hypot(a.x + d.x * t - p.x, a.y + d.y * t - p.y, a.z + d.z * t - p.z) <= ON;
}
const ends = (net: Network, s: Segment) => [net.nodes[s.a].pos, net.nodes[s.b].pos] as const;
const sameAttrs = (x: Segment, y: Segment) => x.diameter === y.diameter && (x.material ?? '') === (y.material ?? '') && x.system === y.system;

/** s（net の区間）が他方の同じ種類の管と重なっているか。重なる相手（属性まで同じなら same を優先） */
function partner(net: Network, s: Segment, other: Network): { seg: Segment; same: boolean } | null {
  const [p, q] = ends(net, s);
  let found: Segment | null = null;
  for (const o of Object.values(other.segments)) {
    const [op, oq] = ends(other, o);
    // s が o の上に乗っている（分けた片方）か、o が s の上に乗っている（つないだ）
    const overlap = (onSegment(other, o, p) && onSegment(other, o, q)) || (onSegment(net, s, op) && onSegment(net, s, oq));
    if (!overlap) continue;
    if (sameAttrs(s, o)) return { seg: o, same: true };
    // 属性が違う重なり: 同じ種類の管を優先して「変わった」の相手にする
    if (!found || (found.system !== s.system && o.system === s.system)) found = o;
  }
  return found ? { seg: found, same: false } : null;
}

function segDiff(o: Segment, n: Segment): string[] {
  const w: string[] = [];
  if (o.system !== n.system) w.push('種類が変わった');
  if (o.diameter !== n.diameter) w.push(`口径 φ${o.diameter}→φ${n.diameter}`);
  if ((o.material ?? '') !== (n.material ?? '')) w.push(`管種 ${o.material ?? '—'}→${n.material ?? '—'}`);
  return w;
}

function lengthsBySystem(net: Network): Map<SystemType, number> {
  const m = new Map<SystemType, number>();
  for (const s of Object.values(net.segments)) m.set(s.system, (m.get(s.system) ?? 0) + (s.measuredLength ?? segmentLength(net, s.id)));
  return m;
}

export function compareDocs(before: Doc, after: Doc): Comparison {
  const on = before.network, nn = after.network;
  const added: string[] = [], removed: string[] = [], changed: SegChange[] = [];
  for (const s of Object.values(nn.segments)) {
    const p = partner(nn, s, on);
    if (!p) added.push(s.id);
    else if (!p.same) changed.push({ id: s.id, oldId: p.seg.id, what: segDiff(p.seg, s) });
  }
  for (const s of Object.values(on.segments)) if (!partner(on, s, nn)) removed.push(s.id);

  const fa: string[] = [], fr: string[] = [], fm: FixtureMove[] = [], fc: { id: string; what: string[] }[] = [];
  for (const f of Object.values(after.fixtures)) {
    const o = before.fixtures[f.id];
    if (!o) { fa.push(f.id); continue; }
    const what: string[] = [];
    const d = Math.hypot(f.x - o.x, f.y - o.y);
    if (o.floorId !== f.floorId) what.push('階が変わった');
    if (d >= ON) what.push(`${Math.round(d)}mm 動いた`);
    if (o.rotation !== f.rotation) what.push(`向き ${o.rotation}°→${f.rotation}°`);
    if (what.length) fm.push({ id: f.id, from: { x: o.x, y: o.y }, what });
    if (o.type !== f.type) fc.push({ id: f.id, what: [`${FIXTURE_CATALOG[o.type]?.label ?? o.type}→${FIXTURE_CATALOG[f.type]?.label ?? f.type}`] });
  }
  for (const f of Object.values(before.fixtures)) if (!after.fixtures[f.id]) fr.push(f.id);

  const lb = lengthsBySystem(on), la = lengthsBySystem(nn);
  const systems = [...new Set([...lb.keys(), ...la.keys()])];
  const lengths = systems.map((system) => ({ system, before: Math.round(lb.get(system) ?? 0), after: Math.round(la.get(system) ?? 0) }));

  const cnt = (d: Doc) => ({ walls: Object.keys(d.building.walls).length, rooms: Object.keys(d.building.rooms).length, openings: Object.keys(d.building.openings).length });
  const cb = cnt(before), ca = cnt(after);
  const building = { walls: ca.walls - cb.walls, rooms: ca.rooms - cb.rooms, openings: ca.openings - cb.openings, changed: before.building !== after.building && JSON.stringify(before.building) !== JSON.stringify(after.building) };

  return {
    segments: { added, removed, changed },
    fixtures: { added: fa, removed: fr, moved: fm, changed: fc },
    lengths,
    building,
    total: added.length + removed.length + changed.length + fa.length + fr.length + fm.length + fc.length,
  };
}
