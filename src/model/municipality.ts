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
  /** 図面の色分け（申請書の指示: 新設・増設＝赤、既設＝青、公共下水道＝黒）。省略時は既定 */
  colors: z.object({
    newWork: z.string().default('#d91e18'),
    existing: z.string().default('#1d4ed8'),
    public: z.string().default('#1f2328'),
  }).default({ newWork: '#d91e18', existing: '#1d4ed8', public: '#1f2328' }),
});
export type MunicipalityProfile = z.infer<typeof municipalityProfileSchema>;
export type SlopeFormat = MunicipalityProfile['profileTable']['slopeFormat'];

export const DEFAULT_COLORS: MunicipalityProfile['colors'] = { newWork: '#d91e18', existing: '#1d4ed8', public: '#1f2328' };

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
  colors: DEFAULT_COLORS,
};

/** standard を基に、自治体の公開資料で確認できた項目だけを上書きする */
function municipal(over: Partial<MunicipalityProfile> & Pick<MunicipalityProfile, 'id' | 'name' | 'source' | 'unverified'>): MunicipalityProfile {
  return { ...structuredClone(STANDARD_PROFILE), ...over, paper: { ...STANDARD_PROFILE.paper, ...(over.paper ?? {}) }, profileTable: { ...structuredClone(STANDARD_PROFILE.profileTable), ...(over.profileTable ?? {}) } };
}

/** 南部の自治体に共通する「要確認」（公開資料に書かれていない項目） */
const COMMON_UNVERIFIED = ['最小勾配（口径ごと）', '最小土被り', '勾配の書き方（1/100・‰・%）', 'ますの記号', '表題欄の項目'];
const JGES_TEXT = '設計図は「排水設備工事責任技術者講習用テキスト」（日本下水道協会）に沿って作成する';
const A3_FOLDED = { size: 'A4' as const, orientation: 'portrait' as const };

/**
 * 同梱の自治体プロファイル（2026-11-10 に各自治体の公開ページを確認）。
 * 南部の自治体はいずれも「日本下水道協会の責任技術者講習用テキストどおり」「新設＝赤・既設＝青・公共＝黒」で、
 * 表の行や最小勾配などの細部は公開されていない。未確認の項目は unverified に入れて図面に「要確認」と出す。
 */
export const MUNICIPAL_PROFILES: MunicipalityProfile[] = [
  municipal({
    id: 'okinawa-city', name: '沖縄市',
    source: { title: '沖縄市 下水道排水設備計画確認申請書（様式第1号）の注意書き。' + JGES_TEXT + '。A3 二つ折り（申請書→平面図及び縦断面図→配管立図→見取図）', url: 'https://www.city.okinawa.okinawa.jp/documents/318/1-1sinsei.pdf', checkedAt: '2026-11-10' },
    unverified: ['表の行（項目・順番）', '縮尺', ...COMMON_UNVERIFIED],
    paper: { ...A3_FOLDED, titleBlockFields: STANDARD_PROFILE.paper.titleBlockFields },
  }),
  municipal({
    id: 'itoman', name: '糸満市',
    source: { title: '糸満市「【公共下水道】排水設備工事等の申請について」。平面図は 1/200 程度、縦断面図は管渠の大きさと勾配・ますの大きさ・地表と管渠の高さ。' + JGES_TEXT + '。A3 見開き', url: 'https://www.city.itoman.lg.jp/soshiki/25/22748.html', checkedAt: '2026-11-10' },
    unverified: ['縦断図の縮尺（平面図は 1/200 程度と明記）', ...COMMON_UNVERIFIED],
    paper: { ...A3_FOLDED, titleBlockFields: STANDARD_PROFILE.paper.titleBlockFields },
  }),
  municipal({
    id: 'haebaru', name: '南風原町',
    source: { title: '南風原町 排水設備計画確認申請書の注意書き（図面は平面図及び縦断面図・配管立図・見取図）。' + JGES_TEXT, url: 'https://www.town.haebaru.lg.jp/uploaded/attachment/9638.pdf', checkedAt: '2026-11-10' },
    unverified: ['表の行（項目・順番）', '縮尺', '用紙サイズ（沖縄市・糸満市と同じ A3 二つ折りと推定）', ...COMMON_UNVERIFIED],
    paper: { ...A3_FOLDED, titleBlockFields: STANDARD_PROFILE.paper.titleBlockFields },
  }),
  municipal({
    id: 'naha', name: '那覇市',
    source: { title: '那覇市上下水道局「排水設備情報」「給水工事情報」。図面の様式は公開されていない（指定工事店の様式のみ）。責任技術者は沖縄県下水道協会の資格', url: 'https://www.city.naha.okinawa.jp/water/business/haisui.html', checkedAt: '2026-11-10' },
    unverified: ['表の行（項目・順番）', '縮尺', '用紙サイズ', '色分け', ...COMMON_UNVERIFIED],
  }),
  municipal({
    id: 'tomigusuku', name: '豊見城市',
    source: { title: '豊見城市 上下水道部。図面の様式は公開されていない（補助金の規程のみ確認）', url: 'https://www.city.tomigusuku.lg.jp/', checkedAt: '2026-11-10' },
    unverified: ['表の行（項目・順番）', '縮尺', '用紙サイズ', '色分け', ...COMMON_UNVERIFIED],
  }),
  municipal({
    id: 'yonabaru', name: '与那原町',
    source: { title: '与那原町 上下水道課「下水道排水設備指定工事店について」「申請書ダウンロード」。図面の様式は公開されていない', url: 'https://www.town.yonabaru.okinawa.jp/site/jyougesui/4265.html', checkedAt: '2026-11-10' },
    unverified: ['表の行（項目・順番）', '縮尺', '用紙サイズ', '色分け', ...COMMON_UNVERIFIED],
  }),
];

export const BUILTIN_PROFILES: MunicipalityProfile[] = [STANDARD_PROFILE, ...MUNICIPAL_PROFILES];
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
