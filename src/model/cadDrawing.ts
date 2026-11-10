/**
 * CAD図面（Jw_cad の .jww）を下敷き用の線画にする。純粋関数のみ。
 * 入力は ezjww の解析結果（必要な項目だけ）。座標は用紙上の mm（原点は用紙の中心、y は上向き）。
 * 実寸は「用紙mm × レイヤグループの縮尺」。
 */

export type JwwBase = { layer: number; layer_group: number; pen_style: number };
type LineLike = { start_x: number; start_y: number; end_x: number; end_y: number };
type TextLike = LineLike & { size_x: number; size_y: number; angle: number; content: string };
export type JwwEntityLike = {
  type: string;
  base: JwwBase;
  start_x?: number; start_y?: number; end_x?: number; end_y?: number;
  center_x?: number; center_y?: number; radius?: number;
  start_angle?: number; arc_angle?: number; tilt_angle?: number; flatness?: number; is_full_circle?: boolean;
  size_x?: number; size_y?: number; angle?: number; content?: string;
  ref_x?: number; ref_y?: number; scale_x?: number; scale_y?: number; rotation?: number; def_number?: number;
  line?: LineLike; text?: TextLike; aux_lines?: LineLike[];
};
export type JwwLike = {
  header: { paper_size: number; layer_groups: { state: number; scale: number; layers: { state: number }[] }[] };
  entities: JwwEntityLike[];
  block_defs: { number: number; entities: JwwEntityLike[] }[];
};

export type CadLine = { x1: number; y1: number; x2: number; y2: number };
/** angle は度（反時計回り）。h は文字の高さ、w は1文字の幅（用紙mm） */
export type CadText = { x: number; y: number; h: number; w: number; angle: number; content: string };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type CadDrawing = {
  lines: CadLine[];
  texts: CadText[];
  /** 下敷きにする範囲（用紙mm） */
  bounds: Bounds;
  /** 採用した縮尺の分母（1/100 なら 100） */
  scale: number;
  /** 図形のあるレイヤグループの縮尺（小さい順・重複なし） */
  scales: number[];
  /** 利用者に知らせること */
  notes: string[];
  empty: boolean;
};

/** 用紙サイズ（mm）。JWW の用紙コード 0〜4 = A0〜A4。それ以外は不明として扱う */
const PAPER: Record<number, [number, number]> = { 0: [1189, 841], 1: [841, 594], 2: [594, 420], 3: [420, 297], 4: [297, 210] };
/** ブロックの入れ子の上限 */
const MAX_NEST = 8;
/** 円弧を折れ線にするときの1区間の角度 */
const ARC_STEP = Math.PI / 18;
const AUX_LINE_STYLE = 9;
/** 線分の上限。ブロックの入れ子で図形が増えすぎる図面は取り込まない（端末のメモリを守る） */
export const MAX_CAD_LINES = 400_000;

/** 2×3 のアフィン変換 [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f */
type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];
const apply = (m: Mat, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const fin = (...v: (number | undefined)[]) => v.every((n) => typeof n === 'number' && Number.isFinite(n));
const deg = (r: number) => (r * 180) / Math.PI;

export function jwwToDrawing(doc: JwwLike): CadDrawing {
  const lines: CadLine[] = [];
  const texts: CadText[] = [];
  const perGroup = new Map<number, number>();
  const defs = new Map(doc.block_defs.map((b) => [b.number, b.entities]));
  const groups = doc.header.layer_groups;

  const visible = (b: JwwBase) => {
    const g = groups[b.layer_group];
    if (!g) return true;
    return g.state !== 0 && g.layers[b.layer]?.state !== 0;
  };

  const push = (l: CadLine) => {
    if (lines.length >= MAX_CAD_LINES) throw new Error('図面が大きすぎます（線が多すぎます）。Jw_cad で必要な範囲だけにして保存し直してください');
    lines.push(l);
  };
  const addLine = (m: Mat, l: LineLike | undefined) => {
    if (!l || !fin(l.start_x, l.start_y, l.end_x, l.end_y)) return 0;
    const p = apply(m, l.start_x, l.start_y), q = apply(m, l.end_x, l.end_y);
    push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
    return 1;
  };
  const addText = (m: Mat, t: TextLike | undefined) => {
    if (!t || !fin(t.start_x, t.start_y, t.size_y) || typeof t.content !== 'string') return 0;
    const content = t.content.trim();
    if (!content || content.startsWith('^@BM')) return 0;
    const p = apply(m, t.start_x, t.start_y);
    // ブロックの倍率: 文字の幅は横方向、高さは縦方向の倍率を掛ける
    const kx = Math.hypot(m[0], m[1]) || 1, ky = Math.hypot(m[2], m[3]) || 1;
    const rot = deg(Math.atan2(m[1], m[0]));
    const w = fin(t.size_x) ? t.size_x : t.size_y;
    texts.push({ x: p.x, y: p.y, h: t.size_y * ky, w: w * kx, angle: (fin(t.angle) ? t.angle : 0) + rot, content });
    return 1;
  };
  const addArc = (m: Mat, e: JwwEntityLike) => {
    if (!fin(e.center_x, e.center_y, e.radius) || !(e.radius! > 0)) return 0;
    const full = e.is_full_circle ?? e.type === 'CIRCLE';
    const a0 = full ? 0 : fin(e.start_angle) ? e.start_angle! : 0;
    const da = full ? Math.PI * 2 : fin(e.arc_angle) ? e.arc_angle! : 0;
    if (da === 0) return 0;
    const flat = fin(e.flatness) && e.flatness! > 0 ? e.flatness! : 1;
    const tilt = fin(e.tilt_angle) ? e.tilt_angle! : 0;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const n = Math.min(360, Math.max(4, Math.ceil(Math.abs(da) / ARC_STEP)));
    const at = (i: number) => {
      const t = a0 + (da * i) / n;
      const lx = e.radius! * Math.cos(t), ly = e.radius! * flat * Math.sin(t);
      return apply(m, e.center_x! + lx * ct - ly * st, e.center_y! + lx * st + ly * ct);
    };
    let p = at(0);
    for (let i = 1; i <= n; i++) {
      const q = at(i);
      push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
      p = q;
    }
    return 1;
  };

  /** 追加した図形の数を返す */
  const walk = (es: JwwEntityLike[], m: Mat, depth: number, stack: number[]): number => {
    let n = 0;
    for (const e of es) {
      if (!e?.base || e.base.pen_style === AUX_LINE_STYLE) continue;
      if (depth === 0 && !visible(e.base)) continue;
      let added = 0;
      switch (e.type) {
        case 'LINE': added = addLine(m, e as LineLike); break;
        case 'ARC': case 'CIRCLE': added = addArc(m, e); break;
        case 'TEXT': added = addText(m, e as TextLike); break;
        case 'DIMENSION':
          added = addLine(m, e.line) + addText(m, e.text);
          for (const a of e.aux_lines ?? []) added += addLine(m, a);
          break;
        case 'BLOCK': {
          const def = defs.get(e.def_number ?? NaN);
          if (!def || depth >= MAX_NEST || stack.includes(e.def_number!)) break;
          if (!fin(e.ref_x, e.ref_y)) break;
          const sx = fin(e.scale_x) && e.scale_x !== 0 ? e.scale_x! : 1;
          const sy = fin(e.scale_y) && e.scale_y !== 0 ? e.scale_y! : 1;
          const r = fin(e.rotation) ? e.rotation! : 0;
          const c = Math.cos(r), s = Math.sin(r);
          added = walk(def, mul(m, [c * sx, s * sx, -s * sy, c * sy, e.ref_x!, e.ref_y!]), depth + 1, [...stack, e.def_number!]);
          break;
        }
        default: break; // 点・塗り（ソリッド）・画像は下敷きに描かない
      }
      n += added;
      if (depth === 0 && added) perGroup.set(e.base.layer_group, (perGroup.get(e.base.layer_group) ?? 0) + added);
    }
    return n;
  };
  walk(doc.entities, IDENT, 0, []);

  // 縮尺: 図形が最も多いレイヤグループ
  const scaleOf = (g: number) => { const s = groups[g]?.scale; return fin(s) && s! > 0 ? s! : 1; };
  let scale = 1, best = -1;
  for (const [g, n] of perGroup) if (n > best) { best = n; scale = scaleOf(g); }
  const scales = [...new Set([...perGroup.keys()].map(scaleOf))].sort((a, b) => a - b);
  const notes: string[] = [];
  if (scales.length > 1) {
    notes.push(`縮尺の違う図が混ざっています（${scales.map((s) => `1/${s}`).join('・')}）。図形の多い 1/${scale} に合わせました。寸法が合わないときは「2点で縮尺」で直してください`);
  }

  return { lines, texts, bounds: boundsOf(lines, texts, PAPER[doc.header.paper_size]), scale, scales, notes, empty: lines.length + texts.length === 0 };
}

function boundsOf(lines: CadLine[], texts: CadText[], paper?: [number, number]): Bounds {
  const pts: [number, number][] = [];
  for (const l of lines) pts.push([l.x1, l.y1], [l.x2, l.y2]);
  for (const t of texts) {
    // 文字は書き出し位置と、おおよその終わり（文字数×幅）・高さを範囲に入れる
    const a = (t.angle * Math.PI) / 180, len = [...t.content].length * t.w;
    pts.push([t.x, t.y], [t.x + Math.cos(a) * len, t.y + Math.sin(a) * len], [t.x - Math.sin(a) * t.h, t.y + Math.cos(a) * t.h]);
  }
  const of = (ps: [number, number][]): Bounds | null => {
    if (!ps.length) return null;
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [x, y] of ps) {
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
    return b;
  };
  if (paper) {
    // 用紙から大きく外れた図形（消し忘れなど）で図面が小さくならないように、用紙の 1.25 倍の範囲で見る
    const hx = (paper[0] / 2) * 1.25, hy = (paper[1] / 2) * 1.25;
    const kept = pts.filter(([x, y]) => Math.abs(x) <= hx && Math.abs(y) <= hy);
    // ほとんどが用紙の中にあるときだけ外れた図形を無視する（原点が用紙の中心でない図面は全体を使う）
    if (kept.length >= pts.length * 0.9) { const inside = of(kept); if (inside) return inside; }
  }
  return of(pts) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

export type DrawingFit = {
  widthPx: number;
  heightPx: number;
  /** 1px あたりの用紙mm */
  paperMmPerPx: number;
  /** 1px あたりの実寸mm（下敷きの縮尺） */
  mmPerPx: number;
  /** 用紙mm → 画素（左上原点・下向き） */
  toPx(x: number, y: number): { x: number; y: number };
};

/** 図形の範囲に余白を付け、長辺が maxPx になる画像の大きさと座標変換を決める */
export function fitDrawing(d: Pick<CadDrawing, 'bounds' | 'scale'>, maxPx: number): DrawingFit {
  const b = d.bounds;
  const bw = Math.max(b.maxX - b.minX, 0), bh = Math.max(b.maxY - b.minY, 0);
  const margin = Math.max(2, Math.max(bw, bh) * 0.03);
  const w = bw + margin * 2, h = bh + margin * 2;
  const paperMmPerPx = Math.max(w, h) / maxPx;
  return {
    widthPx: Math.max(1, Math.round(w / paperMmPerPx)),
    heightPx: Math.max(1, Math.round(h / paperMmPerPx)),
    paperMmPerPx,
    mmPerPx: paperMmPerPx * d.scale,
    toPx: (x, y) => ({ x: (x - b.minX + margin) / paperMmPerPx, y: (b.maxY + margin - y) / paperMmPerPx }),
  };
}
