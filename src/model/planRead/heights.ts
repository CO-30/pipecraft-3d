/**
 * 立面図の文字から高さを読む: 「GL」「1階FL」「2階FL」「軒高」「基礎高」の文字の上下の間隔 × 縮尺で高さの差を出し、
 * 近い値の寸法数字（「611」「2,970」）があればその数字を正とする。すべて純粋関数。
 */
import type { PText } from './sheet';

export type Heights = {
  /** GL から 1 階の床まで(mm) */
  glToFl?: number;
  /** 階 n（1 から）の床から、その上の階の床まで(mm) */
  floorToFloor: Map<number, number>;
  /** いちばん上の階の床から軒高まで(mm)。topFloor: その「いちばん上の階」（立面図に床の高さが書かれていた最上階） */
  topToEaves?: number;
  topFloor: number;
  /** GL から基礎の天端まで(mm) */
  footingTop?: number;
};

// 高さの記号（▽ など）は外して読む
const norm = (s: string) => s.normalize('NFKC').replace(/[\s▽▼△▲]+/g, '').toUpperCase();
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)];

type Level = { key: string; x: number; y: number };

function levelKey(s: string): string | null {
  if (/^(設計)?G\.?L$/.test(s)) return 'GL';
  const fl = /^(\d)(?:階|F)F?\.?L$/.exec(s);
  if (fl) return `FL${fl[1]}`;
  // 屋上の床（RFL）。いちばん上の階の上の床として読む
  if (/^R(階)?F\.?L$/.test(s)) return 'FLR';
  if (/軒高$/.test(s) || /^軒高さ?$/.test(s)) return 'EAVES';
  if (/^基礎(高さ?|天端)$/.test(s)) return 'FOOTING';
  return null;
}

/** 寸法数字（3〜5 桁、桁区切りのカンマ可） */
function dimValue(s: string): number | null {
  const m = /^(\d{1,2}),?(\d{3})$/.exec(s) ?? /^(\d{3})$/.exec(s);
  return m ? Number(m.slice(1).join('')) : null;
}

/** k: 紙 1pt あたりの mm（25.4/72 × 縮尺） */
export function readHeights(texts: PText[], k: number): Heights {
  const levels: Level[] = [];
  const dims: number[] = [];
  for (const t of texts) {
    const s = norm(t.s);
    const key = levelKey(s);
    if (key) levels.push({ key, x: t.x, y: t.y });
    const d = dimValue(s);
    if (d !== null) dims.push(d);
  }
  // RFL は「いちばん上の階 + 1」の床
  const topN = Math.max(0, ...levels.map((l) => /^FL(\d)$/.exec(l.key)).filter(Boolean).map((m) => Number(m![1])));
  const hasRoof = topN > 0 && levels.some((l) => l.key === 'FLR');
  if (hasRoof) for (const l of levels) if (l.key === 'FLR') l.key = `FL${topN + 1}`;
  const of = (key: string) => levels.filter((l) => l.key === key);
  /** 下の基準 lower から上の基準 upper までの高さ。立面ごと（近い文字どうし）に測って中央値を採る */
  const between = (lower: string, upper: string): number | undefined => {
    const out: number[] = [];
    for (const u of of(upper)) {
      let best: Level | null = null, d = Infinity;
      for (const l of of(lower)) {
        const dist = Math.hypot(l.x - u.x, l.y - u.y);
        if (l.y > u.y && dist < d) { best = l; d = dist; }
      }
      if (best) out.push((best.y - u.y) * k);
    }
    if (!out.length) return undefined;
    const raw = median(out);
    if (raw < 50) return undefined;
    // 文字の位置から測った値は 数十mm ずれるので、近い寸法数字があればそれを採る
    const tol = Math.max(60, raw * 0.03);
    const near = dims.filter((v) => Math.abs(v - raw) <= tol).sort((a, b) => Math.abs(a - raw) - Math.abs(b - raw))[0];
    return near ?? Math.round(raw / 10) * 10;
  };
  const h: Heights = { floorToFloor: new Map(), topFloor: 1 };
  h.glToFl = between('GL', 'FL1');
  h.footingTop = between('GL', 'FOOTING');
  let top = 1;
  for (let n = 1; n < 9; n++) {
    const v = between(`FL${n}`, `FL${n + 1}`);
    if (v === undefined) break;
    h.floorToFloor.set(n, v);
    top = n + 1;
  }
  // RFL があれば、いちばん上の階は RFL の下の階（RFL は屋上の床で、階ではない）
  if (hasRoof && top === topN + 1) top = topN;
  h.topToEaves = between(`FL${top}`, 'EAVES');
  h.topFloor = top;
  return h;
}

/** 基礎伏図: 基礎天端からスラブ（耐圧盤）天端までの差の印が無いときの標準(mm) */
export const DEFAULT_SLAB_BELOW_FOOTING = 350;

const minusValue = (s: string): number | null => {
  const m = /^[-−‐－ー](\d{2,4})$/.exec(s);
  return m ? -Number(m[1]) : null;
};

/**
 * 基礎伏図の区画ごとの高さの印「基礎天端 −350」（＝ その区画のスラブ天端は基礎天端の 350mm 下）から、
 * 基礎天端からスラブ天端までの差（負、mm）を読む。「基礎天端」の文字のすぐ近くの「−350」、または「基礎天端-350」の 1 つの文字。
 * いちばん多い値を採る。印が無ければ undefined。
 */
export function readSlabOffset(texts: PText[]): number | undefined {
  const ok = slabMarks(texts);
  if (!ok.length) return undefined;
  const count = new Map<number, number>();
  for (const v of ok) count.set(v, (count.get(v) ?? 0) + 1);
  // いちばん多い値。同数なら標準（−350）に近い方
  return [...count].sort((p, q) => q[1] - p[1] || Math.abs(p[0] + DEFAULT_SLAB_BELOW_FOOTING) - Math.abs(q[0] + DEFAULT_SLAB_BELOW_FOOTING))[0][0];
}

/** 基礎伏図の「基礎天端 −350」の印の値をすべて（区画ごと・凡例を含む）。−100〜−1000 のものだけ */
export function slabMarks(texts: PText[]): number[] {
  const vals: number[] = [];
  const nums = texts.map((t) => ({ t, v: minusValue(norm(t.s)) })).filter((x) => x.v !== null) as { t: PText; v: number }[];
  for (const t of texts) {
    const s = norm(t.s);
    if (!s.startsWith('基礎天端')) continue;
    const joined = minusValue(s.slice(4));
    if (joined !== null) { vals.push(joined); continue; }
    if (s !== '基礎天端') continue;
    const reach = 3 * Math.max(t.h, 4);
    const near = nums.filter((n) => Math.hypot(n.t.x - t.x, n.t.y - t.y) <= reach).sort((p, q) => Math.hypot(p.t.x - t.x, p.t.y - t.y) - Math.hypot(q.t.x - t.x, q.t.y - t.y))[0];
    if (near) vals.push(near.v);
  }
  return vals.filter((v) => v <= -100 && v >= -1000);
}
