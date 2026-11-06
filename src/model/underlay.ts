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
};

/** 下敷き画像の data URL の上限（文字数） */
export const MAX_UNDERLAY_SRC = 4_000_000;
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
