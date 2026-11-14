/**
 * 「汚水・水・湯をまとめてつなぐ」: 器具の真下に落とす → 排水を外のマスへ → 屋外でマスどうし・公共汚水マスまで →
 * 給水・給湯を床下のヘッダーで（止水栓も）→ キッチン・洗面台に通気弁。純粋関数（画面は commit 1 回で入れる）。
 * 屋外の管の高さ・勾配・曲がりのマスは、いつもの排水の自動計算（solveDrain）が入れる。
 */
import type { Doc } from './doc';
import { dropFixturePipes } from './dropPipes';
import type { DrainRules } from './drainRoute';
import { routeDrainMain } from './drainMain';
import { localToPlan, portNodes, type FixtureType } from './fixtures';
import { addPolyline, segmentsAt, splitSegment, type Network, type Vec3 } from './network';
import { closestPoints } from './clash';
import { routeSupplies, type HeaderMode } from './supplyRoute';
import { headerQuestion, type Question } from './question';
import { makeYardRouter } from './yardRoute';

/** 汚水の系統のマス（雨水は別の系統なのでつながない） */
const SEWAGE_MANHOLES = new Set<FixtureType>(['manholeSewage', 'manholeInvert', 'manholeTrap']);
const RAIN = new Set<FixtureType>(['manholeRain', 'publicRain']);
/** 管種は付けない（屋外の管の自動の管種を、画面の側で付ける） */
const YARD_PIPE = { system: 'sewage' as const, diameter: 100 };

const isDrainSys = (s: string) => s === 'drain' || s === 'sewage';

/** 排水・汚水の管でつながっている点ごとのまとまりの番号（隣の表を 1 回作る） */
function drainComponents(net: Network): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const s of Object.values(net.segments)) {
    if (!isDrainSys(s.system)) continue;
    (adj.get(s.a) ?? adj.set(s.a, []).get(s.a)!).push(s.b);
    (adj.get(s.b) ?? adj.set(s.b, []).get(s.b)!).push(s.a);
  }
  const comp = new Map<string, number>();
  let k = 0;
  for (const start of Object.keys(net.nodes)) {
    if (comp.has(start)) continue;
    comp.set(start, ++k);
    const st = [start];
    while (st.length) for (const m of adj.get(st.pop()!) ?? []) if (!comp.has(m)) { comp.set(m, k); st.push(m); }
  }
  return comp;
}


export type YardResult = { doc: Doc; connected: number; pipes: number; notes: string[] };

/**
 * 屋外: 公共汚水マスにつながっていない汚水マス（のまとまり）を、つながっている所の一番近いものへ、
 * 直線・L 字・建物の周りを回る道（縦横）で建物の外を通してつなぐ。何度呼んでも増えない。
 */
export function connectYard(doc: Doc): YardResult {
  const pubs = Object.values(doc.fixtures).filter((f) => f.type === 'publicSewage');
  const holes = Object.values(doc.fixtures).filter((f) => SEWAGE_MANHOLES.has(f.type));
  if (!holes.length) return { doc, connected: 0, pipes: 0, notes: [] };
  if (!pubs.length) return { doc, connected: 0, pipes: 0, notes: ['公共汚水マスが無いので、外のマスどうしはつないでいません（器具の「マス（排水）」から公共汚水マスを置いてください）'] };
  const notes: string[] = [];
  const route = makeYardRouter(doc);
  let net = doc.network;
  const portOf = (fid: string) => portNodes(net, fid)[0];
  let connected = 0, pipes = 0;
  const bad = new Set<string>();
  for (let guard = 0; guard < holes.length * 3 + 3; guard++) {
    const comp = drainComponents(net);
    const pubComps = new Set(pubs.map((f) => portOf(f.id)).filter(Boolean).map((p) => comp.get(p.id)!));
    // 雨水マス・公共雨水マスとつながったまとまりは雨水の系統（汚水へつながない）
    const rainComps = new Set(Object.values(doc.fixtures).filter((f) => RAIN.has(f.type)).map((f) => portOf(f.id)).filter(Boolean).map((p) => comp.get(p.id)!));
    const ports = holes.map((f) => portOf(f.id)).filter(Boolean);
    const linked = [...pubs.map((f) => portOf(f.id)).filter(Boolean), ...ports.filter((p) => pubComps.has(comp.get(p.id)!))];
    const loose = ports.filter((p) => !pubComps.has(comp.get(p.id)!) && !rainComps.has(comp.get(p.id)!));
    if (!loose.length) break;
    let best: { from: string; to: string; pts: Vec3[]; len: number } | null = null;
    for (const u of loose) for (const c of linked) {
      if (bad.has(`${u.id}|${c.id}`)) continue;
      if (Math.hypot(u.pos.x - c.pos.x, u.pos.y - c.pos.y) < 1) { bad.add(`${u.id}|${c.id}`); continue; }
      const pts = route(u.pos, c.pos);
      if (!pts) { bad.add(`${u.id}|${c.id}`); continue; }
      const len = pts.reduce((a, p, i) => (i ? a + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
      if (!best || len < best.len - 1) best = { from: u.id, to: c.id, pts, len };
    }
    if (!best) { notes.push(`外の汚水マス ${loose.length} 個は、建物を避けて公共マスへつなぐ道が見つかりませんでした（配管の道具でつないでください）`); break; }
    const before = comp.get(best.from)!;
    const r = addPolyline(net, best.pts, YARD_PIPE, { startNodeId: best.from, endNodeId: best.to });
    if (!r.segmentIds.length) { bad.add(`${best.from}|${best.to}`); continue; }
    net = r.net;
    pipes += r.segmentIds.length;
    connected += ports.filter((p) => comp.get(p.id) === before).length;
  }
  return { doc: net === doc.network ? doc : { ...doc, network: net }, connected, pipes, notes };
}

/** 通気弁を付ける器具（キャビネットの中に付けられるもの） */
const VENT_FIXTURES = new Set<FixtureType>(['kitchen', 'washbasin']);
/** トラップから 300mm 以内（メーカーの施工説明）: 排水口から下へ 150mm にチーズ、横へ出して上へ 300mm で通気弁 */
const VENT_TEE = 150, VENT_UP = 300;
/** 横へ出す長さの候補と、ほかの管・接続口から離す距離（管の芯どうし） */
const VENT_OUTS = [100, 150, 200], VENT_GAP = 80;

/** 線分 p-q と点 r の距離（3D） */
const pointSeg3 = (r: Vec3, p: Vec3, q: Vec3) => closestPoints(p, q, r, { ...r, x: r.x + 1e-6 }).dist;

/**
 * キッチン・洗面台の排水口の下に通気弁。排水が外へつながっている（落とした立て管の下が続いている）ときだけ。
 * 横へ出す向きは、給水・給湯の管や接続口に重ならない向きを選ぶ。もう付いていれば足さない
 */
export function addVentValves(doc: Doc): { doc: Doc; valves: number; notes: string[] } {
  let net = doc.network;
  let valves = 0;
  const notes: string[] = [];
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
    // 外へつながっていない排水は、あとで「排水を外の桝までつなぐ」が落とした立て管を見つけられるよう、そのままにする
    if (segmentsAt(net, o.id).length < 2) { notes.push(`${f.type === 'kitchen' ? 'キッチン' : '洗面台'}の排水がまだ外へつながっていないので、通気弁は付けていません`); continue; }
    const L = Math.hypot(o.pos.x - port.pos.x, o.pos.y - port.pos.y, o.pos.z - port.pos.z);
    if (L < 40) continue;
    const t = Math.min(VENT_TEE, L / 2) / L;
    const at = { x: port.pos.x + (o.pos.x - port.pos.x) * t, y: port.pos.y + (o.pos.y - port.pos.y) * t, z: port.pos.z + (o.pos.z - port.pos.z) * t };
    // 横へ出す向き: 器具の右・左・奥・手前の順に、給水・給湯などの管と接続口から VENT_GAP 以上離れる所
    const p0 = localToPlan(f, 0, 0);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => { const q = localToPlan(f, dx, dy); return { x: q.x - p0.x, y: q.y - p0.y }; });
    const others = Object.values(net.segments).filter((s) => s.id !== seg.id);
    const otherPorts = portNodes(net, f.id).filter((n) => n.id !== port.id).map((n) => n.pos);
    let path: Vec3[] | null = null;
    for (const out of VENT_OUTS) {
      for (const d of dirs) {
        const side = { x: at.x + d.x * out, y: at.y + d.y * out, z: at.z };
        const top = { ...side, z: side.z + VENT_UP };
        const legs: [Vec3, Vec3][] = [[{ x: at.x + d.x * 40, y: at.y + d.y * 40, z: at.z }, side], [side, top]];
        const clear = legs.every(([a, c]) => others.every((s) => closestPoints(a, c, net.nodes[s.a].pos, net.nodes[s.b].pos).dist >= VENT_GAP)
          && otherPorts.every((r) => pointSeg3(r, a, c) >= VENT_GAP));
        if (clear) { path = [at, side, top]; break; }
      }
      if (path) break;
    }
    if (!path) { notes.push(`${f.type === 'kitchen' ? 'キッチン' : '洗面台'}の通気弁は、ほかの管と重ならない向きが無いので付けていません`); continue; }
    const sp = splitSegment(net, seg.id, at);
    const r = addPolyline(sp.net, [sp.net.nodes[sp.nodeId].pos, path[1], path[2]], { system: 'vent', diameter: seg.diameter, material: seg.material }, { startNodeId: sp.nodeId });
    const top = r.nodeIds[r.nodeIds.length - 1];
    // チーズは排水と通気の分岐（部品は確定。積算の要確認にしない）、先は通気弁
    net = { ...r.net, nodes: { ...r.net.nodes, [sp.nodeId]: { ...r.net.nodes[sp.nodeId], fitting: { type: 'tee', degree: 3 } }, [top]: { ...r.net.nodes[top], fitting: { type: 'aav', degree: 1 } } } };
    valves++;
  }
  return { doc: valves ? { ...doc, network: net } : doc, valves, notes };
}

export type AutoConnectResult = {
  doc: Doc;
  dropped: number; drains: number; newManholes: number; yard: number; supplies: number; headers: number; valves: number; vents: number;
  /** 画面に出す知らせ（順に） */
  summary: string[];
  /** 使う人に聞くこと（ヘッダーを置くか など）。無ければ空 */
  questions: Question[];
};

/** まとめてつなぐ（1〜5）。何度呼んでも増えない */
export function autoConnect(doc: Doc, opts: { drainRules?: DrainRules; burial?: number; dropDepth?: number; headers?: HeaderMode } = {}): AutoConnectResult {
  // headers: 'avoid' を渡すと従来の形（ヘッダーを足さず分岐でつなぎ、通せない所があるときだけ聞く）
  // 給水・給湯は初期設定でヘッダー工法（2026-11-14 ユーザー指定: 実際の工事に多い、器具ごとに PB を引く形）
  const headers = opts.headers ?? 'use';
  const summary: string[] = [];
  const d1 = dropFixturePipes(doc, opts.dropDepth);
  // 床下は φ100 の本管にまとめ、公共マスに近い側から 1 か所で外へ（外のマスはその出口から）
  const d2 = routeDrainMain(d1.doc, opts.drainRules ?? {});
  const d3 = connectYard(d2.doc);
  const s = routeSupplies(d3.doc, { headers, ...(opts.burial !== undefined ? { burial: opts.burial } : {}) });
  const d4 = s.error ? d3.doc : s.doc;
  const v = addVentValves(d4);
  if (d1.pipes) summary.push(`器具の真下に配管を ${d1.pipes} 本落としました`);
  if ((d2.main === 'new' || d2.main === 'joined') && d2.notes.length) summary.push(`${d2.notes.join('。')}${d2.manholes ? `（マスを新しく ${d2.manholes} 個）` : ''}${d2.sleeves ? `・基礎の貫通 ${d2.sleeves} か所` : ''}`);
  else if (d2.pipes) summary.push(`排水 ${d2.pipes} 本を床下から外の汚水マスへ出しました${d2.manholes ? `（マスを新しく ${d2.manholes} 個）` : ''}${d2.sleeves ? `・基礎の貫通 ${d2.sleeves} か所` : ''}`, ...d2.notes);
  if (d2.skipped) summary.push(`排水 ${d2.skipped} 本は外へ出す出口を決められませんでした`);
  if (d3.connected) summary.push(`外の汚水マス ${d3.connected} 個を公共汚水マスまでつなぎました（勾配・曲がりのマスは自動）`);
  summary.push(...d3.notes);
  if (s.error) summary.push(`給水・給湯: ${s.error}`);
  else if (s.pipes || s.headers) {
    const how = s.headers ? `ヘッダーでつなぎました（ヘッダーを ${s.headers} 台）` : headers === 'avoid' ? '床下で枝分かれ（チーズ）させてつなぎました（ヘッダーは使っていません）' : 'ヘッダーでつなぎました';
    summary.push(`給水 ${s.connected.water} 本・お湯 ${s.connected.hot} 本を${how}${s.valves ? `・止水栓 ${s.valves} 個` : ''}`);
  }
  if (!s.error) summary.push(...s.notes);
  if (v.valves) summary.push(`通気弁を ${v.valves} 個（キッチン・洗面台の排水口の下）`);
  summary.push(...v.notes);
  return {
    doc: v.doc,
    dropped: d1.pipes, drains: d2.pipes, newManholes: d2.manholes, yard: d3.connected,
    supplies: s.error ? 0 : s.pipes, headers: s.error ? 0 : s.headers, valves: s.error ? 0 : s.valves, vents: v.valves,
    summary,
    questions: [s.needHeader ? headerQuestion(s.needHeader) : null].filter((q): q is Question => !!q),
  };
}
