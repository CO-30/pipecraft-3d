/**
 * 図面 1 枚（PDF の線と文字）の見分け: 図面の種類・縮尺・通り芯。すべて純粋関数。
 * 紙の座標はポイント（1/72 インチ）、左上原点・y は下向き。
 * 図面座標(mm)は「X の最小番号の通り芯 × Y の最小番号の通り芯」を原点、x 東・y 北（紙の上を北とみなす）。
 */
import { PAPER_SCALES, detectDrawingScale } from '../underlay';

/** 線分。w は線の太さ（紙の上のポイント） */
export type PSeg = { x1: number; y1: number; x2: number; y2: number; w: number };
/** 文字。x, y は文字の中心、h は文字の高さ */
export type PText = { x: number; y: number; h: number; s: string };
export type VectorPage = { widthPt: number; heightPt: number; segs: PSeg[]; texts: PText[] };

export type SheetKind = 'plan' | 'foundation' | 'elevation' | 'site' | 'detail' | 'unknown';
export const SHEET_LABEL: Record<SheetKind, string> = { plan: '平面図', foundation: '基礎伏図', elevation: '立面図', site: '配置図', detail: '展開図・詳細図', unknown: '種類不明' };

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
const PT_MM = 25.4 / 72;

// 先に書いたものを優先（「基礎伏図」は「伏図」より先、「平面詳細図」は「詳細図」より先）
const TITLE_WORDS: [RegExp, SheetKind][] = [
  [/基礎伏図|基礎図|基礎配筋図/, 'foundation'],
  [/平面詳細図|平面図|間取り?図/, 'plan'],
  [/立面図/, 'elevation'],
  [/配置図|敷地図/, 'site'],
  [/展開図|矩計図|断面図|詳細図|伏図|仕上表|建具表|面積表|案内図/, 'detail'],
];

function titleKind(s: string): SheetKind | null {
  // 「展開図参照」「別紙参照」は他の図面を指す注記
  if (/参照|別紙|による/.test(s)) return null;
  for (const [re, kind] of TITLE_WORDS) if (re.test(s)) return kind;
  return null;
}

/**
 * 図面の種類を図面名の文字から決める。いちばん大きい文字の図面名を採る（同じ大きさなら TITLE_WORDS の順）。
 * 文字から決まらなければファイル名を見る。floor は「2階平面図」の 2（無ければ 1）。
 */
export function classifySheet(texts: PText[], fileName = ''): { kind: SheetKind; floor: number; title: string } {
  let best: { kind: SheetKind; h: number; title: string } | null = null;
  const order = (k: SheetKind) => TITLE_WORDS.findIndex(([, x]) => x === k);
  for (const t of texts) {
    const s = norm(t.s);
    const kind = titleKind(s);
    if (!kind) continue;
    if (!best || t.h > best.h * 1.05 || (t.h >= best.h * 0.95 && order(kind) < order(best.kind))) best = { kind, h: t.h, title: s };
  }
  if (!best) {
    const kind = titleKind(norm(fileName.replace(/\.[^.]+$/, '')));
    if (kind) best = { kind, h: 0, title: norm(fileName) };
  }
  if (!best) return { kind: 'unknown', floor: 1, title: '' };
  const all = texts.map((t) => norm(t.s));
  const m = /(\d)階/.exec(best.title) ?? (best.kind === 'plan' ? all.map((s) => /^(\d)階$/.exec(s)).find(Boolean) ?? null : null);
  return { kind: best.kind, floor: m ? Number(m[1]) : 1, title: best.title };
}

export type GridLine = { n: number; pos: number };
/** 通り芯。xs は X1, X2…の紙の x 座標、ys は Y1, Y2…の紙の y 座標（番号順） */
export type Grid = { xs: GridLine[]; ys: GridLine[] };

/** 「X1」「Y10」の文字から通り芯の位置を読む。上下（左右）の両側に同じ番号があれば平均する */
export function readGrid(texts: PText[]): Grid | null {
  const acc = { X: new Map<number, number[]>(), Y: new Map<number, number[]>() };
  for (const t of texts) {
    const m = /^([XY])(\d{1,2})$/.exec(norm(t.s).toUpperCase());
    if (!m) continue;
    const a = acc[m[1] as 'X' | 'Y'], n = Number(m[2]);
    a.set(n, [...(a.get(n) ?? []), m[1] === 'X' ? t.x : t.y]);
  }
  const lines = (a: Map<number, number[]>): GridLine[] =>
    [...a].map(([n, v]) => {
      // 凡例などに同じ文字が紛れても影響しないよう中央値
      const s = [...v].sort((p, q) => p - q);
      return { n, pos: s[Math.floor((s.length - 1) / 2)] };
    }).sort((p, q) => p.n - q.n);
  const xs = lines(acc.X), ys = lines(acc.Y);
  if (xs.length < 2 || ys.length < 2) return null;
  // 番号が増えるほど X は右、Y は上（紙では y が減る）でなければ通り芯ではない
  const mono = (g: GridLine[], sign: number) => g.every((l, i) => i === 0 || (l.pos - g[i - 1].pos) * sign > 0);
  return mono(xs, 1) && mono(ys, -1) ? { xs, ys } : null;
}

/** 通り芯の間隔（紙の pt）でいちばん多いもの */
function modalPitch(g: GridLine[]): number {
  const d = g.slice(1).map((l, i) => Math.abs(l.pos - g[i].pos) / (l.n - g[i].n)).sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

/**
 * 縮尺（1/n の n）。図面の文字 → 無ければ通り芯の間隔が 910mm（尺モジュール）か 1000mm に最も近くなる縮尺。
 * guessed: 文字から読めず推定した
 */
export function sheetScale(texts: PText[], grid: Grid | null): { scale: number; guessed: boolean } | null {
  const s = detectDrawingScale(texts.map((t) => t.s));
  if (s) return { scale: s, guessed: false };
  // 表題欄の「1/50」だけの文字（「SCALE」の欄と別の文字列になっている図面）。違う値が混ざるなら採らない
  const lone = new Set(texts.map((t) => /^1[/:](\d{2,3})$/.exec(norm(t.s))).filter(Boolean).map((m) => Number(m![1])));
  const title = lone.size === 1 && (PAPER_SCALES as readonly number[]).includes([...lone][0]) ? [...lone][0] : undefined;
  if (!grid) return title ? { scale: title, guessed: false } : null;
  const pitch = modalPitch(grid.xs) * PT_MM;
  let best: { scale: number; err: number } | null = null;
  for (const n of PAPER_SCALES) for (const mod of [910, 1000]) {
    const err = Math.abs(pitch * n - mod) / mod;
    if (!best || err < best.err) best = { scale: n, err };
  }
  if (best && best.err < 0.03) return { scale: best.scale, guessed: best.scale !== title };
  return title ? { scale: title, guessed: false } : null;
}

/** 紙の座標 → 図面座標(mm) の変換。ox, oy は原点（紙の pt）、k は 1pt あたりの mm */
export type ToWorld = { ox: number; oy: number; k: number };
export const toWorldX = (t: ToWorld, x: number) => (x - t.ox) * t.k;
export const toWorldY = (t: ToWorld, y: number) => (t.oy - y) * t.k;

/** 基準の図面（通り芯の最小番号を原点にする） */
export function baseTransform(grid: Grid, scale: number): ToWorld {
  return { ox: grid.xs[0].pos, oy: grid.ys[0].pos, k: PT_MM * scale };
}

/** 通り芯の番号 → 図面座標(mm) */
export type GridWorld = { xs: Map<number, number>; ys: Map<number, number> };
export function gridWorld(grid: Grid, t: ToWorld): GridWorld {
  return { xs: new Map(grid.xs.map((l) => [l.n, toWorldX(t, l.pos)])), ys: new Map(grid.ys.map((l) => [l.n, toWorldY(t, l.pos)])) };
}

/**
 * 別の図面を、同じ番号の通り芯が重なるように合わせる。縮尺は通り芯の間隔から決める（文字の縮尺より確実）。
 * 共通の通り芯が X・Y それぞれ 2 本以上無ければ null。
 * shiftX / shiftY: この図面の番号 n を、基準の図面の n + shift とみなす（図面どうしで番号が 1 つずれていることがある）。
 */
export function alignTransform(grid: Grid, base: GridWorld, shiftX = 0, shiftY = 0): ToWorld | null {
  const pairs = (g: GridLine[], w: Map<number, number>, shift: number) => g.filter((l) => w.has(l.n + shift)).map((l) => ({ p: l.pos, w: w.get(l.n + shift)! }));
  const px = pairs(grid.xs, base.xs, shiftX), py = pairs(grid.ys, base.ys, shiftY);
  if (px.length < 2 || py.length < 2) return null;
  const span = (a: { p: number; w: number }[]) => Math.abs(a.at(-1)!.w - a[0].w) / Math.abs(a.at(-1)!.p - a[0].p);
  const k = (span(px) + span(py)) / 2;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return { k, ox: mean(px.map((q) => q.p - q.w / k)), oy: mean(py.map((q) => q.p + q.w / k)) };
}

export const PT_TO_MM = PT_MM;
