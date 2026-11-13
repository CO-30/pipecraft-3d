/**
 * 屋外の地中の道（建物を避けて、直線・L 字・建物の周りを回る道・方眼の道の順に探す）。
 * 屋外の汚水（マスどうし・公共マスまで）と、外回りの給水（メーター → 給湯器の近く・立水栓）で使う。純粋関数。
 */
import type { Doc } from './doc';
import type { Vec3 } from './network';
import { distToOutline, insideBuilding, underfloorLevels } from './underfloorSlope';

/** 屋外の管を外壁（芯）から離す距離 mm */
const YARD_CLEAR_DEFAULT = 300;
/** 建物の周りを回る道: 外壁の外側この距離を通る mm */
const AROUND = 700;
/** 曲がりにマスを置けるよう、曲がりのある道では 1m より短い区間を避ける */
const MIN_LEG = 1000, SHORT_LEG_COST = 3000;
/** 方眼の道探しの間隔・まわりの余白・曲がり 1 回の重み(mm) */
const GRID = 250, GRID_PAD = 2500, TURN_COST = 1500;

const pointSeg = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
};

/** 屋外の道を探す関数を作る（建物の形はここで 1 回だけ読む）。a → c の点の列（a・c を含む）。見つからなければ null */
export function makeYardRouter(doc: Doc, opts: { clear?: number } = {}): (a: Vec3, c: Vec3) => Vec3[] | null {
  const YARD_CLEAR = opts.clear ?? YARD_CLEAR_DEFAULT;
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

  return route;
}
