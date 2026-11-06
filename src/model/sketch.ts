/**
 * 建物のスケッチ入力: 指でなぞった外形の補正、外壁ループ、実測寸法による形の調整。
 * すべて純粋関数（Building / Doc を受け取り新しい値を返す）。
 */
import { addWall, MIN_WALL_MM, wallLength, wallsOnFloor, type Building, type Vec2, type Wall } from './building';
import { simplify } from './geometry';
import type { Doc } from './doc';
import { syncAllFixturePorts } from './fixtures';
import { newId } from './id';

export const SKETCH_GRID = 50;
/** 軸に平行とみなす・同じ位置とみなす許容(mm) */
const EPS = 1;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const snap = (v: number, g: number) => Math.round(v / g) * g + 0; // -0 を 0 に

/** 符号付き面積（y 上向き。正 = 反時計回り） */
function signedArea(p: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}

function isSimple(p: Vec2[]): boolean {
  const n = p.length;
  const orient = (a: Vec2, c: Vec2, d: Vec2) => Math.sign((c.x - a.x) * (d.y - a.y) - (c.y - a.y) * (d.x - a.x));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = p[i], c = p[(i + 1) % n], d = p[j], e = p[(j + 1) % n];
      if (orient(a, c, d) !== orient(a, c, e) && orient(d, e, a) !== orient(d, e, c)) return false;
    }
  }
  return true;
}

/** 画面で見て時計回り（y 上向きの座標で面積が負）にし、左上の点から始める */
function normalizeLoop(p: Vec2[]): Vec2[] {
  const q = signedArea(p) > 0 ? [...p].reverse() : [...p];
  let k = 0;
  for (let i = 1; i < q.length; i++) {
    if (q[i].y > q[k].y + EPS || (Math.abs(q[i].y - q[k].y) <= EPS && q[i].x < q[k].x)) k = i;
  }
  return [...q.slice(k), ...q.slice(0, k)];
}

type AxisEdge = { h: boolean; v: number; w: number };

/** 同じ向きで隣り合う辺を（長さの重み付き平均で）1本にまとめる。環状 */
function mergeSame(edges: AxisEdge[]): AxisEdge[] {
  const out: AxisEdge[] = [];
  for (const e of edges) {
    const last = out.at(-1);
    if (last && last.h === e.h) { const w = last.w + e.w; out[out.length - 1] = { h: e.h, v: (last.v * last.w + e.v * e.w) / (w || 1), w }; }
    else out.push({ ...e });
  }
  while (out.length > 1 && out[0].h === out.at(-1)!.h) {
    const a = out.pop()!, b = out[0], w = a.w + b.w;
    out[0] = { h: b.h, v: (a.v * a.w + b.v * b.w) / (w || 1), w };
  }
  return out;
}

/** 辺 k と辺 k+1 の交点 */
const vertexOf = (es: AxisEdge[], k: number): Vec2 => {
  const e = es[k], f = es[(k + 1) % es.length];
  return e.h ? { x: f.v, y: e.v } : { x: e.v, y: f.v };
};

/**
 * 手描きの外形を閉じた多角形に補正する。
 * ortho: 各辺を水平・垂直にそろえて直角の多角形にする。false なら間引いた形をそのまま閉じる。
 * 形にならない（辺が少なすぎる・ねじれている）場合は null。
 */
export function straightenOutline(raw: Vec2[], opts: { tolerance: number; ortho: boolean; minEdge?: number; grid?: number }): Vec2[] | null {
  const minEdge = opts.minEdge ?? 300, grid = opts.grid ?? SKETCH_GRID;
  if (raw.length < 3) return null;
  let pts = simplify(raw, opts.tolerance);
  const xs = raw.map((p) => p.x), ys = raw.map((p) => p.y);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (pts.length >= 3 && dist(pts[0], pts.at(-1)!) <= Math.max(opts.tolerance * 4, diag * 0.2)) pts = pts.slice(0, -1);
  if (pts.length < 3) return null;

  let poly: Vec2[];
  if (opts.ortho) {
    let es: AxisEdge[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x, dy = b.y - a.y, w = Math.hypot(dx, dy);
      if (w === 0) continue;
      const h = Math.abs(dx) >= Math.abs(dy);
      es.push({ h, v: h ? (a.y + b.y) / 2 : (a.x + b.x) / 2, w });
    }
    es = mergeSame(es);
    // 短すぎる辺を消して、その両隣（同じ向き）をまとめる
    for (let guard = 0; guard < 100 && es.length >= 4; guard++) {
      let k = -1, best = Infinity;
      for (let i = 0; i < es.length; i++) {
        const L = dist(vertexOf(es, (i - 1 + es.length) % es.length), vertexOf(es, i));
        if (L < best) { best = L; k = i; }
      }
      if (best >= minEdge) break;
      es = mergeSame(es.filter((_, i) => i !== k));
    }
    if (es.length < 4) return null;
    es = es.map((e) => ({ ...e, v: snap(e.v, grid) }));
    poly = es.map((_, k) => vertexOf(es, k));
  } else {
    poly = pts.map((p) => ({ x: snap(p.x, grid), y: snap(p.y, grid) }));
  }
  // 同一点・一直線上の点を除去
  const clean: Vec2[] = [];
  for (const p of poly) if (!clean.length || dist(clean.at(-1)!, p) >= EPS) clean.push(p);
  if (clean.length > 1 && dist(clean[0], clean.at(-1)!) < EPS) clean.pop();
  const out = clean.filter((p, i) => {
    const a = clean[(i - 1 + clean.length) % clean.length], b = clean[(i + 1) % clean.length];
    return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > EPS * Math.max(1, dist(a, b));
  });
  if (out.length < 3 || !isSimple(out)) return null;
  for (let i = 0; i < out.length; i++) if (dist(out[i], out[(i + 1) % out.length]) < MIN_WALL_MM) return null;
  return normalizeLoop(out);
}

/** 多角形の各辺を外壁（寸法未確定）として追加する */
export function addOutlineWalls(b: Building, floorId: string, poly: Vec2[]): { b: Building; wallIds: string[] } {
  let next = b;
  const ids: string[] = [];
  for (let i = 0; i < poly.length; i++) {
    const r = addWall(next, floorId, poly[i], poly[(i + 1) % poly.length], { kind: 'exterior' });
    if (!r.wallIds.length) return { b, wallIds: [] };
    next = r.b;
    ids.push(...r.wallIds);
  }
  const walls = { ...next.walls };
  for (const id of ids) walls[id] = { ...walls[id], lengthSet: false };
  return { b: { ...next, walls }, wallIds: ids };
}

/** fromFloorId より上の、壁がまだない階に外壁をコピーする（積み上げて立体化） */
export function copyOutlineToEmptyFloors(b: Building, fromFloorId: string): Building {
  const src = wallsOnFloor(b, fromFloorId).filter((w) => w.kind === 'exterior');
  if (!src.length) return b;
  const corners = { ...b.corners }, walls = { ...b.walls };
  let changed = false;
  const from = b.floors.findIndex((f) => f.id === fromFloorId);
  for (const f of b.floors.slice(from + 1)) {
    if (wallsOnFloor(b, f.id).length) continue;
    const map = new Map<string, string>();
    for (const w of src) {
      for (const cid of [w.a, w.b]) {
        if (map.has(cid)) continue;
        const nid = newId('c');
        map.set(cid, nid);
        corners[nid] = { ...b.corners[cid], id: nid, floorId: f.id };
      }
      const wid = newId('w');
      walls[wid] = { ...w, id: wid, floorId: f.id, a: map.get(w.a)!, b: map.get(w.b)! };
    }
    changed = true;
  }
  return changed ? { ...b, corners, walls } : b;
}

export type OutlineLoop = { corners: string[]; walls: string[] };

/** その階の外壁が1つの閉じたループなら、画面で時計回り・左上の角から並べて返す */
export function outlineLoop(b: Building, floorId: string): OutlineLoop | null {
  const ws = wallsOnFloor(b, floorId).filter((w) => w.kind === 'exterior');
  if (ws.length < 3) return null;
  const adj = new Map<string, Wall[]>();
  for (const w of ws) for (const c of [w.a, w.b]) adj.set(c, [...(adj.get(c) ?? []), w]);
  if ([...adj.values()].some((l) => l.length !== 2)) return null;
  const start = ws[0].a;
  const corners = [start], walls: string[] = [];
  let cur = start, prev: Wall | null = null;
  for (let i = 0; i < ws.length; i++) {
    const w: Wall = adj.get(cur)!.find((x) => x !== prev)!;
    walls.push(w.id);
    cur = w.a === cur ? w.b : w.a;
    prev = w;
    if (cur === start) break;
    corners.push(cur);
  }
  if (cur !== start || walls.length !== ws.length) return null;
  const pts = corners.map((id) => b.corners[id]);
  let cs = corners, wl = walls;
  if (signedArea(pts) > 0) { cs = [corners[0], ...corners.slice(1).reverse()]; wl = [...walls].reverse(); }
  // 左上の角から
  let k = 0;
  for (let i = 1; i < cs.length; i++) {
    const p = b.corners[cs[i]], q = b.corners[cs[k]];
    if (p.y > q.y + EPS || (Math.abs(p.y - q.y) <= EPS && p.x < q.x)) k = i;
  }
  return { corners: [...cs.slice(k), ...cs.slice(0, k)], walls: [...wl.slice(k), ...wl.slice(0, k)] };
}

export const isConfirmed = (w: Wall) => w.lengthSet !== false;

/** 壁の向き: 'x' 水平 / 'y' 垂直 / null 斜め */
export function wallAxis(b: Building, wallId: string): 'x' | 'y' | null {
  const w = b.walls[wallId], A = b.corners[w.a], B = b.corners[w.b];
  if (Math.abs(A.y - B.y) <= EPS) return 'x';
  if (Math.abs(A.x - B.x) <= EPS) return 'y';
  return null;
}

/**
 * 外形が直角で、同じ向きの他の辺がすべて確定済みなら、この辺の長さは他の辺から決まる（自動計算）。
 * その長さ（＝現在の長さ）を返す。決まらなければ null。
 */
export function determinedLength(b: Building, floorId: string, wallId: string): number | null {
  const loop = outlineLoop(b, floorId);
  if (!loop || !loop.walls.includes(wallId)) return null;
  if (loop.walls.some((id) => wallAxis(b, id) === null)) return null;
  const ax = wallAxis(b, wallId);
  const others = loop.walls.filter((id) => id !== wallId && wallAxis(b, id) === ax);
  return others.length && others.every((id) => isConfirmed(b.walls[id])) ? wallLength(b, wallId) : null;
}

/** 外形の未確定の辺の数（全階） */
export const unconfirmedWallCount = (b: Building) => Object.values(b.walls).filter((w) => !isConfirmed(w)).length;

/** 同じ位置（両端が1mm以内）にある別の階の壁 */
function twinWalls(b: Building, wallId: string): string[] {
  const w = b.walls[wallId], A = b.corners[w.a], B = b.corners[w.b];
  return Object.values(b.walls).filter((x) => {
    if (x.id === wallId || x.floorId === w.floorId) return false;
    const P = b.corners[x.a], Q = b.corners[x.b];
    return (dist(P, A) <= EPS && dist(Q, B) <= EPS) || (dist(P, B) <= EPS && dist(Q, A) <= EPS);
  }).map((x) => x.id);
}

export type FixedEnd = 'a' | 'b';
export type LengthResult =
  | { ok: true; doc: Doc; changedConfirmed: string[]; fixed: FixedEnd }
  | { ok: false; error: string };

/**
 * 壁の長さを変える。固定する端の反対側の端より先にある点（全階の角・部屋の頂点・器具・配管）を
 * 壁の向きにずらすので、直角と平行な辺が保たれる。斜めの壁はその端の角だけ動かす。
 * 変更した壁と別の階の同じ位置の壁は確定済みにする。
 */
export type LengthMode = 'stretch' | 'slide';
export function setWallLengthStretch(doc: Doc, wallId: string, length: number, fixed: FixedEnd, mode: LengthMode = 'stretch'): LengthResult {
  const b = doc.building, w = b.walls[wallId];
  if (!w) return { ok: false, error: '壁が見つかりません' };
  if (!(length >= MIN_WALL_MM)) return { ok: false, error: `${MIN_WALL_MM}mm 以上で入力してください` };
  const twins = twinWalls(b, wallId);
  const P = b.corners[fixed === 'a' ? w.a : w.b], Q = b.corners[fixed === 'a' ? w.b : w.a];
  const L = dist(P, Q), delta = length - L;
  const ax = wallAxis(b, wallId);
  const before = Object.fromEntries(Object.keys(b.walls).map((id) => [id, wallLength(b, id)]));

  let move: (p: Vec2) => Vec2;
  let moveCorner: ((id: string, c: Vec2) => Vec2) | null = null;
  let moveRoomVertex: ((floorId: string, v: Vec2) => Vec2) | null = null;
  if (mode === 'slide') {
    // 動かす端につながる直角の外壁だけを平行移動（その先の辺の長さで吸収する）。別の階は同じ位置の壁だけ
    if (!ax) return { ok: false, error: '斜めの壁です' };
    const qId = fixed === 'a' ? w.b : w.a;
    const adj = Object.values(b.walls).find((x) => x.id !== wallId && x.floorId === w.floorId && x.kind === 'exterior' && (x.a === qId || x.b === qId));
    if (!adj || wallAxis(b, adj.id) === ax || wallAxis(b, adj.id) === null) return { ok: false, error: '動かせる壁がありません' };
    const ids = new Set([adj.a, adj.b]);
    for (const t of twinWalls(b, adj.id)) { ids.add(b.walls[t].a); ids.add(b.walls[t].b); }
    const k = ax, s = Math.sign(Q[k] - P[k]);
    const R = b.corners[adj.a === qId ? adj.b : adj.a];
    const floors = new Set([...ids].map((id) => b.corners[id].floorId));
    const pts = [{ ...Q }, { ...R }];
    const shift = (p: Vec2): Vec2 => ({ ...p, [k]: p[k] + s * delta });
    moveCorner = (id, c) => (ids.has(id) ? shift(c) : c);
    moveRoomVertex = (floorId, v) => (floors.has(floorId) && pts.some((t) => dist(t, v) <= EPS) ? shift(v) : v);
    move = (p) => p;
  } else if (ax) {
    const k = ax;
    const s = Math.sign(Q[k] - P[k]);
    move = (p) => (s * (p[k] - Q[k]) >= -EPS ? { ...p, [k]: p[k] + s * delta } : p);
  } else {
    const u = { x: (Q.x - P.x) / L, y: (Q.y - P.y) / L };
    move = (p) => (dist(p, Q) <= EPS ? { x: p.x + u.x * delta, y: p.y + u.y * delta } : p);
  }
  const corners = Object.fromEntries(Object.entries(b.corners).map(([id, c]) => {
    const m = moveCorner ? moveCorner(id, c) : move(c);
    return [id, m === c ? c : { ...c, x: m.x, y: m.y }];
  }));
  const rooms = Object.fromEntries(Object.entries(b.rooms).map(([id, r]) => [id, { ...r, polygon: r.polygon.map((v) => { const m = moveRoomVertex ? moveRoomVertex(r.floorId, v) : move(v); return { x: m.x, y: m.y }; }) }]));
  const walls = { ...b.walls };
  for (const id of [wallId, ...twins]) walls[id] = { ...walls[id], lengthSet: true };
  // 窓・ドアは中心の位置を同じ規則で動かし、壁の始点からの距離を測り直す
  const openings = Object.fromEntries(Object.entries(b.openings).map(([id, o]) => {
    const ow = b.walls[o.wallId], A0 = b.corners[ow.a], B0 = b.corners[ow.b], L0 = dist(A0, B0);
    const c0 = { x: A0.x + ((B0.x - A0.x) * o.offset) / L0, y: A0.y + ((B0.y - A0.y) * o.offset) / L0 };
    // 平行移動する壁の窓・ドアは壁と一緒に動く
    const c = moveCorner ? (moveCorner(ow.a, A0) !== A0 && moveCorner(ow.b, B0) !== B0 ? { x: c0.x + corners[ow.a].x - A0.x, y: c0.y + corners[ow.a].y - A0.y } : c0) : move(c0);
    const A1 = corners[ow.a], B1 = corners[ow.b], L1 = dist(A1, B1);
    const offset = L1 > 0 ? ((c.x - A1.x) * (B1.x - A1.x) + (c.y - A1.y) * (B1.y - A1.y)) / L1 : o.offset;
    return [id, Math.abs(offset - o.offset) < 1e-6 ? o : { ...o, offset }];
  }));
  const nb: Building = { ...b, corners, rooms, walls, openings };

  for (const x of Object.values(nb.walls)) {
    if (wallLength(nb, x.id) < MIN_WALL_MM) return { ok: false, error: '短くなりすぎる壁があります' };
    // 向きが反対になる（形が裏返る）変更は拒否
    const A0 = b.corners[x.a], B0 = b.corners[x.b], A1 = nb.corners[x.a], B1 = nb.corners[x.b];
    if ((B0.x - A0.x) * (B1.x - A1.x) + (B0.y - A0.y) * (B1.y - A1.y) <= 0) return { ok: false, error: 'この長さだと形が裏返ります。値を確かめてください' };
  }
  for (const f of nb.floors) {
    const loop = outlineLoop(nb, f.id);
    if (loop && !isSimple(loop.corners.map((id) => nb.corners[id]))) return { ok: false, error: 'この長さだと外壁が交差します。値を確かめてください' };
  }
  for (const o of Object.values(nb.openings)) {
    if (o.offset - o.width / 2 < -EPS || o.offset + o.width / 2 > wallLength(nb, o.wallId) + EPS) return { ok: false, error: '窓・ドアが壁からはみ出します。先に窓・ドアを動かしてください' };
  }
  const moveItems = mode === 'stretch';
  const nodes = !moveItems ? doc.network.nodes : Object.fromEntries(Object.entries(doc.network.nodes).map(([id, n]) => {
    const m = move(n.pos);
    return [id, m === n.pos ? n : { ...n, pos: { ...n.pos, x: m.x, y: m.y } }];
  }));
  const fixtures = !moveItems ? doc.fixtures : Object.fromEntries(Object.entries(doc.fixtures).map(([id, f]) => {
    const m = move(f);
    return [id, m === f ? f : { ...f, x: m.x, y: m.y }];
  }));
  const next = syncAllFixturePorts({ ...doc, building: nb, network: { ...doc.network, nodes }, fixtures });
  const changedConfirmed = Object.values(nb.walls)
    .filter((x) => x.id !== wallId && !twins.includes(x.id) && isConfirmed(x) && Math.abs(wallLength(nb, x.id) - before[x.id]) > 0.5)
    .map((x) => x.id);
  return { ok: true, doc: next, changedConfirmed, fixed };
}

export type OutlineLengthResult =
  | { ok: true; doc: Doc; fixed: FixedEnd; mode: LengthMode; unconfirmed: string[] }
  | { ok: false; error: string }
  | { ok: false; conflict: { gap: number; walls: string[] } };

/**
 * 実測の長さを入れる。確定済みの他の辺の長さが変わらない方法を順に試す:
 * 指定の端を固定して伸縮 → 反対の端を固定して伸縮 → 動かす端の直角の壁だけ平行移動（両方向）。
 * どれでも変わるなら conflict（gap = 入力 − 今の長さ）。force なら指定の端で伸縮し、変わった辺を未確定に戻す。
 */
export function applyOutlineLength(doc: Doc, wallId: string, length: number, fixed: FixedEnd, force = false): OutlineLengthResult {
  const other: FixedEnd = fixed === 'a' ? 'b' : 'a';
  const tries: [FixedEnd, LengthMode][] = [[fixed, 'stretch'], [other, 'stretch'], [fixed, 'slide'], [other, 'slide']];
  let first: Extract<LengthResult, { ok: true }> | null = null;
  let firstError: string | null = null;
  for (const [f, m] of tries) {
    const r = setWallLengthStretch(doc, wallId, length, f, m);
    if (!r.ok) { if (m === 'stretch' && f === fixed) firstError = r.error; continue; }
    if (!r.changedConfirmed.length) return { ok: true, doc: r.doc, fixed: f, mode: m, unconfirmed: [] };
    if (m === 'stretch' && !first) first = r;
  }
  if (!first) return { ok: false, error: firstError ?? '長さを変えられません' };
  if (!force) return { ok: false, conflict: { gap: length - wallLength(doc.building, wallId), walls: first.changedConfirmed } };
  const walls = { ...first.doc.building.walls };
  for (const id of first.changedConfirmed) walls[id] = { ...walls[id], lengthSet: false };
  return { ok: true, doc: { ...first.doc, building: { ...first.doc.building, walls } }, fixed: first.fixed, mode: 'stretch', unconfirmed: first.changedConfirmed };
}
