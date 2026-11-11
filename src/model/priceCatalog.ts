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
import type { SaleUnit } from './estimate';
import { isPB } from './materials';

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

/**
 * ネジ付の給水継手（HI-TS・ゴールド、円/個）。メーカー設計価格が手元にないため通販（MISUMI）の税抜価格を参考に。
 * 給水栓用エルボ・給水栓用ソケットは水栓をねじ込むため黄銅インサート付き、バルブ用ソケットはインサートなし。
 */
export const THREAD_CATALOG_SOURCE = '通販（MISUMI）の税抜価格（2026年11月時点・参考）';
const THREAD_FITTING: Partial<Record<FittingType, Record<number, number>>> = {
  faucetElbow: { 13: 740 },
  faucetSocket: { 13: 697 },
  threadSocket: { 13: 150, 16: 140, 20: 216, 25: 327 },
};

const norm = (m: string) => m.trim().toUpperCase().replace(/[‐－-]/g, '').replace(/^HIVPW?$/, 'HIVP').replace(/^HT(VP)?$/, 'HTVP').replace(/^VPW$/, 'VP');

export const effectiveMaterial = (s: { system: SystemType; material?: string }) => (s.material?.trim() ? s.material : DEFAULT_MATERIAL[s.system] ?? '');

// ---------- プッシュマスター（ブリヂストン ポリブテン管・ワンタッチ継手） ----------
export const PB_CATALOG_SOURCE = 'ブリヂストン プッシュマスター 建築設備配管カタログ 2024 Vol.13（2024年10月改定・税抜）';
type PBKind = 'bare' | 'h5' | 'h10' | 'sheath';
const pbKind = (m: string): PBKind => {
  const u = m.toUpperCase();
  if (u.includes('さや') || u.includes('コルゲート')) return 'sheath';
  if (u.includes('保温10')) return 'h10';
  if (u.includes('保温')) return 'h5';
  return 'bare';
};
/** らく楽パイプ 円/m（巻）。裸管は 60m 巻（25J は 30m 巻）、保温付・さや管付は 30m 巻 */
const PB_PER_M: Record<PBKind, Record<number, number>> = {
  bare: { 13: 440, 16: 590, 20: 840, 25: 1390 },
  h5: { 13: 810, 16: 1020, 20: 1470, 25: 2740 },
  h10: { 13: 1070, 16: 1400, 20: 2480, 25: 3290 },
  sheath: { 13: 810, 16: 1020, 20: 1470, 25: 2870 },
};
/** 裸管の直管（円/本）: 13〜20J は 3m、25J は 4m */
const PB_STRAIGHT: Record<number, { length: number; price: number }> = {
  13: { length: 3000, price: 1170 }, 16: { length: 3000, price: 1650 }, 20: { length: 3000, price: 2310 }, 25: { length: 4000, price: 4920 },
};
/** カタログの巻の長さ(mm) */
export const pbRollLength = (material: string, diameter: number) => (pbKind(material) === 'bare' && diameter !== 25 ? 60000 : 30000);

/** 管の参考価格（販売単位あたり。定尺=円/本、巻=円/巻、m 単位=円/m）。なければ undefined */
export function catalogPipePrice(s: { system: SystemType; material?: string; diameter: number }, unit: SaleUnit = { kind: 'straight', length: 4000 }): number | undefined {
  const mat = effectiveMaterial(s);
  if (isPB(mat)) {
    const perM = PB_PER_M[pbKind(mat)][s.diameter];
    if (perM === undefined) return undefined;
    if (unit.kind === 'perLength') return unit.step === 1000 ? perM : undefined;
    if (unit.kind === 'roll') return unit.length === pbRollLength(mat, s.diameter) ? (perM * unit.length) / 1000 : undefined;
    const st = PB_STRAIGHT[s.diameter];
    return pbKind(mat) === 'bare' && st?.length === unit.length ? st.price : undefined;
  }
  return unit.kind === 'straight' && unit.length === 4000 ? PIPE[norm(mat)]?.[s.diameter] : undefined;
}

/** プッシュマスター継手（円/個）。同径は口径、径違いは「大×小」 */
const PB_FITTING: Partial<Record<FittingType, Record<string, number>>> = {
  socket: { 13: 1290, 16: 1960, 20: 4390, 25: 5760 }, // コネクターストレート NCS
  elbow90: { 13: 1290, 16: 1960, 20: 4390, 25: 5760, '16×13': 1930, '20×13': 3080, '20×16': 3270 }, // コネクターエルボ NCE
  reducer: { '16×13': 1930, '20×13': 3080, '25×13': 5410, '20×16': 3270, '25×20': 5760 }, // 異径ストレート NCS
  tee: { 13: 1790, 16: 2520, 20: 4540, 25: 8010, '16×13': 2510, '20×13': 3840, '20×16': 4090, '25×13': 7790, '25×16': 7840, '25×20': 7890 }, // コネクターチーズ NCT
  faucetElbow: { 13: 3070, 16: 3500, 20: 10990, 25: 12220 }, // 座付水栓エルボ NAE
  faucetSocket: { 13: 2040, 16: 3030, 20: 4810, 25: 6050 }, // メスアダプター NAF
  threadSocket: { 13: 2040, 16: 3030, 20: 4810, 25: 6050 }, // オスアダプター NAM
  adapter: { 13: 2040, 16: 3030, 20: 4810, 25: 6050 }, // オスアダプター NAM
  hivpAdapter: { '13×13': 2500, '13×20': 2560, '16×16': 2560, '16×20': 2560, '20×20': 4650 }, // HIVP変換継手 NAH（PB×HIVP）
};
/** プッシュマスター継手の品番（見積・部材表の参考） */
export const PB_FITTING_CODE: Partial<Record<FittingType, string>> = {
  socket: 'NCS', elbow90: 'NCE', reducer: 'NCS', tee: 'NCT', faucetElbow: 'NAE', faucetSocket: 'NAF', threadSocket: 'NAM', adapter: 'NAM', hivpAdapter: 'NAH',
};

/** 継手の参考価格（円/個）。同径のみ（径違いは undefined） */
export { norm as normMaterial };

export function catalogFittingPrice(type: FittingType, s: { system: SystemType; material?: string }, size: string): number | undefined {
  if (isPB(effectiveMaterial(s))) return PB_FITTING[type]?.[size];
  if (size.includes('×')) return undefined;
  const mat = norm(effectiveMaterial(s));
  if (THREAD_FITTING[type]) return mat === 'HIVP' ? THREAD_FITTING[type]![Number(size)] : undefined;
  return FITTING[mat]?.[type]?.[Number(size)];
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

/** シールテープ（日東電工 ニトフロン No.95S 13mm×15m）円/巻、塩ビ管用接着剤（クボタケミックス HI用 500g・HT用 500g）円/缶。VP用は未設定 */
const SEAL_TAPE = 212;
const GLUE: Record<string, number> = { hi: 1089, ht: 2714 };

export function catalogSupportPrice(key: string): number | undefined {
  const [, kind, d] = key.split('|');
  if (kind === 'sealTape') return SEAL_TAPE;
  if (kind === 'glue') return GLUE[d];
  if (kind === 'saddle') return SADDLE[Number(d)];
  if (kind === 'screwConcrete') return SCREW_CONCRETE;
  if (kind === 'screwWood') return SCREW_WOOD;
  if (kind === 'bit') return CONCRETE_BIT;
  return undefined; // レベルバンドはサイズ別の価格が得られないため未設定
}
