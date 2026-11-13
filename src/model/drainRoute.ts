/**
 * 排水のつなぎ案: 床下へ落とした排水・汚水の配管（器具から真下へ落とした立て管の、空いている下の端）を、
 * 基礎の中を通していちばん出しやすい外壁の外へ出し、そこに汚水マスを置いてつなぐ。純粋関数。
 *  - 出口は「壁へ直角に出た先が建物の外（マスの周りと、その先に壁も基礎も無い）」の中から選ぶ
 *  - 床下は縦横に配管し、内部の立上りは人通口などの切れ目を通って避ける（floorRoute）。外周の立上りは出口で直角に 1 回だけ貫通する
 *  - 近い出口どうしは 1 つのマスにまとめる（先につないだ配管に合流させる）。外壁の外に置いてあるマスが近ければそれを使う
 *  - 配管は 床下を水平に → マスの真上 → 立ち下げてマスへ。勾配と桝どうしの接続は使う人が決める（案なので）
 */
import type { Vec2 } from './building';
import { wallsOnFloor } from './building';
import type { Doc } from './doc';
import { groundZ, groundZAt, isManhole, moveFixture, placeFixture, portNodes } from './fixtures';
import { membersOf } from './members';
import { addPolyline, connectNodeToSegment, moveNode, segmentsAt, splitSegment, type PipeNode, type Segment, type Vec3 } from './network';
import { applySlope, outerDiameter } from './slope';
import { inUnderfloor, slopeUnderfloor, underfloorLevels } from './underfloorSlope';
import { findFloorRoute, ROUTE_STEP, type RouteGoal, type RouteResult } from './floorRoute';
import { EXIT_BELOW_GL } from './drainSolve/heights';

/** 外壁の芯からマスの中心までの距離の初期値(mm) */
export const MANHOLE_OFFSET = 700;
/** これより近い出口は 1 つのマスにまとめる(mm) */
export const MERGE_MM = 1000;
/** マスの周りに空けておく幅（マスの半径 + 余裕）(mm) */
const CLEAR = 200;
/** 新しいマスの管底を、床下の配管よりこれだけ下にする（標準の管底 GL−600 の方が浅いとき）(mm) */
const INVERT_BELOW = 300;
/** 基礎の立上りを 1 か所余分に貫通することを、配管何 mm 分の遠回りと同じとみるか（貫通パイプ φ125 でまっすぐ通す） */
const SLEEVE_COST = 600;
/** 調べる出口の数（直線で近い順） */
const MAX_EXITS = 4;
/** 外周の壁・立上りの芯から、配管を通す所までの離れ（壁厚の半分に足す）(mm) */
const WALL_GAP = 80;
/** 外壁を貫通する手前の点（壁厚の半分に足す）(mm) */
const INSET = 150;
/** 内部の立上りと配管の離れ（立上りの幅の半分に足す）(mm) */
const PIPE_GAP = 60;
/** マスを 1 つ増やすことを、配管何 mm 分の遠回りと同じとみるか（近くのマスへ合流する方を選ぶ） */
const MANHOLE_COST = 3000;
/** 使う人が汚水マスを置いてあるときの、新しいマスを足す重み（置いたマスへ床下で集める） */
const MANHOLE_COST_PLACED = 8000;
/** 置いたマスから外壁までがこれより遠ければ、そのマスの出口は作らない(mm) */
const HOLE_REACH = 3000;
/** 置いたマスから作る出口の数（近い順） */
const MAX_HOLE_EXITS = 2;
/** 手で置いた汚水マス（公共マス・雨水マスは除く）。床下から出す先にする */
const PLACED_TYPES = new Set(['manholeSewage', 'manholeTrap', 'manholeInvert']);
/** 先の排水管から離す距離(mm) */
const BUSY_GAP = 40;
const FAR = 100_000;

/** buried: 基礎の外で地中へ下ろした本数。unsloped: 床下に勾配をつけられなかった起点の数 */
export type DrainRouteResult = { doc: Doc; pipes: number; manholes: number; sleeves: number; skipped: number; buried?: number; unsloped?: number; /** 1.5/100 でも配管の上が基礎天端を超える床下の系統 */ over?: number };
/** 床下の配管とみなす勾配の上限（これより急な区間は立て管・地中の配管として扱う） */
const FLATISH = 0.06;
/** 勾配のついた床下の配管を「同じ高さの層」とみなす幅(mm) */
const BAND = 200;

/**
 * 外の排水管の決まり（自治体のプロファイルから）。cover: 宅地内の土かぶり（GL から管頂まで、mm）、slopeFor: 口径ごとの最小勾配（比率）。
 * 省略時は「下水道排水設備指針と解説」（日本下水道協会）の標準: 土かぶり 20cm 以上、屋外の勾配は OUTDOOR_SLOPE
 */
export type DrainRules = { cover?: number; slopeFor?: (diameter: number) => number | undefined };
/** 宅地内の排水管の土かぶりの標準(mm) */
export const DEFAULT_COVER = 200;
/** 屋外排水管の最小勾配の標準（指針: φ100 2/100、φ125 1.7/100、φ150 1.5/100、φ200 1.2/100。φ75 は 3m 以下の枝管で 3/100） */
const OUTDOOR_SLOPE: [number, number][] = [[75, 0.03], [100, 0.02], [125, 0.017], [150, 0.015], [200, 0.012]];
export const outdoorSlope = (d: number) => OUTDOOR_SLOPE.find(([k]) => d <= k)?.[1] ?? 0.01;
export { outerDiameter } from './slope';

/** 45° で基礎を抜けるとき、土間の口を壁の芯から内側へ置く距離の上限(mm) */
const MAX_45_IN = 450;

type Line = { a: Vec2; b: Vec2; t: number; exterior?: boolean };

/** 線分 p→q と a→b が交わるか（p→q の端・a→b の終点に触れるだけは数えない: つながった立上りの継ぎ目を 2 度数えないため） */
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
/** 2 本の線分の間のいちばん近い距離 */
function segSeg(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number {
  if (crosses(p, q, a, b) || crosses(a, b, p, q)) return 0;
  return Math.min(pointSeg(p, a, b), pointSeg(q, a, b), pointSeg(a, p, q), pointSeg(b, p, q));
}

/** 器具の排水・汚水の接続口から真下へ落とした立て管の、空いている下の端（1 階の床下） */
export function openDrainEnds(doc: Doc): { node: PipeNode; seg: Segment }[] {
  const net = doc.network, base = doc.building.floors[0];
  if (!base) return [];
  const out: { node: PipeNode; seg: Segment }[] = [];
  for (const n of Object.values(net.nodes)) {
    if (n.fixtureId || n.pos.z >= base.elevation) continue;
    const segs = segmentsAt(net, n.id);
    if (segs.length !== 1 || (segs[0].system !== 'drain' && segs[0].system !== 'sewage')) continue;
    const o = net.nodes[segs[0].a === n.id ? segs[0].b : segs[0].a];
    // 器具の接続口から真下へ落とした立て管だけ（雨どいの立て管や、使う人が途中まで描いた配管はつながない）
    const fx = o.fixtureId ? doc.fixtures[o.fixtureId] : undefined;
    if (!fx || isManhole(fx.type)) continue;
    if (Math.hypot(o.pos.x - n.pos.x, o.pos.y - n.pos.y) > 1 || o.pos.z <= n.pos.z) continue;
    out.push({ node: n, seg: segs[0] });
  }
  return out;
}

export function routeDrainsOut(doc: Doc, offset = MANHOLE_OFFSET, rules: DrainRules = {}): DrainRouteResult {
  const none: DrainRouteResult = { doc, pipes: 0, manholes: 0, sleeves: 0, skipped: 0 };
  const base = doc.building.floors[0];
  const ends = openDrainEnds(doc);
  if (!base || !ends.length) return none;
  const b = doc.building;
  const walls: Line[] = wallsOnFloor(b, base.id).map((w) => ({ a: b.corners[w.a], b: b.corners[w.b], t: w.thickness, exterior: w.kind === 'exterior' }));
  const footLines: (Line & { z0: number; z1: number })[] = membersOf(b).filter((m) => m.kind === 'footing' && m.floorId === base.id)
    .map((m) => ({ a: m.a, b: m.b, t: m.width, z0: base.elevation + m.z0, z1: base.elevation + m.z1 }));
  const blockers: Line[] = [...walls, ...footLines];
  /** 水平の区間 p→q（高さ z）が貫通する立上りの数 */
  const sleevesOn = (p: Vec2, q: Vec2, z: number) => footLines.filter((f) => z > f.z0 && z < f.z1 && crosses(p, q, f.a, f.b)).length;
  /** 点が建物の中にある: 東西南北のどちらへ見ても壁か基礎に当たる（外にある点・外周が開いている所は false） */
  const inside = (p: Vec2) => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => blockers.some((k) => crosses(p, { x: p.x + dx * FAR, y: p.y + dy * FAR }, k.a, k.b)));
  /** マスを m に置けるか: マスの周りと、そこから外向き（n）の先に、壁も基礎も無い */
  const clearAt = (m: Vec2, n: Vec2) => {
    const start = { x: m.x - n.x * CLEAR, y: m.y - n.y * CLEAR }, beyond = { x: m.x + n.x * FAR, y: m.y + n.y * FAR };
    return blockers.every((k) => segSeg(start, beyond, k.a, k.b) >= k.t / 2 + CLEAR);
  };

  /** 出口: wall の外の m へ、向き n（壁に直角・外向き）。foot は壁芯の上の点。cost は直線で出たときの目安（近い順） */
  type Exit = { wall: Line; foot: Vec2; m: Vec2; n: Vec2; cost: number; hole?: Hole };
  /**
   * 置いたマスの出口: マスに直角に向かい合う外周の壁の点（器具の真横でなくてよい）。
   * マスから壁まで HOLE_REACH 以内で、壁の点からマスまでの間に壁・基礎が無いもの
   */
  const holeExits = (p: Vec3): Exit[] => {
    if (!inside(p)) return [];
    const out: Exit[] = [];
    for (const h of placedHoles) {
      let best: Exit | null = null;
      for (const w of walls) {
        if (!w.exterior) continue;
        const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
        if (L < 1) continue;
        const u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
        if (Math.abs(u.x) > 1e-6 && Math.abs(u.y) > 1e-6) continue;
        const s0 = (h.x - w.a.x) * u.x + (h.y - w.a.y) * u.y;
        if (s0 < 0 || s0 > L) continue;
        const foot = { x: w.a.x + u.x * s0, y: w.a.y + u.y * s0 };
        const d = Math.hypot(h.x - foot.x, h.y - foot.y);
        if (d < w.t / 2 + CLEAR || d > HOLE_REACH) continue;
        const n = { x: (h.x - foot.x) / d, y: (h.y - foot.y) / d };
        if (inside({ x: foot.x + n.x * (w.t / 2 + 200), y: foot.y + n.y * (w.t / 2 + 200) })) continue; // 壁の内側にあるマス
        const start = { x: foot.x + n.x * (w.t / 2 + 1), y: foot.y + n.y * (w.t / 2 + 1) };
        if (blockers.some((k) => k !== w && crosses(start, h, k.a, k.b))) continue;
        const cost = Math.abs(p.x - foot.x) + Math.abs(p.y - foot.y);
        if (!best || d < Math.hypot(h.x - best.foot.x, h.y - best.foot.y)) best = { wall: w, foot, m: { x: h.x, y: h.y }, n, cost, hole: h };
      }
      if (best) out.push(best);
    }
    return out.sort((a, b) => a.cost - b.cost).slice(0, MAX_HOLE_EXITS);
  };
  const exitsFor = (p: Vec3): Exit[] => {
    if (!inside(p)) return [];
    const out: Exit[] = [];
    for (const w of walls) {
      const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (L < 1) continue;
      const u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
      if (Math.abs(u.x) > 1e-6 && Math.abs(u.y) > 1e-6) continue; // 斜めの壁からは出さない（床下は縦横に配管する）
      const s = (p.x - w.a.x) * u.x + (p.y - w.a.y) * u.y;
      if (s < 0 || s > L) continue; // 壁へ直角に出られる位置だけ
      const foot = { x: w.a.x + u.x * s, y: w.a.y + u.y * s };
      const d = Math.hypot(foot.x - p.x, foot.y - p.y);
      if (d < 1) continue;
      const n = { x: (foot.x - p.x) / d, y: (foot.y - p.y) / d };
      const m = { x: foot.x + n.x * (w.t / 2 + offset), y: foot.y + n.y * (w.t / 2 + offset) };
      if (!clearAt(m, n)) continue;
      // 途中で別の外壁を横切る道（凹んだ所をまたいで外を通る）は採らない
      if (walls.some((k) => k !== w && k.exterior && crosses(p, foot, k.a, k.b))) continue;
      out.push({ wall: w, foot, m, n, cost: d + SLEEVE_COST * Math.max(0, sleevesOn(p, m, p.z) - 1) });
    }
    return out.sort((a, b) => a.cost - b.cost);
  };

  // --- 床下のルート探し（内部の立上りは人通口などの切れ目を通る） ---
  const extWalls = walls.filter((w) => w.exterior);
  const nearExt = (f: Line) => extWalls.some((w) => pointSeg({ x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 }, w.a, w.b) < Math.max(w.t, f.t) / 2 + 250);
  const extFoot = footLines.filter(nearExt), inFoot = footLines.filter((f) => !nearExt(f));
  const gl = groundZ(b, doc.site);
  /** 同じ層の床下の配管とみなす: 高さの差が BAND 未満、またはどちらも床下（土間〜床。勾配はあとで起点から付け直す） */
  const ufl = underfloorLevels(doc);
  const sameLayer = (z1: number, z2: number) => Math.abs(z1 - z2) < BAND || (!!ufl && inUnderfloor(ufl, z1) && inUnderfloor(ufl, z2));
  /** 床下の横の配管（勾配 FLATISH 以下・地面より上） */
  const underfloor = (a: Vec3, c: Vec3) => { const L = Math.hypot(a.x - c.x, a.y - c.y); return L >= 1 && Math.abs(a.z - c.z) <= FLATISH * L && a.z > gl && c.z > gl; };
  const cover = rules.cover ?? DEFAULT_COVER;
  const slopeOf = (d: number) => Math.max(outdoorSlope(d), rules.slopeFor?.(d) ?? 0);
  /**
   * 基礎の抜け方（基礎伏図 FG1・前澤「排水管貫通セット」の形）: 土間の口から 45° で基礎を抜け、外周の基礎の外の面で
   * GL−370 の水平になって外へ出る。o: 外の口、zE: 外の口の管底、inset: 土間の口の、壁の芯からの内側への距離
   */
  const exitGeom = (exit: Exit, along: number, pz: number, d: number): { o: Vec2; zE: number; inset: number; steep: boolean } => {
    const face = Math.max(exit.wall.t, ...extFoot.filter((f) => pointSeg(exit.foot, f.a, f.b) < f.t / 2 + 50).map((f) => f.t)) / 2;
    const u = { x: -exit.n.y, y: exit.n.x };
    const o = { x: Math.round(exit.foot.x + u.x * along + exit.n.x * face), y: Math.round(exit.foot.y + u.y * along + exit.n.y * face) };
    // GL−370。自治体の土かぶりが深ければそれを守り、床下の口（土間）より 100 は下げる（排水の自動計算と同じ決まり）
    const g = groundZAt(b, doc.site, o), top = Math.min(ufl?.slab ?? pz, pz);
    const zE = Math.round(Math.min(g - EXIT_BELOW_GL, g - cover - outerDiameter(d), top - 100));
    // 45°: 土間の口は外の口から（土間 − 外の口）だけ内側（外の口がとても深いときは 45° の長さを MAX_45_IN までにして急に下ろす）
    const run = Math.min(MAX_45_IN, Math.round(top - zE - face));
    const minIn = exit.wall.t / 2 + INSET;
    // 浅くて 45° が収まらない（土間の口が基礎の中に入る）ときは、土間の口から真下に下ろして水平に抜く（steep = false）
    const steep = run >= minIn && top - zE >= 0.9 * (run + face);
    return { o, zE, inset: steep ? run : minIn, steep };
  };
  /** 外の口と、そこからマスまでの水平距離 */
  const dropOf = (plan: Plan): { x: Vec2; d: number } => ({ x: plan.o, d: Math.hypot(plan.hp.x - plan.o.x, plan.hp.y - plan.o.y) });
  const xs = walls.flatMap((w) => [w.a.x, w.b.x]), ys = walls.flatMap((w) => [w.a.y, w.b.y]);
  const bounds = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  /** 外周の壁・立上りから離れた建物の中 */
  const roomy = (q: Vec2) => inside(q) && extWalls.every((w) => pointSeg(q, w.a, w.b) >= w.t / 2 + WALL_GAP) && extFoot.every((f) => pointSeg(q, f.a, f.b) >= f.t / 2 + WALL_GAP);
  const footAt = (z: number) => (q: Vec2) => inFoot.some((f) => z > f.z0 && z < f.z1 && pointSeg(q, f.a, f.b) < f.t / 2 + PIPE_GAP);
  const dirOf = (n: Vec2): 0 | 1 | 2 | 3 => (Math.abs(n.x) > 0.5 ? (n.x > 0 ? 0 : 2) : n.y > 0 ? 1 : 3);

  let cur: Doc = doc;
  let pipes = 0, manholes = 0, sleeves = 0, skipped = 0;
  type Hole = { id: string; x: number; y: number };
  /** この回につないだ配管の上の端（勾配をつけ直す起点を探す元） */
  const touched: string[] = [];
  let buriedCount = 0;
  const holes: Hole[] = Object.values(doc.fixtures)
    .filter((f) => isManhole(f.type) && f.type !== 'manholeRain' && f.type !== 'publicRain').map((f) => ({ id: f.id, x: f.x, y: f.y }));
  /** 置いてある汚水マス（使う人が置いたもの。前にこのボタンで置いたマスも、もう決まったマスとして同じに扱う） */
  const placedHoles: Hole[] = Object.values(doc.fixtures).filter((f) => PLACED_TYPES.has(f.type)).map((f) => ({ id: f.id, x: f.x, y: f.y }));
  /** この出口で使えるマス: 出口の壁の外側にあり、出口から MERGE_MM 以内で、その位置に置けることを確かめたもの。近い順 */
  const holeFor = (e: Exit): Hole | undefined => holes
    .map((h) => ({ h, out: (h.x - e.foot.x) * e.n.x + (h.y - e.foot.y) * e.n.y, d: Math.hypot(h.x - e.m.x, h.y - e.m.y) }))
    .filter((c) => c.d <= MERGE_MM && c.out >= e.wall.t / 2 + CLEAR && clearAt({ x: c.h.x, y: c.h.y }, e.n))
    .sort((p, q) => p.d - q.d)[0]?.h;
  /** マスへつながっている床下の水平な配管（高さ z）。合流先の候補 */
  const trunkOf = (net: Doc['network'], holeId: string, z: number): { segs: Segment[]; otherDepth: boolean } => {
    const port = portNodes(net, holeId)[0];
    if (!port) return { segs: [], otherDepth: false };
    const seen = new Set<string>([port.id]), stack = [port.id], segs: Segment[] = [];
    let otherDepth = false;
    while (stack.length) {
      const id = stack.pop()!;
      for (const sg of segmentsAt(net, id)) {
        if (sg.system !== 'drain' && sg.system !== 'sewage') continue;
        const a = net.nodes[sg.a].pos, b = net.nodes[sg.b].pos;
        // 床下の横の配管（勾配つきを含む。地中の配管は除く）。同じ層なら合流先、違う深さなら合流しない
        if (underfloor(a, b)) { if (sameLayer(a.z, z) && sameLayer(b.z, z)) segs.push(sg); else otherDepth = true; }
        const o = sg.a === id ? sg.b : sg.a;
        if (!seen.has(o) && !net.nodes[o].fixtureId) { seen.add(o); stack.push(o); }
      }
    }
    return { segs: [...new Map(segs.map((x) => [x.id, x])).values()], otherDepth: otherDepth && !segs.length };
  };

  type Plan = { exit: Exit; hole?: Hole; hp: Vec2; eIn: Vec2; o: Vec2; zE: number; steep: boolean; route: RouteResult; trunk: Segment[]; kind: 'eIn' | 'node' | 'seg'; seg?: Segment };
  type GoalInfo = Omit<Plan, 'route'>;
  /** 出口の候補すべての終点をまとめて 1 回で探す（いちばん安い出口・合流先を選ぶ） */
  const planFor = (p: Vec3, net: Doc['network'], d0: number): Plan | null => {
    const goals: RouteGoal[] = [], info: GoalInfo[] = [];
    const add = (g: Omit<RouteGoal, 'tag'>, gi: GoalInfo) => { goals.push({ ...g, tag: info.length }); info.push(gi); };
    for (const exit of [...holeExits(p), ...exitsFor(p).slice(0, MAX_EXITS)]) {
      const hole = exit.hole ?? holeFor(exit);
      const hp = hole ? { x: hole.x, y: hole.y } : { x: Math.round(exit.m.x), y: Math.round(exit.m.y) };
      const u = { x: -exit.n.y, y: exit.n.x };
      const along = (hp.x - exit.foot.x) * u.x + (hp.y - exit.foot.y) * u.y;
      const g = exitGeom(exit, along, p.z, d0);
      const eIn = { x: Math.round(exit.foot.x + u.x * along - exit.n.x * g.inset), y: Math.round(exit.foot.y + u.y * along - exit.n.y * g.inset) };
      const tr = hole ? trunkOf(net, hole.id, p.z) : { segs: [], otherDepth: false };
      if (tr.otherDepth) continue; // 落とした深さが違う配管どうしは自動ではまとめない
      const base = { exit, hole, hp, eIn, o: g.o, zE: g.zE, steep: g.steep, trunk: tr.segs };
      const side = (a: Vec3, b: Vec3) => (Math.abs(a.y - b.y) < 1 ? [1, 3] as const : Math.abs(a.x - b.x) < 1 ? [0, 2] as const : [] as const);
      // 先の配管があれば、その途中へ横から、または点へ（重ならない向きで）合流
      let joins = 0;
      for (const sg of tr.segs) {
        const a = net.nodes[sg.a].pos, b = net.nodes[sg.b].pos;
        for (const d of side(a, b)) {
          if (roomy(a) || roomy(b)) { add({ a, b, dir: d }, { ...base, kind: 'seg', seg: sg }); joins++; } // 外へ出たあとの区間には合流しない
          // 点への合流は、外周の壁ぎわ（建物の中）の点でもよい
          for (const [id, v] of [[sg.a, a], [sg.b, b]] as const) if (inside(v) && !net.nodes[id].fixtureId) { add({ a: v, b: v, dir: d }, { ...base, kind: 'node' }); joins++; }
        }
        // 先の配管の空いている端へは、まっすぐ続けて着いてもよい（重ならない）
        for (const [id, v, w] of [[sg.a, a, b], [sg.b, b, a]] as const) {
          if (!inside(v) || net.nodes[id].fixtureId || segmentsAt(net, id).length !== 1) continue;
          const L = Math.hypot(w.x - v.x, w.y - v.y);
          if (L < 1) continue;
          add({ a: v, b: v, dir: dirOf({ x: (w.x - v.x) / L, y: (w.y - v.y) / L }) }, { ...base, kind: 'node' }); joins++;
        }
      }
      // 合流できる所が無ければ外周の内側の点へ外向きに（その先は外壁を直角に貫通してマスへ。先の配管があればマスの真上で合流）
      if (!joins) add({ a: eIn, b: eIn, dir: dirOf(exit.n), extra: Math.hypot(hp.x - eIn.x, hp.y - eIn.y) + (hole ? 0 : placedHoles.length ? MANHOLE_COST_PLACED : MANHOLE_COST) }, { ...base, kind: 'eIn' });
    }
    if (!goals.length) return null;
    // 先にある同じ高さの排水管の上は通らない・横切らない（重ねない）
    const busy = Object.values(net.segments).filter((sg) => {
      const a = net.nodes[sg.a].pos, c = net.nodes[sg.b].pos;
      return (sg.system === 'drain' || sg.system === 'sewage') && ((Math.abs(a.z - p.z) < 1 && Math.abs(c.z - p.z) < 1) || (underfloor(a, c) && sameLayer(a.z, p.z) && sameLayer(c.z, p.z)));
    });
    const nearStart = (q: Vec2) => Math.hypot(q.x - p.x, q.y - p.y) < 2 * ROUTE_STEP;
    const edgeOk = (q: Vec2, r: Vec2) => nearStart(q) || busy.every((sg) => {
      const a = net.nodes[sg.a].pos, b = net.nodes[sg.b].pos;
      // 合流先の配管には着いてよい（終点の手前まで離れていればよい）
      return segSeg(q, r, a, b) >= BUSY_GAP || pointSeg(r, a, b) < 1;
    });
    const route = findFloorRoute({ start: p, allowed: (q) => nearStart(q) || roomy(q), footing: footAt(p.z), edgeOk, goals, bounds });
    if (!route) return null;
    return { ...info[route.goal.tag], route };
  };

  // 壁に近い端から順に（まとめるマスの位置が、いちばん素直に出せる器具で決まるように）
  const order = ends.map((e) => ({ ...e, near: exitsFor(e.node.pos)[0]?.cost ?? Infinity })).sort((p, q) => p.near - q.near);
  for (const e of order) {
    const p = e.node.pos;
    const plan = planFor(p, cur.network, e.seg.diameter);
    if (!plan) { skipped++; continue; }
    const attrs = { system: e.seg.system, diameter: e.seg.diameter, ...(e.seg.material ? { material: e.seg.material } : {}) };
    // 外では管頂の土かぶりを守り、最小勾配でマスへ下る（出口から外へ出るときだけ）
    const drop = plan.kind === 'eIn' ? dropOf(plan) : null;
    const slope = slopeOf(e.seg.diameter);
    // 土かぶりは、地中へ下ろす所とマスの所の低い方の地面から（配置図の敷地の高さがあればその場所の地面）
    const glHere = drop ? Math.min(groundZAt(b, doc.site, drop.x), groundZAt(b, doc.site, plan.hp)) : gl;
    const buriedTop = glHere - cover - outerDiameter(e.seg.diameter);
    let hole = plan.hole;
    // マスを置いても配管をつなげなければ、マスごと取りやめる（next を採用しない）
    let next = cur, placed = false;
    if (!hole) {
      const r = placeFixture(cur, base.id, 'manholeSewage', plan.hp);
      if (!r.fixtureId) { skipped++; continue; }
      next = r.doc;
      hole = { id: r.fixtureId, ...plan.hp };
      placed = true;
      // 標準の管底（GL−600）が床下の配管より浅い、または外の配管の土かぶり・勾配が取れなければ、下げる
      const z0 = portNodes(next.network, hole.id)[0]?.pos.z;
      if (z0 !== undefined) {
        let need = z0;
        if (p.z - need < 100) need = Math.round(p.z - INVERT_BELOW);
        // 外の口（GL−370）から最小勾配で下がった所を、新しいマスの管底にする
        if (drop) need = Math.round(plan.zE - slope * drop.d);
        if (need !== z0) next = moveFixture(next, hole.id, plan.hp, undefined, { invertZ: need });
      }
    }
    const port = portNodes(next.network, hole.id)[0];
    if (!port || p.z - port.pos.z < 10) { skipped++; continue; } // 置いてあるマスの管底が、床下の配管より高い
    // 置いてあるマスが浅く、外の配管の土かぶりと勾配が取れない
    // 外の口の管底は GL−370（いちばん上流の外の管底。高さは排水の自動計算でも同じ）
    const buried = drop ? plan.zE : 0;
    if (drop && (buried > buriedTop + 0.5 || p.z - buried < 50)) { skipped++; continue; }
    // 置いてあるマスが外の口より浅くて下りにならないときはつながない（深ければマスの外で L で落とす）
    if (drop && port.pos.z > buried - slope * drop.d + 0.5) { skipped++; continue; }
    // 土間の口（床下の配管の終わり）。先の配管がここを通っていればここで合流。外の口へは 45° で下りる
    const top: Vec3 = drop ? { x: plan.eIn.x, y: plan.eIn.y, z: p.z } : { x: hole.x, y: hole.y, z: p.z };
    const under: Vec3 | null = drop ? { ...drop.x, z: buried } : null;
    const at = (q: Vec2): Vec3 => ({ x: Math.round(q.x), y: Math.round(q.y), z: p.z });
    let net = next.network;
    let pts: Vec3[] = plan.route.points.map(at);
    let endId: string | undefined = port.id;
    let joined = false;
    // 同じ平面位置の点。床下（地面より上）なら勾配で少し高さが違っても同じ点とみる
    const nodeAt = (q: Vec3) => Object.values(net.nodes).find((x) => !x.fixtureId && Math.hypot(x.pos.x - q.x, x.pos.y - q.y) < 1
      && (Math.abs(x.pos.z - q.z) < 1 || (q.z > gl && x.pos.z > gl && sameLayer(x.pos.z, q.z))));
    if (plan.kind === 'node') {
      // 先の配管の点へ合流
      const hitNode = nodeAt(pts[pts.length - 1]);
      if (!hitNode) { skipped++; continue; }
      endId = hitNode.id;
    } else if (plan.kind === 'eIn') {
      // 外周の内側の点まで来たら、外壁を直角に貫通し、基礎の外ですぐ地中へ下ろして勾配をつけてマスへ。先の配管があればそこへ合流
      const eNode = nodeAt(pts[pts.length - 1]);
      const topNode = nodeAt(top);
      if (eNode) endId = eNode.id;
      else if (topNode) { endId = topNode.id; pts = [...pts, top]; }
      else {
        const lastPt = pts[pts.length - 1];
        // 45° が収まらない浅い出口: 土間の口の真下へ下ろしてから水平に外の口へ
        const down = under && !plan.steep ? [{ x: lastPt.x, y: lastPt.y, z: under.z }] : [];
        pts = [...pts, ...(Math.hypot(top.x - lastPt.x, top.y - lastPt.y) >= 1 ? [top] : []), ...down, ...(under ? [under] : []), port.pos];
      }
    } else {
      const sg = plan.seg!;
      if (pts.length === 1) {
        // 落とした端が先の配管の真上: 端をその区間につなぐ
        const merged = connectNodeToSegment(net, e.node.id, sg.id);
        if (merged === net) { skipped++; continue; }
        net = merged; joined = true;
      } else {
        const sp = splitSegment(net, sg.id, pts[pts.length - 1]);
        net = sp.net; endId = sp.nodeId;
      }
    }
    // 一直線に並んだ途中の点は除く（継ぎ目の無い 1 本の配管にする）
    pts = pts.filter((q, i) => {
      if (i === 0 || i === pts.length - 1) return true;
      const a = pts[i - 1], b = pts[i + 1];
      const cx = (q.y - a.y) * (b.z - a.z) - (q.z - a.z) * (b.y - a.y), cy = (q.z - a.z) * (b.x - a.x) - (q.x - a.x) * (b.z - a.z), cz = (q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x);
      return Math.hypot(cx, cy, cz) > 1e-3 || (q.x - a.x) * (b.x - q.x) + (q.y - a.y) * (b.y - q.y) + (q.z - a.z) * (b.z - q.z) < 0;
    });
    if (joined) cur = { ...next, network: net };
    else {
      const r = addPolyline(net, pts, attrs, { startNodeId: e.node.id, endNodeId: endId });
      if (!r.segmentIds.length) { skipped++; continue; }
      cur = { ...next, network: r.net };
      cur = { ...next, network: r.net };
      if (drop && under) {
        buriedCount++;
        // 地中の区間に設計の勾配を持たせる（区間の表示・縦断図で分かるように）
        const un = Object.values(r.net.nodes).find((x) => !x.fixtureId && Math.hypot(x.pos.x - under.x, x.pos.y - under.y) < 1 && Math.abs(x.pos.z - under.z) < 1);
        const last = un && segmentsAt(r.net, un.id).find((t) => t.a === port.id || t.b === port.id);
        if (last) cur = { ...cur, network: { ...cur.network, segments: { ...cur.network.segments, [last.id]: { ...last, slope } } } };
      }
    }
    touched.push(e.node.id);
    if (placed) { holes.push(hole); manholes++; }
    pipes++;
    // 貫通の数: この配管で新しく引いた水平の区間が横切る立上り（外周の立上りを含む）
    const flat = pts.filter((q) => Math.abs(q.z - p.z) < 1);
    for (let i = 1; i < flat.length; i++) sleeves += sleevesOn(flat[i - 1], flat[i], p.z);
    // 外周の基礎は地中で抜ける（基礎貫通スリーブ 1 か所）
    if (under && drop && extFoot.some((f) => pointSeg(plan.exit.foot, f.a, f.b) < f.t / 2 + 50) && pts.some((q) => Math.hypot(q.x - under.x, q.y - under.y) < 1 && Math.abs(q.z - under.z) < 1)) sleeves++;
  }
  // 床下: 起点（基礎を出て地中へ下ろす点）の管底を土間に置き、器具の方へ 2/100（足りなければ 1.5/100、自治体の最小勾配が急ならそれ）で上げる
  const uf = slopeUnderfloor(cur, { slopeFor: rules.slopeFor }, touched);
  cur = { ...cur, network: uf.net };
  let unsloped = uf.failed;
  const lv = uf.levels;
  // 土間より深く落とした配管（床下の外）は、器具側の端の高さを保つように起点を下げ、管径ごとの最小勾配で上げる
  const slabAbs = b.foundation ? base.elevation + b.foundation.slabTop : undefined;
  for (const s0 of startsFrom(cur.network, touched)) {
    let net = cur.network;
    const x = net.nodes[s0.id];
    if (lv && x.pos.z < lv.floor - 1 && x.pos.z > lv.slab - 30) continue; // 床下は上でつけた
    const dry = applySlope(net, s0.id, 'auto');
    if (!dry) { unsloped++; continue; }
    const rise = Math.max(0, ...Object.keys(dry.net.nodes).map((id) => (net.nodes[id] ? dry.net.nodes[id].pos.z - net.nodes[id].pos.z : 0)));
    if (rise > 0.05) {
      const lo = Math.max(s0.underZ + 50, slabAbs !== undefined ? slabAbs + 50 : -Infinity);
      const z = Math.min(x.pos.z, Math.max(x.pos.z - rise, lo));
      if (z < x.pos.z - 0.05) net = moveNode(net, s0.id, { ...x.pos, z: Math.round(z * 10) / 10 });
    }
    const r = applySlope(net, s0.id, 'auto');
    if (r) cur = { ...cur, network: r.net };
    else unsloped++;
  }
  const over = uf.over;
  return pipes ? { doc: cur, pipes, manholes, sleeves, skipped, buried: buriedCount, unsloped, over } : { ...none, skipped };
}

/**
 * 起点（基礎を出て地中へ下ろす点）を、つないだ配管の上の端から排水管をたどって探す。
 * 起点 = 立て管で下の点 U へ下り、U が地中の区間でマスの接続口へつながる点
 */
function startsFrom(net: Doc['network'], from: string[]): { id: string; underZ: number }[] {
  const out = new Map<string, number>();
  const seen = new Set<string>(), stack = [...from];
  const isDrainSeg = (sg: Segment) => sg.system === 'drain' || sg.system === 'sewage';
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || !net.nodes[id] || net.nodes[id].fixtureId) continue;
    seen.add(id);
    const x = net.nodes[id].pos;
    for (const sg of segmentsAt(net, id)) {
      if (!isDrainSeg(sg)) continue;
      const oid = sg.a === id ? sg.b : sg.a, o = net.nodes[oid];
      const vertical = Math.hypot(o.pos.x - x.x, o.pos.y - x.y) < 1;
      if (vertical && o.pos.z < x.z && !o.fixtureId && segmentsAt(net, oid).some((t) => t.id !== sg.id && isDrainSeg(t) && [t.a, t.b].some((n) => net.nodes[n].fixtureId))) out.set(id, o.pos.z);
      if (!vertical || o.pos.z > x.z) stack.push(oid);
    }
  }
  return [...out].map(([id, underZ]) => ({ id, underZ }));
}
