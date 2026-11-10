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
  /** いちばん上の階の床から軒高まで(mm) */
  topToEaves?: number;
  /** GL から基礎の天端まで(mm) */
  footingTop?: number;
};

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)];

type Level = { key: string; x: number; y: number };

function levelKey(s: string): string | null {
  if (/^(設計)?G\.?L$/.test(s)) return 'GL';
  const fl = /^(\d)(?:階|F)F?\.?L$/.exec(s);
  if (fl) return `FL${fl[1]}`;
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
  const h: Heights = { floorToFloor: new Map() };
  h.glToFl = between('GL', 'FL1');
  h.footingTop = between('GL', 'FOOTING');
  let top = 1;
  for (let n = 1; n < 9; n++) {
    const v = between(`FL${n}`, `FL${n + 1}`);
    if (v === undefined) break;
    h.floorToFloor.set(n, v);
    top = n + 1;
  }
  h.topToEaves = between(`FL${top}`, 'EAVES');
  return h;
}
