/**
 * 床下の排水の本管（2026-11-13 ユーザー）:
 * すべての器具から近く、材料が少なくて済む位置に φ100 の本管を 1 本通し、公共マスに近い側の外壁から出す
 * （公共マスが無ければ、置いてある汚水マス、それも無ければ水道メーターの側 = 道路側）。
 * 器具の排水（トイレ 75・キッチン 50・洗濯 50・手洗い 40。器具の接続口の太さ）は床下でそれぞれ本管へつなぐ。
 * 外の口（前澤 KSA）と外の汚水マスは「排水を外の桝までつなぐ」（routeDrainsOut）が本管の下流の端から 1 か所だけ作る。
 *
 * 形: 本管は出口の外壁に直角な 1 本の直線（櫛の形）。本管の位置（壁に沿った位置）は、器具から本管までの
 * 枝の長さの合計が一番短くなる所（器具の位置の中央値の近く）。枝は本管に直角（器具が外壁に近いときは L 字）。
 */
import type { Vec2 } from './building';
import { wallsOnFloor } from './building';
import type { Doc } from './doc';
import { isManhole, portNodes } from './fixtures';
import { addPolyline, segmentsAt, splitSegment, type PipeNode, type Segment, type SegmentAttrs, type Vec3 } from './network';
import { MANHOLE_OFFSET, openDrainEnds, routeDrainsOut, type DrainRouteResult, type DrainRules } from './drainRoute';
import { distToOutline, insideBuilding, isUnderfloorDrain, slopeUnderfloor, underfloorLevels, type UnderfloorLevels } from './underfloorSlope';
import { KSA_STRAIGHT, ksaStandardHeights } from './kisoSleeve';
import { isRiserLike } from './slope';

/** 床下の本管の太さ */
export const MAIN_DIAMETER = 100;
/** 合流点どうし・本管の端からの離れ(mm) */
const JOIN_GAP = 150;
/** 出口の外壁の端（角）から本管を離す(mm) */
const CORNER_GAP = 600;
/** 本管・枝を外周の壁の芯から離す(mm) */
const EDGE_GAP = 200;
/** 本管・枝が、ほかの器具から落とした管の真下を通らない離れ(mm) */
const DROP_GAP = 60;
/** 本管の下流の端は、土間の口（KSA の上の口）から内へこれだけ（そこから外へは routeDrainsOut が出す） */
const END_BEYOND = 200;
/** 調べる点の間隔(mm) */
const SAMPLE = 100;

export type DrainMainResult = DrainRouteResult & {
  /** new: 本管を新しく通した / joined: 前の本管へ枝をつないだ / none: つなぐ排水が無い / fallback: 本管にできず器具ごとに外へ出した */
  main: 'new' | 'joined' | 'none' | 'fallback';
  /** 画面に出す知らせ */
  notes: string[];
};

type End = { node: PipeNode; seg: Segment };
type ExtWall = { a: Vec2; b: Vec2; t: number; L: number; u: Vec2; out: Vec2 };

const SIDE: Record<string, string> = { '1,0': '東', '-1,0': '西', '0,1': '北', '0,-1': '南' };
const sideOf = (n: Vec2) => SIDE[`${Math.round(n.x)},${Math.round(n.y)}`] ?? '';
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const pointSeg = (p: Vec2, a: Vec2, b: Vec2) => {
  const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2));
  return Math.hypot(a.x + (b.x - a.x) * t - p.x, a.y + (b.y - a.y) * t - p.y);
};

/** 出口を向ける所: 公共汚水マス → 置いてある汚水マス → 水道メーター（道路側）。無ければ null */
function exitTarget(doc: Doc): { p: Vec2; why: string } | null {
  const fs = Object.values(doc.fixtures);
  const pub = fs.find((f) => f.type === 'publicSewage');
  if (pub) return { p: { x: pub.x, y: pub.y }, why: '公共汚水マスに近い' };
  const mh = fs.find((f) => f.type === 'manholeSewage' && !f.params?.auto);
  if (mh) return { p: { x: mh.x, y: mh.y }, why: '置いてある汚水マスに近い' };
  const meter = fs.find((f) => f.type === 'waterMeter');
  if (meter) return { p: { x: meter.x, y: meter.y }, why: '道路側（水道メーターの側）の' };
  return null;
}

/** 線分 p→q の上の点（端から skip 以内は除く）がすべて ok か */
function along(p: Vec2, q: Vec2, ok: (x: Vec2) => boolean, skip: Vec2[] = []): boolean {
  const L = Math.hypot(q.x - p.x, q.y - p.y), n = Math.max(1, Math.ceil(L / SAMPLE));
  for (let i = 0; i <= n; i++) {
    const x = { x: p.x + ((q.x - p.x) * i) / n, y: p.y + ((q.y - p.y) * i) / n };
    if (skip.some((s) => Math.hypot(s.x - x.x, s.y - x.y) < JOIN_GAP)) continue;
    if (!ok(x)) return false;
  }
  return true;
}

type Layout = {
  wall: ExtWall; cost: number;
  /** 本管の下流の端（土間の口の内側） */
  end: Vec2;
  /** 合流点（下流から上流の順）。onEnd: その器具の落とした管が本管の上にある */
  joins: { at: Vec2; end?: End }[];
  /** 枝（器具の端 → 合流点）。pts は器具の端の後の点 */
  branches: { e: End; pts: Vec2[]; join: number }[];
};

/** 外壁 w から出す櫛の形の本管。器具の端から本管までの長さの合計が一番短い所。置けなければ null */
function layoutFor(w: ExtWall, ends: End[], lv: UnderfloorLevels): Layout | null {
  const vin = { x: -w.out.x, y: -w.out.y };
  const U = (p: Vec2) => (p.x - w.a.x) * w.u.x + (p.y - w.a.y) * w.u.y;
  const V = (p: Vec2) => (p.x - w.a.x) * vin.x + (p.y - w.a.y) * vin.y;
  const P = (u: number, v: number): Vec2 => ({ x: Math.round(w.a.x + w.u.x * u + vin.x * v), y: Math.round(w.a.y + w.u.y * u + vin.y * v) });
  // 土間の口（KSA の上の口）: 外の面から内へ 255 + H。φ100 の KSA の H
  const H = Math.max(...ksaStandardHeights(MAIN_DIAMETER), 0);
  const vS = KSA_STRAIGHT - w.t / 2 + H;
  const vP = vS + END_BEYOND;
  const es = ends.map((e) => ({ e, u: U(e.node.pos), v: V(e.node.pos) }));
  if (es.some((x) => x.v <= 0)) return null;
  const okIn = (x: Vec2) => insideBuilding(lv, x) && distToOutline(lv, x) >= EDGE_GAP;
  const lo = CORNER_GAP, hi = w.L - CORNER_GAP;
  if (hi < lo) return null;
  const cands = [...new Set([median(es.map((x) => x.u)), ...es.map((x) => x.u)].map((c) => Math.round(Math.max(lo, Math.min(hi, c)))))];
  let best: Layout | null = null;
  for (const c of cands) {
    // 出口のそば（本管の下流の端より壁側）にある器具の落とした管の真下を、外へ出る管が通らない
    if (es.some((x) => x.v < vP + JOIN_GAP && Math.abs(x.u - c) < JOIN_GAP)) continue;
    // 合流点: 本管の上の器具はその場所、ほかは器具の奥行き（壁に近すぎれば本管の端の先）。重なれば奥へずらす
    const onLine = es.filter((x) => Math.abs(x.u - c) < 1 && x.v >= vP + JOIN_GAP);
    const taken = onLine.map((x) => x.v);
    const rows = es.filter((x) => !onLine.includes(x)).sort((a, b) => a.v - b.v).map((x) => {
      let vj = Math.max(x.v, vP + JOIN_GAP);
      for (let k = 0; k < 50 && taken.some((t) => Math.abs(t - vj) < JOIN_GAP); k++) vj += JOIN_GAP;
      taken.push(vj);
      return { ...x, vj };
    });
    const vTop = Math.max(...taken);
    const endPts = es.map((x) => x.e.node.pos);
    const others = (x: { e: End }) => endPts.filter((q) => q !== x.e.node.pos);
    // 本管: 土間の口から一番奥の合流点まで、建物の中で外周の壁から離れている。器具の落とした管の真下（本管の上の器具を除く）を通らない
    const offLine = endPts.filter((q) => !onLine.some((x) => x.e.node.pos === q));
    if (!along(P(c, vS), P(c, vTop), (x) => okIn(x) && offLine.every((q) => Math.hypot(q.x - x.x, q.y - x.y) >= DROP_GAP))) continue;
    let ok = true, cost = vTop - vP;
    const branches: { e: End; pts: Vec2[]; vj: number }[] = [];
    for (const x of rows) {
      const pts = [...(Math.abs(x.vj - x.v) >= 1 ? [P(x.u, x.vj)] : []), P(c, x.vj)];
      const from = { x: x.e.node.pos.x, y: x.e.node.pos.y };
      const chain = [from, ...pts];
      for (let i = 1; i < chain.length && ok; i++) {
        ok = along(chain[i - 1], chain[i], (q) => okIn(q) && others(x).every((r) => Math.hypot(r.x - q.x, r.y - q.y) >= DROP_GAP), [from]);
      }
      if (!ok) break;
      cost += Math.abs(x.vj - x.v) + Math.abs(x.u - c);
      branches.push({ e: x.e, pts, vj: x.vj });
    }
    if (!ok) continue;
    if (best && cost >= best.cost - 1) continue;
    const joinVs = [...new Set(taken)].sort((a, b) => a - b);
    best = {
      wall: w, cost, end: P(c, vP),
      joins: joinVs.map((v) => ({ at: P(c, v), end: onLine.find((x) => Math.abs(x.v - v) < 1)?.e })),
      branches: branches.map((b) => ({ e: b.e, pts: b.pts, join: joinVs.indexOf(b.vj) })),
    };
  }
  return best;
}

/** 外のマスまでつながっている床下の排水の横管（前に通した本管・枝） */
function existingMains(doc: Doc, lv: UnderfloorLevels): Segment[] {
  const net = doc.network;
  const isDrain = (s: Segment) => s.system === 'drain' || s.system === 'sewage';
  // 外のマス（汚水マス・公共ます）からたどれる排水の点
  const seen = new Set<string>();
  const stack = Object.values(doc.fixtures).filter((f) => isManhole(f.type)).flatMap((f) => portNodes(net, f.id).map((n) => n.id));
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const s of segmentsAt(net, id)) if (isDrain(s)) stack.push(s.a === id ? s.b : s.a);
  }
  return Object.values(net.segments).filter((s) => isDrain(s) && seen.has(s.a) && isUnderfloorDrain(net, s, lv) && !isRiserLike(net, s)
    && (Math.abs(net.nodes[s.a].pos.x - net.nodes[s.b].pos.x) < 1 || Math.abs(net.nodes[s.a].pos.y - net.nodes[s.b].pos.y) < 1));
}

/** 前に通した本管（太い管を先に）へ、器具の端から直角に枝をつなぐ。つなげなければ null */
function joinToMain(doc: Doc, e: End, lv: UnderfloorLevels): Doc | null {
  const net = doc.network;
  const mains = existingMains(doc, lv);
  if (!mains.length) return null;
  const top = Math.max(...mains.map((s) => s.diameter));
  const E = e.node.pos;
  const others = openDrainEnds(doc).filter((x) => x.node.id !== e.node.id).map((x) => x.node.pos);
  const okIn = (x: Vec2) => insideBuilding(lv, x) && distToOutline(lv, x) >= EDGE_GAP && others.every((r) => Math.hypot(r.x - x.x, r.y - x.y) >= DROP_GAP);
  let best: { sid: string; foot: Vec3; pts: Vec3[]; cost: number } | null = null;
  for (const s of mains) {
    const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos, L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 2 * JOIN_GAP) continue;
    const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    const t = Math.max(JOIN_GAP, Math.min(L - JOIN_GAP, (E.x - a.x) * u.x + (E.y - a.y) * u.y));
    const foot = { x: Math.round(a.x + u.x * t), y: Math.round(a.y + u.y * t), z: a.z + ((b.z - a.z) * t) / L };
    // 直角に着く（はみ出すときは L 字: 本管に平行に寄せてから直角に）
    const bend = { x: E.x + (foot.x - E.x) * Math.abs(u.x), y: E.y + (foot.y - E.y) * Math.abs(u.y), z: E.z };
    const pts = Math.hypot(bend.x - E.x, bend.y - E.y) >= 1 && Math.hypot(bend.x - foot.x, bend.y - foot.y) >= 1 ? [bend, foot] : [foot];
    const chain = [E, ...pts];
    if (!chain.every((p, i) => i === 0 || along(chain[i - 1], p, okIn, [E]))) continue;
    // 太い管（本管）を先に。同じ太さなら短い方
    const cost = chain.reduce((acc, p, i) => (i ? acc + Math.hypot(p.x - chain[i - 1].x, p.y - chain[i - 1].y) : 0), 0) + (s.diameter < top ? 1e6 : 0);
    if (!best || cost < best.cost) best = { sid: s.id, foot, pts, cost };
  }
  if (!best) return null;
  const sp = splitSegment(net, best.sid, best.foot);
  const at = sp.net.nodes[sp.nodeId].pos;
  const pts = [E, ...best.pts.slice(0, -1).map((p) => ({ ...p, z: at.z })), at];
  const attrs: SegmentAttrs = { system: e.seg.system, diameter: e.seg.diameter, ...(e.seg.material ? { material: e.seg.material } : {}) };
  const r = addPolyline(sp.net, pts, attrs, { startNodeId: e.node.id, endNodeId: sp.nodeId });
  return r.segmentIds.length ? { ...doc, network: r.net } : null;
}

/**
 * 床下の排水を本管にまとめて外へ出す。本管にできないとき（外周が閉じていない・置ける所が無い）は、
 * これまでどおり器具ごとに一番近い外壁から出す（routeDrainsOut）
 */
export function routeDrainMain(doc: Doc, rules: DrainRules = {}): DrainMainResult {
  const none: DrainMainResult = { doc, pipes: 0, manholes: 0, sleeves: 0, skipped: 0, main: 'none', notes: [] };
  const ends = openDrainEnds(doc);
  const base = doc.building.floors[0];
  if (!ends.length || !base) return none;
  const lv = underfloorLevels(doc);
  const fallback = (why: string): DrainMainResult => {
    const r = routeDrainsOut(doc, MANHOLE_OFFSET, rules);
    return { ...r, main: 'fallback', notes: r.pipes ? [`床下の本管にまとめられなかったので（${why}）、器具ごとに近い外壁から出しました`] : [] };
  };
  if (!lv?.outline.length) return fallback('外周の壁が 1 周つながっていない');

  // 前に通した本管があれば、新しい器具はそこへ枝でつなぐ
  if (existingMains(doc, lv).length) {
    let cur = doc;
    const touched: string[] = [], left: End[] = [];
    for (const e of ends) {
      const next = joinToMain(cur, e, lv);
      if (next) { cur = next; touched.push(e.node.id); } else left.push(e);
    }
    let pipes = touched.length;
    if (touched.length) cur = { ...cur, network: slopeUnderfloor(cur, { slopeFor: rules.slopeFor }, touched).net };
    let skipped = 0, manholes = 0, sleeves = 0;
    if (left.length) {
      const r = routeDrainsOut(cur, MANHOLE_OFFSET, rules, { ends: left.map((e) => ({ node: cur.network.nodes[e.node.id], seg: cur.network.segments[e.seg.id] })) });
      cur = r.doc; pipes += r.pipes; skipped += r.skipped; manholes += r.manholes; sleeves += r.sleeves;
    }
    return { doc: cur, pipes, manholes, sleeves, skipped, main: 'joined', notes: touched.length ? [`排水 ${touched.length} 本を床下の本管へつなぎました`] : [] };
  }

  // 新しく本管を通す: 出口の外壁（公共マス・汚水マス・メーターに向いた、一番近い外壁から順に）
  const b = doc.building;
  const walls: ExtWall[] = wallsOnFloor(b, base.id).filter((w) => w.kind === 'exterior' && b.corners[w.a] && b.corners[w.b]).flatMap((w) => {
    const a = b.corners[w.a], c = b.corners[w.b], L = Math.hypot(c.x - a.x, c.y - a.y);
    if (L < 1) return [];
    const u = { x: (c.x - a.x) / L, y: (c.y - a.y) / L };
    if (Math.abs(u.x) > 1e-6 && Math.abs(u.y) > 1e-6) return []; // 斜めの壁からは出さない
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, n = { x: u.y, y: -u.x };
    const probe = (k: number) => ({ x: mid.x + n.x * k * (w.thickness / 2 + 150), y: mid.y + n.y * k * (w.thickness / 2 + 150) });
    const out = !insideBuilding(lv, probe(1)) && insideBuilding(lv, probe(-1)) ? n : !insideBuilding(lv, probe(-1)) && insideBuilding(lv, probe(1)) ? { x: -n.x, y: -n.y } : null;
    return out ? [{ a, b: c, t: w.thickness, L, u, out }] : [];
  });
  const target = exitTarget(doc);
  let chosen: Layout | null = null;
  if (target) {
    // 出口を向ける所に向いた外壁（外向きがその所の方を向く）を、近い順に
    const facing = walls.map((w) => ({ w, d: pointSeg(target.p, w.a, w.b), f: (target.p.x - (w.a.x + w.b.x) / 2) * w.out.x + (target.p.y - (w.a.y + w.b.y) / 2) * w.out.y }))
      .sort((p, q) => Number(q.f > 0) - Number(p.f > 0) || p.d - q.d);
    for (const { w } of facing) { chosen = layoutFor(w, ends, lv); if (chosen) break; }
  } else {
    for (const w of walls) { const l = layoutFor(w, ends, lv); if (l && (!chosen || l.cost < chosen.cost)) chosen = l; }
  }
  if (!chosen) return fallback('本管を通せる所が見つからない');

  // 本管（下流の端 → 合流点 → 一番奥）と枝を引く
  const hasToilet = ends.some((e) => e.seg.system === 'sewage');
  const z0 = Math.max(...ends.map((e) => e.node.pos.z));
  const mainAttrs: SegmentAttrs = { system: hasToilet ? 'sewage' : 'drain', diameter: MAIN_DIAMETER };
  let net = doc.network;
  const at = (p: Vec2): Vec3 => ({ x: p.x, y: p.y, z: z0 });
  const ids: string[] = [];
  let prev: string | undefined, endSeg: string | undefined;
  const chainPts: { p: Vec3; id?: string }[] = [{ p: at(chosen.end) }, ...chosen.joins.map((j) => ({ p: j.end ? j.end.node.pos : at(j.at), id: j.end?.node.id }))];
  for (let i = 1; i < chainPts.length; i++) {
    const r = addPolyline(net, [chainPts[i - 1].p, chainPts[i].p], mainAttrs, { ...(prev ? { startNodeId: prev } : {}), ...(chainPts[i].id ? { endNodeId: chainPts[i].id } : {}) });
    if (!r.segmentIds.length) return fallback('本管を引けなかった');
    net = r.net;
    if (i === 1) { ids.push(r.nodeIds[0]); endSeg = r.segmentIds[0]; }
    prev = r.nodeIds[r.nodeIds.length - 1];
    ids.push(prev);
  }
  // ids[0] = 下流の端、ids[k+1] = k 番目の合流点
  for (const br of chosen.branches) {
    const e = br.e;
    const attrs: SegmentAttrs = { system: e.seg.system, diameter: e.seg.diameter, ...(e.seg.material ? { material: e.seg.material } : {}) };
    const r = addPolyline(net, [e.node.pos, ...br.pts.map(at)], attrs, { startNodeId: e.node.id, endNodeId: ids[br.join + 1] });
    if (!r.segmentIds.length) return fallback('枝を引けなかった');
    net = r.net;
  }
  const built: Doc = { ...doc, network: net };
  // 本管の下流の端から、前澤 KSA で外へ出して外の汚水マスへ（マスはこの 1 か所）
  const endNode = net.nodes[ids[0]], seg = net.segments[endSeg!];
  const r = routeDrainsOut(built, MANHOLE_OFFSET, rules, { ends: [{ node: endNode, seg }], wall: { a: chosen.wall.a, b: chosen.wall.b } });
  if (!r.pipes) return fallback('本管の出口から外へ出せなかった');
  const n = ends.length;
  return {
    ...r, pipes: n, main: 'new',
    notes: [`床下に φ${MAIN_DIAMETER} の本管を通し、器具 ${n} 個の排水をつなぎました。${target ? target.why : '一番短く出せる'}${sideOf(chosen.wall.out)}の外壁から外の汚水マスへ出しています`],
  };
}
