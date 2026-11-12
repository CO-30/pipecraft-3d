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
import { closestPoints } from './clash';
import { routeSupplies } from './supplyRoute';
import { distToOutline, insideBuilding, underfloorLevels } from './underfloorSlope';

/** 汚水の系統のマス（雨水は別の系統なのでつながない） */
const SEWAGE_MANHOLES = new Set<FixtureType>(['manholeSewage', 'manholeInvert', 'manholeTrap']);
const RAIN = new Set<FixtureType>(['manholeRain', 'publicRain']);
/** 屋外の管を外壁（芯）から離す距離 mm */
const YARD_CLEAR = 300;
/** 建物の周りを回る道: 外壁の外側この距離を通る mm */
const AROUND = 700;
/** 曲がりにマスを置けるよう、曲がりのある道では 1m より短い区間を避ける */
const MIN_LEG = 1000, SHORT_LEG_COST = 3000;
/** 方眼の道探しの間隔・まわりの余白・曲がり 1 回の重み(mm) */
const GRID = 250, GRID_PAD = 2500, TURN_COST = 1500;
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

const pointSeg = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
};

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
  const lv = underfloorLevels(doc);
  const b = doc.building;
  const base = [...b.floors].sort((x, y) => Math.abs(x.elevation) - Math.abs(y.elevation))[0];
  const ext = Object.values(b.walls).filter((w) => w.kind === 'exterior' && w.floorId === base?.id && b.corners[w.a] && b.corners[w.b]).map((w) => [b.corners[w.a], b.corners[w.b]] as const);
  /** 建物の中・外壁の近くか（外壁が 1 周つながっていなければ、外壁の線からの距離だけで見る） */
  const blocked = (x: { x: number; y: number }) => (lv && lv.outline.length
    ? insideBuilding(lv, x) || distToOutline(lv, x) < YARD_CLEAR
    : ext.some(([a, c]) => pointSeg(x, a, c) < YARD_CLEAR));
  const legOk = (p: Vec3, q: Vec3, ends: Vec3[]) => {
    if (!ext.length && !(lv && lv.outline.length)) return true;
    const L = Math.hypot(q.x - p.x, q.y - p.y), n = Math.max(1, Math.ceil(L / 100));
    for (let i = 0; i <= n; i++) {
      const x = { x: p.x + ((q.x - p.x) * i) / n, y: p.y + ((q.y - p.y) * i) / n };
      // 端のマスのすぐそば（外壁から 300mm 未満に置いたマス）は除く。ただし建物の中は不可
      if (ends.some((e) => Math.hypot(e.x - x.x, e.y - x.y) < 400) && !(lv && lv.outline.length && insideBuilding(lv, x) && distToOutline(lv, x) > 1)) continue;
      if (blocked(x)) return false;
    }
    return true;
  };
  const xs = ext.flatMap(([a, c]) => [a.x, c.x]), ys = ext.flatMap(([a, c]) => [a.y, c.y]);
  const box = xs.length ? { x0: Math.min(...xs) - AROUND, x1: Math.max(...xs) + AROUND, y0: Math.min(...ys) - AROUND, y1: Math.max(...ys) + AROUND } : null;
  /** a → b の道の候補（直線・L 字 2 通り・建物の周りを回る 4 通り）のうち、使える一番安いもの */
  const route = (a: Vec3, c: Vec3): Vec3[] | null => {
    const z = (a.z + c.z) / 2;
    const P = (x: number, y: number) => ({ x, y, z });
    const cands: Vec3[][] = [[a, c]];
    if (Math.abs(a.x - c.x) > 1 && Math.abs(a.y - c.y) > 1) cands.push([a, P(c.x, a.y), c], [a, P(a.x, c.y), c]);
    if (box) cands.push([a, P(a.x, box.y1), P(c.x, box.y1), c], [a, P(a.x, box.y0), P(c.x, box.y0), c], [a, P(box.x0, a.y), P(box.x0, c.y), c], [a, P(box.x1, a.y), P(box.x1, c.y), c]);
    let best: { pts: Vec3[]; cost: number } | null = null;
    for (const c0 of cands) {
      const pts = c0.filter((p, i) => i === 0 || Math.hypot(p.x - c0[i - 1].x, p.y - c0[i - 1].y) >= 1);
      if (pts.length < 2 || !pts.every((p, i) => i === 0 || legOk(pts[i - 1], p, [a, c]))) continue;
      const legs = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
      const cost = legs.reduce((x, y) => x + y, 0) + (pts.length > 2 ? legs.filter((l) => l < MIN_LEG).length * SHORT_LEG_COST : 0);
      if (!best || cost < best.cost) best = { pts, cost };
    }
    return best?.pts ?? gridRoute(a, c);
  };
  /**
   * 方眼の道探し（直線・L 字・箱を回る道でつなげないとき。凹んだ形の建物、マスが建物のへこみにある、など）。
   * a を通る GRID 間隔の方眼で、建物の中・外壁の近くを避けて縦横に進み、c と縦か横にそろった所からまっすぐ c へ。曲がりは少なく
   */
  const gridRoute = (a: Vec3, c: Vec3): Vec3[] | null => {
    if (!box) return null;
    const z = (a.z + c.z) / 2;
    const x0 = Math.min(box.x0, a.x, c.x) - GRID_PAD, x1 = Math.max(box.x1, a.x, c.x) + GRID_PAD;
    const y0 = Math.min(box.y0, a.y, c.y) - GRID_PAD, y1 = Math.max(box.y1, a.y, c.y) + GRID_PAD;
    const i0 = Math.floor((x0 - a.x) / GRID), i1 = Math.ceil((x1 - a.x) / GRID), j0 = Math.floor((y0 - a.y) / GRID), j1 = Math.ceil((y1 - a.y) / GRID);
    const NI = i1 - i0 + 1, NJ = j1 - j0 + 1;
    if (NI * NJ > 200_000) return null;
    const pos = (i: number, j: number) => ({ x: a.x + (i + i0) * GRID, y: a.y + (j + j0) * GRID, z });
    const okCell = new Int8Array(NI * NJ).fill(-1);
    const cellOk = (i: number, j: number) => {
      const k = j * NI + i;
      if (okCell[k] < 0) { const q = pos(i, j); okCell[k] = Math.hypot(q.x - a.x, q.y - a.y) < 400 || !blocked(q) ? 1 : 0; }
      return okCell[k] === 1;
    };
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const N = NI * NJ * 4;
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const heap: [number, number][] = [];
    const push = (d: number, s: number) => { heap.push([d, s]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const si = -i0, sj = -j0;
    for (let d = 0; d < 4; d++) { const s0 = (sj * NI + si) * 4 + d; dist[s0] = 0; push(0, s0); }
    let goal = -1;
    while (heap.length) {
      const [d, st] = pop();
      if (d > dist[st]) continue;
      const cell = st >> 2, dir = st & 3, i = cell % NI, j = (cell / NI) | 0;
      const q = pos(i, j);
      // c とそろっていて、まっすぐ行ける
      if ((Math.abs(q.x - c.x) < 1 || Math.abs(q.y - c.y) < 1) && legOk(q, c, [a, c])) { goal = st; break; }
      for (let nd = 0; nd < 4; nd++) {
        const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
        if (ni < 0 || nj < 0 || ni >= NI || nj >= NJ || !cellOk(ni, nj)) continue;
        const ns = (nj * NI + ni) * 4 + nd, nd2 = d + GRID + (nd !== dir && d > 0 ? TURN_COST : 0);
        if (nd2 < dist[ns]) { dist[ns] = nd2; prev[ns] = st; push(nd2, ns); }
      }
    }
    if (goal < 0) return null;
    const cells: Vec3[] = [];
    for (let st = goal; st >= 0; st = prev[st]) { const cell = st >> 2; cells.push(pos(cell % NI, (cell / NI) | 0)); if (prev[st] < 0) break; }
    cells.reverse();
    const pts: Vec3[] = [a, ...cells.slice(1), c].filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) >= 1);
    // まっすぐ並んだ点を除く
    const out: Vec3[] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = out[out.length - 1], p1 = pts[i], p2 = pts[i + 1];
      if (Math.abs((p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x)) > 1e-6) out.push(p1);
    }
    out.push(pts[pts.length - 1]);
    return out.every((p, i) => i === 0 || legOk(out[i - 1], p, [a, c])) ? out : null;
  };

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
};

/** まとめてつなぐ（1〜5）。何度呼んでも増えない */
export function autoConnect(doc: Doc, opts: { drainRules?: DrainRules; burial?: number; dropDepth?: number } = {}): AutoConnectResult {
  const summary: string[] = [];
  const d1 = dropFixturePipes(doc, opts.dropDepth);
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
  summary.push(...v.notes);
  return {
    doc: v.doc,
    dropped: d1.pipes, drains: d2.pipes, newManholes: d2.manholes, yard: d3.connected,
    supplies: s.error ? 0 : s.pipes, headers: s.error ? 0 : s.headers, valves: s.error ? 0 : s.valves, vents: v.valves,
    summary,
  };
}
