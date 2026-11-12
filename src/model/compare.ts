/**
 * ⑩ 保存した版との比較。
 * - 管: 同じ ID が両方にあれば ID で比べる（口径・管種・長さ・位置）。排水の高さは自動計算で変わるので見ない。
 * - ID が片方にしか無い管（区間を分けた・まとめた・切った）は、もう片方の同じ種類の管が「どれだけ覆っているか」で比べる。
 *   覆われていない所は 増えた／なくなった（一部も）。違う口径・管種で覆われていれば 変わった。
 * - 器具は ID で（種類・位置・向き・階）。建物は数だけ。
 */
import type { Doc } from './doc';
import { FIXTURE_CATALOG } from './fixtures';
import { segmentLength, type Network, type Segment, type SystemType, type Vec3 } from './network';

export type SegChange = { id: string; oldId: string; what: string[] };
export type FixtureMove = { id: string; from: { x: number; y: number }; what: string[] };
/** 版の管のうち、今は無い一部（a→b） */
export type RemovedPart = { oldId: string; a: Vec3; b: Vec3; length: number };
export type Comparison = {
  /** added・changed は今の区間 ID、removed は版の区間 ID（全部なくなった）、removedParts は一部なくなった所 */
  segments: { added: string[]; removed: string[]; removedParts: RemovedPart[]; changed: SegChange[] };
  /** added・moved・changed は今の器具 ID、removed は版の器具 ID。動いた器具の種類の違いは moved に入れる */
  fixtures: { added: string[]; removed: string[]; moved: FixtureMove[]; changed: { id: string; what: string[] }[] };
  /** 系統ごとの管の長さ（実測優先・割増なし）mm */
  lengths: { system: SystemType; before: number; after: number }[];
  building: { walls: number; rooms: number; openings: number; changed: boolean };
  /** 変わった所の数（管・器具） */
  total: number;
};

const ON = 1; // 同じ線の上とみなす平面の距離 mm
const isDrain = (s: SystemType) => s === 'drain' || s === 'sewage';
/** 高さのずれの許し: 排水は自動計算で変わるので広く、ほかは 1mm */
const zTol = (s: SystemType) => (isDrain(s) ? 400 : ON);
const CELL = 2000;

type Line = { seg: Segment; p: Vec3; q: Vec3; planLen: number };
const lineOf = (net: Network, s: Segment): Line => {
  const p = net.nodes[s.a].pos, q = net.nodes[s.b].pos;
  return { seg: s, p, q, planLen: Math.hypot(q.x - p.x, q.y - p.y) };
};

/** 平面の格子で引けるようにした管（同じ種類ごと） */
class Index {
  private cells = new Map<string, Line[]>();
  constructor(net: Network) {
    for (const s of Object.values(net.segments)) {
      const l = lineOf(net, s);
      for (const k of this.keys(l)) { const c = this.cells.get(k); if (c) c.push(l); else this.cells.set(k, [l]); }
    }
  }
  private keys(l: Line): string[] {
    const x0 = Math.floor(Math.min(l.p.x, l.q.x) / CELL), x1 = Math.floor(Math.max(l.p.x, l.q.x) / CELL);
    const y0 = Math.floor(Math.min(l.p.y, l.q.y) / CELL), y1 = Math.floor(Math.max(l.p.y, l.q.y) / CELL);
    const out: string[] = [];
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) out.push(`${l.seg.system}:${i}:${j}`);
    return out;
  }
  near(l: Line): Line[] {
    const seen = new Set<Line>();
    for (const k of this.keys(l)) for (const c of this.cells.get(k) ?? []) seen.add(c);
    return [...seen];
  }
}

/** c が t の線の上に乗っている部分（t の 0..1 の範囲）。乗っていなければ null */
function overlapOn(t: Line, c: Line): [number, number] | null {
  if (c.seg.system !== t.seg.system) return null;
  const tol = zTol(t.seg.system);
  if (t.planLen >= ON) {
    if (c.planLen < ON) return null;
    const ux = (t.q.x - t.p.x) / t.planLen, uy = (t.q.y - t.p.y) / t.planLen;
    const param = (r: Vec3) => {
      const s = ((r.x - t.p.x) * ux + (r.y - t.p.y) * uy) / t.planLen;
      const off = Math.abs((r.x - t.p.x) * uy - (r.y - t.p.y) * ux);
      const zt = t.p.z + (t.q.z - t.p.z) * s;
      return off <= ON && Math.abs(r.z - zt) <= tol ? s : null;
    };
    const s1 = param(c.p), s2 = param(c.q);
    if (s1 === null || s2 === null) return null;
    const lo = Math.max(0, Math.min(s1, s2)), hi = Math.min(1, Math.max(s1, s2));
    return hi - lo > 1e-9 ? [lo, hi] : null;
  }
  // 立て管: 平面の位置が同じ立て管だけ、高さで重なりを見る
  if (c.planLen >= ON || Math.hypot(c.p.x - t.p.x, c.p.y - t.p.y) > ON || Math.hypot(c.q.x - t.p.x, c.q.y - t.p.y) > ON) return null;
  const dz = t.q.z - t.p.z;
  if (Math.abs(dz) < ON) return null;
  const s1 = (c.p.z - t.p.z) / dz, s2 = (c.q.z - t.p.z) / dz;
  const lo = Math.max(0, Math.min(s1, s2)), hi = Math.min(1, Math.max(s1, s2));
  return hi - lo > 1e-9 ? [lo, hi] : null;
}

/** 区間の和（0..1 の範囲のつながり） */
function union(iv: [number, number][]): [number, number][] {
  const s = [...iv].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) { const last = out.at(-1); if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  return out;
}
const covered = (iv: [number, number][]) => union(iv).reduce((a, [x, y]) => a + (y - x), 0);
const gaps = (iv: [number, number][]): [number, number][] => {
  const u = union(iv), out: [number, number][] = [];
  let at = 0;
  for (const [a, b] of u) { if (a > at) out.push([at, a]); at = Math.max(at, b); }
  if (at < 1) out.push([at, 1]);
  return out;
};
const len3 = (l: Line) => Math.hypot(l.q.x - l.p.x, l.q.y - l.p.y, l.q.z - l.p.z);
const lerp = (l: Line, s: number): Vec3 => ({ x: l.p.x + (l.q.x - l.p.x) * s, y: l.p.y + (l.q.y - l.p.y) * s, z: l.p.z + (l.q.z - l.p.z) * s });
const sameAttrs = (x: Segment, y: Segment) => x.diameter === y.diameter && (x.material ?? '') === (y.material ?? '');
/** 長さ: 排水の横の管は平面の長さ（高さは自動計算で変わるため） */
const lenOf = (l: Line) => (isDrain(l.seg.system) && l.planLen >= ON ? l.planLen : len3(l));

function attrDiff(o: Segment, n: Segment, part = ''): string[] {
  const w: string[] = [];
  if (o.diameter !== n.diameter) w.push(`口径 φ${o.diameter}→φ${n.diameter}${part}`);
  if ((o.material ?? '') !== (n.material ?? '')) w.push(`管種 ${o.material || '—'}→${n.material || '—'}${part}`);
  return w;
}

function lengthsBySystem(net: Network): Map<SystemType, number> {
  const m = new Map<SystemType, number>();
  for (const s of Object.values(net.segments)) m.set(s.system, (m.get(s.system) ?? 0) + (s.measuredLength ?? segmentLength(net, s.id)));
  return m;
}

export function compareDocs(before: Doc, after: Doc): Comparison {
  const on = before.network, nn = after.network;
  const added: string[] = [], removed: string[] = [], removedParts: RemovedPart[] = [], changed: SegChange[] = [];
  let oldIdx: Index | null = null, newIdx: Index | null = null;

  // 1) 同じ ID: 口径・管種・長さ・位置（排水の高さは見ない）
  for (const s of Object.values(nn.segments)) {
    const o = on.segments[s.id];
    if (!o) continue;
    const ln = lineOf(nn, s), lo = lineOf(on, o);
    const what = o.system !== s.system ? ['種類が変わった'] : [];
    what.push(...attrDiff(o, s));
    const Ln = Math.round(lenOf(ln)), Lo = Math.round(lenOf(lo));
    if (Math.abs(Ln - Lo) >= ON) what.push(`長さ ${Lo}→${Ln}mm`);
    else {
      const d = Math.max(Math.hypot(ln.p.x - lo.p.x, ln.p.y - lo.p.y), Math.hypot(ln.q.x - lo.q.x, ln.q.y - lo.q.y));
      if (d >= ON) what.push(`${Math.round(d)}mm 動いた`);
      else if (!isDrain(s.system) && Math.max(Math.abs(ln.p.z - lo.p.z), Math.abs(ln.q.z - lo.q.z)) >= ON) what.push('高さが変わった');
    }
    if (what.length) changed.push({ id: s.id, oldId: o.id, what });
  }

  // 2) 今にしか無い ID: 版の管がどれだけ覆っているか
  for (const s of Object.values(nn.segments)) {
    if (on.segments[s.id]) continue;
    oldIdx ??= new Index(on);
    const t = lineOf(nn, s);
    const sameIv: [number, number][] = [], anyIv: [number, number][] = [], others: Segment[] = [];
    for (const c of oldIdx.near(t)) {
      const iv = overlapOn(t, c);
      if (!iv) continue;
      anyIv.push(iv);
      if (sameAttrs(c.seg, s)) sameIv.push(iv); else others.push(c.seg);
    }
    const L = lenOf(t);
    const cAny = covered(anyIv) * L, cSame = covered(sameIv) * L;
    if (cAny < ON) { added.push(s.id); continue; }
    const what: string[] = [];
    if (cSame < L - ON && others.length) what.push(...new Set(others.flatMap((o) => attrDiff(o, s, cSame > ON || cAny < L - ON ? '（一部）' : ''))));
    if (cAny < L - ON) what.push(`長さ +${Math.round(L - cAny)}mm`);
    if (what.length) changed.push({ id: s.id, oldId: others[0]?.id ?? '', what });
  }

  // 3) 版にしか無い ID: 今の管がどれだけ覆っているか（覆われていない所が なくなった）
  for (const o of Object.values(on.segments)) {
    if (nn.segments[o.id]) continue;
    newIdx ??= new Index(nn);
    const t = lineOf(on, o);
    const iv: [number, number][] = [];
    for (const c of newIdx.near(t)) { const r = overlapOn(t, c); if (r) iv.push(r); }
    const L = lenOf(t);
    if (covered(iv) * L < ON) { removed.push(o.id); continue; }
    for (const [a, b] of gaps(iv)) {
      const length = Math.round((b - a) * L);
      if (length >= ON) removedParts.push({ oldId: o.id, a: lerp(t, a), b: lerp(t, b), length });
    }
  }

  // 器具（種類の違いと動きは 1 つにまとめる）
  const fa: string[] = [], fr: string[] = [], fm: FixtureMove[] = [], fc: { id: string; what: string[] }[] = [];
  const label = (t: string) => FIXTURE_CATALOG[t as keyof typeof FIXTURE_CATALOG]?.label ?? t;
  for (const f of Object.values(after.fixtures)) {
    const o = before.fixtures[f.id];
    if (!o) { fa.push(f.id); continue; }
    const type = o.type !== f.type ? [`${label(o.type)}→${label(f.type)}`] : [];
    const mv: string[] = [];
    const d = Math.hypot(f.x - o.x, f.y - o.y);
    if (o.floorId !== f.floorId) mv.push('階が変わった');
    if (d >= ON) mv.push(`${Math.round(d)}mm 動いた`);
    if (o.rotation !== f.rotation) mv.push(`向き ${o.rotation}°→${f.rotation}°`);
    if (mv.length) fm.push({ id: f.id, from: { x: o.x, y: o.y }, what: [...type, ...mv] });
    else if (type.length) fc.push({ id: f.id, what: type });
  }
  for (const f of Object.values(before.fixtures)) if (!after.fixtures[f.id]) fr.push(f.id);

  const lb = lengthsBySystem(on), la = lengthsBySystem(nn);
  const systems = [...new Set([...lb.keys(), ...la.keys()])];
  const lengths = systems.map((system) => ({ system, before: Math.round(lb.get(system) ?? 0), after: Math.round(la.get(system) ?? 0) }));

  const cnt = (d: Doc) => ({ walls: Object.keys(d.building.walls).length, rooms: Object.keys(d.building.rooms).length, openings: Object.keys(d.building.openings).length });
  const cb = cnt(before), ca = cnt(after);
  const building = { walls: ca.walls - cb.walls, rooms: ca.rooms - cb.rooms, openings: ca.openings - cb.openings, changed: before.building !== after.building && JSON.stringify(before.building) !== JSON.stringify(after.building) };

  return {
    segments: { added, removed, removedParts, changed },
    fixtures: { added: fa, removed: fr, moved: fm, changed: fc },
    lengths,
    building,
    total: added.length + removed.length + removedParts.length + changed.length + fa.length + fr.length + fm.length + fc.length,
  };
}
