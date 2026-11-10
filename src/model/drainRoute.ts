/**
 * 排水のつなぎ案: 床下へ落とした排水・汚水の配管（器具から真下へ落とした立て管の、空いている下の端）を、
 * 基礎の中を通していちばん出しやすい外壁の外へ出し、そこに汚水マスを置いてつなぐ。純粋関数。
 *  - 出口は「壁へ直角に出た先が建物の外（マスの周りと、その先に壁も基礎も無い）」の中から、距離と基礎の貫通の少なさで選ぶ
 *  - 近い出口どうしは 1 つのマスにまとめる（先につないだ配管に合流させる）。外壁の外に置いてあるマスが近ければそれを使う
 *  - 配管は 床下を水平に → マスの真上 → 立ち下げてマスへ。勾配と桝どうしの接続は使う人が決める（案なので）
 */
import type { Vec2 } from './building';
import { wallsOnFloor } from './building';
import type { Doc } from './doc';
import { isManhole, moveFixture, placeFixture, portNodes } from './fixtures';
import { membersOf } from './members';
import { addPolyline, connectNodeToSegment, segmentsAt, splitSegment, type PipeNode, type Segment, type Vec3 } from './network';

/** 外壁の芯からマスの中心までの距離の初期値(mm) */
export const MANHOLE_OFFSET = 700;
/** これより近い出口は 1 つのマスにまとめる(mm) */
export const MERGE_MM = 1000;
/** マスの周りに空けておく幅（マスの半径 + 余裕）(mm) */
const CLEAR = 200;
/** 新しいマスの管底を、床下の配管よりこれだけ下にする（標準の管底 GL−600 の方が浅いとき）(mm) */
const INVERT_BELOW = 300;
/** 基礎の立上りを 1 か所余分に貫通することを、配管何 mm 分の遠回りと同じとみるか */
const SLEEVE_COST = 2500;
const FAR = 100_000;

export type DrainRouteResult = { doc: Doc; pipes: number; manholes: number; sleeves: number; skipped: number };

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

export function routeDrainsOut(doc: Doc, offset = MANHOLE_OFFSET): DrainRouteResult {
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

  /** 出口: wall の外の m へ、向き n（壁に直角・外向き）。foot は壁芯の上の点 */
  type Exit = { wall: Line; foot: Vec2; m: Vec2; n: Vec2; cost: number };
  const exitFor = (p: Vec3): Exit | null => {
    if (!inside(p)) return null;
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
      if (!clearAt(m, n)) continue;
      // 途中で別の外壁を横切る道（凹んだ所をまたいで外を通る）は採らない
      if (walls.some((k) => k !== w && k.exterior && crosses(p, foot, k.a, k.b))) continue;
      const cost = d + SLEEVE_COST * Math.max(0, sleevesOn(p, m, p.z) - 1);
      if (!best || cost < best.cost) best = { wall: w, foot, m, n, cost };
    }
    return best;
  };

  let cur: Doc = doc;
  let pipes = 0, manholes = 0, sleeves = 0, skipped = 0;
  type Hole = { id: string; x: number; y: number };
  const holes: Hole[] = Object.values(doc.fixtures)
    .filter((f) => isManhole(f.type) && f.type !== 'manholeRain' && f.type !== 'publicRain').map((f) => ({ id: f.id, x: f.x, y: f.y }));
  /** この出口で使えるマス: 出口の壁の外側にあり、出口から MERGE_MM 以内で、その位置に置けることを確かめたもの。近い順 */
  const holeFor = (e: Exit): Hole | undefined => holes
    .map((h) => ({ h, out: (h.x - e.foot.x) * e.n.x + (h.y - e.foot.y) * e.n.y, d: Math.hypot(h.x - e.m.x, h.y - e.m.y) }))
    .filter((c) => c.d <= MERGE_MM && c.out >= e.wall.t / 2 + CLEAR && clearAt({ x: c.h.x, y: c.h.y }, e.n))
    .sort((p, q) => p.d - q.d)[0]?.h;

  // 壁に近い端から順に（まとめるマスの位置が、いちばん素直に出せる器具で決まるように）
  const plan = ends.map((e) => ({ ...e, exit: exitFor(e.node.pos) })).sort((p, q) => (p.exit?.cost ?? Infinity) - (q.exit?.cost ?? Infinity));
  for (const e of plan) {
    const exit = e.exit;
    if (!exit) { skipped++; continue; }
    const p = e.node.pos, n = exit.n;
    const attrs = { system: e.seg.system, diameter: e.seg.diameter, ...(e.seg.material ? { material: e.seg.material } : {}) };
    let hole = holeFor(exit);
    // マスを置いても配管をつなげなければ、マスごと取りやめる（next を採用しない）
    let next = cur, placed = false;
    if (!hole) {
      const r = placeFixture(cur, base.id, 'manholeSewage', { x: Math.round(exit.m.x), y: Math.round(exit.m.y) });
      if (!r.fixtureId) { skipped++; continue; }
      next = r.doc;
      hole = { id: r.fixtureId, x: Math.round(exit.m.x), y: Math.round(exit.m.y) };
      placed = true;
      // 標準の管底（GL−600）が床下の配管より浅ければ、配管より下げる
      const z0 = portNodes(next.network, hole.id)[0]?.pos.z;
      if (z0 !== undefined && p.z - z0 < 100) next = moveFixture(next, hole.id, { x: hole.x, y: hole.y }, undefined, { invertZ: Math.round(p.z - INVERT_BELOW) });
    }
    const port = portNodes(next.network, hole.id)[0];
    if (!port || p.z - port.pos.z < 10) { skipped++; continue; } // 置いてあるマスの管底が、床下の配管より高い
    const top = { x: hole.x, y: hole.y, z: p.z };
    // 壁に平行にマスの線（マスを通って壁に直角な線）まで寄った点
    const along = (hole.x - p.x) * -n.y + (hole.y - p.y) * n.x;
    const q: Vec3 = { x: p.x + -n.y * along, y: p.y + n.x * along, z: p.z };
    const shifted = Math.abs(along) > 1;
    const flat = shifted ? [p, q] : [p];
    // そのマスへ先につないだ配管があれば合流する（同じ所に配管を重ねない）
    let net = next.network, endId = port.id, pts: Vec3[] = [...flat, top, port.pos];
    const trunk = segmentsAt(net, port.id).map((s) => net.nodes[s.a === port.id ? s.b : s.a]).find((t) => Math.hypot(t.pos.x - top.x, t.pos.y - top.y) < 1 && t.pos.z > port.pos.z);
    let joined = false;
    if (trunk) {
      if (Math.abs(trunk.pos.z - p.z) > 1) { skipped++; continue; } // 落とした深さが違う配管どうしは自動ではまとめない
      const depth = (v: Vec3) => (v.x - top.x) * n.x + (v.y - top.y) * n.y; // マスの真上から外向きを正（建物の奥ほど小さい）
      const flatAt = (v: Vec3) => Math.abs(v.z - p.z) < 1;
      // 先の配管を、マスの真上から建物の奥へたどる（マスの線の上の水平な区間だけ）
      const line: PipeNode[] = [trunk];
      for (;;) {
        const at = line[line.length - 1];
        const nx = segmentsAt(net, at.id).map((sg) => net.nodes[sg.a === at.id ? sg.b : sg.a])
          .find((t) => flatAt(t.pos) && Math.abs((t.pos.x - top.x) * -n.y + (t.pos.y - top.y) * n.x) < 1 && depth(t.pos) < depth(at.pos) - 1);
        if (!nx) break;
        line.push(nx);
      }
      const hit = line.find((t) => Math.hypot(t.pos.x - q.x, t.pos.y - q.y) < 1);
      const k = line.findIndex((t) => depth(t.pos) < depth(q));
      if (hit) {
        // q が先の配管の点の上: その点へ
        if (!shifted) { skipped++; continue; }
        endId = hit.id; pts = [p, hit.pos];
      } else if (k > 0) {
        // q が先の配管の途中: その区間へ合流（チーズ）
        const sg = segmentsAt(net, line[k].id).find((x) => x.a === line[k - 1].id || x.b === line[k - 1].id)!;
        if (shifted) {
          const sp = splitSegment(net, sg.id, q);
          net = sp.net; endId = sp.nodeId; pts = [p, q];
        } else {
          // 落とした端が先の配管の真上にある: 端をその区間につなぐ
          const merged = connectNodeToSegment(net, e.node.id, sg.id);
          if (merged === net) { skipped++; continue; }
          net = merged; joined = true;
        }
      } else {
        // q が先の配管より奥: いちばん奥の端へつなぐ
        const inner = line[line.length - 1];
        endId = inner.id; pts = [...flat, inner.pos];
      }
    }
    let drawn: Vec3[] = [];
    if (joined) cur = { ...next, network: net };
    else {
      const r = addPolyline(net, pts, attrs, { startNodeId: e.node.id, endNodeId: endId });
      if (!r.segmentIds.length) { skipped++; continue; }
      cur = { ...next, network: r.net };
      // 新しく引いた水平の区間（マスへ立ち下げる縦の区間は除く）
      drawn = trunk ? pts : pts.slice(0, -1);
    }
    if (placed) { holes.push(hole); manholes++; }
    pipes++;
    // 貫通の数: この配管で新しく引いた水平の区間が横切る立上り（合流した先の区間は、先の配管で数えている）
    for (let i = 1; i < drawn.length; i++) sleeves += sleevesOn(drawn[i - 1], drawn[i], p.z);
  }
  return pipes ? { doc: cur, pipes, manholes, sleeves, skipped } : { ...none, skipped };
}
