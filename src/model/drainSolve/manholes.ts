/**
 * マスの自動配置（純関数）。建物の外の排水管に、決まりで必要な所へ自動でマス（params.auto）を置く:
 *  - 起点（基礎の外で地中へ立ち下げた所）・曲がり点・合流点・管径が変わる所
 *  - 公共ますの手前（管径の 60 倍以内）・直線部は管径の 120 倍（自治体の値）以内ごと
 * マスがある系統（公共ます・マスへつながっている）だけ。使う人が消した所（site.manholeSuppressed）には置かない。
 * 自動で置いたマスを使う人が動かしたら、そのマスは使う人のもの（auto を外す）。消したものは置き直さない。
 */
import type { Vec2 } from '../building';
import type { Doc } from '../doc';
import type { DrainRuleSet } from '../drainRules';
import { deleteFixture, isManhole, placeFixture, portNodes, type FixtureType } from '../fixtures';
import { mergeNodes, segmentsAt, splitSegment, type Segment, type Vec3 } from '../network';
import { isRiserLike, planLength } from '../slope';
import { insideBuilding, underfloorLevels } from '../underfloorSlope';
import { buildDrainTrees, type DrainTree } from './tree';

/** 曲がりとみなす角度（度） */
const BEND_DEG = 10;
/** 公共ますの手前のマス: 管径のこの倍数以内 */
const PUBLIC_TIMES = 60;
/** 公共ますの手前に置くときの、公共ますからの距離(mm) */
const PUBLIC_GAP = 1000;
/** 消した所とみなす距離(mm) */
const SUPPRESS_R = 300;
/** 既にあるマスからこれより近い所には置かない(mm)（排水をつなぐ案のマスと基礎の外の立ち下げの間など） */
const MIN_GAP = 1000;

/**
 * only: 編集で変わった点。渡すと、その点を含む系統だけに置く（開いただけの工事・関係ない系統には置かない）
 */
export function placeManholes(doc: Doc, rules: DrainRuleSet, only?: Set<string>): Doc {
  const lv = underfloorLevels(doc);
  if (!lv) return doc;
  // 配管を消して孤立した自動のマス（どの接続口にも配管が無い）は取り除く
  let base = doc;
  for (const f of Object.values(doc.fixtures)) {
    if (!isManhole(f.type) || !f.params?.auto) continue;
    if (portNodes(base.network, f.id).every((n) => segmentsAt(base.network, n.id).length === 0)) base = deleteFixture(base, f.id);
  }
  const suppressed = doc.site?.manholeSuppressed ?? [];
  let cur = base;
  const blocked = (p: Vec2) => suppressed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < SUPPRESS_R)
    || Object.values(cur.fixtures).some((f) => isManhole(f.type) && Math.hypot(f.x - p.x, f.y - p.y) < MIN_GAP);
  const fx = (d: Doc, id: string) => { const f = d.network.nodes[id]?.fixtureId; return f ? d.fixtures[f] : undefined; };
  const isMh = (d: Doc, id: string) => { const f = fx(d, id); return !!f && isManhole(f.type); };
  const outdoor = (d: Doc, id: string) => { const n = d.network.nodes[id]; return !!n && !n.fixtureId && !insideBuilding(lv, n.pos); };
  const typeFor = (d: Doc, t: DrainTree): FixtureType => { const f = fx(d, t.root); return f && (f.type === 'publicRain' || f.type === 'manholeRain') ? 'manholeRain' : 'manholeSewage'; };
  /** 点にマスを置き、その点を接続口にする。置けなければ元の doc */
  const placeAt = (d: Doc, nodeId: string, type: FixtureType): Doc => {
    const n = d.network.nodes[nodeId];
    if (!n || blocked(n.pos)) return d;
    const r = placeFixture(d, lv.floorId, type, { x: n.pos.x, y: n.pos.y }, 0, { auto: true, invertZ: n.pos.z });
    if (!r.fixtureId) return d;
    const port = portNodes(r.doc.network, r.fixtureId)[0];
    const merged = mergeNodes(r.doc.network, port.id, nodeId);
    return merged === r.doc.network || !merged.nodes[port.id] || merged.nodes[nodeId] ? d : { ...r.doc, network: merged };
  };
  const trees = () => buildDrainTrees(cur).filter((t) => isMh(cur, t.root) && (!only || t.order.some((id) => only.has(id))));

  // 1. 起点・曲がり・合流・管径が変わる所
  for (const t of trees()) {
    const children = new Map<string, Segment[]>();
    for (const [n, sid] of t.parent) {
      const s = cur.network.segments[sid];
      const p = s.a === n ? s.b : s.a;
      children.set(p, [...(children.get(p) ?? []), s]);
    }
    const need: string[] = [];
    for (const id of t.order) {
      if (id === t.root || !outdoor(cur, id)) continue;
      const net = cur.network;
      const down = net.segments[t.parent.get(id)!];
      const kids = children.get(id) ?? [];
      const flatKids = kids.filter((k) => !isRiserLike(net, k));
      const riserUp = kids.some((k) => isRiserLike(net, k) && net.nodes[k.a === id ? k.b : k.a].pos.z > net.nodes[id].pos.z);
      let bend = false, size = false;
      if (flatKids.length === 1 && !isRiserLike(net, down)) {
        const k = flatKids[0], p = net.nodes[down.a === id ? down.b : down.a].pos, q = net.nodes[k.a === id ? k.b : k.a].pos, o = net.nodes[id].pos;
        const a1 = Math.atan2(o.y - p.y, o.x - p.x), a2 = Math.atan2(q.y - o.y, q.x - o.x);
        let da = Math.abs(a1 - a2) * 180 / Math.PI;
        if (da > 180) da = 360 - da;
        bend = da > BEND_DEG;
        size = k.diameter !== down.diameter;
      }
      if (riserUp || flatKids.length >= 2 || bend || size) need.push(id);
    }
    const type = typeFor(cur, t);
    for (const id of need) cur = placeAt(cur, id, type);
  }

  // 2. 公共ますの手前・直線部の間隔: マスから上流へ、次のマス・建物の中・立て管までの屋外の区間ごと
  for (const t of trees()) {
    const net = cur.network;
    const children = new Map<string, string[]>();
    for (const [n, sid] of t.parent) { const s = net.segments[sid]; const p = s.a === n ? s.b : s.a; children.set(p, [...(children.get(p) ?? []), n]); }
    const inserts: Vec3[] = [];
    for (const m of t.order) {
      if (!isMh(cur, m)) continue;
      const publicRoot = m === t.root && /^public/.test(fx(cur, m)!.type);
      for (const first of children.get(m) ?? []) {
        // 上流へ 1 本道をたどる
        const pts: Vec3[] = [net.nodes[m].pos];
        let id = first, d = 100;
        for (;;) {
          const s = net.segments[t.parent.get(id)!];
          if (isRiserLike(net, s)) break;
          d = Math.max(d, s.diameter);
          const inside = !outdoor(cur, id) && !isMh(cur, id);
          pts.push(net.nodes[id].pos);
          const ks = children.get(id) ?? [];
          if (isMh(cur, id) || inside || ks.length !== 1) break;
          id = ks[0];
        }
        if (pts.length < 2) continue;
        const L = pts.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
        const at = (dist: number): Vec3 => {
          let acc = 0;
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.y - a.y);
            if (acc + l >= dist) { const u = (dist - acc) / l; return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u }; }
            acc += l;
          }
          return pts[pts.length - 1];
        };
        const marks: number[] = [];
        let start = 0;
        if (publicRoot && L > PUBLIC_TIMES * d) { marks.push(Math.min(PUBLIC_GAP, L / 2)); start = marks[0]; }
        const rest = L - start, span = rules.spacing(d);
        if (rest > span) { const k = Math.ceil(rest / span); for (let j = 1; j < k; j++) marks.push(start + (rest * j) / k); }
        for (const x of marks) inserts.push(at(x));
      }
    }
    const type = typeFor(cur, t);
    // 分けてよい区間: この系統の区間（分けたら新しい区間も足す）
    const treeSegs = new Set(t.parent.values());
    for (const p of inserts) {
      if (blocked(p)) continue;
      const seg = [...treeSegs].map((id) => cur.network.segments[id]).find((s) => {
        if (!s || planLength(cur.network, s) < 1) return false;
        const a = cur.network.nodes[s.a].pos, b = cur.network.nodes[s.b].pos;
        const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2, u = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2;
        return u > 0.001 && u < 0.999 && Math.hypot(a.x + (b.x - a.x) * u - p.x, a.y + (b.y - a.y) * u - p.y) < 1;
      });
      if (!seg) continue;
      const sp = splitSegment(cur.network, seg.id, p);
      const split = { ...cur, network: sp.net };
      const placed = placeAt(split, sp.nodeId, type);
      // 置けなければ分けたのも取りやめる
      if (placed !== split) { cur = placed; treeSegs.delete(seg.id); for (const id of sp.segmentIds) treeSegs.add(id); }
    }
  }
  return cur;
}
