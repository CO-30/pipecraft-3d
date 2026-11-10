/**
 * 下敷き（図面・写真・航空写真）。画像は data URL で現場データに含める。
 * 画像の画素 (px, py)（左上原点・下向き）と図面座標 (x 東, y 北, mm) は相似変換:
 *   world = center + R(rotation) · ((px − w/2), −(py − h/2)) · mmPerPx
 */
import type { Vec2 } from './building';

export type UnderlayKind = 'image' | 'pdf' | 'aerial';
export type Underlay = {
  id: string;
  floorId: string;
  kind: UnderlayKind;
  label: string;
  src: string;
  widthPx: number;
  heightPx: number;
  center: Vec2;
  mmPerPx: number;
  /** 反時計回り（度） */
  rotation: number;
  opacity: number;
  /** 縮尺確定済み（航空写真・2点指定後） */
  scaled: boolean;
  /** 出典表示（航空写真など） */
  attribution?: string;
  /** PDF 図面: 画像 1px が紙の上で何 mm か。これ × 縮尺の分母 = mmPerPx */
  paperMmPerPx?: number;
};

/** 選べる図面の縮尺（1/n の n） */
export const PAPER_SCALES = [10, 20, 30, 50, 60, 75, 100, 150, 200, 250, 300, 500, 600] as const;
/** 図面から縮尺を読み取れなかったときの仮の縮尺（住宅の平面図で最も多い） */
export const DEFAULT_PAPER_SCALE = 100;

/** PDF のページ（長辺 longPt ポイント）を長辺 longPx 画素の画像にしたとき、1px が紙の何 mm か */
export function paperMmPerPx(longPt: number, longPx: number): number {
  return (longPt * 25.4) / 72 / longPx;
}

/**
 * 図面の文字から縮尺（1/n の n）を読む。「S:1/100」「縮尺 1：50」「SCALE 1/200」の形と、表題欄の「1/50」だけの文字を見る
 * （勾配の「1/100」を縮尺と取り違えないため）。違う縮尺が混ざっている図面（平面図 1/100 と詳細図 1/20 など）は決めない。
 */
export function detectDrawingScale(texts: string[]): number | undefined {
  const scan = (t: string) => {
    const found: number[] = [];
    // 単独の「S」は区切り（= :）があるときだけ縮尺とみなす（「75s 1/100」などを拾わない）
    const re = /(?:(?:SCALE|縮尺)[=:]?|(?<![A-Za-z0-9])S[=:])1[/:](\d{2,4})(?!\d)/gi;
    for (const m of t.normalize('NFKC').replace(/\s+/g, '').matchAll(re)) {
      const n = Number(m[1]);
      if ((PAPER_SCALES as readonly number[]).includes(n)) found.push(n);
    }
    return found;
  };
  let found = texts.flatMap(scan);
  // 1文字ずつに分かれている PDF は、1文字の並びだけをつなげて読み直す（別々の文字列どうしはつなげない）
  if (!found.length) found = scan(texts.map((t) => (t.trim().length === 1 ? t.trim() : '|')).join(''));
  // 表題欄で「SCALE」「縮尺」の欄と値が別々の文字になっている図面: 欄の見出しがあるときだけ、「1/50」だけの文字を縮尺とみなす
  // （見出しが無ければ勾配の「1/100」かもしれない。「1/20,100」のように複数の縮尺が書かれた図面は決めない）
  const hasLabel = texts.some((t) => /^(SCALE|縮尺|尺度)[:=]?$/i.test(t.normalize('NFKC').replace(/\s+/g, '')));
  if (!found.length && hasLabel) {
    for (const t of texts) {
      const m = /^1[/:](\d{2,4})$/.exec(t.normalize('NFKC').replace(/\s+/g, ''));
      if (m && (PAPER_SCALES as readonly number[]).includes(Number(m[1]))) found.push(Number(m[1]));
    }
  }
  const kinds = new Set(found);
  return kinds.size === 1 ? found[0] : undefined;
}

/** 紙の縮尺（1/n）を選び直す。中心は動かさない。紙の大きさが分からない下敷きは null */
export function applyPaperScale(u: Underlay, n: number): Underlay | null {
  if (!u.paperMmPerPx || !(n > 0) || !Number.isFinite(n)) return null;
  return { ...u, mmPerPx: u.paperMmPerPx * n, scaled: true };
}

/** 今の縮尺が紙の 1/n ちょうどなら n（2点で合わせ直して半端になっていれば undefined） */
export function paperScaleOf(u: Pick<Underlay, 'mmPerPx' | 'paperMmPerPx'>): number | undefined {
  if (!u.paperMmPerPx) return undefined;
  const r = u.mmPerPx / u.paperMmPerPx;
  return PAPER_SCALES.find((n) => Math.abs(r - n) / n < 0.002);
}

/** 下敷き画像の data URL の上限（文字数） */
export const MAX_UNDERLAY_SRC = 4_000_000;
/** 取り込み時に目指す上限（保存形式の上限より余裕をもたせる） */
export const TARGET_UNDERLAY_SRC = 3_000_000;
/** 1現場の下敷きの合計（文字数）。自動保存が重くならないように */
export const MAX_UNDERLAYS_TOTAL = 12_000_000;
/** 取り込み時の長辺の上限(px) */
export const MAX_UNDERLAY_PX = 2400;

const rad = (d: number) => (d * Math.PI) / 180;

export function pxToWorld(u: Pick<Underlay, 'center' | 'mmPerPx' | 'rotation' | 'widthPx' | 'heightPx'>, p: Vec2): Vec2 {
  const lx = (p.x - u.widthPx / 2) * u.mmPerPx;
  const ly = -(p.y - u.heightPx / 2) * u.mmPerPx;
  const c = Math.cos(rad(u.rotation)), s = Math.sin(rad(u.rotation));
  return { x: u.center.x + lx * c - ly * s, y: u.center.y + lx * s + ly * c };
}

export function worldToPx(u: Pick<Underlay, 'center' | 'mmPerPx' | 'rotation' | 'widthPx' | 'heightPx'>, w: Vec2): Vec2 {
  const dx = w.x - u.center.x, dy = w.y - u.center.y;
  const c = Math.cos(rad(u.rotation)), s = Math.sin(rad(u.rotation));
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return { x: lx / u.mmPerPx + u.widthPx / 2, y: -ly / u.mmPerPx + u.heightPx / 2 };
}

/**
 * 2点の実寸から縮尺を決める。p1・p2 は図面座標（現在の下敷き上で指定した点）。
 * p1 の位置を固定して拡縮するので、p1 の下にある図面の点は動かない。
 */
export function rescaleByTwoPoints(u: Underlay, p1: Vec2, p2: Vec2, realMm: number): Underlay | null {
  const cur = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (!(cur > 1) || !(realMm > 0) || !Number.isFinite(realMm)) return null;
  const k = realMm / cur;
  return {
    ...u,
    mmPerPx: u.mmPerPx * k,
    center: { x: p1.x + (u.center.x - p1.x) * k, y: p1.y + (u.center.y - p1.y) * k },
    scaled: true,
  };
}

/** 画像の四隅の図面座標（描画・当たり判定用） */
export function underlayCorners(u: Underlay): Vec2[] {
  return [{ x: 0, y: 0 }, { x: u.widthPx, y: 0 }, { x: u.widthPx, y: u.heightPx }, { x: 0, y: u.heightPx }].map((p) => pxToWorld(u, p));
}

/** 新しい下敷きの初期配置: 縮尺未確定なら長辺が 10m になる仮の縮尺で、指定位置に置く */
export function initialPlacement(widthPx: number, heightPx: number, at: Vec2, mmPerPx?: number): Pick<Underlay, 'center' | 'mmPerPx' | 'rotation' | 'scaled'> {
  return { center: at, mmPerPx: mmPerPx ?? 10000 / Math.max(widthPx, heightPx), rotation: 0, scaled: mmPerPx !== undefined };
}
