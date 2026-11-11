/**
 * 床下の排水の自動勾配（純関数）。
 * 床下から外へ出る所（起点）の管底を土間（ベタ基礎のスラブ天端）に置き、そこから各器具へ
 * 勾配（標準 2/100。床下の高さが足りない系統は 1.5/100。自治体の最小勾配・管径別の最小勾配の方が急ならそれ）で上げる。
 * 床下の横管は土間から立てたレベルバンドで支持する（supports.ts）。
 *  - 床下の排水 = 1 階の床より下・土間より上の、排水・汚水の横管（立て管・急な斜めの管は除く）
 *  - 起点 = 床下の排水のまとまりから、外の配管・マス・地中へ下がっていく点。無ければ外壁にいちばん近い端
 *  - 器具の接続口（高さは器具で決まる）は動かさない。器具から下ろした立て管は長さが変わる
 */
import { wallsOnFloor, type Vec2 } from './building';
import type { Doc } from './doc';
import { isManhole } from './fixtures';
import { membersOf } from './members';
import { segmentsAt, type Network, type Segment } from './network';
import { applySlope, defaultSlope, isRiserLike, isSlopePinned, outerDiameter, planLength } from './slope';

/** 床下の排水の標準の勾配（2/100） */
export const UF_SLOPE = 0.02;
/** 床下の高さが足りないときに下げる勾配（1.5/100） */
export const UF_SLOPE_LOW = 0.015;
/** 床下の底（土間）が分からないとき、1 階の床からこれだけ下を土間とみなす(mm) */
export const DEFAULT_SLAB_DEPTH = 500;
/** 基礎の立上りが分からないとき、配管の上（管頂）は 1 階の床からこれだけ下まで（大引・床組）(mm) */
const FLOOR_FRAME = 150;
/** 床下の配管とみなす勾配の上限（これより急な区間は立て管・地中へ下ろす管） */
const FLATISH = 0.06;
/** 土間より少し下まで床下とみなす（丸めの誤差）(mm) */
const ZONE_TOL = 30;
/** 起点を下流（マス・地中の点）より最低これだけ高くする(mm) */
const DOWN_GAP = 50;

/**
 * slopeFor: 自治体の口径ごとの最小勾配（比率）。target/low: 標準とゆとりが無いときの勾配。
 * startAbove: 起点の管底の、土間からの高さ（既定 0 = 土間）
 */
export type UnderfloorRules = { slopeFor?: (diameter: number) => number | undefined; target?: number; low?: number; startAbove?: number; /** 勾配を決める関数（自治体の決まり。あれば slopeFor・target・low より優先） */ ratio?: (diameter: number, low: boolean) => number };

/** 口径 d の床下の勾配（比率）: 標準（または 1.5/100）・自治体の最小勾配・管径別の最小勾配のうち急な方 */
export const underfloorRatio = (d: number, rules: UnderfloorRules = {}, low = false) => rules.ratio ? rules.ratio(d, low) :
  Math.max(low ? rules.low ?? UF_SLOPE_LOW : rules.target ?? UF_SLOPE, rules.slopeFor?.(d) ?? 0, defaultSlope(d));

/** 床下の高さ（絶対 mm）: floor = 1 階の床、slab = 土間、top = 配管の上（管頂）の上限。slabKnown: 図面・設定の土間がある */
export type UnderfloorLevels = { floorId: string; floor: number; slab: number; top: number; slabKnown: boolean; /** 1 階の外壁（1 周つながっているときだけ。建物の内外の判定。無ければ全部を内とみる） */ outline: (readonly [Vec2, Vec2])[] };

export function underfloorLevels(doc: Pick<Doc, 'building'>): UnderfloorLevels | null {
  const b = doc.building;
  const base = [...b.floors].sort((p, q) => p.elevation - q.elevation)[0];
  if (!base) return null;
  const slabKnown = !!b.foundation;
  const slab = base.elevation + (b.foundation?.slabTop ?? -DEFAULT_SLAB_DEPTH);
  const tops = membersOf(b).filter((m) => m.kind === 'footing' && m.floorId === base.id).map((m) => base.elevation + m.z1);
  const top = tops.length ? Math.min(Math.max(...tops), base.elevation - 1) : base.elevation - FLOOR_FRAME;
  const ext = wallsOnFloor(b, base.id).filter((w) => w.kind === 'exterior');
  // 外壁が 1 周つながっているときだけ内外を判定する（描きかけの外壁で全部が「外」にならないように）
  const deg = new Map<string, number>();
  for (const w of ext) for (const c of [w.a, w.b]) deg.set(c, (deg.get(c) ?? 0) + 1);
  const closed = ext.length >= 3 && [...deg.values()].every((n) => n % 2 === 0);
  const outline = closed ? ext.map((w) => [b.corners[w.a], b.corners[w.b]] as const) : [];
  return { floorId: base.id, floor: base.elevation, slab, top, slabKnown, outline };
}

const isDrainLine = (s: Segment) => s.system === 'drain' || s.system === 'sewage';

/** 高さ z（絶対 mm）が床下（1 階の床より下・土間より上）か */
export const inUnderfloor = (lv: UnderfloorLevels, z: number) => z < lv.floor - 1 && z > lv.slab - ZONE_TOL;

/** 平面の点が建物（1 階の外壁の内側）にあるか。外壁が無ければ true。外壁の線上は内 */
export function insideBuilding(lv: Pick<UnderfloorLevels, 'outline'>, p: Vec2): boolean {
  if (!lv.outline.length) return true;
  if (lv.outline.some(([a, b]) => pointSeg(p, a, b) < 1)) return true;
  let inside = false;
  for (const [a, b] of lv.outline) {
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

/**
 * 床下の排水の横管か（両端が床下にあり、平面で長さがある。勾配の急・緩は問わない: 描いた・つないだ直後の段差も含めて付け直す）
 */
export function isUnderfloorDrain(net: Network, s: Segment, lv: UnderfloorLevels): boolean {
  if (!isDrainLine(s)) return false;
  const za = net.nodes[s.a]?.pos.z, zb = net.nodes[s.b]?.pos.z;
  if (za === undefined || zb === undefined) return false;
  // 外の浅い排水管（床下と同じ高さでも外壁の外だけを通る管）は除く。外壁をまたぐ区間は床下に含める
  return inUnderfloor(lv, za) && inUnderfloor(lv, zb) && planLength(net, s) >= 1
    && (insideBuilding(lv, net.nodes[s.a].pos) || insideBuilding(lv, net.nodes[s.b].pos));
}

/** 支持金具: 床下の排水の横管（勾配のついた・ゆるい横管。立て管のような急な管は除く） */
export function isUnderfloorRun(net: Network, s: Segment, lv: UnderfloorLevels): boolean {
  return isUnderfloorDrain(net, s, lv) && !isRiserLike(net, s) && Math.abs(net.nodes[s.a].pos.z - net.nodes[s.b].pos.z) <= FLATISH * planLength(net, s);
}

function pointSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2));
  return Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t));
}

/** 床下の排水のまとまり（区間 ID の集合と点 ID の集合） */
function components(net: Network, lv: UnderfloorLevels): { segs: Set<string>; nodes: Set<string> }[] {
  const uf = Object.values(net.segments).filter((s) => isUnderfloorDrain(net, s, lv));
  const byNode = new Map<string, Segment[]>();
  for (const s of uf) for (const n of [s.a, s.b]) byNode.set(n, [...(byNode.get(n) ?? []), s]);
  const seen = new Set<string>();
  const out: { segs: Set<string>; nodes: Set<string> }[] = [];
  for (const s0 of uf) {
    if (seen.has(s0.id)) continue;
    const segs = new Set<string>(), nodes = new Set<string>(), stack = [s0];
    seen.add(s0.id);
    while (stack.length) {
      const s = stack.pop()!;
      segs.add(s.id);
      for (const n of [s.a, s.b]) {
        nodes.add(n);
        for (const t of byNode.get(n) ?? []) if (!seen.has(t.id)) { seen.add(t.id); stack.push(t); }
      }
    }
    out.push({ segs, nodes });
  }
  return out;
}

/**
 * まとまりの起点。外の配管・マス・地中へ下がっていく点（いちばん低い所）。
 * 無ければ（描いたばかりで外とつながっていない）、器具の立て管が上がっていない端のうち外壁にいちばん近いもの。
 * downZ: 起点の下流のいちばん高い管底（これより上に起点を置く）
 */
function exitOf(doc: Doc, comp: { segs: Set<string>; nodes: Set<string> }, lv: UnderfloorLevels): { id: string; downZ?: number } | null {
  const net = doc.network;
  const down: { id: string; z: number; downZ: number }[] = [];
  const ends: string[] = [];
  for (const id of comp.nodes) {
    const n = net.nodes[id];
    let goesUp = false, deg = 0, dz: number | undefined;
    for (const t of segmentsAt(net, id)) {
      if (comp.segs.has(t.id)) { deg++; continue; }
      if (!isDrainLine(t)) continue;
      const o = net.nodes[t.a === id ? t.b : t.a];
      const fx = o.fixtureId ? doc.fixtures[o.fixtureId] : undefined;
      if (o.pos.z > n.pos.z + 1 && !(fx && isManhole(fx.type))) goesUp = true;
      // 下がっていく管・マス・建物の外の管（外の浅い管）へ続く点が起点。外の管より上に起点を置く
      else if (o.pos.z < n.pos.z - 1 || (fx && isManhole(fx.type)) || !insideBuilding(lv, o.pos)) dz = Math.max(dz ?? -Infinity, o.pos.z + (o.dropIn ?? 0));
    }
    if (dz !== undefined) down.push({ id, z: n.pos.z, downZ: dz });
    else if (deg === 1 && !goesUp && !n.fixtureId) ends.push(id);
  }
  if (down.length) {
    const d = down.sort((p, q) => p.z - q.z)[0];
    return { id: d.id, downZ: d.downZ };
  }
  if (!ends.length) return null;
  const ext = lv.outline.length ? lv.outline : wallsOnFloor(doc.building, lv.floorId).filter((w) => w.kind === 'exterior').map((w) => [doc.building.corners[w.a], doc.building.corners[w.b]] as const);
  const score = (id: string) => {
    const p = net.nodes[id].pos;
    return ext.length ? Math.min(...ext.map(([a, b]) => pointSeg(p, a, b))) : p.z;
  };
  return { id: ends.sort((p, q) => score(p) - score(q))[0] };
}

/** systems: 勾配をつけた系統の数。low: 1.5/100 に下げた系統。over: それでも配管の上が基礎天端（床組）を超える系統。raised: 下流が浅く、起点を土間より上げた系統。failed: つけられなかった系統 */
export type UnderfloorSlopeResult = { net: Network; systems: number; segments: number; nodes: number; low: number; over: number; raised: number; failed: number; levels: UnderfloorLevels | null };

/**
 * 床下の排水に勾配をつける。onlyNodes を渡すと、その点を含むまとまりだけ（描いた配管・つないだ配管）。
 */
export function slopeUnderfloor(doc: Doc, rules: UnderfloorRules = {}, onlyNodes?: Iterable<string>): UnderfloorSlopeResult {
  const lv = underfloorLevels(doc);
  const res: UnderfloorSlopeResult = { net: doc.network, systems: 0, segments: 0, nodes: 0, low: 0, over: 0, raised: 0, failed: 0, levels: lv };
  if (!lv) return res;
  const only = onlyNodes ? new Set(onlyNodes) : null;
  let net = doc.network;
  for (const comp of components(net, lv)) {
    if (only && ![...comp.nodes].some((n) => only.has(n))) continue;
    const ex = exitOf({ ...doc, network: net }, comp, lv);
    if (!ex) { res.failed++; continue; }
    let z0 = lv.slab + (rules.startAbove ?? 0);
    if (ex.downZ !== undefined && ex.downZ + DOWN_GAP > z0) { z0 = ex.downZ + DOWN_GAP; res.raised++; }
    // まとまりの点をいったん起点の高さにそろえ（描いた・つないだ直後の段差をなくす）、起点から勾配で上げる。器具の接続口は動かさない
    const zz = Math.round(z0 * 10) / 10;
    const nodes = { ...net.nodes };
    let movedExit = false;
    for (const id of comp.nodes) {
      const n = nodes[id];
      if (n.fixtureId || n.zPin || Math.abs(n.pos.z - zz) < 0.05) continue;
      nodes[id] = { ...n, pos: { ...n.pos, z: zz } };
      if (id === ex.id) movedExit = true;
    }
    const start: Network = { ...net, nodes };
    const run = (low: boolean) => applySlope(start, ex.id, (s) => (isSlopePinned(s) && s.slope !== undefined ? s.slope : underfloorRatio(s.diameter, rules, low)), { include: (s) => comp.segs.has(s.id), allowMid: true });
    /** 配管の上（管頂）が上限を超える点があるか */
    const tooHigh = (n2: Network) => [...comp.segs].some((id) => {
      const s = n2.segments[id];
      return !!s && Math.max(n2.nodes[s.a].pos.z, n2.nodes[s.b].pos.z) + outerDiameter(s.diameter) > lv.top + 0.5;
    });
    let r = run(false);
    if (r && tooHigh(r.net)) {
      const r2 = run(true);
      if (r2) { r = r2; res.low++; if (tooHigh(r2.net)) res.over++; }
    }
    if (!r) { res.failed++; continue; }
    net = r.net;
    res.systems++;
    res.segments += r.segments;
    res.nodes += r.nodes + (movedExit ? 1 : 0);
  }
  res.net = net;
  return res;
}

/** 区間の支持点（レベルバンド）の土間からの高さ（管底、mm）。床下の排水でなければ undefined */
export function bandHeight(doc: Pick<Doc, 'building' | 'network'>, s: Segment, z: number): number | undefined {
  const lv = underfloorLevels(doc);
  if (!lv || !isUnderfloorRun(doc.network, s, lv)) return undefined;
  return Math.max(0, Math.round(z - lv.slab));
}
