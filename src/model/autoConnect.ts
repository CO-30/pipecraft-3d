/**
 * 「汚水・水・湯をまとめてつなぐ」: 器具の真下に落とす → 排水を外のマスへ → 屋外でマスどうし・公共汚水マスまで →
 * 給水・給湯を床下のヘッダーで（止水栓も）→ キッチン・洗面台に通気弁。純粋関数（画面は commit 1 回で入れる）。
 * 屋外の管の高さ・勾配・曲がりのマスは、いつもの排水の自動計算（solveDrain）が入れる。
 */
import type { Doc } from './doc';
import { dropFixturePipes } from './dropPipes';
import { routeDrainsOut, type DrainRules } from './drainRoute';
import { localToPlan, portNodes, type FixtureType } from './fixtures';
import { addPolyline, segmentsAt, splitSegment, type Network, type Vec3 } from './network';
import { routeSupplies } from './supplyRoute';
import { distToOutline, insideBuilding, underfloorLevels } from './underfloorSlope';

/** 汚水の系統のマス（雨水は別の系統なのでつながない） */
const SEWAGE_MANHOLES = new Set<FixtureType>(['manholeSewage', 'manholeInvert', 'manholeTrap']);
/** 屋外の管を外壁（芯）から離す距離 mm */
const YARD_CLEAR = 300;
const YARD_PIPE = { system: 'sewage' as const, diameter: 100, material: 'VU' };

const isDrainSys = (s: string) => s === 'drain' || s === 'sewage';

/** 排水・汚水の管でつながっている点ごとのまとまりの番号 */
function drainComponents(net: Network): Map<string, number> {
  const comp = new Map<string, number>();
  let k = 0;
  for (const start of Object.keys(net.nodes)) {
    if (comp.has(start)) continue;
    comp.set(start, ++k);
    const st = [start];
    while (st.length) {
      const n = st.pop()!;
      for (const s of segmentsAt(net, n)) {
        if (!isDrainSys(s.system)) continue;
        for (const m of [s.a, s.b]) if (!comp.has(m)) { comp.set(m, k); st.push(m); }
      }
    }
  }
  return comp;
}

export type YardResult = { doc: Doc; connected: number; pipes: number; notes: string[] };

/**
 * 屋外: 公共汚水マスにつながっていない汚水マス（のまとまり）を、つながっている所の一番近いものへ、
 * 直線か L 字（縦横）で建物の外を通してつなぐ。何度呼んでも増えない。
 */
export function connectYard(doc: Doc): YardResult {
  const notes: string[] = [];
  const pubs = Object.values(doc.fixtures).filter((f) => f.type === 'publicSewage');
  const holes = Object.values(doc.fixtures).filter((f) => SEWAGE_MANHOLES.has(f.type));
  if (!holes.length) return { doc, connected: 0, pipes: 0, notes };
  if (!pubs.length) return { doc, connected: 0, pipes: 0, notes: ['公共汚水マスが無いので、外のマスどうしはつないでいません（器具の「マス（排水）」から公共汚水マスを置いてください）'] };
  const lv = underfloorLevels(doc);
  /** 屋外の道として使えるか: 建物の中・外壁の近くを通らない（端のマスの近くは除く） */
  const legOk = (p: Vec3, q: Vec3, ends: Vec3[]) => {
    if (!lv || !lv.outline.length) return true;
    const L = Math.hypot(q.x - p.x, q.y - p.y), n = Math.max(1, Math.ceil(L / 100));
    for (let i = 0; i <= n; i++) {
      const x = { x: p.x + ((q.x - p.x) * i) / n, y: p.y + ((q.y - p.y) * i) / n };
      if (ends.some((e) => Math.hypot(e.x - x.x, e.y - x.y) < 400)) continue;
      if (insideBuilding(lv, x) || distToOutline(lv, x) < YARD_CLEAR) return false;
    }
    return true;
  };
  /** a → b の道（直線か L 字の 2 通り）のうち使える一番短いもの */
  const route = (a: Vec3, b: Vec3): Vec3[] | null => {
    const z = (a.z + b.z) / 2;
    const cands: Vec3[][] = [[a, b]];
    if (Math.abs(a.x - b.x) > 1 && Math.abs(a.y - b.y) > 1) cands.push([a, { x: b.x, y: a.y, z }, b], [a, { x: a.x, y: b.y, z }, b]);
    for (const c of cands) if (c.every((p, i) => i === 0 || legOk(c[i - 1], p, [a, b]))) return c;
    return null;
  };

  let net = doc.network;
  let comp = drainComponents(net);
  const portOf = (fid: string) => portNodes(net, fid)[0];
  const pubComps = new Set(pubs.map((f) => portOf(f.id)).filter(Boolean).map((p) => comp.get(p.id)!));
  let connected = 0, pipes = 0;
  for (;;) {
    const ports = holes.map((f) => portOf(f.id)).filter(Boolean);
    const linked = [...pubs.map((f) => portOf(f.id)).filter(Boolean), ...ports.filter((p) => pubComps.has(comp.get(p.id)!))];
    const loose = ports.filter((p) => !pubComps.has(comp.get(p.id)!));
    if (!loose.length) break;
    let best: { from: string; to: string; pts: Vec3[]; len: number } | null = null;
    for (const u of loose) for (const c of linked) {
      const pts = route(u.pos, c.pos);
      if (!pts) continue;
      const len = pts.reduce((a, p, i) => (i ? a + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
      if (!best || len < best.len - 1) best = { from: u.id, to: c.id, pts, len };
    }
    if (!best) { notes.push(`外の汚水マス ${loose.length} 個は、建物を避けて公共マスへつなぐ道が見つかりませんでした（配管の道具でつないでください）`); break; }
    const before = comp.get(best.from)!;
    const r = addPolyline(net, best.pts, YARD_PIPE, { startNodeId: best.from, endNodeId: best.to });
    net = r.net;
    pipes += r.segmentIds.length;
    connected += ports.filter((p) => comp.get(p.id) === before).length;
    comp = drainComponents(net);
    pubComps.clear();
    for (const f of pubs) { const p = portOf(f.id); if (p) pubComps.add(comp.get(p.id)!); }
  }
  return { doc: net === doc.network ? doc : { ...doc, network: net }, connected, pipes, notes };
}

/** 通気弁を付ける器具（キャビネットの中に付けられるもの） */
const VENT_FIXTURES = new Set<FixtureType>(['kitchen', 'washbasin']);
/** トラップから 300mm 以内（メーカーの施工説明）: 排水口から下へ 150mm にチーズ、横へ 100mm・上へ 300mm で通気弁 */
const VENT_TEE = 150, VENT_OUT = 100, VENT_UP = 300;

/** キッチン・洗面台の排水口の下に通気弁。もう付いていれば足さない */
export function addVentValves(doc: Doc): { doc: Doc; valves: number } {
  let net = doc.network;
  let valves = 0;
  for (const f of Object.values(doc.fixtures)) {
    if (!VENT_FIXTURES.has(f.type)) continue;
    const port = portNodes(net, f.id).find((n) => n.portId === 'drain');
    const seg = port && segmentsAt(net, port.id)[0];
    if (!port || !seg) continue;
    // もう通気の管がついている（排水口から 2 つ先まで）
    const near = new Set([port.id]);
    for (let i = 0; i < 2; i++) for (const n of [...near]) for (const s of segmentsAt(net, n)) { near.add(s.a); near.add(s.b); }
    if ([...near].some((n) => segmentsAt(net, n).some((s) => s.system === 'vent'))) continue;
    const o = net.nodes[seg.a === port.id ? seg.b : seg.a];
    const L = Math.hypot(o.pos.x - port.pos.x, o.pos.y - port.pos.y, o.pos.z - port.pos.z);
    if (L < 40) continue;
    const t = Math.min(VENT_TEE, L / 2) / L;
    const at = { x: port.pos.x + (o.pos.x - port.pos.x) * t, y: port.pos.y + (o.pos.y - port.pos.y) * t, z: port.pos.z + (o.pos.z - port.pos.z) * t };
    const sp = splitSegment(net, seg.id, at);
    const tee = sp.net.nodes[sp.nodeId].pos;
    // 器具の右（器具の向きの +x）へ出す
    const p0 = localToPlan(f, 0, 0), p1 = localToPlan(f, 1, 0);
    const d = { x: p1.x - p0.x, y: p1.y - p0.y };
    const side = { x: tee.x + d.x * VENT_OUT, y: tee.y + d.y * VENT_OUT, z: tee.z };
    const r = addPolyline(sp.net, [tee, side, { ...side, z: side.z + VENT_UP }], { system: 'vent', diameter: seg.diameter, material: seg.material }, { startNodeId: sp.nodeId });
    const top = r.nodeIds[r.nodeIds.length - 1];
    net = { ...r.net, nodes: { ...r.net.nodes, [top]: { ...r.net.nodes[top], fitting: { type: 'aav', degree: 1 } } } };
    valves++;
  }
  return { doc: valves ? { ...doc, network: net } : doc, valves };
}

export type AutoConnectResult = {
  doc: Doc;
  dropped: number; drains: number; newManholes: number; yard: number; supplies: number; headers: number; valves: number; vents: number;
  /** 画面に出す知らせ（順に） */
  summary: string[];
};

/** まとめてつなぐ（1〜5）。何度呼んでも増えない */
export function autoConnect(doc: Doc, opts: { drainRules?: DrainRules; burial?: number } = {}): AutoConnectResult {
  const summary: string[] = [];
  const d1 = dropFixturePipes(doc);
  const d2 = routeDrainsOut(d1.doc, undefined, opts.drainRules ?? {});
  const d3 = connectYard(d2.doc);
  const s = routeSupplies(d3.doc, opts.burial !== undefined ? { burial: opts.burial } : {});
  const d4 = s.error ? d3.doc : s.doc;
  const v = addVentValves(d4);
  if (d1.pipes) summary.push(`器具の真下に配管を ${d1.pipes} 本落としました`);
  if (d2.pipes) summary.push(`排水 ${d2.pipes} 本を床下から外の汚水マスへ出しました${d2.manholes ? `（マスを新しく ${d2.manholes} 個）` : ''}${d2.sleeves ? `・基礎の貫通 ${d2.sleeves} か所` : ''}`);
  if (d2.skipped) summary.push(`排水 ${d2.skipped} 本は外へ出す出口を決められませんでした`);
  if (d3.connected) summary.push(`外の汚水マス ${d3.connected} 個を公共汚水マスまでつなぎました（勾配・曲がりのマスは自動）`);
  summary.push(...d3.notes);
  if (s.error) summary.push(`給水・給湯: ${s.error}`);
  else if (s.pipes || s.headers) summary.push(`給水 ${s.connected.water} 本・給湯 ${s.connected.hot} 本をヘッダーでつなぎました${s.headers ? `（ヘッダーを ${s.headers} 台）` : ''}${s.valves ? `・止水栓 ${s.valves} 個` : ''}`);
  if (!s.error) summary.push(...s.notes);
  if (v.valves) summary.push(`通気弁を ${v.valves} 個（キッチン・洗面台の排水口の下）`);
  return {
    doc: v.doc,
    dropped: d1.pipes, drains: d2.pipes, newManholes: d2.manholes, yard: d3.connected,
    supplies: s.error ? 0 : s.pipes, headers: s.error ? 0 : s.headers, valves: s.error ? 0 : s.valves, vents: v.valves,
    summary,
  };
}
