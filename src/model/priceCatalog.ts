/**
 * 参考単価（メーカー公表の設計価格・税抜）。現場で単価を入力していない行の初期値として使い、
 * ユーザーが入力した単価があればそちらを優先する（現場データには保存しない＝あとで表を更新しても既存の入力は変わらない）。
 *
 * 出典: 積水化学工業「エスロン」設計積算価格（2026年度版）
 *   - 水道用エスロンパイプ設計積算価格表 2026年度版（HIVP「HIパイプ・ゴールド＋」、VPW）
 *   - 農業用エスロンパイプ設計積算価格表 2026年度版（VP・VU 直管、2026年4月1日価格）
 *   - エスロンタイムズ 品番別 設計積算価格（HI-TS継手・ゴールド、HT継手、HTパイプ）
 * 施工単価（手間）はメーカー価格がないため含めない。
 */
import type { SystemType } from './network';
import type { FittingType } from './fittings';

export const CATALOG_SOURCE = '積水化学工業 エスロン 設計積算価格（2026年度・税抜）';

/** 材質が未指定の配管に使う既定の管種 */
export const DEFAULT_MATERIAL: Partial<Record<SystemType, string>> = {
  water: 'HIVP', hotWater: 'HTVP', drain: 'VP', sewage: 'VP', vent: 'VP', condensate: 'VP',
};

/** 直管 4m 1本の価格（円/本） */
const PIPE: Record<string, Record<number, number>> = {
  HIVP: { 13: 1220, 16: 1830, 20: 2010, 25: 3050, 30: 3880, 40: 5320, 50: 7070 },
  // 13〜30 は水道用 VP（VPW）、40 以上は一般用 VP
  VP: { 13: 990, 16: 1450, 20: 1680, 25: 2380, 30: 3030, 40: 3430, 50: 4840, 65: 6170, 75: 9470, 100: 13920, 125: 17860, 150: 26810 },
  VU: { 40: 1840, 50: 2290, 65: 3510, 75: 4650, 100: 6990, 125: 11300, 150: 16250 },
  HTVP: { 13: 1610, 16: 2390, 20: 2880, 25: 4170 },
};

/** 継手（円/個）。HIVP は HI-TS継手・ゴールド、HTVP は HT継手 */
const FITTING: Record<string, Partial<Record<FittingType, Record<number, number>>>> = {
  HIVP: {
    elbow90: { 13: 101, 16: 137, 20: 166, 25: 262, 30: 349, 40: 607, 50: 940 },
    elbow45: { 13: 125, 20: 259, 25: 439, 30: 586, 40: 1100, 50: 1583 },
    tee: { 13: 110, 16: 191, 20: 259, 25: 391, 30: 543, 40: 904, 50: 1455 },
    socket: { 13: 101, 16: 121, 20: 138, 25: 209, 30: 271, 40: 456, 50: 693 },
  },
  HTVP: {
    elbow90: { 13: 232, 16: 328, 20: 429, 25: 604 },
    elbow45: { 13: 229, 20: 310, 25: 498 },
    tee: { 13: 274, 20: 601, 25: 874 },
    socket: { 13: 156, 20: 364, 25: 498 },
  },
};

const norm = (m: string) => m.trim().toUpperCase().replace(/[‐－-]/g, '').replace(/^HIVPW?$/, 'HIVP').replace(/^HT(VP)?$/, 'HTVP').replace(/^VPW$/, 'VP');

export const effectiveMaterial = (s: { system: SystemType; material?: string }) => (s.material?.trim() ? s.material : DEFAULT_MATERIAL[s.system] ?? '');

/** 直管 4m の参考価格（円/本）。なければ undefined */
export function catalogPipePrice(s: { system: SystemType; material?: string; diameter: number }): number | undefined {
  return PIPE[norm(effectiveMaterial(s))]?.[s.diameter];
}

/** 継手の参考価格（円/個）。同径のみ（径違いは undefined） */
export function catalogFittingPrice(type: FittingType, s: { system: SystemType; material?: string }, size: string): number | undefined {
  if (size.includes('×')) return undefined;
  return FITTING[norm(effectiveMaterial(s))]?.[type]?.[Number(size)];
}

// ---------- 支持金具・ビス（メーカー希望価格が公表されていない「オープン価格」品のため、通販の税抜価格を参考に） ----------
export const SUPPORT_CATALOG_SOURCE = '通販の税抜価格（2026年11月時点・参考）';
/** ステンレス片サドル（昭和コーポレーション S-KS、VP用）円/個 */
const SADDLE: Record<number, number> = { 13: 139, 16: 139, 20: 159, 25: 219, 30: 239, 40: 299, 50: 499, 65: 719 };
/** コンクリートビス（マーベル ステンレスコンクリートビス SCS-432 4×32、参考基準価格 2,200円/95本）円/本 */
const SCREW_CONCRETE = 23;
/** ステンレス皿木ねじ 4.1×38（約27本 528円税込）円/本 */
const SCREW_WOOD = 18;
/** インパクト用 六角軸コンクリートドリル 3.4mm（大西工業 No.24）円/本 */
const CONCRETE_BIT = 979;

export function catalogSupportPrice(key: string): number | undefined {
  const [, kind, d] = key.split('|');
  if (kind === 'saddle') return SADDLE[Number(d)];
  if (kind === 'screwConcrete') return SCREW_CONCRETE;
  if (kind === 'screwWood') return SCREW_WOOD;
  if (kind === 'bit') return CONCRETE_BIT;
  return undefined; // レベルバンドはサイズ別の価格が得られないため未設定
}
