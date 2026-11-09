/**
 * 外壁の写真から配管を測るための計算。
 * - 基準の四角: 壁全体が写っていないとき、大きさの分かる四角（窓・階の間など）で写真を合わせる
 * - 立面の配管の長さの合計（系統ごと）
 * - 3D の外壁の表面に写真を貼る位置
 */
import type { Vec2 } from './building';
import type { Vec3 } from './network';
import { segmentLength, type Network } from './network';
import type { Elevation } from './elevation';

/** 立面の中の四角(mm): left = 立面の左端から、bottom = 立面の下端から */
export type RefRect = { left: number; bottom: number; width: number; height: number };

const MIN_REF = 100;

/** 基準の四角が使えるか。使えなければ理由（日本語）を返す */
export function checkRefRect(r: RefRect, elW: number, elH: number): string | null {
  const vals = [r.left, r.bottom, r.width, r.height];
  if (!vals.every(Number.isFinite)) return '四角の寸法を数字で入れてください';
  if (r.left < 0 || r.bottom < 0) return '位置は 0 以上で入れてください';
  if (r.width < MIN_REF || r.height < MIN_REF) return `四角の横幅・高さは ${MIN_REF}mm 以上にしてください`;
  if (r.left + r.width > elW + 0.5) return `四角が立面の横幅（${Math.round(elW)}mm）からはみ出しています`;
  if (r.bottom + r.height > elH + 0.5) return `四角が立面の高さ（${Math.round(elH)}mm）からはみ出しています`;
  return null;
}

/** 基準の四角(mm) → 補正画像の画素（左上・右上・右下・左下）。画像の幅 = 立面の横幅、高さ = 立面の高さ */
export function refRectPx(r: RefRect, elW: number, elH: number, outW: number, outH: number): Vec2[] {
  const kx = outW / elW, ky = outH / elH;
  const x0 = r.left * kx, x1 = (r.left + r.width) * kx;
  const y0 = (elH - (r.bottom + r.height)) * ky, y1 = (elH - r.bottom) * ky;
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/** 区間の長さ(mm)の合計と系統ごとの内訳（長い順） */
export function faceLengths(net: Network, segIds: string[]): { total: number; bySystem: { system: string; length: number }[] } {
  const m = new Map<string, number>();
  let total = 0;
  for (const id of segIds) {
    const s = net.segments[id];
    if (!s) continue;
    const l = segmentLength(net, id);
    total += l;
    m.set(s.system, (m.get(s.system) ?? 0) + l);
  }
  const bySystem = [...m.entries()].map(([system, length]) => ({ system, length })).sort((a, b) => b.length - a.length);
  return { total, bySystem };
}

/** 外壁の表面から写真を浮かせる距離(mm)。壁と重なってちらつかないように */
export const PHOTO_GAP = 3;

/**
 * 3D の外壁に写真を貼る位置（共通座標 mm, z = 上）。
 * right = 画像の右、up = 画像の上、normal = 外向き（外から見る向きの逆）。right × up = normal（鏡像にならない）。
 */
export function photoPlane(el: Elevation): { center: Vec3; right: Vec3; up: Vec3; normal: Vec3; size: { w: number; h: number } } {
  const k = el.faceOffset + PHOTO_GAP;
  const r = (x: number) => Math.round(x * 1000) / 1000 + 0;
  return {
    center: {
      x: r(el.origin.x + el.dir.x * (el.width / 2) + el.normal.x * k),
      y: r(el.origin.y + el.dir.y * (el.width / 2) + el.normal.y * k),
      z: r(el.baseZ + el.height / 2),
    },
    // 立面図で画像の右 = dir（u の向き）。外から見た右手方向 (-n.y, n.x) と一致する（テストで確認）
    right: { x: r(el.dir.x), y: r(el.dir.y), z: 0 },
    up: { x: 0, y: 0, z: 1 },
    normal: { x: r(el.normal.x), y: r(el.normal.y), z: 0 },
    size: { w: el.width, h: el.height },
  };
}
