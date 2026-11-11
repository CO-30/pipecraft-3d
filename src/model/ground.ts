/**
 * 敷地の高さ: 配置図から読んだ「GL−950」などの点（設計 GL からの mm）から、ある場所の地面の高さを出す（純関数）。
 * 点が無ければ 0（設計 GL のまま）
 */
import type { Vec2 } from './building';

export type GroundPoint = { x: number; y: number; gl: number };
/** 重みに使う近い点の数 */
const NEAREST = 3;

/** 場所 p の地面の高さ（設計 GL からの mm）: 近い 3 点の距離の 2 乗の逆数で重み付けした平均。点の真上（50mm 以内）はその値 */
export function groundAt(site: { groundPoints?: GroundPoint[] } | undefined, p: Vec2): number {
  const pts = site?.groundPoints;
  if (!pts?.length) return 0;
  const near = pts.map((q) => ({ q, d: Math.hypot(q.x - p.x, q.y - p.y) })).sort((a, b) => a.d - b.d).slice(0, NEAREST);
  if (near[0].d < 50) return near[0].q.gl;
  let w = 0, s = 0;
  for (const { q, d } of near) { w += 1 / (d * d); s += q.gl / (d * d); }
  return Math.round(s / w);
}
