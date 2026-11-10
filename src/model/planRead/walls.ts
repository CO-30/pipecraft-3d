/**
 * 帯（strips.ts）→ 壁の芯線。建物の外の誤検出を捨て、壁の並びの切れ目を開口部にし、端を相手の壁芯まで伸ばし、
 * 外壁・内壁を見分ける。すべて純粋関数、座標は図面座標(mm)。
 */
import type { Vec2 } from '../building';
import type { Strip, WSeg } from './strips';

export type WallOpening = { /** 壁の a 端から開口の中心まで */ offset: number; width: number };
export type WallSpec = { a: Vec2; b: Vec2; thickness: number; kind: 'exterior' | 'interior'; openings: WallOpening[] };

/** 壁の並び（同じ線上の帯をつないだもの）。gaps は開口部にする切れ目 */
type Run = { dir: 'h' | 'v'; c: number; lo: number; hi: number; t: number; gaps: [number, number][] };

/** 同じ線上とみなす芯のずれ / つながっているとみなすすき間 / 開口部とみなす切れ目の幅 */
const SAME_LINE = 40, TOUCH = 220, OPEN_MIN = 250, OPEN_MAX = 4200;
/** 建具の線が切れ目の外へはみ出してよい長さ */
const PASS = 300;
/** 通り芯（とその中間）へ寄せる距離 */
const GRID_SNAP = 45;
const CELL = 100;

const rectOf = (s: { dir: 'h' | 'v'; c: number; lo: number; hi: number; t: number }, pad = 0) =>
  s.dir === 'h'
    ? { x0: s.lo - pad, x1: s.hi + pad, y0: s.c - s.t / 2 - pad, y1: s.c + s.t / 2 + pad }
    : { x0: s.c - s.t / 2 - pad, x1: s.c + s.t / 2 + pad, y0: s.lo - pad, y1: s.hi + pad };
type Rect = ReturnType<typeof rectOf>;
const hit = (a: Rect, b: Rect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
const collinear = (a: Strip, b: Strip) => a.dir === b.dir && Math.abs(a.c - b.c) <= SAME_LINE;

/** 塊を作る帯の本数の上限（住宅の図面 1 枚は数十本） */
export const MAX_STRIPS = 3000;
/** これより離れた帯は別の塊（窓の多い壁は細い線で描かれて帯にならないので、少し離れていても同じ建物とみなす） */
const NEAR = 2000;

/**
 * 建物の帯だけを残す: 近い帯どうしを 1 つの塊とし、
 * いちばん長い塊と、その範囲の内側にある塊を採る（図面の外側にある表の枠などを捨てる）。
 */
export function buildingStrips(input: Strip[]): Strip[] {
  // 総当たりで塊を作るので、多すぎるときは長い帯から採る
  const strips = input.length > MAX_STRIPS ? [...input].sort((a, b) => b.hi - b.lo - (a.hi - a.lo)).slice(0, MAX_STRIPS) : input;
  const n = strips.length;
  const parent = strips.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = strips[i], b = strips[j];
    const near = hit(rectOf(a, NEAR / 2), rectOf(b, NEAR / 2));
    if (near) parent[find(i)] = find(j);
  }
  const groups = new Map<number, Strip[]>();
  strips.forEach((s, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), s]));
  const len = (g: Strip[]) => g.reduce((s, x) => s + x.hi - x.lo, 0);
  const sorted = [...groups.values()].sort((p, q) => len(q) - len(p));
  if (!sorted.length) return [];
  const box = bounds(sorted[0].map((s) => rectOf(s)), 300);
  return sorted.filter((g, i) => i === 0 || g.every((s) => inside(rectOf(s), box))).flat();
}

function bounds(rs: Rect[], pad = 0): Rect {
  return { x0: Math.min(...rs.map((r) => r.x0)) - pad, x1: Math.max(...rs.map((r) => r.x1)) + pad, y0: Math.min(...rs.map((r) => r.y0)) - pad, y1: Math.max(...rs.map((r) => r.y1)) + pad };
}
const inside = (r: Rect, b: Rect) => r.x0 >= b.x0 && r.x1 <= b.x1 && r.y0 >= b.y0 && r.y1 <= b.y1;

/** 通り芯とその中間（半間）の位置 */
export function snapLines(grid: number[]): number[] {
  const g = [...grid].sort((a, b) => a - b);
  return [...g, ...g.slice(1).map((v, i) => (v + g[i]) / 2)];
}
const snap = (v: number, lines: number[]) => {
  let best = v, d = GRID_SNAP;
  for (const l of lines) if (Math.abs(l - v) <= d) { best = l; d = Math.abs(l - v); }
  return best === v ? Math.round(v / 5) * 5 : best;
};

/**
 * 切れ目に建具（サッシ・ドアの線）が描かれているか: 壁の厚さの中を、切れ目の半分以上にわたって走る線がある
 * （壁を貫いて続く通り芯は数えない）。
 * 何も無い切れ目は壁の終わり（通り抜けられる所）として開けたままにする。
 */
function hasJoinery(segs: WSeg[], dir: 'h' | 'v', c: number, t: number, lo: number, hi: number): boolean {
  const band = t / 2 + 40;
  let covered = 0;
  for (const s of segs) {
    const along = dir === 'h' ? [s.x1, s.x2] : [s.y1, s.y2], across = dir === 'h' ? [s.y1, s.y2] : [s.x1, s.x2];
    if (Math.abs(across[0] - c) > band || Math.abs(across[1] - c) > band) continue;
    const s0 = Math.min(along[0], along[1]), s1 = Math.max(along[0], along[1]);
    // 切れ目を大きく越えて続く線は通り芯・寸法線（建具ではない）
    if (s0 < lo - PASS || s1 > hi + PASS) continue;
    const a = Math.max(lo, s0), b = Math.min(hi, s1);
    if (b - a > 50) covered = Math.max(covered, b - a);
  }
  return covered >= (hi - lo) * 0.5;
}

/** 同じ線上の帯を壁の並びにまとめる。建具のある切れ目は開口部として 1 本の壁にする */
function toRuns(strips: Strip[], segs: WSeg[]): Run[] {
  const runs: Run[] = [];
  const rest = [...strips].sort((a, b) => (a.dir === b.dir ? a.c - b.c || a.lo - b.lo : a.dir < b.dir ? -1 : 1));
  const used = new Set<Strip>();
  for (const s of rest) {
    if (used.has(s)) continue;
    const line = rest.filter((x) => !used.has(x) && collinear(s, x)).sort((a, b) => a.lo - b.lo);
    line.forEach((x) => used.add(x));
    const total = line.reduce((v, x) => v + x.hi - x.lo, 0);
    const c = line.reduce((v, x) => v + x.c * (x.hi - x.lo), 0) / total;
    const t = line.reduce((v, x) => v + x.t * (x.hi - x.lo), 0) / total;
    let cur: Run = { dir: s.dir, c, lo: line[0].lo, hi: line[0].hi, t, gaps: [] };
    for (const x of line.slice(1)) {
      const gap = x.lo - cur.hi;
      if (gap <= TOUCH) cur.hi = Math.max(cur.hi, x.hi);
      else if (gap >= OPEN_MIN && gap <= OPEN_MAX && hasJoinery(segs, s.dir, c, t, cur.hi, x.lo)) { cur.gaps.push([cur.hi, x.lo]); cur.hi = x.hi; }
      else { runs.push(cur); cur = { dir: s.dir, c, lo: x.lo, hi: x.hi, t, gaps: [] }; }
    }
    runs.push(cur);
  }
  return runs;
}

/** 壁の端を、直角に交わる相手の壁芯まで伸ばす（縮める）。角・T 字で芯線どうしが届くようにする */
function joinEnds(runs: Run[]): Run[] {
  return runs.map((r) => {
    const end = (v: number, sign: -1 | 1) => {
      let best = v, d = Infinity;
      for (const o of runs) {
        if (o.dir === r.dir) continue;
        if (r.c < o.lo - TOUCH || r.c > o.hi + TOUCH) continue;
        const reach = o.t / 2 + TOUCH;
        // 相手の芯が端のすぐ先（または厚さの内側）にあるときだけ
        const gap = (o.c - v) * sign;
        if (gap < -reach || gap > reach) continue;
        if (Math.abs(gap) < d) { best = o.c; d = Math.abs(gap); }
      }
      return best;
    };
    return { ...r, lo: end(r.lo, -1), hi: end(r.hi, 1) };
  });
}

/**
 * 外壁の見分け: 壁を 100mm の升目に塗り、図面の外から塗りつぶして届いた升目に面していて、
 * かつその側から他の壁に当たらずに外まで見通せる壁を外壁とする（中庭を囲む壁は内壁になることがある）。
 * 開口部と同じ線上の切れ目は塞いでから塗る。
 */
function exteriorFlags(runs: Run[]): boolean[] {
  if (!runs.length) return [];
  const all = bounds(runs.map((r) => rectOf(r)), CELL * 3);
  const nx = Math.ceil((all.x1 - all.x0) / CELL), ny = Math.ceil((all.y1 - all.y0) / CELL);
  const WALL = 1, OUT = 2;
  const grid = new Uint8Array(nx * ny);
  const paint = (r: Rect) => {
    for (let j = Math.max(0, Math.floor((r.y0 - all.y0) / CELL)); j <= Math.min(ny - 1, Math.floor((r.y1 - all.y0) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((r.x0 - all.x0) / CELL)); i <= Math.min(nx - 1, Math.floor((r.x1 - all.x0) / CELL)); i++) grid[j * nx + i] = WALL;
  };
  for (const r of runs) paint(rectOf({ ...r, t: Math.max(r.t, CELL) }));
  // 同じ線上の切れ目（建具が読めなかった開口部）を塞ぐ
  for (const a of runs) for (const b of runs) {
    if (a === b || a.dir !== b.dir || Math.abs(a.c - b.c) > SAME_LINE || b.lo <= a.hi) continue;
    if (b.lo - a.hi <= OPEN_MAX) paint(rectOf({ dir: a.dir, c: a.c, lo: a.hi, hi: b.lo, t: CELL }));
  }
  const stack = [0];
  grid[0] = OUT;
  while (stack.length) {
    const k = stack.pop()!, i = k % nx, j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const p = i + di, q = j + dj;
      if (p < 0 || q < 0 || p >= nx || q >= ny || grid[q * nx + p]) continue;
      grid[q * nx + p] = OUT;
      stack.push(q * nx + p);
    }
  }
  return runs.map((r) => {
    const side = (sign: -1 | 1) => {
      let out = 0, n = 0;
      for (let s = r.lo + CELL / 2; s < r.hi; s += CELL) {
        const off = r.c + sign * (Math.max(r.t, CELL) / 2 + CELL);
        const x = r.dir === 'h' ? s : off, y = r.dir === 'h' ? off : s;
        const i = Math.floor((x - all.x0) / CELL), j = Math.floor((y - all.y0) / CELL);
        n++;
        if (i < 0 || j < 0 || i >= nx || j >= ny || grid[j * nx + i] === OUT) out++;
      }
      return n > 0 && out / n >= 0.5;
    };
    // 掃き出し窓などで外周が切れていると室内まで塗れてしまうので、「外まで見通せる」ことも条件にする
    return (side(-1) && seesOut(r, runs, -1)) || (side(1) && seesOut(r, runs, 1));
  });
}

/** 壁の sign 側から直角に見て、半分以上の位置で他の壁に当たらずに外まで抜ける */
function seesOut(r: Run, runs: Run[], sign: -1 | 1): boolean {
  let free = 0, n = 0;
  for (let s = r.lo + CELL / 2; s < r.hi; s += CELL) {
    n++;
    const blocked = runs.some((o) => {
      if (o === r) return false;
      const q = rectOf(o);
      const [a0, a1, c0, c1] = r.dir === 'h' ? [q.x0, q.x1, q.y0, q.y1] : [q.y0, q.y1, q.x0, q.x1];
      return s >= a0 && s <= a1 && (sign > 0 ? c1 > r.c + r.t : c0 < r.c - r.t);
    });
    if (!blocked) free++;
  }
  return n > 0 && free / n >= 0.5;
}

export type WallReadOptions = { /** 通り芯の位置（x と y）。あれば壁芯を通り芯へ寄せる */ gridX?: number[]; gridY?: number[] };

/**
 * 帯 → 壁。segs は図面のすべての線（建具の有無を見る）。
 * 長い壁から順に返す（短い壁を長い壁に T 字でつなげるため）。
 */
export function wallsFromStrips(strips: Strip[], segs: WSeg[], o: WallReadOptions = {}): WallSpec[] {
  const lx = snapLines(o.gridX ?? []), ly = snapLines(o.gridY ?? []);
  const snapped = buildingStrips(strips).map((s) => ({ ...s, c: snap(s.c, s.dir === 'h' ? ly : lx) }));
  // 建具になりうる線だけ先に選ぶ（軸に平行で、開口部より長くない線）
  const joinery = segs.filter((s) => {
    const dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1);
    return (dx < 1 || dy < 1) && dx + dy > 50 && dx + dy <= OPEN_MAX + PASS * 2;
  });
  const runs = joinEnds(toRuns(snapped, joinery)).filter((r) => r.hi - r.lo >= OPEN_MIN);
  const ext = exteriorFlags(runs);
  return runs
    .map((r, i): WallSpec => {
      const pt = (s: number): Vec2 => (r.dir === 'h' ? { x: Math.round(s), y: Math.round(r.c) } : { x: Math.round(r.c), y: Math.round(s) });
      return {
        a: pt(r.lo), b: pt(r.hi), thickness: Math.min(500, Math.max(50, Math.round(r.t / 5) * 5)), kind: ext[i] ? 'exterior' : 'interior',
        openings: r.gaps.map(([g0, g1]) => ({ offset: (g0 + g1) / 2 - r.lo, width: g1 - g0 })),
      };
    })
    .sort((p, q) => Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) - Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y));
}
