/**
 * 部屋の結合・分割（多角形演算は polyclip-ts）。純粋関数。不成立の操作は元の Building をそのまま返す。
 */
import { intersection, union, type Geom } from 'polyclip-ts';
import { newId } from './id';
import { roomArea, type Building, type Room, type Vec2 } from './building';

/** これ未満の片は分割結果として認めない(㎡) */
const MIN_PIECE_M2 = 0.1;
const FAR = 1e7;

const toGeom = (poly: Vec2[]): Geom => [[...poly.map((p) => [p.x, p.y] as [number, number]), [poly[0].x, poly[0].y]]];

/** 1mm丸め・閉じ点/重複点/一直線上の中間点を除去 */
function clean(ring: [number, number][]): Vec2[] {
  let pts = ring.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) }));
  if (pts.length > 1 && pts[0].x === pts.at(-1)!.x && pts[0].y === pts.at(-1)!.y) pts.pop();
  pts = pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return p.x !== q.x || p.y !== q.y; });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], p = pts[i], c = pts[(i + 1) % pts.length];
      const cross = (p.x - a.x) * (c.y - a.y) - (p.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) < 1) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
}

/** 同じ階で辺を共有する2部屋を1部屋に結合（穴あき・離れた部屋・角だけ接する部屋は不可） */
export function mergeRooms(b: Building, aId: string, bId: string): { b: Building; roomId: string | null } {
  const A = b.rooms[aId], B = b.rooms[bId];
  if (!A || !B || aId === bId || A.floorId !== B.floorId) return { b, roomId: null };
  const res = union(toGeom(A.polygon), toGeom(B.polygon));
  if (res.length !== 1 || res[0].length !== 1) return { b, roomId: null };
  const polygon = clean(res[0][0]);
  if (polygon.length < 3) return { b, roomId: null };
  const id = newId('r');
  const rooms = { ...b.rooms };
  delete rooms[aId];
  delete rooms[bId];
  rooms[id] = { id, floorId: A.floorId, name: A.name, polygon };
  return { b: { ...b, rooms }, roomId: id };
}

/** 直線が多角形の内側を通る区間（凹んだ部屋では複数）。端点は1mmに丸める */
function cutSegments(poly: Vec2[], p: Vec2, d: Vec2): [Vec2, Vec2][] {
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const e = { x: c.x - a.x, y: c.y - a.y };
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - p.x) * e.y - (a.y - p.y) * e.x) / den;
    const u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const at = (t: number) => ({ x: p.x + d.x * t, y: p.y + d.y * t });
  const out: [Vec2, Vec2][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    if (ts[i + 1] - ts[i] < 1) continue;
    if (!pointInPolygon(at((ts[i] + ts[i + 1]) / 2), poly)) continue;
    const r = (v: Vec2) => ({ x: Math.round(v.x), y: Math.round(v.y) });
    const prev = out.at(-1);
    // 頂点を通過して区間が連続する場合はつなげる
    if (prev && Math.hypot(prev[1].x - at(ts[i]).x, prev[1].y - at(ts[i]).y) < 1) prev[1] = r(at(ts[i + 1]));
    else out.push([r(at(ts[i])), r(at(ts[i + 1]))]);
  }
  return out;
}

/** p→q を通る直線で部屋を分割。2片以上に分かれた時だけ置き換える */
export function splitRoom(b: Building, roomId: string, p: Vec2, q: Vec2): { b: Building; roomIds: string[]; cuts: [Vec2, Vec2][] } {
  const room = b.rooms[roomId];
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  if (!room || len < 1e-6) return { b, roomIds: [], cuts: [] };
  const d = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  const n = { x: -d.y, y: d.x };
  const half = (s: number): Geom => {
    const a = { x: p.x - d.x * FAR, y: p.y - d.y * FAR }, c = { x: p.x + d.x * FAR, y: p.y + d.y * FAR };
    return toGeom([a, c, { x: c.x + n.x * FAR * s, y: c.y + n.y * FAR * s }, { x: a.x + n.x * FAR * s, y: a.y + n.y * FAR * s }]);
  };
  const pieces: Vec2[][] = [];
  for (const s of [1, -1]) {
    for (const poly of intersection(toGeom(room.polygon), half(s))) {
      if (poly.length !== 1) return { b, roomIds: [], cuts: [] }; // 穴あきは想定外
      pieces.push(clean(poly[0]));
    }
  }
  const valid = pieces.filter((pts) => pts.length >= 3 && roomArea({ polygon: pts } as Room) >= MIN_PIECE_M2);
  if (valid.length < 2 || valid.length !== pieces.length) return { b, roomIds: [], cuts: [] };
  const rooms = { ...b.rooms };
  delete rooms[roomId];
  const roomIds = valid.map((polygon, i) => {
    const id = newId('r');
    rooms[id] = { id, floorId: room.floorId, name: `${room.name}-${i + 1}`, polygon };
    return id;
  });
  return { b: { ...b, rooms }, roomIds, cuts: cutSegments(room.polygon, p, d) };
}

/** 点が多角形の内側か（境界上は内側扱いしない場合あり） */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], c = poly[j];
    if ((a.y > p.y) !== (c.y > p.y) && p.x < ((c.x - a.x) * (p.y - a.y)) / (c.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
