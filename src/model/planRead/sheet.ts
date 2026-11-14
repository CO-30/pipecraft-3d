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
/** truncated: 線が多すぎて途中までしか読んでいない */
export type VectorPage = { widthPt: number; heightPt: number; segs: PSeg[]; texts: PText[]; truncated?: boolean; /** 文字だけ読んで線は読まなかった（図面リスト・仕様書など） */ skipped?: boolean };

export type SheetKind = 'plan' | 'foundation' | 'elevation' | 'section' | 'site' | 'detail' | 'other' | 'unknown';
export const SHEET_LABEL: Record<SheetKind, string> = {
  plan: '平面図', foundation: '基礎伏図', elevation: '立面図', section: '断面図', site: '配置図', detail: '展開図・詳細図', other: '図面リスト・仕様書など', unknown: '種類不明',
};

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
const PT_MM = 25.4 / 72;

// 先に書いたものを優先（「基礎伏図」は「伏図」より先、「平面詳細図」は「詳細図」より先）
const TITLE_WORDS: [RegExp, SheetKind][] = [
  [/基礎伏図|基礎図|基礎配筋図/, 'foundation'],
  [/平面詳細図|平面図|間取り?図/, 'plan'],
  [/立面図/, 'elevation'],
  [/配置図|敷地図/, 'site'],
  // 「断面詳細図」は詳細図（「断面図」の文字を含まない）
  [/断面図/, 'section'],
  [/展開図|矩計図|詳細図|伏図|仕上表|建具表|面積表|案内図/, 'detail'],
];
/** 表題欄の図面名がこれなら、平面図などの文字が入っていても読まない（図面リスト・仕様書・法規・日影・斜線・面積・建具・天井伏など） */
const OTHER_TITLE = /図面(リスト|目録|一覧)|仕様書|法規|日影|斜線|天空率|平均地盤|求積|面積|建具|KEYPLAN|天井伏|展開図|仕上表|概要書/i;

/**
 * 表題欄の「図面名称」の値（同じ行の右、無ければすぐ下）。図面一式の PDF では、図面の中の文字（図面リストの「1階平面図」、
 * 詳細の「S=1/20」など）より、表題欄の名前が確か
 */
export function titleBlockName(texts: PText[]): string | null {
  const isLabel = (s: string) => /^(図面名称|図面名|図名|図面名称:)$/.test(s);
  const stop = /^(図面番号|図番|縮尺|縮尺:|尺度|SCALE|工事名称|工事名|工事場所|日付|設計|製図|備考|承認|検図|NO\.?$)/i;
  for (const lab of texts.filter((t) => isLabel(norm(t.s)))) {
    const right = texts.filter((t) => t !== lab && Math.abs(t.y - lab.y) <= Math.max(lab.h, t.h) * 0.8 && t.x > lab.x && t.x - lab.x < 450).sort((a, b) => a.x - b.x);
    for (const t of right) {
      const s = norm(t.s);
      if (stop.test(s)) break;
      // 図面名は見出しより小さくない文字
      if (s.length >= 2 && t.h >= lab.h * 0.9) return s;
    }
    const below = texts.filter((t) => t !== lab && t.y > lab.y && t.y - lab.y < lab.h * 4 && Math.abs(t.x - lab.x) < 80).sort((a, b) => a.y - b.y);
    if (below[0] && !stop.test(norm(below[0].s))) return norm(below[0].s);
  }
  return null;
}

/**
 * 図面名 → 階。「1階平面図」→[1]、「2~4階平面図」→[2,3,4]（同じ平面の階）、「R階平面図」「屋上」→ roof。無ければ []
 */
export function floorsOfTitle(title: string): { floors: number[]; roof: boolean } {
  const t = norm(title);
  // 屋上・塔屋（「R階平面図」「RF平面図」「屋上平面図」「PH階」）。「RC造…」などは屋上にしない
  if (/^(R|PH)(階|F)(?!L)|^(屋上|塔屋|屋根伏)|R階|RF平面/.test(t)) return { floors: [], roof: true };
  const r = /(\d{1,2})[~〜～\-－・,、](\d{1,2})(?:階|F)(?!建)/i.exec(t);
  if (r) {
    const a = Number(r[1]), b = Number(r[2]);
    if (b >= a && b - a < 30) return { floors: Array.from({ length: b - a + 1 }, (_, i) => a + i), roof: false };
  }
  // 「2階建て」は階ではない
  // 「1階・2階平面図」のように並べた階
  const all = [...t.matchAll(/(\d{1,2})(?:階|F)(?!建)/gi)].map((x) => Number(x[1]));
  if (all.length > 1 && /(\d{1,2})(?:階|F)[・、,](\d{1,2})(?:階|F)/i.test(t)) return { floors: [...new Set(all)].sort((a, b) => a - b), roof: false };
  // 「2階建て」は階ではない
  const m = /(\d{1,2})(?:階|F)(?!建)/i.exec(t);
  return { floors: m ? [Number(m[1])] : [], roof: false };
}

/** 同じ階の平面図が複数あるときの順位（小さいほど使う）: 平面図 → 平面詳細図 → 階段・部分・KEY など */
export function planRank(title: string): number {
  const t = norm(title);
  if (/階段|部分|KEY|建具|住戸|拡大/i.test(t)) return 2;
  if (/詳細/.test(t)) return 1;
  return 0;
}

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
export function classifySheet(texts: PText[], fileName = ''): { kind: SheetKind; floor: number; floors: number[]; roof: boolean; title: string } {
  // 表題欄に図面名があればそれで決める
  const tb = titleBlockName(texts);
  if (tb) {
    const tk = titleKind(tb);
    const kind: SheetKind | null = OTHER_TITLE.test(tb) && tk !== 'site' ? 'other' : tk;
    if (kind) {
      const f = floorsOfTitle(tb);
      const floors = kind === 'plan' && !f.floors.length && !f.roof ? [1] : f.floors;
      return { kind, floor: floors[0] ?? 1, floors, roof: f.roof, title: tb };
    }
  }
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
  if (!best) return { kind: 'unknown', floor: 1, floors: [], roof: false, title: '' };
  const all = texts.map((t) => norm(t.s));
  // 「2階平面図」「2~4階平面図」「2F平面図」。図面名に無ければ「2階」「2F」だけの文字（表題欄で分かれている図面）
  const f = floorsOfTitle(best.title);
  const lone = best.kind === 'plan' && !f.floors.length && !f.roof ? all.map((s) => /^(\d)(?:階|F)$/i.exec(s)).find(Boolean) : null;
  const floors = f.floors.length ? f.floors : lone ? [Number(lone[1])] : best.kind === 'plan' && !f.roof ? [1] : [];
  return { kind: best.kind, floor: floors[0] ?? 1, floors, roof: f.roof, title: best.title };
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

/** 寸法の数字（「8,500」「8500」）。300mm 以上 */
const dimNumber = (s: string): number | null => {
  const m = /^(\d{1,2}),(\d{3})$/.exec(s) ?? /^(\d{3,5})$/.exec(s);
  const v = m ? Number(m.slice(1).join('')) : NaN;
  return v >= 300 ? v : null;
};

/**
 * 通り芯の間隔と寸法の数字から縮尺: 隣り合う通り芯の間の紙の長さ × 縮尺 に合う寸法の数字（±1%）がいちばん多い縮尺。
 * RC の図面（通り芯の間隔が 910・1000 の倍数でない）や、詳細の「S=1/20」だけが書かれた図面でも、本体の縮尺が分かる。
 * 合う間隔が 2 つ以上（間隔が 1 つなら 1 つ）で、ほかの縮尺より多いときだけ
 */
export function scaleFromGridDims(texts: PText[], grid: Grid): number | undefined {
  const scored = PAPER_SCALES.map((n) => ({ n, hits: gridDimHits(texts, grid, n) })).sort((a, b) => b.hits - a.hits);
  // 合う間隔が 2 つ以上（たまたま 1 つ合うだけでは決めない）で、ほかの縮尺よりはっきり多い
  return scored[0].hits >= 2 && scored[0].hits > (scored[1]?.hits ?? 0) ? scored[0].n : undefined;
}

/** 縮尺 1/n のとき、隣り合う通り芯の間隔（紙の長さ × n）に合う寸法の数字（±1%）がある間隔の数 */
export function gridDimHits(texts: PText[], grid: Grid, n: number): number {
  const dims = texts.map((t) => dimNumber(norm(t.s))).filter((v): v is number => v !== null);
  const gaps = (g: GridLine[]) => g.slice(1).map((l, i) => Math.abs(l.pos - g[i].pos)).filter((d) => d > 3);
  return [...gaps(grid.xs), ...gaps(grid.ys)].filter((g) => { const mm = g * PT_MM * n; return dims.some((d) => Math.abs(d - mm) <= Math.max(15, d * 0.01)); }).length;
}

/** 寸法の数字（「7,280」「11,147.5」「≒8,259」）。300mm 以上 */
const dimValue = (s: string): number | null => {
  const m = /^[≒約]?((?:\d{1,3}(?:,\d{3})+)|\d{3,6})(\.\d+)?$/.exec(norm(s));
  const v = m ? Number(m[1].replace(/,/g, '') + (m[2] ?? '')) : NaN;
  return v >= 300 ? v : null;
};

/**
 * 寸法線から縮尺: 寸法の数字のすぐ横（真ん中あたり）のいちばん近い水平・垂直の線の紙の長さ × 縮尺 が数字に合う（±1.5%）縮尺。
 * たまたま合うのを避けるため、3 か所以上で合い、寸法の数字の半分以上が同じ縮尺で、ほかの縮尺より多いときだけ。
 * 通り芯も縮尺の文字も無い図面のため（重い図面では数字・線の数で打ち切る）
 */
export function scaleFromDimLines(texts: PText[], segs: PSeg[]): number | undefined {
  const dims = texts.flatMap((t) => { const v = dimValue(t.s); return v === null ? [] : [{ t, v }]; });
  if (dims.length < 3 || dims.length > 600) return undefined;
  const lines = segs.filter((g) => (Math.abs(g.x2 - g.x1) < 0.5 || Math.abs(g.y2 - g.y1) < 0.5) && Math.hypot(g.x2 - g.x1, g.y2 - g.y1) >= 10);
  if (lines.length * dims.length > 40_000_000) return undefined;
  const votes = new Map<number, number>();
  for (const { t, v } of dims) {
    const near = Math.max(8, t.h * 1.5);
    let best: { off: number; /** 合った縮尺 */ L: number } | null = null;
    for (const g of lines) {
      const hz = Math.abs(g.y2 - g.y1) < 0.5;
      const L = hz ? Math.abs(g.x2 - g.x1) : Math.abs(g.y2 - g.y1);
      const [lo, hi] = hz ? [Math.min(g.x1, g.x2), Math.max(g.x1, g.x2)] : [Math.min(g.y1, g.y2), Math.max(g.y1, g.y2)];
      const along = hz ? t.x : t.y, off = hz ? Math.abs(t.y - g.y1) : Math.abs(t.x - g.x1);
      if (off > near || along < lo + L * 0.25 || along > hi - L * 0.25) continue;
      // 縮尺に合う線のうち、数字にいちばん近い 1 本だけ（1 つの数字が複数の縮尺に票を入れない）
      const n = v / (L * PT_MM);
      const sc = PAPER_SCALES.find((p) => Math.abs(n - p) / p <= 0.015);
      if (sc && (!best || off < best.off)) best = { off, L: sc };
    }
    if (best) votes.set(best.L, (votes.get(best.L) ?? 0) + 1);
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  return top && top[1] >= 3 && top[1] * 2 >= dims.length && top[1] > (ranked[1]?.[1] ?? 0) ? top[0] : undefined;
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
export function sheetScale(texts: PText[], grid: Grid | null, segs?: PSeg[]): { scale: number; guessed: boolean; /** 寸法線から推定 */ byDims?: boolean } | null {
  const s = detectDrawingScale(texts.map((t) => t.s));
  // 通り芯の間隔と寸法の数字が合う縮尺: 文字の縮尺が無いとき、または文字の縮尺では合う寸法がその半分以下
  // （図の中の詳細の「S=1/20」だけが書かれていて、たまたま 1〜2 か所合う）ときに使う
  if (grid) {
    const d = scaleFromGridDims(texts, grid);
    if (d && (!s || (s !== d && gridDimHits(texts, grid, s) * 2 <= gridDimHits(texts, grid, d)))) return { scale: d, guessed: false };
  }
  if (s && !grid) return { scale: s, guessed: false };
  // 表題欄の「1/50」だけの文字（「SCALE」の欄と別の文字列になっている図面）。違う値が混ざるなら採らない
  const lone = new Set(texts.map((t) => /^1[/:](\d{2,3})$/.exec(norm(t.s))).filter(Boolean).map((m) => Number(m![1])));
  const title = lone.size === 1 && (PAPER_SCALES as readonly number[]).includes([...lone][0]) ? [...lone][0] : undefined;
  if (!grid) {
    if (title) return { scale: title, guessed: false };
    // 通り芯も縮尺の文字も無い図面（申請図・設備図など）: 寸法線と寸法の数字から
    const d = segs ? scaleFromDimLines(texts, segs) : undefined;
    return d ? { scale: d, guessed: true, byDims: true } : null;
  }
  const pitch = modalPitch(grid.xs) * PT_MM;
  let best: { scale: number; err: number } | null = null;
  for (const n of PAPER_SCALES) for (const mod of [910, 1000]) {
    const err = Math.abs(pitch * n - mod) / mod;
    if (!best || err < best.err) best = { scale: n, err };
  }
  const fromGrid = best && best.err < 0.03 ? best.scale : undefined;
  if (s) {
    // 文字の縮尺で通り芯の間隔が半間・1m の倍数にならず、通り芯からは別の縮尺が出るなら、文字は別の図（詳細図など）の縮尺
    const real = pitch * s;
    const plausible = [455, 500].some((mod) => Math.abs(real / mod - Math.round(real / mod)) < 0.06 && real >= mod * 0.9);
    return !plausible && fromGrid && fromGrid !== s ? { scale: fromGrid, guessed: true } : { scale: s, guessed: false };
  }
  if (fromGrid) return { scale: fromGrid, guessed: fromGrid !== title };
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
