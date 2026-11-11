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

/** 色は #rrggbb だけ（SVG の属性にそのまま入るので、他の形式や文字列は受け付けない） */
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, '色は #rrggbb の形式');

export const municipalityProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  source: z.object({ title: z.string(), url: z.string().optional(), checkedAt: z.string().optional() }),
  unverified: z.array(z.string()),
  symbols: z.record(z.string(), z.string()),
  profileTable: z.object({
    rows: z.array(z.object({ key: z.enum(PROFILE_ROW_KEYS), label: z.string() })).min(1),
    /** 勾配の書き方: 1/100・10.0‰・1.00%・1.0/100（沖縄市の図面） */
    slopeFormat: z.enum(['ratio', 'permille', 'percent', 'per100']),
    hScale: z.number().positive(),
    vScale: z.number().positive(),
    /** 口径(mm) → 最小勾配の分母 */
    minSlopeByDiameter: z.record(z.string(), z.number().positive()),
    minCover: z.number().nonnegative(),
    unit: z.enum(['m', 'mm']).default('m'),
    /** 高さの基準: absolute＝1階 FL 基準の絶対値、publicInvert＝下流端（公共桝）の管底を ±0 */
    datum: z.enum(['absolute', 'publicInvert']).default('absolute'),
    /** 管種口径の書き方: VUφ100 ／ 100VU */
    pipeSpecFormat: z.enum(['materialFirst', 'diameterFirst']).default('materialFirst'),
    /** 距離（m）の小数桁 */
    lengthDecimals: z.union([z.literal(2), z.literal(3)]).default(3),
    /** 桝の名前・口径・深さを表に書く（table）か、図の上に書く（above。上流から NO.1, NO.2…） */
    manholeLabel: z.enum(['table', 'above']).default('table'),
    /** 下流端（公共桝）を図のどちらに描くか。沖縄市の実例は左。省略時は右 */
    downstreamSide: z.enum(['left', 'right']).default('right'),
    /** 縦断図の上に排水のアイソメ図（立面図・展開図）を描く（沖縄市の様式） */
    drainageIsometric: z.boolean().default(false),
  }),
  riser: z.object({
    /** single＝平らな系統図、isometric＝アイソメ図（3D を斜めから見た展開図） */
    lineStyle: z.enum(['single', 'isometric']),
    diameterLabelPos: z.enum(['above', 'side']),
    showFloorLines: z.boolean(),
    heightLabel: z.enum(['FL+', 'GL+']),
  }),
  paper: z.object({
    size: z.enum(['A3', 'A4']),
    orientation: z.enum(['landscape', 'portrait']),
    titleBlockFields: z.array(z.string()),
    /** 右上の受付欄（沖縄市: 受付番号・水道番号・縮尺）。空なら描かない。省略可 */
    headerFields: z.array(z.string()).default([]),
  }),
  /** 図面の色分け（申請書の指示: 新設・増設＝赤、既設＝青、公共下水道＝黒）。省略時は既定 */
  colors: z.object({
    newWork: colorSchema.default('#d91e18'),
    existing: colorSchema.default('#1d4ed8'),
    public: colorSchema.default('#1f2328'),
  }).default(() => ({ newWork: '#d91e18', existing: '#1d4ed8', public: '#1f2328' })),
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
    datum: 'absolute',
    pipeSpecFormat: 'materialFirst',
    lengthDecimals: 3,
    manholeLabel: 'table',
    downstreamSide: 'right',
    drainageIsometric: false,
  },
  riser: { lineStyle: 'single', diameterLabelPos: 'above', showFloorLines: true, heightLabel: 'FL+' },
  paper: { size: 'A3', orientation: 'landscape', titleBlockFields: ['工事名', '申請者', '施工者', '図面名', '縮尺', '作成日'], headerFields: [] },
  colors: { ...DEFAULT_COLORS },
};

/** standard を基に、自治体の公開資料で確認できた項目だけを上書きする */
function municipal(over: Partial<Omit<MunicipalityProfile, 'paper' | 'profileTable' | 'colors'>> & { paper?: Partial<MunicipalityProfile['paper']>; profileTable?: Partial<MunicipalityProfile['profileTable']>; colors?: Partial<MunicipalityProfile['colors']> } & Pick<MunicipalityProfile, 'id' | 'name' | 'source' | 'unverified'>): MunicipalityProfile {
  const base = structuredClone(STANDARD_PROFILE);
  // 配列・オブジェクトを standard や他のプロファイルと共有しない（どこかで破壊的に変えても波及しないように）
  return structuredClone({ ...base, ...over, paper: { ...base.paper, ...(over.paper ?? {}) }, profileTable: { ...base.profileTable, ...(over.profileTable ?? {}) }, colors: { ...base.colors, ...(over.colors ?? {}) } });
}

/** 南部の自治体に共通する「要確認」（公開資料に書かれていない項目） */
const COMMON_UNVERIFIED = ['最小勾配（口径ごと）', '最小土被り', '勾配の書き方（1/100・‰・%）', 'ますの記号', '表題欄の項目'];
const JGES_TEXT = '設計図は「排水設備工事責任技術者講習用テキスト」（日本下水道協会）に沿って作成する';
const A3_FOLDED: Partial<MunicipalityProfile['paper']> = { size: 'A4', orientation: 'portrait' };

/**
 * 同梱の自治体プロファイル（2026-11-10 に各自治体の公開ページを確認）。
 * 南部の自治体はいずれも「日本下水道協会の責任技術者講習用テキストどおり」「新設＝赤・既設＝青・公共＝黒」で、
 * 表の行や最小勾配などの細部は公開されていない。未確認の項目は unverified に入れて図面に「要確認」と出す。
 */
export const MUNICIPAL_PROFILES: MunicipalityProfile[] = [
  municipal({
    id: 'okinawa-city', name: '沖縄市',
    source: {
      title: '沖縄市で受理されている申請図面（指定工事店作成の「立面図（展開図）」＝排水のアイソメ図＋縦断図、A4 縦、S=1/200。2026-11-10 入手）と、下水道排水設備計画確認申請書（様式第1号）の注意書き（新設・増設は赤、既設は青、公共下水道は黒。' + JGES_TEXT + '。A3 二つ折り）。'
        + '縦断図: 公共桝の管底を ±0 とし、表は 地盤高・土かぶり・管底高（m、3 桁）、区間に 100VU／3.0/100／長さ(m 2 桁)、桝は「NO.n小口径桝 φ150 H410」を図の上に、GL の差を (−600) のように表示。表題欄は 受付番号・水道番号・縮尺 と 申請地・申請者・指定工事店。公共桝は新設なら赤・既設なら青（黒は市下水管）',
      url: 'https://www.city.okinawa.okinawa.jp/documents/318/1-1sinsei.pdf', checkedAt: '2026-11-10',
    },
    unverified: ['最小勾配は日下協テキストの標準値（φ75 3/100・φ100 2/100・φ125 1.7/100・φ150 1.5/100。実例 2 件の 2.0〜5.4/100 と整合）。市の手引きでの確認は未', '最小土被り', 'ますの記号（実例は小さな楕円）', '落差桝（実例に H530-830 のような段差あり。未対応）'],
    paper: { ...A3_FOLDED, titleBlockFields: ['申請地', '申請者', '指定工事店'], headerFields: ['受付番号', '水道番号', '縮尺'] },
    profileTable: {
      rows: [{ key: 'groundLevel', label: '地盤高' }, { key: 'cover', label: '土かぶり' }, { key: 'invertLevel', label: '管底高' }],
      minSlopeByDiameter: { 75: 100 / 3, 100: 50, 125: 100 / 1.7, 150: 100 / 1.5 },
      slopeFormat: 'per100', hScale: 200, vScale: 200, datum: 'publicInvert', pipeSpecFormat: 'diameterFirst', lengthDecimals: 2, manholeLabel: 'above', downstreamSide: 'left', drainageIsometric: true,
    },
    riser: { lineStyle: 'isometric', diameterLabelPos: 'above', showFloorLines: false, heightLabel: 'FL+' },
  }),
  municipal({
    id: 'itoman', name: '糸満市',
    source: { title: '糸満市「【公共下水道】排水設備工事等の申請について」。平面図は 1/200 程度、縦断面図は管渠の大きさと勾配・ますの大きさ・地表と管渠の高さ（新設・増設は赤、既設は青、公共下水道は黒）。' + JGES_TEXT + '。A3 見開き', url: 'https://www.city.itoman.lg.jp/soshiki/25/22748.html', checkedAt: '2026-11-10' },
    unverified: ['表の項目の順番と名前（書く内容は明記: 管渠の大きさと勾配・ますの大きさ・地表と管渠の高さ）', '縦断図の縮尺（平面図は 1/200 程度と明記）', ...COMMON_UNVERIFIED],
    paper: A3_FOLDED,
  }),
  municipal({
    id: 'haebaru', name: '南風原町',
    source: { title: '南風原町 排水設備計画確認申請書の注意書き（図面は平面図及び縦断面図・配管立図・見取図。新設・増設は赤、既設は青、公共下水道は黒）。' + JGES_TEXT + '。用紙サイズ・綴じ方の記載なし', url: 'https://www.town.haebaru.lg.jp/uploaded/attachment/9638.pdf', checkedAt: '2026-11-10' },
    unverified: ['表の行（項目・順番）', '縮尺', '用紙サイズ（申請書に記載なし。沖縄市・糸満市は A3 二つ折り）', ...COMMON_UNVERIFIED],
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
  if (format === 'per100') return `${(ratio * 100).toFixed(1)}/100`;
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

/** 住所の頭の 郵便番号・国名・都道府県・郡 を外す */
function stripHead(text: string): string {
  let s = text.normalize('NFKC').replace(/\s+/g, '').replace(/^日本[、,]?/, '').replace(/^〒?\d{3}-?\d{4}/, '');
  s = s.replace(/^(北海道|東京都|京都府|大阪府|[^都道府県市区町村]{2,3}県)/, '');
  // 郡: 後ろが「…町／…村」（間に 市 が無い。大和郡山市 の 郡 は外さない）か、郡と同じ名前の町（余市郡余市町）
  const g = /^(.{1,4}?)郡/.exec(s);
  if (g) {
    const rest = s.slice(g[0].length);
    if (/^[^市]{1,4}?[町村]/.test(rest) || rest.startsWith(g[1])) s = rest;
  }
  return s;
}

/** 住所・プロファイル名から市町村名（「豊見城市」「南風原町」）を取り出す。名前に 市・町・村 を含むもの（四日市市・東村山市・余市町）も */
export function cityOf(text: string): string | undefined {
  const s = stripHead(text);
  const m = /^(.+?[市区町村])/.exec(s);
  if (!m) return undefined;
  let c = m[1];
  const rest = s.slice(c.length);
  if (/^[市町村]/.test(rest)) c += rest[0]; // 四日市市・野々市市・余市町
  else if (c.endsWith('村') && /^[^\d字]市/.test(rest)) c += rest.slice(0, 2); // 東村山市（東村 ではない）
  return c;
}

/**
 * 新しい工事の住所から、申請書類・決まり（土かぶり・勾配・図面の様式）の自治体プロファイルを選ぶ。
 * city: 住所の市町村名、profile: その市町村のプロファイル（同じ市町村が複数あれば名前の長い方＝自作を優先）。標準は選ばない
 */
export function profileForAddress(address: string, profiles: MunicipalityProfile[]): { city?: string; profile?: MunicipalityProfile } {
  const city = cityOf(address);
  if (!city) return {};
  const hit = profiles.filter((p) => p.id !== STANDARD_PROFILE.id && cityOf(p.name) === city).sort((a, b) => b.name.length - a.name.length)[0];
  return hit ? { city, profile: hit } : { city };
}
