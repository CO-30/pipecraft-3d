/**
 * 床下の配管ルート探し（純粋関数）。方眼の上を縦横に進み、基礎の立上り（内部）は人通口などの切れ目を通って避ける。
 * 立上りを貫通するのは、遠回りが CROSS_COST より長くなるときだけ。曲がりは BEND_COST の遠回りとみなす（継手を減らす）。
 * 方眼は始点を原点に取るので、始点からの最初の向きはずれない。最後の 1 本は終点の線に合わせ直す。
 */
type Vec2 = { x: number; y: number };

/** 終点: 線分 a→b（点なら a = b）へ、向き dir（0:+x 1:+y 2:−x 3:−y）で着く */
export type RouteGoal = { a: Vec2; b: Vec2; dir: 0 | 1 | 2 | 3; tag: number };
export type RouteInput = {
  start: Vec2;
  /** 通ってよい所（建物の中で、外周の立上りから離れた所） */
  allowed: (p: Vec2) => boolean;
  /** 内部の立上りの上（貫通になる所） */
  footing: (p: Vec2) => boolean;
  goals: RouteGoal[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
  step?: number;
};
export type RouteResult = { points: Vec2[]; goal: RouteGoal; cost: number; crossings: number };

export const ROUTE_STEP = 100;
/** 曲がり 1 か所を、直線何 mm の遠回りとみなすか */
export const BEND_COST = 400;
/** 立上りの貫通 1 か所を、何 mm の遠回りとみなすか（人通口を通る方を選ぶ） */
export const CROSS_COST = 8000;
const DIRS: Vec2[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];

class Heap {
  private a: [number, number][] = [];
  push(k: number, v: number) {
    const a = this.a; a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): [number, number] | undefined {
    const a = this.a; if (!a.length) return undefined;
    const top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/** 方眼の点 c から向き d へまっすぐ進んで終点 g に着けるなら、その着く点と前へ進む距離 */
function reach(c: Vec2, d: number, g: RouteGoal, step: number): { p: Vec2; fwd: number } | null {
  const v = DIRS[d];
  if (g.dir !== d) return null;
  const ga = g.a, gb = g.b;
  const len = Math.hypot(gb.x - ga.x, gb.y - ga.y);
  if (len < 1e-6) {
    // 点: 横のずれは方眼の半分まで（あとで最後の 1 本を合わせる）、前へ 0〜1 目
    const fwd = (ga.x - c.x) * v.x + (ga.y - c.y) * v.y;
    const side = Math.abs((ga.x - c.x) * -v.y + (ga.y - c.y) * v.x);
    return fwd >= -1e-6 && fwd <= step + 1e-6 && side <= step / 2 + 1e-6 ? { p: ga, fwd } : null;
  }
  // 線分: 進む向きに直交していること。c から前へ伸ばした線との交点
  const u = { x: (gb.x - ga.x) / len, y: (gb.y - ga.y) / len };
  if (Math.abs(u.x * v.x + u.y * v.y) > 1e-6) return null;
  const fwd = (ga.x - c.x) * v.x + (ga.y - c.y) * v.y;
  if (fwd < -1e-6 || fwd > step + 1e-6) return null;
  const s = (c.x - ga.x) * u.x + (c.y - ga.y) * u.y;
  if (s < 1 || s > len - 1) return null; // 端点ちょうどは継手が重なるので避ける
  return { p: { x: ga.x + u.x * s, y: ga.y + u.y * s }, fwd };
}

/** 床下のルート。見つからなければ null */
export function findFloorRoute(inp: RouteInput): RouteResult | null {
  const step = inp.step ?? ROUTE_STEP;
  const { start: s0, bounds } = inp;
  const i0 = Math.floor((bounds.x0 - s0.x) / step) - 1, i1 = Math.ceil((bounds.x1 - s0.x) / step) + 1;
  const j0 = Math.floor((bounds.y0 - s0.y) / step) - 1, j1 = Math.ceil((bounds.y1 - s0.y) / step) + 1;
  const W = i1 - i0 + 1, H = j1 - j0 + 1;
  if (W <= 0 || H <= 0 || W * H > 400_000) return null;
  const at = (i: number, j: number): Vec2 => ({ x: s0.x + i * step, y: s0.y + j * step });
  const cell = (i: number, j: number) => (j - j0) * W + (i - i0);
  const allowed = new Int8Array(W * H).fill(-1), foot = new Int8Array(W * H).fill(-1);
  const ok = (i: number, j: number) => {
    const k = cell(i, j);
    if (allowed[k] < 0) allowed[k] = inp.allowed(at(i, j)) ? 1 : 0;
    return allowed[k] === 1;
  };
  const onFoot = (i: number, j: number) => {
    const k = cell(i, j);
    if (foot[k] < 0) foot[k] = inp.footing(at(i, j)) ? 1 : 0;
    return foot[k] === 1;
  };
  const N = W * H * 4;
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), cross = new Int16Array(N);
  const heap = new Heap();
  const key = (i: number, j: number, d: number) => cell(i, j) * 4 + d;
  // 始点は立上りの上でも、どの向きにも出られる
  for (let d = 0; d < 4; d++) { const k = key(0, 0, d); dist[k] = 0; heap.push(0, k); }
  let best: { k: number; cost: number; goal: RouteGoal; p: Vec2 } | null = null;
  for (let e = heap.pop(); e; e = heap.pop()) {
    const [c, k] = e;
    if (c > dist[k] || (best && c >= best.cost)) continue;
    const d = k % 4, ci = Math.floor(k / 4), i = (ci % W) + i0, j = Math.floor(ci / W) + j0;
    const here = at(i, j);
    for (const g of inp.goals) {
      const r = reach(here, d, g, step);
      if (r && (!best || c + r.fwd < best.cost)) best = { k, cost: c + r.fwd, goal: g, p: r.p };
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue; // 引き返さない
      const ni = i + DIRS[nd].x, nj = j + DIRS[nd].y;
      if (ni < i0 || ni > i1 || nj < j0 || nj > j1 || !ok(ni, nj)) continue;
      const enter = onFoot(ni, nj) && !onFoot(i, j);
      const along = onFoot(ni, nj) && onFoot(i, j);
      const isStart = i === 0 && j === 0;
      const nc = c + step + (nd !== d && !isStart ? BEND_COST : 0) + (enter ? CROSS_COST : 0) + (along ? step * 4 : 0);
      const nk = key(ni, nj, nd);
      if (nc < dist[nk]) { dist[nk] = nc; prev[nk] = k; cross[nk] = cross[k] + (enter ? 1 : 0); heap.push(nc, nk); }
    }
  }
  if (!best) return null;
  // たどって角の点だけにする
  const cells: { p: Vec2; d: number }[] = [];
  for (let k = best.k; k >= 0; k = prev[k]) {
    const ci = Math.floor(k / 4);
    cells.push({ p: at((ci % W) + i0, Math.floor(ci / W) + j0), d: k % 4 });
  }
  cells.reverse();
  const pts: Vec2[] = [{ ...s0 }];
  for (let n = 1; n < cells.length; n++) if (n + 1 < cells.length && cells[n + 1].d !== cells[n].d) pts.push({ ...cells[n].p });
  // 最後の 1 本を終点の線に合わせる（方眼の半分以内のずれ）
  const last = DIRS[best.goal.dir];
  const g = best.p;
  if (pts.length >= 2) {
    const c = pts[pts.length - 1];
    if (last.x !== 0) c.y = g.y; else c.x = g.x;
  } else if ((last.x !== 0 ? Math.abs(g.y - s0.y) : Math.abs(g.x - s0.x)) > 0.5) {
    // 始点からまっすぐ: ずれがあれば始点のすぐ先で横へずらす
    const off = last.x !== 0 ? { x: s0.x, y: g.y } : { x: g.x, y: s0.y };
    pts.push(off);
  }
  pts.push({ ...g });
  // 同じ点・一直線の点を除く
  const out: Vec2[] = [];
  for (const p of pts) {
    if (out.length && Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) < 0.5) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if (Math.abs((b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)) < 1e-6) out.pop();
    }
    out.push(p);
  }
  return { points: out, goal: best.goal, cost: best.cost, crossings: cross[best.k] };
}
