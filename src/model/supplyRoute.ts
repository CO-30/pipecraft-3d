/**
 * 給水・給湯を床下でつなぐ（案）。純粋関数。ヘッダー工法:
 *   メーター → 地中 → いちばん近い外壁の外で床下の高さへ → 外周の基礎を直角に貫通 → 床下の給水ヘッダー → 各器具の給水口
 *   給水ヘッダー → 給湯器の入口、給湯器の出口 → 床下の給湯ヘッダー → 各器具の給湯口
 * 床下の配管は 1 階の床から UNDERFLOOR_Z。器具の給水・給湯口から真下へ立て管を下ろし、`findFloorRoute`（内部の立上りは人通口を通る）でヘッダーの出口へ。
 * つながっていない口だけをつなぐので、何度押しても増えない。床下の形の判定は drainRoute と同じ考え方の写し（排水の作業と衝突させないため）。
 */
import type { Vec2 } from './building';
import { wallsOnFloor } from './building';
import type { Doc } from './doc';
import { FIXTURE_CATALOG, groundZ, placeFixture, portNodes, type Fixture, type FixtureType } from './fixtures';
import { findFloorRoute, ROUTE_STEP, type RouteGoal } from './floorRoute';
import { assignAutoMaterials } from './materials';
import { membersOf } from './members';
import { addPolyline, addRiser, segmentsAt, type PipeNode, type SegmentAttrs, type SystemType, type Vec3 } from './network';

/** 床下の配管の高さ（1 階の床から mm） */
export const UNDERFLOOR_Z = -300;
/** 床下のヘッダーの設置面（出口が UNDERFLOOR_Z に来る） */
const HEADER_MOUNT = -400;
/** 給水・給湯口を床下へ下ろす器具（屋外の水栓・機器どうしをつなぐものは除く） */
const SUPPLY_TYPES = new Set<FixtureType>(['toilet', 'washbasin', 'kitchen', 'bathtub', 'shower', 'washer', 'faucet', 'mixFaucet']);
const WALL_GAP = 80, INSET = 150, OUT_GAP = 100, PIPE_GAP = 60, BUSY_GAP = 40, CORNER = 300, HEADER_IN = 600, FAR = 100_000;

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
  connected: { water: number; hot: number };
  notes: string[];
  error?: string;
};

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
/** 線分 p→q が a→b と平行に重なって走る（離れ gap 未満で、長さの方向に重なりがある）。直角に横切るのはよい */
function runsOn(p: Vec2, q: Vec2, a: Vec2, b: Vec2, gap: number): boolean {
  const horiz = (s: Vec2, t: Vec2) => Math.abs(s.y - t.y) < 1, vert = (s: Vec2, t: Vec2) => Math.abs(s.x - t.x) < 1;
  const ov = (s0: number, s1: number, t0: number, t1: number) => Math.min(Math.max(s0, s1), Math.max(t0, t1)) - Math.max(Math.min(s0, s1), Math.min(t0, t1)) > 1;
  if (horiz(p, q) && horiz(a, b)) return Math.abs(p.y - a.y) < gap && ov(p.x, q.x, a.x, b.x);
  if (vert(p, q) && vert(a, b)) return Math.abs(p.x - a.x) < gap && ov(p.y, q.y, a.y, b.y);
  return false;
}

type Entry = { eIn: Vec2; eOut: Vec2; n: Vec2; u: Vec2 };

export function routeSupplies(doc: Doc, opts: { burial?: number } = {}): SupplyRouteResult {
  const none = (error?: string): SupplyRouteResult => ({ doc, pipes: 0, headers: 0, sleeves: 0, crossings: 0, connected: { water: 0, hot: 0 }, notes: [], ...(error ? { error } : {}) });
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
  const inside = (p: Vec2) => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => blockers.some((k) => crosses(p, { x: p.x + dx * FAR, y: p.y + dy * FAR }, k.a, k.b)));
  const nearExt = (f: Line) => extWalls.some((w) => pointSeg({ x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 }, w.a, w.b) < Math.max(w.t, f.t) / 2 + 250);
  const extFoot = footLines.filter(nearExt), inFoot = footLines.filter((f) => !nearExt(f));
  const roomy = (q: Vec2) => inside(q) && extWalls.every((w) => pointSeg(q, w.a, w.b) >= w.t / 2 + WALL_GAP) && extFoot.every((f) => pointSeg(q, f.a, f.b) >= f.t / 2 + WALL_GAP);
  const zU = base.elevation + UNDERFLOOR_Z;
  const footAt = (q: Vec2) => inFoot.some((f) => zU > f.z0 && zU < f.z1 && pointSeg(q, f.a, f.b) < f.t / 2 + PIPE_GAP);
  const xs = walls.flatMap((w) => [w.a.x, w.b.x]), ys = walls.flatMap((w) => [w.a.y, w.b.y]);
  const bounds = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const burialZ = groundZ(b, doc.site) - (opts.burial ?? 300);

  let cur = doc;
  const newSegs: string[] = [];
  let pipes = 0, headers = 0, sleeves = 0, crossings = 0;
  const connected = { water: 0, hot: 0 };
  const notes: string[] = [];
  const nodeOf = (fid: string, pid: string): PipeNode | undefined => portNodes(cur.network, fid).find((n) => n.portId === pid);
  const free = (n: PipeNode | undefined) => !!n && segmentsAt(cur.network, n.id).length === 0;
  const attrs = (system: SystemType, diameter: number): SegmentAttrs => ({ system, diameter });
  const path = (pts: Vec3[], a: SegmentAttrs, start?: string, end?: string): string[] => {
    const r = addPolyline(cur.network, pts, a, { ...(start ? { startNodeId: start } : {}), ...(end ? { endNodeId: end } : {}) });
    cur = { ...cur, network: r.net };
    newSegs.push(...r.segmentIds);
    return r.nodeIds;
  };

  /** 外の点 p に近い外壁の入口（壁へ直角に下ろした足。壁の端から CORNER 以上） */
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
        const nn = [{ x: -u.y, y: u.x }, { x: u.y, y: -u.x }].find((c) => !inside({ x: foot.x + c.x * (w.t / 2 + 200), y: foot.y + c.y * (w.t / 2 + 200) }));
        if (!nn) continue;
        const face = Math.max(w.t, ...extFoot.filter((f) => pointSeg(foot, f.a, f.b) < f.t / 2 + 50).map((f) => f.t)) / 2;
        const eIn = { x: Math.round(foot.x - nn.x * (w.t / 2 + INSET)), y: Math.round(foot.y - nn.y * (w.t / 2 + INSET)) };
        const eOut = { x: Math.round(foot.x + nn.x * (face + OUT_GAP)), y: Math.round(foot.y + nn.y * (face + OUT_GAP)) };
        if (!roomy(eIn)) continue;
        // 外から入口へ: 壁と平行に進んでから直角に（途中で別の外壁を横切る道は採らない）
        const corner = { x: eOut.x + nn.x * ((p.x - eOut.x) * nn.x + (p.y - eOut.y) * nn.y), y: eOut.y + nn.y * ((p.x - eOut.x) * nn.x + (p.y - eOut.y) * nn.y) };
        if (extWalls.some((k) => k !== w && (crosses(p, corner, k.a, k.b) || crosses(corner, eOut, k.a, k.b)))) continue;
        const cost = Math.abs(p.x - eOut.x) + Math.abs(p.y - eOut.y);
        if (!best || cost < best.cost) best = { eIn, eOut, n: nn, u, cost };
        break;
      }
    }
    return best;
  };
  /** 外の点から入口までの道（壁と平行 → 直角）の曲がり角 */
  const cornerOf = (p: Vec2, e: Entry): Vec2 => {
    const k = (p.x - e.eOut.x) * e.n.x + (p.y - e.eOut.y) * e.n.y;
    return { x: e.eOut.x + e.n.x * k, y: e.eOut.y + e.n.y * k };
  };

  /** 床下の点 from から to へ（先に引いた給水・給湯の床下の管から BUSY_GAP 離す） */
  const routeUnder = (from: Vec2, to: Vec2): Vec2[] | null => {
    if (dist2(from, to) < 1) return [from, to];
    const busy = Object.values(cur.network.segments).filter((s) => {
      if (s.system !== 'water' && s.system !== 'hotWater') return false;
      const a = cur.network.nodes[s.a].pos, c = cur.network.nodes[s.b].pos;
      return Math.abs(a.z - zU) < 1 && Math.abs(c.z - zU) < 1;
    });
    const near = (q: Vec2) => dist2(q, from) < 2 * ROUTE_STEP || dist2(q, to) < 2 * ROUTE_STEP;
    // 先の管の上を重ねて走らない（直角に横切るのはよい。床下の PB はまたいで通す）
    const edgeOk = (q: Vec2, r: Vec2) => near(q) || near(r) || busy.every((s) => !runsOn(q, r, cur.network.nodes[s.a].pos, cur.network.nodes[s.b].pos, BUSY_GAP));
    const goals: RouteGoal[] = ([0, 1, 2, 3] as const).map((dir, tag) => ({ a: to, b: to, dir, tag }));
    const r = findFloorRoute({ start: from, allowed: (q) => near(q) || roomy(q), footing: footAt, edgeOk, goals, bounds });
    if (!r) return null;
    crossings += r.crossings;
    return r.points;
  };
  const at = (p: Vec2, z = zU): Vec3 => ({ x: p.x, y: p.y, z });

  /** ヘッダー: 床下にあるものを使い、出口が足りなければ near の近くに置く。出口のノードを返す（使える順） */
  const headerOutlets = (type: 'waterHeader' | 'hotWaterHeader', need: number, near: Vec2, inward: Vec2, feed: (inNode: PipeNode) => boolean): PipeNode[] => {
    const outs: PipeNode[] = [];
    const existing = Object.values(cur.fixtures).filter((f) => f.type === type && f.floorId === base.id && (f.params?.mountZ ?? 0) < 0);
    const collect = (f: Fixture) => portNodes(cur.network, f.id).filter((n) => n.portId?.startsWith('out') && free(n)).forEach((n) => outs.push(n));
    // 置いてあるヘッダーの入口が空いていれば、そこへもつなぐ
    for (const f of existing) { const inNode = nodeOf(f.id, 'in'); if (free(inNode) && !feed(inNode!)) notes.push(`${FIXTURE_CATALOG[type].label}の入口へ配管をつなげませんでした（手でつないでください）`); }
    existing.forEach(collect);
    for (let k = 0; outs.length < need && k < 4; k++) {
      // 入口から内へ HEADER_IN、2 台目からは壁と平行にずらす。置けなければ少しずつ内へ
      const along = { x: inward.y, y: -inward.x };
      let placed: string | null = null;
      for (let step = 0; step < 6 && !placed; step++) {
        const d = HEADER_IN + step * 300, sx = (existing.length + k) * 600;
        const p = { x: Math.round(near.x + inward.x * d + along.x * sx), y: Math.round(near.y + inward.y * d + along.y * sx) };
        if (![-300, 0, 300].every((o) => roomy({ x: p.x + along.x * o, y: p.y + along.y * o }))) continue;
        const r = placeFixture(cur, base.id, type, p, 0, { mountZ: HEADER_MOUNT });
        if (!r.fixtureId) continue;
        cur = r.doc;
        placed = r.fixtureId;
      }
      if (!placed) break;
      headers++;
      const inNode = nodeOf(placed, 'in')!;
      if (!feed(inNode)) notes.push(`${FIXTURE_CATALOG[type].label}の入口へ配管をつなげませんでした（手でつないでください）`);
      collect(cur.fixtures[placed]);
    }
    return outs;
  };

  /** 器具の給水・給湯口の床下の端（真下へ下ろす。すでに下ろしてあればその下の端）。つながっていれば null */
  const underEnd = (n: PipeNode, system: SystemType, dia: number): PipeNode | null => {
    const segs = segmentsAt(cur.network, n.id);
    if (!segs.length) {
      const r = addRiser(cur.network, n.id, zU, attrs(system, dia));
      if (!r) return null;
      cur = { ...cur, network: r.net };
      newSegs.push(r.segmentId);
      return cur.network.nodes[r.nodeId];
    }
    if (segs.length !== 1) return null;
    const o = cur.network.nodes[segs[0].a === n.id ? segs[0].b : segs[0].a];
    return !o.fixtureId && segmentsAt(cur.network, o.id).length === 1 && Math.abs(o.pos.z - zU) < 20 ? o : null;
  };

  // --- 器具の給水・給湯口（1 階の建物の中） ---
  type Target = { node: PipeNode; end: PipeNode; fixtureId: string };
  const targets: Record<'water' | 'hotWater', Target[]> = { water: [], hotWater: [] };
  let outdoor = 0, upper = 0;
  for (const f of Object.values(cur.fixtures)) {
    if (!SUPPLY_TYPES.has(f.type) && f.type !== 'outdoorFaucet') continue;
    const ports = portNodes(cur.network, f.id).filter((n) => { const sys = FIXTURE_CATALOG[f.type].ports.find((p) => p.id === n.portId)?.system; return sys === 'water' || sys === 'hotWater'; });
    if (!ports.some(free)) continue;
    if (f.type === 'outdoorFaucet' || !inside(f)) { outdoor++; continue; }
    if (f.floorId !== base.id) { upper++; continue; }
    for (const n of ports) {
      const def = FIXTURE_CATALOG[f.type].ports.find((p) => p.id === n.portId)!;
      const end = underEnd(n, def.system, def.diameter);
      if (end) targets[def.system as 'water' | 'hotWater'].push({ node: n, end, fixtureId: f.id });
    }
  }
  if (outdoor) notes.push(`屋外の水栓など ${outdoor} 個はつないでいません（引込の管から分けてください）`);
  if (upper) notes.push(`2 階より上の器具 ${upper} 個はつないでいません`);

  const heater = Object.values(cur.fixtures).find((f) => f.type === 'waterHeater');
  const heaterIn = heater ? nodeOf(heater.id, 'in') : undefined;
  const heaterOut = heater ? nodeOf(heater.id, 'out') : undefined;
  const heaterInside = !!heater && inside(heater);

  /** 外の口（給湯器）と床下の入口をつなぐ: 口 → 入口の外で床下の高さ → 基礎を貫通 → 入口。入口のノード id */
  const wallLink = (port: PipeNode, a: SegmentAttrs): string | null => {
    const e = entryFor(port.pos);
    if (!e) return null;
    const c = cornerOf(port.pos, e);
    const ids = path([port.pos, at(c, port.pos.z), at(e.eOut, port.pos.z), at(e.eOut), at(e.eIn)], a, port.id);
    sleeves++;
    return ids.at(-1)!;
  };
  /** 建物の中の口: 真下へ下ろした床下の端 */
  const dropLink = (port: PipeNode, a: SegmentAttrs): string | null => {
    const r = addRiser(cur.network, port.id, zU, a);
    if (!r) return null;
    cur = { ...cur, network: r.net };
    newSegs.push(r.segmentId);
    return r.nodeId;
  };
  /** 床下の点 fromId から口 toId へ（終点が床下でなければ、終点の真下まで来てから立ち上げ・立ち下げ） */
  const connect = (fromId: string, toId: string, a: SegmentAttrs): boolean => {
    const p = cur.network.nodes[fromId].pos, q = cur.network.nodes[toId].pos;
    const pts = routeUnder(p, q);
    if (!pts) return false;
    const v = pts.map((x) => at(x));
    if (Math.abs(q.z - zU) > 0.5) v.push(q);
    path(v, a, fromId, toId);
    pipes++;
    return true;
  };

  // --- 給水: メーター → 給水ヘッダー → 器具・給湯器の入口 ---
  const waterTargets: { end: string; fixtureId: string; dia: number }[] = targets.water.map((t) => ({ end: t.end.id, fixtureId: t.fixtureId, dia: 13 }));
  let heaterInEnd: string | null = null;
  if (heaterIn && free(heaterIn)) {
    heaterInEnd = heaterInside ? dropLink(heaterIn, attrs('water', 20)) : wallLink(heaterIn, attrs('water', 20));
    if (heaterInEnd) waterTargets.push({ end: heaterInEnd, fixtureId: heater!.id, dia: 20 });
    else notes.push('給湯器の入口への道が見つかりませんでした');
  }
  const meterOut = nodeOf(meter.id, 'out')!;
  const meterEntry = entryFor(meterOut.pos);
  let feedNode: string | null = null;
  const feed = (inNode: PipeNode): boolean => {
    if (!feedNode) {
      if (!free(meterOut) || !meterEntry) return false;
      const c = cornerOf(meterOut.pos, meterEntry);
      const ids = path([meterOut.pos, at(meterOut.pos, burialZ), at(c, burialZ), at(meterEntry.eOut, burialZ), at(meterEntry.eOut), at(meterEntry.eIn)], attrs('water', 20), meterOut.id);
      sleeves++;
      pipes++;
      feedNode = ids.at(-1)!;
    }
    return connect(feedNode, inNode.id, attrs('water', 20));
  };
  if (waterTargets.length) {
    if (!free(meterOut) && !Object.values(cur.fixtures).some((f) => f.type === 'waterHeader' && (f.params?.mountZ ?? 0) < 0)) notes.push('メーターの出口にはすでに配管があるため、引込は足していません');
    const near = meterEntry ? meterEntry.eIn : { x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 };
    const inward = meterEntry ? { x: -meterEntry.n.x, y: -meterEntry.n.y } : { x: 1, y: 0 };
    const outs = headerOutlets('waterHeader', waterTargets.length, near, inward, feed);
    // ヘッダーに近い器具から順に、近い出口へ
    const order = waterTargets.slice().sort((p, q) => dist2(cur.network.nodes[p.end].pos, near) - dist2(cur.network.nodes[q.end].pos, near));
    for (const t of order) {
      const out = outs.shift();
      if (!out) { notes.push('給水ヘッダーの出口が足りず、つないでいない器具があります'); break; }
      if (connect(t.end, out.id, attrs('water', t.dia))) connected.water++;
      else { outs.unshift(out); notes.push(`${FIXTURE_CATALOG[cur.fixtures[t.fixtureId].type].label}への道が見つかりませんでした（立上りに囲まれている、など）`); }
    }
  }

  // --- 給湯: 給湯器の出口 → 給湯ヘッダー → 器具の給湯口 ---
  if (targets.hotWater.length) {
    if (!heater || !heaterOut) notes.push('給湯器が無いため、給湯はつないでいません');
    else {
      let hotFeed: string | null = null;
      const hotEntry = heaterInside ? null : entryFor(heaterOut.pos);
      const feedHot = (inNode: PipeNode): boolean => {
        if (!hotFeed) {
          if (!free(heaterOut)) return false;
          hotFeed = heaterInside ? dropLink(heaterOut, attrs('hotWater', 20)) : wallLink(heaterOut, attrs('hotWater', 20));
          if (!hotFeed) return false;
          if (!heaterInside) pipes++;
        }
        return connect(hotFeed, inNode.id, attrs('hotWater', 20));
      };
      const near = hotEntry ? hotEntry.eIn : { x: heaterOut.pos.x, y: heaterOut.pos.y };
      const inward = hotEntry ? { x: -hotEntry.n.x, y: -hotEntry.n.y } : { x: 1, y: 0 };
      const outs = headerOutlets('hotWaterHeader', targets.hotWater.length, near, inward, feedHot);
      const order = targets.hotWater.slice().sort((p, q) => dist2(p.end.pos, near) - dist2(q.end.pos, near));
      for (const t of order) {
        const out = outs.shift();
        if (!out) { notes.push('給湯ヘッダーの出口が足りず、つないでいない器具があります'); break; }
        if (connect(t.end.id, out.id, attrs('hotWater', 13))) connected.hot++;
        else { outs.unshift(out); notes.push(`${FIXTURE_CATALOG[cur.fixtures[t.fixtureId].type].label}の給湯への道が見つかりませんでした`); }
      }
    }
  }

  if (!newSegs.length && !headers) return { ...none(), notes };
  return { doc: { ...cur, network: assignAutoMaterials(cur.network, b, newSegs) }, pipes, headers, sleeves, crossings, connected, notes };
}
