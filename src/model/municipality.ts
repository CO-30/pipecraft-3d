/**
 * 自治体プロファイル。申請図面（排水縦断図・給水立面図）の体裁・記号・基準値を JSON で持ち、
 * 自治体ごとの違いをコードを変えずに吸収する。同梱は `standard`（下水道協会方式を参考にした標準）のみ。
 * 個別自治体は公開の手引きを確認してから追加し、確認できなかった項目は `unverified` に入れて図面に「要確認」と出す。
 */
import { z } from 'zod';
import { newId } from './id';

export const PROFILE_ROW_KEYS = ['distance', 'cumDistance', 'groundLevel', 'invertLevel', 'cover', 'slope', 'pipeSpec', 'manhole'] as const;
export type ProfileRowKey = (typeof PROFILE_ROW_KEYS)[number];
export const PROFILE_ROW_LABEL: Record<ProfileRowKey, string> = {
  distance: '距離', cumDistance: '累加距離', groundLevel: '地盤高', invertLevel: '管底高', cover: '土被り', slope: '勾配', pipeSpec: '管種・口径', manhole: 'マス',
};

/** 図面で使える記号の ID */
export const SYMBOL_IDS = ['circle', 'square', 'circleDot', 'squareCross', 'triangle', 'meter', 'valve', 'faucet'] as const;
export type SymbolId = (typeof SYMBOL_IDS)[number];
export const SYMBOL_LABEL: Record<SymbolId, string> = {
  circle: '○', square: '□', circleDot: '◎（点）', squareCross: '□に×', triangle: '△', meter: 'メーター（M）', valve: 'バルブ（蝶）', faucet: '水栓',
};

export const municipalityProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  source: z.object({ title: z.string(), url: z.string().optional(), checkedAt: z.string().optional() }),
  unverified: z.array(z.string()),
  symbols: z.record(z.string(), z.string()),
  profileTable: z.object({
    rows: z.array(z.object({ key: z.enum(PROFILE_ROW_KEYS), label: z.string() })).min(1),
    slopeFormat: z.enum(['ratio', 'permille', 'percent']),
    hScale: z.number().positive(),
    vScale: z.number().positive(),
    /** 口径(mm) → 最小勾配の分母 */
    minSlopeByDiameter: z.record(z.string(), z.number().positive()),
    minCover: z.number().nonnegative(),
    unit: z.enum(['m', 'mm']).default('m'),
  }),
  riser: z.object({
    lineStyle: z.literal('single'),
    diameterLabelPos: z.enum(['above', 'side']),
    showFloorLines: z.boolean(),
    heightLabel: z.enum(['FL+', 'GL+']),
  }),
  paper: z.object({
    size: z.enum(['A3', 'A4']),
    orientation: z.enum(['landscape', 'portrait']),
    titleBlockFields: z.array(z.string()),
  }),
});
export type MunicipalityProfile = z.infer<typeof municipalityProfileSchema>;
export type SlopeFormat = MunicipalityProfile['profileTable']['slopeFormat'];

export const STANDARD_PROFILE: MunicipalityProfile = {
  id: 'standard',
  name: '標準（下水道協会方式を参考）',
  version: '1',
  source: { title: '下水道排水設備指針と解説（公益社団法人 日本下水道協会）を参考にした一般的な様式', checkedAt: '2026-11-09' },
  unverified: [],
  symbols: {
    manholeSewage: 'circle', manholeRain: 'square', manholeTrap: 'circleDot', manholeInvert: 'circle', publicSewage: 'circleDot', publicRain: 'squareCross',
    waterMeter: 'meter', faucet: 'faucet', mixFaucet: 'faucet', outdoorFaucet: 'faucet', toilet: 'square', washbasin: 'square', kitchen: 'square', bathtub: 'square', shower: 'square', washer: 'square', waterHeater: 'square', roofTank: 'square', pump: 'circle',
  },
  profileTable: {
    rows: [
      { key: 'cumDistance', label: '累加距離' },
      { key: 'distance', label: '距離' },
      { key: 'slope', label: '勾配' },
      { key: 'pipeSpec', label: '管種・口径' },
      { key: 'groundLevel', label: '地盤高' },
      { key: 'invertLevel', label: '管底高' },
      { key: 'cover', label: '土被り' },
      { key: 'manhole', label: 'マス' },
    ],
    slopeFormat: 'ratio',
    hScale: 100,
    vScale: 50,
    minSlopeByDiameter: { 65: 50, 75: 100, 100: 100, 125: 150, 150: 200 },
    minCover: 200,
    unit: 'm',
  },
  riser: { lineStyle: 'single', diameterLabelPos: 'above', showFloorLines: true, heightLabel: 'FL+' },
  paper: { size: 'A3', orientation: 'landscape', titleBlockFields: ['工事名', '申請者', '施工者', '図面名', '縮尺', '作成日'] },
};

export const BUILTIN_PROFILES: MunicipalityProfile[] = [STANDARD_PROFILE];
export const isBuiltinProfile = (id: string) => BUILTIN_PROFILES.some((p) => p.id === id);

/** 現場の ID からプロファイルを決める（ユーザー分 → 同梱 → standard） */
export function resolveProfile(id: string | undefined, user: MunicipalityProfile[]): MunicipalityProfile {
  if (!id) return STANDARD_PROFILE;
  return user.find((p) => p.id === id) ?? BUILTIN_PROFILES.find((p) => p.id === id) ?? STANDARD_PROFILE;
}

export function parseProfileJson(json: string): { profile: MunicipalityProfile } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: 'JSON として読み込めません' };
  }
  const r = municipalityProfileSchema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    return { error: `プロファイルの形式が正しくありません: ${i?.path.join('.') ?? ''} ${i?.message ?? ''}`.trim() };
  }
  return { profile: r.data };
}

export function duplicateProfile(p: MunicipalityProfile, newName: string): MunicipalityProfile {
  return { ...structuredClone(p), id: newId('mp'), name: newName, version: '1' };
}

/** 比率 → 表示（0.01 → 1/100・10.0‰・1.00%）。0 は水平 */
export function formatSlope(ratio: number, format: SlopeFormat): string {
  if (!(ratio > 0)) return '水平';
  if (format === 'permille') return `${(ratio * 1000).toFixed(1)}‰`;
  if (format === 'percent') return `${(ratio * 100).toFixed(2)}%`;
  return `1/${Math.round(1 / ratio)}`;
}

/** 口径の最小勾配（比率）。表に無ければいちばん近い下の口径、それも無ければ undefined */
export function minSlopeFor(profile: MunicipalityProfile, diameter: number): number | undefined {
  const table = profile.profileTable.minSlopeByDiameter;
  const keys = Object.keys(table).map(Number).filter((k) => Number.isFinite(k)).sort((a, b) => a - b);
  let pick: number | undefined;
  for (const k of keys) if (k <= diameter) pick = k;
  return pick === undefined ? undefined : 1 / table[String(pick)];
}
