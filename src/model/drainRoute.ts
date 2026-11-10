/**
 * 排水のつなぎ案: 床下へ落とした排水・汚水の配管（下の端が空いているもの）を、基礎の中を通して
 * いちばん出しやすい外壁の外へ出し、そこに汚水マスを置いてつなぐ。純粋関数。
 *  - 出口は「壁へ直角に出た先が建物の外（その先に壁も基礎も無い）」の中から、距離と基礎の貫通の少なさで選ぶ
 *  - 近い出口どうしは 1 つのマスにまとめる。近くに置いてあるマスがあればそれを使う
 *  - 配管は 床下を水平に → マスの真上 → 立ち下げてマスへ。勾配と桝どうしの接続は使う人が決める（案なので）
 */
import type { Vec2 } from './building';
import { wallsOnFloor } from './building';
import type { Doc } from './doc';
import { isManhole, placeFixture, portNodes } from './fixtures';
import { membersOf } from './members';
import { addPolyline, segmentsAt, type Network, type PipeNode, type Segment, type Vec3 } from './network';

/** 外壁の芯からマスの中心までの距離の初期値(mm) */
export const MANHOLE_OFFSET = 700;
/** これより近い出口は 1 つのマスにまとめる(mm) */
export const MERGE_MM = 1000;
/** 基礎の立上りを 1 か所余分に貫通することを、配管何 mm 分の遠回りと同じとみるか */
const SLEEVE_COST = 2500;
const FAR = 100_000;

export type DrainRouteResult = { doc: Doc; pipes: number; manholes: number; sleeves: number; skipped: number };

type Line = { a: Vec2; b: Vec2; t: number };

/** 線分 p→q と a→b が交わるか（端が触れるだけは数えない） */
function crosses(p: Vec2, q: Vec2, a: Vec2, b: Vec2): boolean {
  const d = (q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x);
  if (Math.abs(d) < 1e-9) return false;
  const s = ((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)) / d;
  const u = ((a.x - p.x) * (q.y - p.y) - (a.y - p.y) * (q.x - p.x)) / d;
  return s > 1e-6 && s < 1 - 1e-6 && u >= 0 && u <= 1;
}

/** 床下に落とした排水・汚水の配管の、空いている下の端 */
export function openDrainEnds(doc: Doc): { node: PipeNode; seg: Segment }[] {
  const net = doc.network, base = doc.building.floors[0];
  if (!base) return [];
  const out: { node: PipeNode; seg: Segment }[] = [];
  for (const n of Object.values(net.nodes)) {
    if (n.fixtureId || n.pos.z >= base.elevation) continue;
    const segs = segmentsAt(net, n.id);
    if (segs.length !== 1 || (segs[0].system !== 'drain' && segs[0].system !== 'sewage')) continue;
    const o = net.nodes[segs[0].a === n.id ? segs[0].b : segs[0].a];
    // 立て管の下の端だけ（横に引いた配管の端は、使う人が途中まで描いたものかもしれない）
    if (Math.hypot(o.pos.x - n.pos.x, o.pos.y - n.pos.y) > 1 || o.pos.z <= n.pos.z) continue;
    out.push({ node: n, seg: segs[0] });
  }
  return out;
}

export function routeDrainsOut(doc: Doc, offset = MANHOLE_OFFSET): DrainRouteResult {
  const none: DrainRouteResult = { doc, pipes: 0, manholes: 0, sleeves: 0, skipped: 0 };
  const base = doc.building.floors[0];
  const ends = openDrainEnds(doc);
  if (!base || !ends.length) return none;
  const b = doc.building;
  const walls: Line[] = wallsOnFloor(b, base.id).map((w) => ({ a: b.corners[w.a], b: b.corners[w.b], t: w.thickness }));
  const footings = membersOf(b).filter((m) => m.kind === 'footing' && m.floorId === base.id);
  const footLines: (Line & { z0: number; z1: number })[] = footings.map((m) => ({ a: m.a, b: m.b, t: m.width, z0: base.elevation + m.z0, z1: base.elevation + m.z1 }));
  const blockers: Line[] = [...walls, ...footLines];
  /** 水平の区間 p→q（高さ z）が貫通する立上りの数 */
  const sleevesOn = (p: Vec2, q: Vec2, z: number) => footLines.filter((f) => z > f.z0 && z < f.z1 && crosses(p, q, f.a, f.b)).length;

  type Exit = { m: Vec2; n: Vec2; cost: number };
  const exitFor = (p: Vec3): Exit | null => {
    let best: Exit | null = null;
    for (const w of walls) {
      const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (L < 1) continue;
      const u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
      const s = (p.x - w.a.x) * u.x + (p.y - w.a.y) * u.y;
      if (s < 0 || s > L) continue; // 壁へ直角に出られる位置だけ
      const foot = { x: w.a.x + u.x * s, y: w.a.y + u.y * s };
      const d = Math.hypot(foot.x - p.x, foot.y - p.y);
      if (d < 1) continue;
      const n = { x: (foot.x - p.x) / d, y: (foot.y - p.y) / d };
      const m = { x: foot.x + n.x * (w.t / 2 + offset), y: foot.y + n.y * (w.t / 2 + offset) };
      // マスの位置から先に壁も基礎も無い = 建物の外
      const beyond = { x: m.x + n.x * FAR, y: m.y + n.y * FAR };
      const start = { x: foot.x + n.x * (w.t / 2 + 1), y: foot.y + n.y * (w.t / 2 + 1) };
      if (blockers.some((k) => crosses(start, beyond, k.a, k.b))) continue;
      const cost = d + SLEEVE_COST * Math.max(0, sleevesOn(p, m, p.z) - 1);
      if (!best || cost < best.cost) best = { m, n, cost };
    }
    return best;
  };

  let cur: Doc = doc;
  let pipes = 0, manholes = 0, sleeves = 0, skipped = 0;
  /** この操作で使うマス（既にあるもの・新しく置いたもの） */
  const used: { id: string; x: number; y: number }[] = Object.values(doc.fixtures)
    .filter((f) => isManhole(f.type) && f.type !== 'manholeRain' && f.type !== 'publicRain').map((f) => ({ id: f.id, x: f.x, y: f.y }));
  // 壁に近い端から順に（まとめるマスの位置が、いちばん素直に出せる器具で決まるように）
  const plan = ends.map((e) => ({ ...e, exit: exitFor(e.node.pos) })).sort((p, q) => (p.exit?.cost ?? Infinity) - (q.exit?.cost ?? Infinity));
  for (const e of plan) {
    if (!e.exit) { skipped++; continue; }
    const p = e.node.pos;
    let hole = used.find((h) => Math.hypot(h.x - e.exit!.m.x, h.y - e.exit!.m.y) <= MERGE_MM);
    // マスを置いても配管をつなげなければ、マスごと取りやめる（next を採用しない）
    let next = cur, placed = false;
    if (!hole) {
      const r = placeFixture(cur, base.id, 'manholeSewage', { x: Math.round(e.exit.m.x), y: Math.round(e.exit.m.y) });
      if (!r.fixtureId) { skipped++; continue; }
      next = r.doc;
      hole = { id: r.fixtureId, x: Math.round(e.exit.m.x), y: Math.round(e.exit.m.y) };
      placed = true;
    }
    const port = portNodes(next.network, hole.id)[0];
    if (!port || p.z - port.pos.z < 10) { skipped++; continue; } // 床下の配管がマスの管底より低い
    // 床下を水平に: まず壁に平行にマスの線まで寄り（まとめたマスのとき）、壁へ直角に出て、マスの真上から立ち下げる
    const n = e.exit.n;
    const along = (hole.x - p.x) * -n.y + (hole.y - p.y) * n.x;
    const pts: Vec3[] = [p];
    if (Math.abs(along) > 1) pts.push({ x: p.x + -n.y * along, y: p.y + n.x * along, z: p.z });
    pts.push({ x: hole.x, y: hole.y, z: p.z }, port.pos);
    const net: Network = next.network;
    const r = addPolyline(net, pts, { system: e.seg.system, diameter: e.seg.diameter, ...(e.seg.material ? { material: e.seg.material } : {}) }, { startNodeId: e.node.id, endNodeId: port.id });
    if (!r.segmentIds.length) { skipped++; continue; }
    cur = { ...next, network: r.net };
    if (placed) { used.push(hole); manholes++; }
    pipes++;
    for (let i = 1; i < pts.length - 1; i++) sleeves += sleevesOn(pts[i - 1], pts[i], p.z);
  }
  return pipes ? { doc: cur, pipes, manholes, sleeves, skipped } : { ...none, skipped };
}
