/**
 * 給水管の水理公式（純粋関数）。流量は L/min、口径は呼び径 mm、動水勾配は ‰（= 損失水頭 m / 管長 km）。
 * 口径 50 以下はウエストン公式、それより太い管はヘーゼン・ウィリアムス公式（給水装置工事技術指針）。
 */
const G = 9.8;
/** 1 MPa の水頭（m）。1 m ≒ 0.0098 MPa（各市の計算例と同じ換算） */
export const MPA_HEAD = 102;

const area = (dMm: number) => (Math.PI * (dMm / 1000) ** 2) / 4;
const m3s = (qLmin: number) => qLmin / 1000 / 60;

/** 管内の平均流速（m/s） */
export function velocity(qLmin: number, dMm: number): number {
  if (!(qLmin > 0) || !(dMm > 0)) return 0;
  return m3s(qLmin) / area(dMm);
}

/** ウエストン公式の動水勾配（‰）: h = (0.0126 + (0.01739 − 0.1087d)/√v)·(L/d)·v²/2g */
export function westonGradient(qLmin: number, dMm: number): number {
  const v = velocity(qLmin, dMm);
  if (v <= 0) return 0;
  const d = dMm / 1000;
  const f = 0.0126 + (0.01739 - 0.1087 * d) / Math.sqrt(v);
  return f * (1 / d) * (v * v / (2 * G)) * 1000;
}

/** ヘーゼン・ウィリアムス公式の動水勾配（‰）: h = 10.666·C^−1.85·D^−4.87·Q^1.85·L。C=150 は樹脂管 */
export function hazenGradient(qLmin: number, dMm: number, c = 150): number {
  if (!(qLmin > 0) || !(dMm > 0)) return 0;
  return 10.666 * c ** -1.85 * (dMm / 1000) ** -4.87 * m3s(qLmin) ** 1.85 * 1000;
}

/** 口径に合った公式の動水勾配（‰） */
export function gradient(qLmin: number, dMm: number): number {
  if (!(qLmin > 0)) return 0;
  return dMm <= 50 ? westonGradient(qLmin, dMm) : hazenGradient(qLmin, dMm);
}
