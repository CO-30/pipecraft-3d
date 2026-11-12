/**
 * 給水・給湯を床下でつなぐ（案）。純粋関数。ヘッダー工法:
 *   メーター → 地中 → いちばん近い外壁の外で床下の高さへ → 外周の基礎を直角に貫通 → 床下の給水ヘッダー → 各器具の給水口
 *   給水ヘッダー → 給湯器の入口、給湯器の出口 → 床下の給湯ヘッダー → 各器具の給湯口
 * 床下の配管は 1 階の床から UNDERFLOOR_Z。器具の給水・給湯口から真下へ立て管を下ろし（すでに下ろしてあればそれを使う）、
 * `findFloorRoute`（内部の立上りは人通口を通る）でヘッダーの出口へ。ヘッダーへはヘッダーの向きに直角に入る。
 * 先に引いた給水・給湯の床下の管とは平行に重ねない（直角に横切るのはよい）。
 * つながっていない口だけをつなぐので、何度押しても増えない。床下の形の判定は drainRoute と同じ考え方の写し（排水の作業と衝突させないため）。
 */
import type { Vec2 } from './building';
import { wallsOnFloor } from './building';
import type { Doc } from './doc';
import { FIXTURE_CATALOG, fixtureCorners, groundZ, placeFixture, portNodes, type Fixture, type FixtureType } from './fixtures';
import { findFloorRoute, ROUTE_STEP, type RouteGoal, type RouteResult } from './floorRoute';
import { assignAutoMaterials } from './materials';
import { KSS_HEIGHTS } from './kisoSleeve';
import { membersOf } from './members';
import { addPolyline, addRiser, insertValve, segmentsAt, splitSegment, type PipeNode, type SegmentAttrs, type SystemType, type Vec3 } from './network';

/** 床下の配管の高さ（1 階の床から mm） */
export const UNDERFLOOR_Z = -300;
/** 床下のヘッダーの設置面（出口が UNDERFLOOR_Z に来る） */
const HEADER_MOUNT = -400;
/** 給水・給湯口を床下へ下ろす器具（屋外の水栓・機器どうしをつなぐものは除く） */
const SUPPLY_TYPES = new Set<FixtureType>(['toilet', 'washbasin', 'kitchen', 'bathtub', 'shower', 'washer', 'faucet', 'mixFaucet']);
/** 基礎の内側の面から、スリーブ（KSS）から床下へ立ち上げる点までの離れ(mm) */
const KSS_IN = 10;
const WALL_GAP = 80, INSET = 150, OUT_GAP = 100, PIPE_GAP = 60, BUSY_GAP = 40, CORNER = 300, HEADER_IN = 600, FAR = 100_000;
/** ヘッダーの周りに空けておく幅(mm)。長さの方向は少しだけ（入口へは長さの方向から入る） */
const HEADER_CLEAR_LONG = 20, HEADER_CLEAR_WIDE = 60;
/** ヘッダーを横に並べるときの間(mm) */
const HEADER_ROW_GAP = 500;
/** 同じ外壁で、貫通どうしを離す距離(mm) */
const SLEEVE_APART = 150;
/** 方眼の都合で最後の 1 本が少し斜めになっても、縦・横とみなす幅(mm) */
const AXIS_TOL = 60;

export type SupplyRouteResult = {
  doc: Doc;
  /** 足した配管の本数（つないだ道の数） */
  pipes: number;
  /** 新しく置いたヘッダーの数 */
  headers: number;
  /** 外周の基礎の貫通（スリーブ）の数 */
  sleeves: number;
  /** 内部の立上りの貫通の数 */
  crossings: number;
  /** 入れた止水栓の数（各器具の給水・給湯と給湯器の入口） */
  valves: number;
  connected: { water: number; hot: number };
  notes: string[];
  error?: string;
  /** ヘッダーを使わない（分岐でつなぐ）ときに、つなげなかった器具の数。ヘッダーを置くか聞くのに使う */
  needHeader?: { water: number; hot: number };
};

/**
 * ヘッダーの使い方。use: 床下のヘッダーでつなぐ（足りなければ置く）。
 * avoid: ヘッダーを置かず、引込（給湯は給湯器の出口）から床下の管を分岐（チーズ）でつなぐ。置いてあるヘッダーは使う
 */
export type HeaderMode = 'use' | 'avoid';

type Line = { a: Vec2; b: Vec2; t: number; exterior?: boolean };
function crosses(p: Vec2, q: Vec2, a: Vec2, b: Vec2): boolean {
  const d = (q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x);
  if (Math.abs(d) < 1e-9) return false;
  const s = ((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)) / d;
  const u = ((a.x - p.x) * (q.y - p.y) - (a.y - p.y) * (q.x - p.x)) / d;
  return s > 1e-6 && s < 1 - 1e-6 && u >= 0 && u < 1;
}
function pointSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2));
  return Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t));
}
const dist2 = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
type Axis = 'h' | 'v';
const axisOf = (p: Vec2, q: Vec2): Axis | null => (Math.abs(p.y - q.y) < AXIS_TOL && Math.abs(p.x - q.x) >= Math.abs(p.y - q.y) ? 'h' : Math.abs(p.x - q.x) < AXIS_TOL ? 'v' : null);
/** 平行に重なって走る長さ（離れ gap 未満のとき）。重ならなければ 0 */
function overlapRun(p: Vec2, q: Vec2, a: Vec2, b: Vec2, gap: number): number {
  const ax = axisOf(p, q);
  if (!ax || ax !== axisOf(a, b)) return 0;
  const off = ax === 'h' ? Math.abs((p.y + q.y) / 2 - (a.y + b.y) / 2) : Math.abs((p.x + q.x) / 2 - (a.x + b.x) / 2);
  if (off >= gap) return 0;
  const [p0, p1, a0, a1] = ax === 'h' ? [p.x, q.x, a.x, b.x] : [p.y, q.y, a.y, b.y];
  return Math.max(0, Math.min(Math.max(p0, p1), Math.max(a0, a1)) - Math.max(Math.min(p0, p1), Math.min(a0, a1)));
}
const DIR: Record<0 | 1 | 2 | 3, Vec2> = { 0: { x: 1, y: 0 }, 1: { x: 0, y: 1 }, 2: { x: -1, y: 0 }, 3: { x: 0, y: -1 } };
const dirOf = (v: Vec2): 0 | 1 | 2 | 3 => (Math.abs(v.x) >= Math.abs(v.y) ? (v.x >= 0 ? 0 : 2) : v.y >= 0 ? 1 : 3);

/** eIn: 床下の入口、eOut: 基礎の外（地中で近づく点）、rise: 基礎の中で立ち上げる点（基礎貫通スリーブ KSS の形）、n: 外向き */
type Entry = { eIn: Vec2; eOut: Vec2; rise: Vec2; n: Vec2 };

export function routeSupplies(doc: Doc, opts: { burial?: number; headers?: HeaderMode } = {}): SupplyRouteResult {
  const none = (error?: string): SupplyRouteResult => ({ doc, pipes: 0, headers: 0, sleeves: 0, crossings: 0, valves: 0, connected: { water: 0, hot: 0 }, notes: [], ...(error ? { error } : {}) });
  const b = doc.building;
  const base = b.floors.slice().sort((p, q) => p.elevation - q.elevation)[0];
  if (!base) return none('建物がありません');
  const meter = Object.values(doc.fixtures).find((f) => f.type === 'waterMeter');
  if (!meter) return none('水道メーターがありません。器具の「水道メーター」を外に置いてから押してください');
  const walls: Line[] = wallsOnFloor(b, base.id).map((w) => ({ a: b.corners[w.a], b: b.corners[w.b], t: w.thickness, exterior: w.kind === 'exterior' }));
  const extWalls = walls.filter((w) => w.exterior);
  if (!extWalls.length) return none('1 階の外壁がありません。建物の外壁を描いてから押してください');
  const footLines = membersOf(b).filter((m) => m.kind === 'footing' && m.floorId === base.id).map((m) => ({ a: m.a, b: m.b, t: m.width, z0: base.elevation + m.z0, z1: base.elevation + m.z1 }));
  const blockers: Line[] = [...walls, ...footLines];
  const xs = walls.flatMap((w) => [w.a.x, w.b.x]), ys = walls.flatMap((w) => [w.a.y, w.b.y]);
  const bounds = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  // 判定は方眼の点ごとに何度も呼ぶので、RES 角の升目ごとに覚えておく（道ごとに方眼がずれても使い回せる。スマホで固まらないように）
  const RES = 25, PAD = 3000;
  const gx0 = bounds.x0 - PAD, gy0 = bounds.y0 - PAD;
  const GW = Math.ceil((bounds.x1 - bounds.x0 + 2 * PAD) / RES) + 1, GH = Math.ceil((bounds.y1 - bounds.y0 + 2 * PAD) / RES) + 1;
  const memo = (f: (p: Vec2) => boolean) => {
    const cache = GW * GH <= 4_000_000 ? new Int8Array(GW * GH).fill(-1) : null;
    return (p: Vec2): boolean => {
      const i = Math.round((p.x - gx0) / RES), j = Math.round((p.y - gy0) / RES);
      if (!cache || i < 0 || j < 0 || i >= GW || j >= GH) return f(p);
      const k = j * GW + i;
      if (cache[k] < 0) cache[k] = f({ x: gx0 + i * RES, y: gy0 + j * RES }) ? 1 : 0;
      return cache[k] === 1;
    };
  };
  const inside = memo((p) => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => blockers.some((k) => crosses(p, { x: p.x + dx * FAR, y: p.y + dy * FAR }, k.a, k.b))));
  const nearExt = (f: Line) => extWalls.some((w) => pointSeg({ x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 }, w.a, w.b) < Math.max(w.t, f.t) / 2 + 250);
  const extFoot = footLines.filter(nearExt), inFoot = footLines.filter((f) => !nearExt(f));
  const zU = base.elevation + UNDERFLOOR_Z;
  const roomy = memo((q) => inside(q) && extWalls.every((w) => pointSeg(q, w.a, w.b) >= w.t / 2 + WALL_GAP) && extFoot.every((f) => pointSeg(q, f.a, f.b) >= f.t / 2 + WALL_GAP));
  const footAt = memo((q) => inFoot.some((f) => zU > f.z0 && zU < f.z1 && pointSeg(q, f.a, f.b) < f.t / 2 + PIPE_GAP));
  const burialZ0 = groundZ(b, doc.site) - (opts.burial ?? 300);
  // 基礎貫通スリーブ（前澤 KSS）: 床下の口は土間。外の口（土間 − H）が埋設の深さより深くなる一番浅い品番に、地中の管の深さを合わせる
  const slabZ = b.foundation?.slabTop !== undefined ? base.elevation + b.foundation.slabTop : undefined;
  const kssH = slabZ !== undefined && extFoot.length ? KSS_HEIGHTS.find((H) => slabZ - H <= burialZ0) : undefined;
  const burialZ = kssH !== undefined ? slabZ! - kssH : burialZ0;

  let cur = doc;
  const newSegs: string[] = [];
  let pipes = 0, headers = 0, sleeves = 0, crossings = 0;
  const connected = { water: 0, hot: 0 };
  const notes: string[] = [];
  /** 止水栓を入れる口（つないだ器具の給水・給湯、給湯器の入口） */
  const valvePorts: string[] = [];
  const nodeOf = (fid: string, pid: string): PipeNode | undefined => portNodes(cur.network, fid).find((n) => n.portId === pid);
  const free = (n: PipeNode | undefined) => !!n && segmentsAt(cur.network, n.id).length === 0;
  const attrs = (system: SystemType, diameter: number): SegmentAttrs => ({ system, diameter });
  const at = (p: Vec2, z = zU): Vec3 => ({ x: p.x, y: p.y, z });
  const path = (pts: Vec3[], a: SegmentAttrs, start?: string, end?: string): string[] => {
    const r = addPolyline(cur.network, pts, a, { ...(start ? { startNodeId: start } : {}), ...(end ? { endNodeId: end } : {}) });
    cur = { ...cur, network: r.net };
    newSegs.push(...r.segmentIds);
    return r.nodeIds;
  };

  // --- ヘッダー: 床下のヘッダーの形（回してあっても）と、出口・入口へ入る向き ---
  const headerFixtures = () => Object.values(cur.fixtures).filter((f) => (f.type === 'waterHeader' || f.type === 'hotWaterHeader') && f.floorId === base.id && (f.params?.mountZ ?? 0) < 0);
  /** ヘッダーの形（回した向き・大きさ）。方眼の点ごとに計算し直さないよう、先に作っておく */
  type Rect = { cx: number; cy: number; ux: Vec2; uy: Vec2; hl: number; hd: number };
  const headerRects = (): Rect[] => headerFixtures().map((f) => {
    const [c0, c1, , c3] = fixtureCorners(f);
    const L = dist2(c0, c1), D = dist2(c0, c3);
    return { cx: f.x, cy: f.y, ux: { x: (c1.x - c0.x) / L, y: (c1.y - c0.y) / L }, uy: { x: (c3.x - c0.x) / D, y: (c3.y - c0.y) / D }, hl: L / 2 + HEADER_CLEAR_LONG, hd: D / 2 + HEADER_CLEAR_WIDE };
  });
  /** 点が、ヘッダーとその周りの空けておく幅の中にある */
  const inHeader = (q: Vec2, rs = headerRects()) => rs.some((r) => {
    const dx = q.x - r.cx, dy = q.y - r.cy;
    return Math.abs(dx * r.ux.x + dy * r.ux.y) <= r.hl && Math.abs(dx * r.uy.x + dy * r.uy.y) <= r.hd;
  });
  /** ヘッダーの出口へ入れる向き（ヘッダーの長さの方向に直角） */
  const outletDirs = (f: Fixture): (0 | 1 | 2 | 3)[] => {
    const [c0, c1] = fixtureCorners(f);
    return Math.abs(c1.x - c0.x) >= Math.abs(c1.y - c0.y) ? [1, 3] : [0, 2];
  };
  /** ヘッダーの入口へ入る向き（入口の外からヘッダーの中心へ） */
  const inletDir = (f: Fixture, inNode: PipeNode): 0 | 1 | 2 | 3 => dirOf({ x: f.x - inNode.pos.x, y: f.y - inNode.pos.y });

  // --- 外周の入口 ---
  /** これまでに使った貫通（同じ所で 2 本を通さない） */
  const usedSleeves: Vec2[] = [];
  /** 外の点 p に近い外壁の入口（壁へ直角に下ろした足。壁の端から CORNER 以上、使った貫通から SLEEVE_APART 以上） */
  const entryFor = (p: Vec2): Entry | null => {
    let best: (Entry & { cost: number }) | null = null;
    for (const w of extWalls) {
      const L = dist2(w.a, w.b);
      if (L < 2 * CORNER + 1) continue;
      const u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
      if (Math.abs(u.x) > 1e-6 && Math.abs(u.y) > 1e-6) continue; // 床下は縦横に配管する
      const s0 = (p.x - w.a.x) * u.x + (p.y - w.a.y) * u.y;
      for (const shift of [0, 200, -200, 400, -400, 600, -600]) {
        const s = Math.max(CORNER, Math.min(L - CORNER, s0 + shift));
        const foot = { x: w.a.x + u.x * s, y: w.a.y + u.y * s };
        if (usedSleeves.some((f) => dist2(f, foot) < SLEEVE_APART)) continue;
        const nn = [{ x: -u.y, y: u.x }, { x: u.y, y: -u.x }].find((c) => !inside({ x: foot.x + c.x * (w.t / 2 + 200), y: foot.y + c.y * (w.t / 2 + 200) }));
        if (!nn) continue;
        const face = Math.max(w.t, ...extFoot.filter((f) => pointSeg(foot, f.a, f.b) < f.t / 2 + 50).map((f) => f.t)) / 2;
        const eIn = { x: Math.round(foot.x - nn.x * (w.t / 2 + INSET)), y: Math.round(foot.y - nn.y * (w.t / 2 + INSET)) };
        const eOut = { x: Math.round(foot.x + nn.x * (face + OUT_GAP)), y: Math.round(foot.y + nn.y * (face + OUT_GAP)) };
        const rise = { x: Math.round(foot.x - nn.x * (face + KSS_IN)), y: Math.round(foot.y - nn.y * (face + KSS_IN)) };
        if (!roomy(eIn) || footAt(eIn) || inHeader(eIn)) continue;
        // 外から入口へ: 壁と平行に進んでから直角に（途中で別の外壁を横切る道は採らない）
        const k = (p.x - eOut.x) * nn.x + (p.y - eOut.y) * nn.y;
        const corner = { x: eOut.x + nn.x * k, y: eOut.y + nn.y * k };
        if (extWalls.some((x) => x !== w && (crosses(p, corner, x.a, x.b) || crosses(corner, eOut, x.a, x.b)))) continue;
        const cost = Math.abs(p.x - eOut.x) + Math.abs(p.y - eOut.y);
        if (!best || cost < best.cost) best = { eIn, eOut, rise, n: nn, cost };
        break;
      }
    }
    if (best) usedSleeves.push({ x: (best.eIn.x + best.eOut.x) / 2, y: (best.eIn.y + best.eOut.y) / 2 });
    return best;
  };
  const cornerOf = (p: Vec2, e: Entry): Vec2 => {
    const k = (p.x - e.eOut.x) * e.n.x + (p.y - e.eOut.y) * e.n.y;
    return { x: e.eOut.x + e.n.x * k, y: e.eOut.y + e.n.y * k };
  };

  /**
   * 床下の点 from から to へ。dirs: 終点へ入る向き（ヘッダーの出口は長さの方向に直角）。
   * 先に引いた給水・給湯の床下の管とは平行に重ねない。見つからなければ null
   */
  const routeUnder = (from: Vec2, to: Vec2, dirs: (0 | 1 | 2 | 3)[] = [0, 1, 2, 3]): Vec2[] | null => {
    if (dist2(from, to) < 1) return [from, to];
    return routeGoals(from, dirs.map((dir, tag) => ({ a: to, b: to, dir, tag })))?.points ?? null;
  };
  /** 床下の点 from から、いくつかの終点（点・線）の一番近いものへ。先の管とは平行に重ねない */
  const routeGoals = (from: Vec2, goals: RouteGoal[]): RouteResult | null => {
    // 先の管を向き・位置で分けておき、近い所だけ調べる（毎回すべてを見ない）
    const hb = new Map<number, [Vec2, Vec2][]>(), vb = new Map<number, [Vec2, Vec2][]>();
    const B = 50;
    for (const s of Object.values(cur.network.segments)) {
      if (s.system !== 'water' && s.system !== 'hotWater') continue;
      const a = cur.network.nodes[s.a].pos, c = cur.network.nodes[s.b].pos;
      if (Math.abs(a.z - zU) > 1 || Math.abs(c.z - zU) > 1) continue;
      const ax = axisOf(a, c);
      if (!ax) continue;
      const key = Math.round((ax === 'h' ? (a.y + c.y) / 2 : (a.x + c.x) / 2) / B);
      const m = ax === 'h' ? hb : vb;
      (m.get(key) ?? m.set(key, []).get(key)!).push([a, c]);
    }
    const busyNear = (p: Vec2, q: Vec2): boolean => {
      const ax = axisOf(p, q);
      if (!ax) return false;
      const m = ax === 'h' ? hb : vb, c = ax === 'h' ? (p.y + q.y) / 2 : (p.x + q.x) / 2;
      for (let k = Math.floor((c - BUSY_GAP) / B); k <= Math.ceil((c + BUSY_GAP) / B); k++) for (const [a, d] of m.get(k) ?? []) if (overlapRun(p, q, a, d, BUSY_GAP) > 10) return true;
      return false;
    };
    const edgeOk = (q: Vec2, r: Vec2) => !busyNear(q, r);
    const hs = headerRects();
    const nearStart = (q: Vec2) => dist2(q, from) < 2 * ROUTE_STEP;
    const r = findFloorRoute({ start: from, allowed: (q) => nearStart(q) || (roomy(q) && !inHeader(q, hs)), footing: footAt, edgeOk, goals, bounds });
    if (!r) return null;
    // 方眼に合わせた最後の 1 本も含めて、重ならないことを確かめ直す
    for (let i = 0; i + 1 < r.points.length; i++) if (busyNear(r.points[i], r.points[i + 1])) return null;
    crossings += r.crossings;
    return r;
  };

  /** 床下の点 fromId から口 toId へ（終点が床下でなければ、真下まで来てから立ち上げ・立ち下げ） */
  const connect = (fromId: string, toId: string, a: SegmentAttrs, dirs?: (0 | 1 | 2 | 3)[]): boolean => {
    const p = cur.network.nodes[fromId].pos, q = cur.network.nodes[toId].pos;
    const pts = routeUnder(p, q, dirs);
    if (!pts) return false;
    const v = pts.map((x) => at(x));
    if (Math.abs(q.z - zU) > 0.5) v.push(q);
    path(v, a, fromId, toId);
    pipes++;
    return true;
  };

  /** ヘッダーを置く: near から inward へ HEADER_IN、だめなら少しずつ内へ・長さの方向へずらす。置いたヘッダーの id */
  const placeHeader = (type: 'waterHeader' | 'hotWaterHeader', near: Vec2, inwards: Vec2[]): string | null => {
    const hw = FIXTURE_CATALOG[type].size.w / 2;
    const rs = headerRects();
    for (const inward of inwards) for (let step = 0; step < 8; step++) for (const sx of [0, 1, -1, 2, -2]) {
      const d = HEADER_IN + step * 300;
      // 回さずに置くので、長さの方向は x。並べるときは HEADER_ROW_GAP 空ける（入口へまっすぐ入れるように）
      const p = { x: Math.round(near.x + inward.x * d + sx * (2 * hw + HEADER_ROW_GAP)), y: Math.round(near.y + inward.y * d) };
      const pts = [-hw - HEADER_CLEAR_LONG, 0, hw + HEADER_CLEAR_LONG].flatMap((dx) => [-HEADER_CLEAR_WIDE, 0, HEADER_CLEAR_WIDE].map((dy) => ({ x: p.x + dx, y: p.y + dy })));
      // 入口の前（長さの方向に 2 目）も空いていること
      pts.push({ x: p.x - hw - 2 * ROUTE_STEP, y: p.y });
      if (!pts.every((q) => roomy(q) && !footAt(q) && !inHeader(q, rs))) continue;
      const r = placeFixture(cur, base.id, type, p, 0, { mountZ: HEADER_MOUNT });
      if (!r.fixtureId) continue;
      cur = r.doc;
      headers++;
      return r.fixtureId;
    }
    return null;
  };
  type Outlet = { node: PipeNode; dirs: (0 | 1 | 2 | 3)[] };
  /** 床下のヘッダーの空いている出口（足りなければヘッダーを足し、feed で入口へつなぐ） */
  const headerOutlets = (type: 'waterHeader' | 'hotWaterHeader', need: number, near: Vec2, inwards: Vec2[], feed: (inNode: PipeNode, f: Fixture) => boolean): Outlet[] => {
    const outs: Outlet[] = [];
    const collect = (f: Fixture) => portNodes(cur.network, f.id).filter((n) => n.portId?.startsWith('out') && free(n)).forEach((n) => outs.push({ node: n, dirs: outletDirs(f) }));
    const label = FIXTURE_CATALOG[type].label;
    for (const f of headerFixtures().filter((x) => x.type === type)) {
      const inNode = nodeOf(f.id, 'in');
      if (free(inNode) && !feed(inNode!, f)) notes.push(`${label}の入口へ配管をつなげませんでした（手でつないでください）`);
      collect(f);
    }
    while (outs.length < need) {
      const id = placeHeader(type, near, inwards);
      if (!id) { notes.push(`${label}を置ける場所が床下に見つかりませんでした`); break; }
      const f = cur.fixtures[id];
      if (!feed(nodeOf(id, 'in')!, f)) notes.push(`${label}の入口へ配管をつなげませんでした（手でつないでください）`);
      collect(f);
    }
    return outs;
  };

  // --- 器具の給水・給湯口（1 階の建物の中）。空いている口は真下へ下ろし、下ろしてある立て管はその下の端を使う ---
  type PortState = { kind: 'free' } | { kind: 'riser'; end: PipeNode } | { kind: 'used' };
  const portState = (n: PipeNode): PortState => {
    const segs = segmentsAt(cur.network, n.id);
    if (!segs.length) return { kind: 'free' };
    if (segs.length !== 1) return { kind: 'used' };
    const o = cur.network.nodes[segs[0].a === n.id ? segs[0].b : segs[0].a];
    const vertical = dist2(o.pos, n.pos) < 1 && o.pos.z < n.pos.z;
    const under = o.pos.z < base.elevation && o.pos.z > base.elevation - 1000;
    return !o.fixtureId && vertical && under && segmentsAt(cur.network, o.id).length === 1 ? { kind: 'riser', end: o } : { kind: 'used' };
  };
  /** 床下の高さの端（下ろしてある立て管の深さが違えば、床下の高さまで足す） */
  const underEnd = (n: PipeNode, st: PortState, system: SystemType, dia: number): PipeNode | null => {
    if (st.kind === 'used') return null;
    if (st.kind === 'free') {
      const r = addRiser(cur.network, n.id, zU, attrs(system, dia));
      if (!r) return null;
      cur = { ...cur, network: r.net };
      newSegs.push(r.segmentId);
      return cur.network.nodes[r.nodeId];
    }
    if (Math.abs(st.end.pos.z - zU) < 1) return st.end;
    const ids = path([st.end.pos, at(st.end.pos)], attrs(system, dia), st.end.id);
    return cur.network.nodes[ids.at(-1)!];
  };
  type Target = { end: PipeNode; fixtureId: string; port: string };
  const targets: Record<'water' | 'hotWater', Target[]> = { water: [], hotWater: [] };
  let outdoor = 0, upper = 0, indoorSeen = 0;
  for (const f of Object.values(cur.fixtures)) {
    if (!SUPPLY_TYPES.has(f.type) && f.type !== 'outdoorFaucet') continue;
    const ports = portNodes(cur.network, f.id).filter((n) => { const sys = FIXTURE_CATALOG[f.type].ports.find((p) => p.id === n.portId)?.system; return sys === 'water' || sys === 'hotWater'; });
    const states = ports.map((n) => ({ n, st: portState(n) }));
    if (states.every((x) => x.st.kind === 'used')) { if (f.type !== 'outdoorFaucet' && inside(f)) indoorSeen++; continue; }
    if (f.type === 'outdoorFaucet' || !inside(f)) { outdoor++; continue; }
    indoorSeen++;
    if (f.floorId !== base.id) { upper++; continue; }
    for (const { n, st } of states) {
      const def = FIXTURE_CATALOG[f.type].ports.find((p) => p.id === n.portId)!;
      const end = underEnd(n, st, def.system, def.diameter);
      if (end) targets[def.system as 'water' | 'hotWater'].push({ end, fixtureId: f.id, port: n.id });
    }
  }
  if (!indoorSeen && outdoor && !Object.values(doc.fixtures).some((f) => f.type !== 'outdoorFaucet' && SUPPLY_TYPES.has(f.type) && inside(f))) {
    return none('建物の中に給水・給湯の器具が見つかりません（外壁が 1 周つながっていない、器具が建物の外にある、など）');
  }
  if (outdoor) notes.push(`屋外の水栓など ${outdoor} 個はつないでいません（引込の管から分けてください）`);
  if (upper) notes.push(`2 階より上の器具 ${upper} 個はつないでいません`);

  // --- 引込（メーター → 外周の入口）。先に入口を決める（給湯器の貫通と同じ所にしない） ---
  const meterOut = nodeOf(meter.id, 'out')!;
  const meterEntry = entryFor(meterOut.pos);
  /** 引込の入口の点（前に押したときに引いた引込があればそれ） */
  let feedNode: string | null = meterEntry
    ? Object.values(cur.network.nodes).find((n) => dist2(n.pos, meterEntry.eIn) < 1 && Math.abs(n.pos.z - zU) < 1 && segmentsAt(cur.network, n.id).some((s) => s.system === 'water'))?.id ?? null
    : null;
  /** 引込の床下の入口の点（無ければメーターから引く） */
  const ensureFeed = (): string | null => {
    if (!feedNode) {
      if (!free(meterOut) || !meterEntry) return null;
      const c = cornerOf(meterOut.pos, meterEntry);
      // 地中で基礎を抜け、基礎の中で床下へ立ち上げる（基礎貫通スリーブ KSS の形。外に管を出さない）
      const ids = path([meterOut.pos, at(meterOut.pos, burialZ), at(c, burialZ), at(meterEntry.rise, burialZ), at(meterEntry.rise), at(meterEntry.eIn)], attrs('water', 20), meterOut.id);
      sleeves++;
      pipes++;
      feedNode = ids.at(-1)!;
    }
    return feedNode;
  };
  const feedWater = (inNode: PipeNode, f: Fixture): boolean => {
    const id = ensureFeed();
    return !!id && connect(id, inNode.id, attrs('water', 20), [inletDir(f, inNode)]);
  };

  // --- 分岐でつなぐ（ヘッダーを使わない） ---
  const mode: HeaderMode = opts.headers ?? 'use';
  const needHeader = { water: 0, hot: 0 };
  /** 分岐でつないだ床下の管（系統ごと）。次の器具はここへ合流できる */
  const branchSegs: Record<'water' | 'hotWater', string[]> = { water: [], hotWater: [] };
  type Tgt = { end: string; fixtureId: string; dia: number; port: string };
  /** feedId（床下の入口）から器具へ、近い器具から順に。先に引いた管の途中へチーズで合流する。つなげなかった数 */
  const branch = (system: 'water' | 'hotWater', feedId: string, list: Tgt[]): number => {
    let failed = 0;
    const feedPos = () => cur.network.nodes[feedId].pos;
    const order = list.slice().sort((p, q) => dist2(cur.network.nodes[p.end].pos, feedPos()) - dist2(cur.network.nodes[q.end].pos, feedPos()));
    const ends = new Map<string, number>();
    for (const t of order) {
      const from = cur.network.nodes[t.end].pos;
      const goals: RouteGoal[] = [], segOf: (string | null)[] = [];
      for (const dir of [0, 1, 2, 3] as const) { goals.push({ a: feedPos(), b: feedPos(), dir, tag: goals.length }); segOf.push(null); }
      for (const sid of branchSegs[system]) {
        const sg = cur.network.segments[sid];
        if (!sg) continue;
        const a = cur.network.nodes[sg.a].pos, c = cur.network.nodes[sg.b].pos;
        if (Math.abs(a.z - zU) > 1 || Math.abs(c.z - zU) > 1 || dist2(a, c) < 2 * ROUTE_STEP) continue;
        const ax = axisOf(a, c);
        if (!ax) continue;
        for (const dir of (ax === 'h' ? [1, 3] : [0, 2]) as (0 | 1 | 2 | 3)[]) { goals.push({ a, b: c, dir, tag: goals.length }); segOf.push(sid); }
      }
      const r = routeGoals(from, goals);
      if (!r) { failed++; notes.push(`${FIXTURE_CATALOG[cur.fixtures[t.fixtureId].type].label}${system === 'hotWater' ? 'の給湯' : 'の給水'}へ、分岐でつなぐ道が見つかりませんでした`); continue; }
      const last = r.points[r.points.length - 1];
      const sid = segOf[r.goal.tag];
      let endId = feedId;
      if (sid) {
        const sg = cur.network.segments[sid];
        const hit = [sg.a, sg.b].find((n) => dist2(cur.network.nodes[n].pos, last) < 1);
        if (hit) endId = hit;
        else {
          const sp = splitSegment(cur.network, sid, at(last));
          cur = { ...cur, network: sp.net };
          branchSegs[system] = [...branchSegs[system].filter((x) => x !== sid), ...sp.segmentIds];
          newSegs.push(...sp.segmentIds);
          endId = sp.nodeId;
        }
      }
      const pts = r.points.map((x) => at(x));
      const before = new Set(Object.keys(cur.network.segments));
      path(pts, attrs(system, t.dia), t.end, endId);
      branchSegs[system].push(...Object.keys(cur.network.segments).filter((x) => !before.has(x)));
      pipes++;
      ends.set(t.end, t.dia);
      connected[system === 'water' ? 'water' : 'hot']++;
      valvePorts.push(t.port);
    }
    // 管の太さ: 2 つ以上の器具へ流れる区間は φ20、1 つだけへの区間はその器具の太さ
    const segSet = new Set(branchSegs[system]);
    const visit = (nid: string, fromSeg: string | null, seen: Set<string>): [number, number] => {
      let n = ends.has(nid) ? 1 : 0, dia = ends.get(nid) ?? 0;
      for (const sg of segmentsAt(cur.network, nid)) {
        if (sg.id === fromSeg || !segSet.has(sg.id) || seen.has(sg.id)) continue;
        seen.add(sg.id);
        const [c, d] = visit(sg.a === nid ? sg.b : sg.a, sg.id, seen);
        const want = c >= 2 ? 20 : d || sg.diameter;
        if (want !== sg.diameter) cur = { ...cur, network: { ...cur.network, segments: { ...cur.network.segments, [sg.id]: { ...cur.network.segments[sg.id], diameter: want } } } };
        n += c; dia = Math.max(dia, want);
      }
      return [n, dia];
    };
    visit(feedId, null, new Set());
    return failed;
  };

  const heater = Object.values(cur.fixtures).find((f) => f.type === 'waterHeater');
  const heaterIn = heater ? nodeOf(heater.id, 'in') : undefined;
  const heaterOut = heater ? nodeOf(heater.id, 'out') : undefined;
  const heaterInside = !!heater && inside(heater);
  /** 外の口（給湯器）と床下の入口をつなぐ: 口 → 入口の外で床下の高さ → 基礎を貫通 → 入口。入口のノード id */
  const wallLink = (port: PipeNode, a: SegmentAttrs): { id: string; e: Entry } | null => {
    const e = entryFor(port.pos);
    if (!e) return null;
    const c = cornerOf(port.pos, e);
    // 口から地中へ下ろし、地中で基礎を抜けて基礎の中で床下へ立ち上げる（KSS の形）
    const ids = path([port.pos, at(port.pos, burialZ), at(c, burialZ), at(e.rise, burialZ), at(e.rise), at(e.eIn)], a, port.id);
    sleeves++;
    pipes++;
    return { id: ids.at(-1)!, e };
  };
  const dropLink = (port: PipeNode, a: SegmentAttrs): string | null => {
    const r = addRiser(cur.network, port.id, zU, a);
    if (!r) return null;
    cur = { ...cur, network: r.net };
    newSegs.push(r.segmentId);
    return r.nodeId;
  };
  /** 4 方向（first を先に） */
  const around = (first: Vec2): Vec2[] => [first, ...[{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].filter((v) => v.x !== first.x || v.y !== first.y)];
  const toward = (from: Vec2, pts: Vec2[]): Vec2 => {
    if (!pts.length) return { x: 1, y: 0 };
    const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length - from.x, y: pts.reduce((s, p) => s + p.y, 0) / pts.length - from.y };
    return DIR[dirOf(c)];
  };

  // --- 給水: メーター → 給水ヘッダー → 器具・給湯器の入口 ---
  const waterTargets: { end: string; fixtureId: string; dia: number; port: string }[] = targets.water.map((t) => ({ end: t.end.id, fixtureId: t.fixtureId, dia: 13, port: t.port }));
  if (heaterIn && free(heaterIn)) {
    const end = heaterInside ? dropLink(heaterIn, attrs('water', 20)) : wallLink(heaterIn, attrs('water', 20))?.id ?? null;
    if (end) waterTargets.push({ end, fixtureId: heater!.id, dia: 20, port: heaterIn.id });
    else notes.push('給湯器の入口への道が見つかりませんでした');
  }
  if (waterTargets.length) {
    if (!free(meterOut) && !feedNode) notes.push('メーターの出口にはすでに配管があるため、引込は足していません（給水ヘッダーの入口は手でつないでください）');
    const near = meterEntry ? meterEntry.eIn : { x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 };
    const inward = meterEntry ? { x: -meterEntry.n.x, y: -meterEntry.n.y } : toward(near, waterTargets.map((t) => cur.network.nodes[t.end].pos));
    if (mode === 'avoid' && !headerFixtures().some((f) => f.type === 'waterHeader')) {
      const id = ensureFeed();
      if (id) needHeader.water = branch('water', id, waterTargets);
      else notes.push('メーターから床下への引込が引けないので、給水はつないでいません');
    } else {
      const outs = headerOutlets('waterHeader', waterTargets.length, near, around(inward), feedWater);
      attach(waterTargets, outs, near, 'water', '給水ヘッダー');
    }
  }

  // --- 給湯: 給湯器の出口 → 給湯ヘッダー → 器具の給湯口 ---
  if (targets.hotWater.length) {
    if (!heater || !heaterOut) notes.push('給湯器が無いため、給湯はつないでいません（給湯器を置いてもう一度押すとつながります）');
    else {
      let hotFeed: string | null = null, hotEntry: Entry | null = null;
      if (free(heaterOut)) {
        if (heaterInside) hotFeed = dropLink(heaterOut, attrs('hotWater', 20));
        else { const w = wallLink(heaterOut, attrs('hotWater', 20)); hotFeed = w?.id ?? null; hotEntry = w?.e ?? null; }
      }
      const feedHot = (inNode: PipeNode, f: Fixture): boolean => !!hotFeed && connect(hotFeed, inNode.id, attrs('hotWater', 20), [inletDir(f, inNode)]);
      const near = hotFeed ? cur.network.nodes[hotFeed].pos : heaterOut.pos;
      const inward = hotEntry ? { x: -hotEntry.n.x, y: -hotEntry.n.y } : toward(near, targets.hotWater.map((t) => t.end.pos));
      const hotList = targets.hotWater.map((t) => ({ end: t.end.id, fixtureId: t.fixtureId, dia: 13, port: t.port }));
      if (mode === 'avoid' && !headerFixtures().some((f) => f.type === 'hotWaterHeader')) {
        if (hotFeed) needHeader.hot = branch('hotWater', hotFeed, hotList);
        else notes.push('給湯器の出口から床下への管が引けないので、給湯はつないでいません');
      } else {
        const outs = headerOutlets('hotWaterHeader', targets.hotWater.length, near, around(inward), feedHot);
        attach(hotList, outs, near, 'hotWater', '給湯ヘッダー');
      }
    }
  }

  /** 器具をヘッダーの出口へ（ヘッダーに近い器具から、通れる出口へ） */
  function attach(list: { end: string; fixtureId: string; dia: number; port: string }[], outs: Outlet[], near: Vec2, system: 'water' | 'hotWater', label: string) {
    const order = list.slice().sort((p, q) => dist2(cur.network.nodes[p.end].pos, near) - dist2(cur.network.nodes[q.end].pos, near));
    for (const t of order) {
      if (!outs.length) { notes.push(`${label}の出口が足りず、つないでいない器具があります`); break; }
      const i = outs.findIndex((o) => connect(t.end, o.node.id, attrs(system, t.dia), o.dirs));
      if (i >= 0) { outs.splice(i, 1); connected[system === 'water' ? 'water' : 'hot']++; valvePorts.push(t.port); }
      else notes.push(`${FIXTURE_CATALOG[cur.fixtures[t.fixtureId].type].label}${system === 'hotWater' ? 'の給湯' : ''}への道が見つかりませんでした`);
    }
  }

  // 止水栓: つないだ器具の給水・給湯と給湯器の入口の、口のすぐ先（150mm、短ければ半分）
  let valves = 0;
  for (const pid of valvePorts) {
    const port = cur.network.nodes[pid];
    const seg = port && segmentsAt(cur.network, pid)[0];
    if (!seg) continue;
    const o = cur.network.nodes[seg.a === pid ? seg.b : seg.a];
    if (o.kind === 'valve') continue;
    const L = Math.hypot(o.pos.x - port.pos.x, o.pos.y - port.pos.y, o.pos.z - port.pos.z);
    if (L < 20) continue;
    const t = Math.min(150, L / 2) / L;
    const r = insertValve(cur.network, seg.id, { x: port.pos.x + (o.pos.x - port.pos.x) * t, y: port.pos.y + (o.pos.y - port.pos.y) * t, z: port.pos.z + (o.pos.z - port.pos.z) * t });
    if (!r) continue;
    cur = { ...cur, network: r.net };
    newSegs.push(...segmentsAt(cur.network, r.nodeId).map((s) => s.id));
    valves++;
  }

  if (!newSegs.length && !headers) return { ...none(), notes };
  return { doc: { ...cur, network: assignAutoMaterials(cur.network, b, newSegs.filter((id) => cur.network.segments[id])) }, pipes, headers, sleeves, crossings, valves, connected, notes, ...(mode === 'avoid' ? { needHeader } : {}) };
}
