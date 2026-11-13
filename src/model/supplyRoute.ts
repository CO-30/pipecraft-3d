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
import { FIXTURE_CATALOG, fixtureCorners, groundZ, isHeader, moveFixture, placeFixture, portNodes, type Fixture, type FixtureType } from './fixtures';
import { findFloorRoute, ROUTE_STEP, type RouteGoal, type RouteResult } from './floorRoute';
import { assignAutoMaterials } from './materials';
import { KSS_HEIGHTS } from './kisoSleeve';
import { BENRIKAN } from './materials';
import { makeYardRouter } from './yardRoute';
import { membersOf } from './members';
import { addPolyline, addRiser, insertValve, segmentsAt, splitSegment, type PipeNode, type SegmentAttrs, type SystemType, type Vec3 } from './network';

/** 床下の配管の高さ（1 階の床から mm） */
export const UNDERFLOOR_Z = -300;
/** 床下のヘッダーの設置面（出口が UNDERFLOOR_Z に来る） */
const HEADER_MOUNT = -400;
/** 立水栓などを外の給水管へ分けるとき、道を探す分け口の数・建物の中に入る管をずらす刻みと、建物から離す長さ(mm) */
const TEE_TRIES = 6, TEE_STEP = 50, TEE_OUT = 300;
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

/**
 * eIn: 床下の入口、eOut: 基礎の外（地中で近づく点・地上で立ち上げる点）、rise: 基礎の中で立ち上げる点（基礎貫通スリーブ KSS の形）、
 * inner: 基礎の内側の面の少し先（地上で基礎を抜けるとき、HI を PB に替える所）、n: 外向き
 */
type Entry = { eIn: Vec2; eOut: Vec2; rise: Vec2; inner: Vec2; n: Vec2 };
/** 給湯器の口から止水栓までのベンリカンの長さ(mm) */
export const BENRIKAN_LEN = 300;
/** 給湯器の止水栓は GL からこれ以上（mm） */
const VALVE_ABOVE_GL = 200;
/** 床下の高さが GL よりこれだけ上なら、地上で基礎を水平に抜けて床下へ入れる（コーキング）。でなければ地中の基礎貫通スリーブ */
const CAULK_ABOVE_GL = 50;
/** 給水の床下への入口を、給湯器の入口から横へずらす長さ(mm)（給湯器の立上りと重ねない） */
const FEED_BESIDE_HEATER = 300;

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
  const gl = groundZ(b, doc.site);
  const burialZ0 = gl - (opts.burial ?? 300);
  // 床下へは、地上で外周の基礎を水平に抜けて入れる（コーキング。ユーザーの施工 2026-11-13）。床下の高さが地面から出ないときだけ地中の KSS
  const caulk = zU > gl + CAULK_ABOVE_GL;
  // 基礎貫通スリーブ（前澤 KSS）: 床下の口は土間。外の口（土間 − H）が埋設の深さより深くなる一番浅い品番に、地中の管の深さを合わせる
  const slabZ = b.foundation?.slabTop !== undefined ? base.elevation + b.foundation.slabTop : undefined;
  const kssH = !caulk && slabZ !== undefined && extFoot.length ? KSS_HEIGHTS.find((H) => slabZ - H <= burialZ0) : undefined;
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

  // --- 手で置いたヘッダー: 1 階の床の上に置いたまま（まだ配管なし）のものは、同じ場所の床下へ下ろして使う ---
  // （置いた場所を優先する。これをしないと床下のヘッダーが無いとみなされ、別の所にヘッダーを置いていた）
  const lowered: Fixture[] = [];
  for (const f of Object.values(cur.fixtures)) {
    if (!isHeader(f.type) || f.floorId !== base.id || (f.params?.mountZ ?? 0) < 0) continue;
    const label = FIXTURE_CATALOG[f.type].label;
    if (portNodes(cur.network, f.id).some((n) => segmentsAt(cur.network, n.id).length > 0)) { notes.push(`1 階の床の上の${label}は配管がつないであるため、そのままにしました（床下で使うときは、選んで「床下」を押してください）`); continue; }
    const next = moveFixture(cur, f.id, f, undefined, { mountZ: HEADER_MOUNT });
    if (next === cur) { notes.push(`1 階の床の上の${label}を床下へ下ろせませんでした（選んで「床下」を押してください）`); continue; }
    cur = next;
    lowered.push(f);
  }

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
        const dIn = Math.min(face + 100, w.t / 2 + INSET - 25);
        const inner = { x: Math.round(foot.x - nn.x * dIn), y: Math.round(foot.y - nn.y * dIn) };
        if (!roomy(eIn) || footAt(eIn) || inHeader(eIn)) continue;
        // 外から入口へ: 壁と平行に進んでから直角に（途中で別の外壁を横切る道は採らない）
        const k = (p.x - eOut.x) * nn.x + (p.y - eOut.y) * nn.y;
        const corner = { x: eOut.x + nn.x * k, y: eOut.y + nn.y * k };
        if (extWalls.some((x) => x !== w && (crosses(p, corner, x.a, x.b) || crosses(corner, eOut, x.a, x.b)))) continue;
        const cost = Math.abs(p.x - eOut.x) + Math.abs(p.y - eOut.y);
        if (!best || cost < best.cost) best = { eIn, eOut, rise, inner, n: nn, cost };
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
  /** 立水栓（床下に入れず、地中で外の給水管に分岐する） */
  const faucets: Fixture[] = [];
  for (const f of Object.values(cur.fixtures)) {
    // 立水栓は床下に入れない（下の「外回り」で地中の HI へ）。床下の立て管の深さで「つないである」と決めない
    // （床が地面から高い家では、真下に落とした管の下の端が床から 1m より深くなるため、ここで外すとつながらなかった）
    if (f.type === 'outdoorFaucet') { faucets.push(f); continue; }
    if (!SUPPLY_TYPES.has(f.type)) continue;
    const ports = portNodes(cur.network, f.id).filter((n) => { const sys = FIXTURE_CATALOG[f.type].ports.find((p) => p.id === n.portId)?.system; return sys === 'water' || sys === 'hotWater'; });
    const states = ports.map((n) => ({ n, st: portState(n) }));
    if (states.every((x) => x.st.kind === 'used')) { if (inside(f)) indoorSeen++; continue; }
    if (!inside(f)) { outdoor++; continue; }
    indoorSeen++;
    if (f.floorId !== base.id) { upper++; continue; }
    for (const { n, st } of states) {
      const def = FIXTURE_CATALOG[f.type].ports.find((p) => p.id === n.portId)!;
      const end = underEnd(n, st, def.system, def.diameter);
      if (end) targets[def.system as 'water' | 'hotWater'].push({ end, fixtureId: f.id, port: n.id });
    }
  }
  if (!indoorSeen && (outdoor || faucets.length) && !Object.values(doc.fixtures).some((f) => f.type !== 'outdoorFaucet' && SUPPLY_TYPES.has(f.type) && inside(f))) {
    return none('建物の中に給水・給湯の器具が見つかりません（外壁が 1 周つながっていない、器具が建物の外にある、など）');
  }
  if (outdoor) notes.push(`建物の外の器具 ${outdoor} 個はつないでいません（引込の管から分けてください）`);
  if (upper) notes.push(`2 階より上の器具 ${upper} 個はつないでいません`);

  // --- 給湯器 ---
  const heater = Object.values(cur.fixtures).find((f) => f.type === 'waterHeater');
  const heaterIn = heater ? nodeOf(heater.id, 'in') : undefined;
  const heaterOut = heater ? nodeOf(heater.id, 'out') : undefined;
  const heaterInside = !!heater && inside(heater);
  /** 外の給湯器へは、地中の HI から立ち上げてベンリカンでつなぎ、お湯は PB で床下へ戻す（地上で基礎を抜けられるとき） */
  const heaterOutdoor = caulk && !!heater && !heaterInside && !!heaterIn && !!heaterOut;

  // --- 引込（メーター → 地中の HI → 床下の入口）。外に給湯器があればその近く、無ければメーターの近くの外壁から入れる ---
  // 先に入口を決める（給湯器の貫通と同じ所にしない）
  const meterOut = nodeOf(meter.id, 'out')!;
  const feedAt = (): Vec2 => {
    if (!heaterOutdoor) return meterOut.pos;
    const d = { x: heaterIn!.pos.x - heaterOut!.pos.x, y: heaterIn!.pos.y - heaterOut!.pos.y }, L = Math.hypot(d.x, d.y) || 1;
    return { x: heaterIn!.pos.x + (d.x / L) * FEED_BESIDE_HEATER, y: heaterIn!.pos.y + (d.y / L) * FEED_BESIDE_HEATER };
  };
  const feedEntry = entryFor(feedAt());
  /** 引込の入口の点（前に押したときに引いた引込があればそれ） */
  let feedNode: string | null = feedEntry
    ? Object.values(cur.network.nodes).find((n) => dist2(n.pos, feedEntry.eIn) < 1 && Math.abs(n.pos.z - zU) < 1 && segmentsAt(cur.network, n.id).some((s) => s.system === 'water'))?.id ?? null
    : null;
  /** 屋外の地中の道（建物を避ける。壁ぎわをきれいに這わせない） */
  const yard = makeYardRouter(doc);
  const HI = (dia: number): SegmentAttrs => ({ ...attrs('water', dia), material: 'HIVP' });
  /** 続けて同じ点が並んだら 1 つにする */
  const dedupe = (pts: Vec3[]) => pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y, p.z - pts[i - 1].z) >= 1);
  /** 引込の床下の入口の点（無ければメーターから引く） */
  const ensureFeed = (): string | null => {
    if (!feedNode) {
      if (!free(meterOut) || !feedEntry) return null;
      if (caulk) {
        // 地中を HI で入口の外まで → 外で床下の高さまで立ち上げ → 基礎を水平に抜けて（コーキング）、基礎の内側で PB に替える
        const a = at(meterOut.pos, burialZ), c = at(feedEntry.eOut, burialZ);
        const run = yard(a, c) ?? [a, at(cornerOf(meterOut.pos, feedEntry), burialZ), c];
        const ids = path(dedupe([meterOut.pos, ...run, at(feedEntry.eOut), at(feedEntry.inner)]), HI(20), meterOut.id);
        feedNode = path([at(feedEntry.inner), at(feedEntry.eIn)], attrs('water', 20), ids.at(-1)).at(-1)!;
      } else {
        const c = cornerOf(meterOut.pos, feedEntry);
        // 地中で基礎を抜け、基礎の中で床下へ立ち上げる（基礎貫通スリーブ KSS の形。外に管を出さない）
        feedNode = path([meterOut.pos, at(meterOut.pos, burialZ), at(c, burialZ), at(feedEntry.rise, burialZ), at(feedEntry.rise), at(feedEntry.eIn)], attrs('water', 20), meterOut.id).at(-1)!;
      }
      sleeves++;
      pipes++;
    }
    return feedNode;
  };
  /**
   * 地中の点 from から、一番近い外の地中の給水管へ分岐（チーズ）でつなぐ（建物を避けた道）。
   * fromId が無ければ from に新しい点を作る。分岐の始まりの点の id（つなげなければ null。何も作らない）
   */
  const teeToMain = (from: Vec3, dia: number, fromId?: string): string | null => {
    const cands: { sid: string; p: Vec3; d: number }[] = [];
    for (const sg of Object.values(cur.network.segments)) {
      if (sg.system !== 'water' || sg.a === fromId || sg.b === fromId) continue;
      const a = cur.network.nodes[sg.a].pos, c = cur.network.nodes[sg.b].pos;
      if (Math.abs(a.z - c.z) > 1 || a.z > gl - 1 || (inside(a) && inside(c))) continue;
      const L = Math.hypot(c.x - a.x, c.y - a.y);
      const pt = (t: number) => ({ x: Math.round(a.x + (c.x - a.x) * t), y: Math.round(a.y + (c.y - a.y) * t), z: a.z });
      let t = L < 1 ? 0 : Math.max(0, Math.min(1, ((from.x - a.x) * (c.x - a.x) + (from.y - a.y) * (c.y - a.y)) / (L * L)));
      // 基礎の下を抜けて建物の中へ入る管: 分ける所は外の部分（建物から TEE_OUT 離した所。管が短ければ外の端）にずらす
      if (inside(pt(t))) {
        const step = TEE_STEP / Math.max(L, 1), outT = (dir: 1 | -1) => { for (let u = t; u >= 0 && u <= 1; u += dir * step) if (!inside(pt(u))) return u; return null; };
        const ts = ([1, -1] as const).map((dir) => {
          const u = outT(dir);
          if (u === null) return null;
          const u2 = Math.max(0, Math.min(1, u + (dir * TEE_OUT) / Math.max(L, 1)));
          return inside(pt(u2)) ? u : u2;
        }).filter((u): u is number => u !== null);
        if (!ts.length) continue;
        t = ts.sort((x, y) => dist2(pt(x), from) - dist2(pt(y), from))[0];
      }
      const p = pt(t);
      cands.push({ sid: sg.id, p, d: dist2(p, from) });
    }
    // 近い順にいくつか道を探し、いちばん短く行ける所で分ける（一番近い所へ道が無くても、ほかの所から分ける）
    let best: { sid: string; p: Vec3; d: number } | null = null, run: Vec3[] | null = null, runLen = Infinity;
    for (const cd of cands.sort((x, y) => x.d - y.d).slice(0, TEE_TRIES)) {
      const r = cd.d < 1 ? [at(from, cd.p.z)] : yard(at(from, cd.p.z), cd.p);
      if (!r) continue;
      const len = r.reduce((sum, q, i) => (i ? sum + Math.hypot(q.x - r[i - 1].x, q.y - r[i - 1].y) : sum), 0);
      if (len < runLen) { best = cd; run = r; runLen = len; }
    }
    if (!best || !run) return null;
    const sg = cur.network.segments[best.sid];
    let endId = [sg.a, sg.b].find((n) => dist2(cur.network.nodes[n].pos, best!.p) < 1 && Math.abs(cur.network.nodes[n].pos.z - best!.p.z) < 1);
    if (!endId) {
      const sp = splitSegment(cur.network, best.sid, best.p);
      cur = { ...cur, network: sp.net };
      newSegs.push(...sp.segmentIds);
      endId = sp.nodeId;
    }
    const pts = dedupe([from, ...run]);
    if (pts.length < 2) return fromId ?? endId;
    pipes++;
    return path(pts, HI(dia), fromId, endId)[0];
  };
  let valves = 0;
  const markValve = (id: string) => {
    const n = cur.network.nodes[id];
    cur = { ...cur, network: { ...cur.network, nodes: { ...cur.network.nodes, [id]: { ...n, kind: 'valve', fixedKind: true } } } };
    valves++;
  };
  /** 給湯器の止水栓の高さ: 口から BENRIKAN_LEN 下、ただし GL から VALVE_ABOVE_GL 以上（口より 50 は下） */
  const valveZ = (p: Vec3) => Math.min(p.z - 50, Math.max(gl + VALVE_ABOVE_GL, p.z - BENRIKAN_LEN));
  /** 外の給湯器の入口: 地中の HI から真下で分岐 → HI を立ち上げ → 止水栓 → ベンリカン → 入口 */
  const heaterFeed = (): boolean => {
    const p = heaterIn!.pos, vz = valveZ(p);
    const start = teeToMain(at(p, burialZ), 20);
    if (!start) return false;
    const ids = path([p, { ...p, z: vz }], { ...attrs('water', 20), material: BENRIKAN }, heaterIn!.id);
    markValve(ids.at(-1)!);
    path([{ ...p, z: vz }, at(p, burialZ)], HI(20), ids.at(-1), start);
    pipes++;
    return true;
  };
  /** 口 startId から system の管を枝分かれ無しにたどり、床下（建物の中・床下の高さ）で行き止まりの端があればその id */
  const looseUnderEnd = (startId: string, system: SystemType): string | null => {
    let at0 = startId, prev: string | null = null;
    for (let i = 0; i < 50; i++) {
      const segs = segmentsAt(cur.network, at0).filter((s) => s.id !== prev);
      if (segs.length !== 1 || segs[0].system !== system) break;
      const nx = segs[0].a === at0 ? segs[0].b : segs[0].a;
      prev = segs[0].id; at0 = nx;
      const n = cur.network.nodes[nx];
      if (segmentsAt(cur.network, nx).length === 1) return !n.fixtureId && Math.abs(n.pos.z - zU) < 1 && inside(n.pos) ? nx : null;
    }
    return null;
  };
  /** 外の給湯器の出口: ベンリカン → 止水栓 → PB で床下の高さまで下ろし → エルボ → 地上で基礎を抜けて床下へ（コーキング） */
  const hotDown = (): { id: string; e: Entry } | null => {
    const e = entryFor(heaterOut!.pos);
    if (!e) return null;
    const p = heaterOut!.pos, vz = valveZ(p);
    const ids = path([p, { ...p, z: vz }], { ...attrs('hotWater', 20), material: BENRIKAN }, heaterOut!.id);
    markValve(ids.at(-1)!);
    const pts = dedupe([{ ...p, z: vz }, at(p), at(cornerOf(p, e)), at(e.eIn)]);
    // 3 点が一直線なら真ん中を除く（継手を作らない）
    const line = pts.filter((q, i) => i === 0 || i === pts.length - 1 || Math.abs((q.x - pts[i - 1].x) * (pts[i + 1].y - q.y) - (q.y - pts[i - 1].y) * (pts[i + 1].x - q.x)) > 1 || Math.abs(q.z - pts[i - 1].z) > 1);
    const ids2 = path(line, { ...attrs('hotWater', 20), material: 'PB保温10mm' }, ids.at(-1));
    // 下ろした所（口の真下・床下の高さ）の曲がりは L（エルボ）
    const bend = ids2.find((id) => { const q = cur.network.nodes[id].pos; return dist2(q, p) < 1 && Math.abs(q.z - zU) < 1 && segmentsAt(cur.network, id).length === 2; });
    if (bend) cur = { ...cur, network: { ...cur.network, nodes: { ...cur.network.nodes, [bend]: { ...cur.network.nodes[bend], fitting: { type: 'elbow90', degree: 2 } } } } };
    sleeves++;
    pipes++;
    return { id: ids2.at(-1)!, e };
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
      // 分けた点が区間の端に寄せられたときも、最後の点をその点に合わせる（斜めの短い管を作らない）
      if (endId !== feedId || !sid) { const q = cur.network.nodes[endId].pos; pts[pts.length - 1] = at(q); }
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
  /** 置いてあるヘッダーがあれば、出口が足りないときに足すヘッダーはそのそば（横に並べる。器具の側を先に）。無ければ near・dirs のまま */
  const besideHeader = (type: 'waterHeader' | 'hotWaterHeader', near: Vec2, dirs: Vec2[], ends: Vec2[]): [Vec2, Vec2[]] => {
    const h = headerFixtures().find((f) => f.type === type);
    if (!h) return [near, dirs];
    const at = { x: h.x, y: h.y }, t = toward(at, ends);
    const side = t.y !== 0 ? t : { x: 0, y: 1 };
    return [at, [side, { x: -side.x, y: -side.y }, { x: 1, y: 0 }, { x: -1, y: 0 }]];
  };

  // --- 給水: メーター → 給水ヘッダー → 器具・給湯器の入口 ---
  const waterTargets: { end: string; fixtureId: string; dia: number; port: string }[] = targets.water.map((t) => ({ end: t.end.id, fixtureId: t.fixtureId, dia: 13, port: t.port }));
  if (heaterIn && free(heaterIn) && !heaterOutdoor) {
    const end = heaterInside ? dropLink(heaterIn, attrs('water', 20)) : wallLink(heaterIn, attrs('water', 20))?.id ?? null;
    if (end) waterTargets.push({ end, fixtureId: heater!.id, dia: 20, port: heaterIn.id });
    else notes.push('給湯器の入口への道が見つかりませんでした');
  }
  if (waterTargets.length) {
    if (!free(meterOut) && !feedNode) notes.push('メーターの出口にはすでに配管があるため、引込は足していません（給水ヘッダーの入口は手でつないでください）');
    const near = feedEntry ? feedEntry.eIn : { x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 };
    const inward = feedEntry ? { x: -feedEntry.n.x, y: -feedEntry.n.y } : toward(near, waterTargets.map((t) => cur.network.nodes[t.end].pos));
    // 引込が引けない（メーターの出口にもう管がある など）ときは、これまでどおりヘッダーで（入口は手でつなぐ）
    const feedId = mode === 'avoid' && !headerFixtures().some((f) => f.type === 'waterHeader') ? ensureFeed() : null;
    if (feedId) needHeader.water = branch('water', feedId, waterTargets);
    else {
      const [hNear, hDirs] = besideHeader('waterHeader', near, around(inward), waterTargets.map((t) => cur.network.nodes[t.end].pos));
      const outs = headerOutlets('waterHeader', waterTargets.length, hNear, hDirs, feedWater);
      attach(waterTargets, outs, hNear, 'water', '給水ヘッダー');
    }
  }

  // --- 外回り: 外の給湯器の入口・立水栓を、地中の HI から分岐でつなぐ（床下に入れない） ---
  if ((heaterOutdoor && free(heaterIn)) || faucets.length) ensureFeed();
  if (heaterOutdoor && free(heaterIn)) {
    if (heaterFeed()) { connected.water++; notes.push('給湯器の給水は地中の HI から立ち上げ、止水栓とベンリカンでつなぎました（立上りは φ40 さや管）'); }
    else notes.push('給湯器の入口を地中の給水管へつなぐ道が見つかりませんでした');
  }
  let faucetsDone = 0;
  for (const f of faucets) {
    const n = portNodes(cur.network, f.id).find((x) => x.portId === 'water');
    if (!n) continue;
    const segs = segmentsAt(cur.network, n.id);
    let ok = false;
    if (!segs.length) {
      // 立水栓の真下（地中）から分岐し、立水栓まで立ち上げる
      const start = teeToMain(at(n.pos, burialZ), 13);
      if (start) { path([n.pos, at(n.pos, burialZ)], HI(13), n.id, start); ok = true; }
    } else if (segs.length === 1) {
      // 「器具の真下に配管を落とす」で下ろした立て管があれば、その下の端から
      const o = cur.network.nodes[segs[0].a === n.id ? segs[0].b : segs[0].a];
      // （真下でなくても、先が何にもつながっていない管なら、その端から地中の給水管へ）
      if (!o.fixtureId && !inside(o.pos) && segmentsAt(cur.network, o.id).length === 1) ok = !!teeToMain(o.pos, 13, o.id);
      else continue; // もうつながっている
    } else continue;
    if (ok) { connected.water++; faucetsDone++; }
    else notes.push(`${FIXTURE_CATALOG[f.type].label}を地中の給水管へつなぐ道が見つかりませんでした`);
  }
  if (faucetsDone) notes.push(`立水栓 ${faucetsDone} 個は床下に入れず、地中の給水管（HI）から分けました`);

  // --- 給湯: 給湯器の出口 → 給湯ヘッダー → 器具の給湯口 ---
  if (targets.hotWater.length) {
    if (!heater || !heaterOut) notes.push('給湯器が無いため、給湯はつないでいません（給湯器を置いてもう一度押すとつながります）');
    else {
      let hotFeed: string | null = null, hotEntry: Entry | null = null;
      // 前に押したときに給湯器から床下まで引いて、その先がつながらなかった管があれば、その床下の端から続ける
      if (!free(heaterOut)) hotFeed = looseUnderEnd(heaterOut.id, 'hotWater');
      if (free(heaterOut)) {
        if (heaterInside) hotFeed = dropLink(heaterOut, attrs('hotWater', 20));
        else if (heaterOutdoor) {
          const w = hotDown();
          hotFeed = w?.id ?? null; hotEntry = w?.e ?? null;
          if (w) notes.push('お湯は給湯器からベンリカン・止水栓のあと PB で下ろし、L で床下へ戻しました（入口はコーキング、立上りは φ40 さや管）');
        }
        else { const w = wallLink(heaterOut, attrs('hotWater', 20)); hotFeed = w?.id ?? null; hotEntry = w?.e ?? null; }
      }
      const feedHot = (inNode: PipeNode, f: Fixture): boolean => !!hotFeed && connect(hotFeed, inNode.id, attrs('hotWater', 20), [inletDir(f, inNode)]);
      const near = hotFeed ? cur.network.nodes[hotFeed].pos : heaterOut.pos;
      const inward = hotEntry ? { x: -hotEntry.n.x, y: -hotEntry.n.y } : toward(near, targets.hotWater.map((t) => t.end.pos));
      const hotList = targets.hotWater.map((t) => ({ end: t.end.id, fixtureId: t.fixtureId, dia: 13, port: t.port }));
      if (mode === 'avoid' && hotFeed && !headerFixtures().some((f) => f.type === 'hotWaterHeader')) needHeader.hot = branch('hotWater', hotFeed, hotList);
      else {
        const [hNear, hDirs] = besideHeader('hotWaterHeader', near, around(inward), targets.hotWater.map((t) => t.end.pos));
        const outs = headerOutlets('hotWaterHeader', targets.hotWater.length, hNear, hDirs, feedHot);
        attach(hotList, outs, hNear, 'hotWater', '給湯ヘッダー');
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

  // ヘッダーの手前（外から入ってきた給水・給湯の、ヘッダーの入口のすぐ先）にも必ず止水栓（ユーザーの施工 2026-11-13）
  for (const f of headerFixtures()) {
    const inNode = nodeOf(f.id, 'in');
    if (inNode && segmentsAt(cur.network, inNode.id).length === 1) valvePorts.push(inNode.id);
  }
  // 止水栓: つないだ器具の給水・給湯と給湯器の入口・ヘッダーの入口の、口のすぐ先（150mm、短ければ半分）
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
  // 下ろしたヘッダーは、配管がつながったものだけ知らせる（つながらなかったものは上の注意のとおり）
  notes.unshift(...lowered.filter((f) => portNodes(cur.network, f.id).some((n) => segmentsAt(cur.network, n.id).length > 0)).map((f) => `1 階に置いてあった${FIXTURE_CATALOG[f.type].label}を、同じ場所の床下へ下ろしてつなぎました`));
  return { doc: { ...cur, network: assignAutoMaterials(cur.network, b, newSegs.filter((id) => cur.network.segments[id])) }, pipes, headers, sleeves, crossings, valves, connected, notes, ...(mode === 'avoid' ? { needHeader } : {}) };
}
