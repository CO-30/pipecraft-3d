/**
 * 図面の文字が重ならないように置く仕組み（全図面で共通）。
 * - LabelPlacer: 文字の置き場所の候補を順に試し、ほかの文字・記号・配管と重ならない最初の場所に置く。
 *   近くに置けないときは離して細い引出線を引く。
 * - spread1D: 表の列など 1 方向に並ぶ位置を、最小の間隔が空くように最小限だけずらす。
 * - findTextOverlaps: 図面内の文字どうしの重なりを数える（テストで「重なり 0」を守るための検査）。
 * 単位は用紙 mm。文字幅は同梱フォント（Noto Sans JP）に合わせた近似。
 */
import type { Op, Sheet } from './sheet';

export type TextOp = Extract<Op, { t: 'text' }>;
export type Rect = { x1: number; y1: number; x2: number; y2: number };
type Seg = { x1: number; y1: number; x2: number; y2: number; id?: string };

const ASCENT = 0.86, DESCENT = 0.16;

/** 文字列の幅(mm)。全角 1、英大文字・記号は広め、数字・小文字は 0.56 */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w += c >= 0x100 ? 1 : c === 0x20 ? 0.3 : /[A-Z%@#&]/.test(ch) ? 0.68 : /[.,:;'|!()\-ilj]/.test(ch) ? 0.36 : 0.57;
  }
  return w * size;
}

/** 文字の占める範囲。回転した文字は 1 文字ぶんずつの小さな矩形に分ける */
export function textRects(o: TextOp, pad = 0): Rect[] {
  const w = textWidth(o.s, o.size);
  const th = ((o.rotate ?? 0) * Math.PI) / 180;
  const ux = Math.cos(th), uy = Math.sin(th); // 文字の進む向き
  const nx = Math.sin(th), ny = -Math.cos(th); // 文字の上の向き
  const s0 = o.anchor === 'middle' ? -w / 2 : o.anchor === 'end' ? -w : 0;
  const axis = Math.abs(ux) < 1e-6 || Math.abs(uy) < 1e-6;
  const cells = axis ? 1 : Math.max(1, Math.ceil(w / o.size));
  const out: Rect[] = [];
  for (let i = 0; i < cells; i++) {
    const a = s0 + (w * i) / cells, b = s0 + (w * (i + 1)) / cells;
    const xs: number[] = [], ys: number[] = [];
    for (const s of [a, b]) for (const t of [-DESCENT * o.size, ASCENT * o.size]) { xs.push(o.x + ux * s + nx * t); ys.push(o.y + uy * s + ny * t); }
    out.push({ x1: Math.min(...xs) - pad, y1: Math.min(...ys) - pad, x2: Math.max(...xs) + pad, y2: Math.max(...ys) + pad });
  }
  return out;
}

const hit = (a: Rect, b: Rect) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));

/** 線分が矩形を横切るか（Liang–Barsky） */
export function segHitsRect(s: { x1: number; y1: number; x2: number; y2: number }, r: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, s.x1 - r.x1) && clip(dx, r.x2 - s.x1) && clip(-dy, s.y1 - r.y1) && clip(dy, r.y2 - s.y1) && t0 < t1;
}

/** 置き場所の候補。texts をまとめて 1 つの札として置く。penalty が小さいほど優先 */
export type Cand = { texts: TextOp[]; leader?: Seg & { color?: string }; penalty: number };

export class LabelPlacer {
  private hard: Rect[] = [];
  private segs: Seg[] = [];
  private sheet: Sheet;
  private bounds: Rect;
  /** すでに描いてある文字は動かせない障害物として登録する */
  constructor(sheet: Sheet, bounds: Rect) {
    this.sheet = sheet; this.bounds = bounds;
    for (const o of sheet.ops) if (o.t === 'text') this.blockText(o);
  }
  block(r: Rect): void { this.hard.push(r); }
  blockText(o: TextOp): void { this.hard.push(...textRects(o, 0.25)); }
  /** 配管などの線。文字はなるべく線をまたがない */
  blockSeg(x1: number, y1: number, x2: number, y2: number, id?: string): void { this.segs.push({ x1, y1, x2, y2, id }); }

  /** 重ならない場所が見つからず、重なったまま置いた札の数（呼び出し側で注意書きに使う） */
  collisions = 0;

  private cost(c: Cand, ignoreSeg: string | undefined, limit: number): number {
    let cost = c.penalty;
    const b = this.bounds;
    for (const t of c.texts) for (const r of textRects(t, 0.25)) {
      if (r.x1 < b.x1 || r.y1 < b.y1 || r.x2 > b.x2 || r.y2 > b.y2) cost += 5000;
      for (const h of this.hard) if (hit(r, h)) cost += 1000 + area(r, h) * 10;
      if (cost >= limit) return cost; // これより良い候補がすでにある
      // 自分の線は、線に沿って書く札（引出線なし）のときだけ無視する
      for (const s of this.segs) if ((s.id === undefined || s.id !== ignoreSeg || c.leader) && segHitsRect(s, r)) cost += 60;
    }
    if (c.leader) {
      for (const h of this.hard) if (segHitsRect(c.leader, h)) cost += 400;
    }
    return cost;
  }

  /** 候補から選んで描く。全部ぶつかるときは、いちばんましな場所に置く（collisions に数える） */
  place(cands: Cand[], opts: { ignoreSeg?: string } = {}): Cand | undefined {
    let best: Cand | undefined, bestCost = Infinity;
    // 優先度の順に試し、残りの候補がこれ以上良くならなくなったら打ち切る
    for (const c of [...cands].sort((p, q) => p.penalty - q.penalty)) {
      if (c.penalty >= bestCost) break;
      const k = this.cost(c, opts.ignoreSeg, bestCost);
      if (k < bestCost) { best = c; bestCost = k; }
    }
    if (!best) return undefined;
    if (bestCost >= 1000) this.collisions++;
    if (best.leader) {
      this.sheet.ops.push({ t: 'line', x1: best.leader.x1, y1: best.leader.y1, x2: best.leader.x2, y2: best.leader.y2, w: 0.12, color: best.leader.color });
      this.segs.push(best.leader);
    }
    for (const t of best.texts) { this.sheet.ops.push(t); this.blockText(t); }
    return best;
  }
}

export type LabelLine = { s: string; size: number; color?: string; bold?: boolean };
/** 方向（度。0=右、-90=上、90=下、180=左） */
const DIRS = [0, -45, 45, -90, 90, 180, -135, 135, -20, 20, -70, 70, -110, 110, 160, -160];

/**
 * 点 (ax, ay) のまわりに、横書きの札（複数行可）を置く候補。
 * gap: 点から札までの最小の距離。離れた候補には引出線が付く（leaderAlways なら近くても付ける）。
 */
export function around(ax: number, ay: number, lines: LabelLine[], opts: { gap?: number; prefer?: number[]; leaderAlways?: boolean; leaderColor?: string; maxDist?: number } = {}): Cand[] {
  const gap = opts.gap ?? 2;
  const lineH = Math.max(...lines.map((l) => l.size)) * 1.3;
  const W = Math.max(...lines.map((l) => textWidth(l.s, l.size))), H = lineH * lines.length;
  const dirs = [...(opts.prefer ?? []), ...DIRS.filter((d) => !(opts.prefer ?? []).includes(d))];
  const out: Cand[] = [];
  const dists = [0, 3, 6, 10, 15, 22, 30, 40, 52, 66, 82].filter((d) => d <= (opts.maxDist ?? 82));
  dists.forEach((extra, di) => {
    dirs.forEach((deg, i) => {
      const r = (deg * Math.PI) / 180, dx = Math.cos(r), dy = Math.sin(r);
      const d = gap + extra;
      // 札の矩形が点から d だけ離れて接するように中心を決める
      const cx = ax + dx * (d + (Math.abs(dx) * W) / 2), cy = ay + dy * (d + (Math.abs(dy) * H) / 2);
      const left = cx - W / 2, top = cy - H / 2;
      const texts: TextOp[] = lines.map((l, k) => ({ t: 'text', x: left, y: top + lineH * k + l.size * ASCENT, s: l.s, size: l.size, color: l.color, ...(l.bold ? { bold: true } : {}) }));
      const withLeader = opts.leaderAlways || extra > 0;
      const px = Math.min(Math.max(ax, left), left + W), py = Math.min(Math.max(ay, top - 0.2), top + H);
      out.push({ texts, penalty: di * 20 + i, ...(withLeader ? { leader: { x1: ax, y1: ay, x2: px, y2: py, color: opts.leaderColor ?? lines[0].color } } : {}) });
    });
  });
  return out;
}

/** 決まった場所 1 か所の候補 */
export function at(x: number, y: number, l: LabelLine, anchor: TextOp['anchor'] = 'start', penalty = 0, rotate?: number): Cand {
  return { texts: [{ t: 'text', x, y, s: l.s, size: l.size, anchor, color: l.color, ...(l.bold ? { bold: true } : {}), ...(rotate ? { rotate } : {}) }], penalty };
}
/** 候補の優先度を下げる */
export const later = (n: number) => (c: Cand): Cand => ({ ...c, penalty: c.penalty + n });

/** 線に沿って（線と平行に回して）置く候補。線が文字より短いときは空 */
export function alongLine(x1: number, y1: number, x2: number, y2: number, l: LabelLine): Cand[] {
  const L = Math.hypot(x2 - x1, y2 - y1), w = textWidth(l.s, l.size);
  if (L < w + 2) return [];
  let deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  // 文字は左から右へ。ほぼ縦の線は下から上へ読む向きにそろえる
  if (deg > 80) deg -= 180; else if (deg < -100) deg += 180;
  const th = (deg * Math.PI) / 180, nx = Math.sin(th), ny = -Math.cos(th);
  const rot = Math.abs(deg) < 0.01 ? 0 : Math.round(deg * 100) / 100;
  const tMin = (w / 2 + 1) / L;
  const ts = [0.5, 0.36, 0.64, 0.24, 0.76].filter((t) => t >= tMin - 1e-9 && t <= 1 - tMin + 1e-9);
  const out: Cand[] = [];
  ts.forEach((t, i) => {
    const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
    // 線の上側 → 下側
    [l.size * DESCENT + 0.6, -(l.size * ASCENT + 0.6)].forEach((off, side) => {
      out.push({ texts: [{ t: 'text', x: px + nx * off, y: py + ny * off, s: l.s, size: l.size, anchor: 'middle', color: l.color, ...(rot ? { rotate: rot } : {}) }], penalty: i * 2 + side });
    });
  });
  return out;
}

/**
 * 1 方向に並ぶ位置を、隣との間隔が gaps 以上になるように最小限ずらす（順番は変えない）。
 * gap は数値（全部同じ）か、各位置の必要な幅の配列。lo〜hi に収まらないときは間隔を均等に詰める。
 */
export function spread1D(xs: number[], gap: number | number[], lo: number, hi: number): number[] {
  const n = xs.length;
  if (n === 0) return [];
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const wOf = (i: number) => (typeof gap === 'number' ? gap : gap[i]);
  // 隣どうしの必要な間隔 = 両方の幅の半分ずつ
  const need = order.slice(1).map((o, k) => (wOf(order[k].i) + wOf(o.i)) / 2);
  const total = need.reduce((a, b) => a + b, 0);
  const scale = total > hi - lo && total > 0 ? (hi - lo) / total : 1;
  const pos = order.map((o) => Math.min(Math.max(o.x, lo), hi));
  // 左から押し、右端を超えたら右から押し戻す。数回で落ち着く
  for (let it = 0; it < 4; it++) {
    for (let k = 1; k < n; k++) pos[k] = Math.max(pos[k], pos[k - 1] + need[k - 1] * scale);
    if (pos[n - 1] > hi) pos[n - 1] = hi;
    for (let k = n - 2; k >= 0; k--) pos[k] = Math.min(pos[k], pos[k + 1] - need[k] * scale);
    if (pos[0] < lo) pos[0] = lo;
  }
  // 押し出された塊を、元の位置の重心に寄せ直す（片側に偏らないように）
  let k = 0;
  while (k < n) {
    let e = k;
    while (e + 1 < n && pos[e + 1] - pos[e] <= need[e] * scale + 1e-6) e++;
    if (e > k) {
      let shift = 0;
      for (let j = k; j <= e; j++) shift += order[j].x - pos[j];
      shift /= e - k + 1;
      const minS = (k > 0 ? pos[k - 1] + need[k - 1] * scale : lo) - pos[k], maxS = (e + 1 < n ? pos[e + 1] - need[e] * scale : hi) - pos[e];
      shift = Math.min(Math.max(shift, minS), maxS);
      for (let j = k; j <= e; j++) pos[j] += shift;
    }
    k = e + 1;
  }
  const out = new Array<number>(n);
  order.forEach((o, j) => { out[o.i] = pos[j]; });
  return out;
}

/** 図面内で重なっている文字の組（検査用）。tol だけ内側に縮めて比べる */
export function findTextOverlaps(sheet: Sheet, tol = 0.15): { a: string; b: string }[] {
  const texts = sheet.ops.filter((o): o is TextOp => o.t === 'text' && o.s.trim() !== '');
  const rects = texts.map((t) => textRects(t, -tol));
  const out: { a: string; b: string }[] = [];
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    if (rects[i].some((a) => rects[j].some((b) => hit(a, b)))) out.push({ a: texts[i].s, b: texts[j].s });
  }
  return out;
}
