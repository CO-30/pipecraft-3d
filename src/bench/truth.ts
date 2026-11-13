/**
 * 図面解析の正解データ（人が図面を見て確定した値）。数値だけで、氏名・住所・図面の絵は入れない。
 * 座標は読み取り結果と同じ図面座標(mm): 原点は 1 階平面図の通り芯（X・Y の最小番号）の交点、x は右、y は上。
 * AI に下書きさせてもよいが、confirmedBy・confirmedAt が入るまでは「未確認」として扱う（結果の表に出す）。
 */
import { z } from 'zod';

const num = z.number().finite();
const vec = z.object({ x: num, y: num });
export const FIXTURE_TYPES = [
  'toilet', 'washbasin', 'kitchen', 'bathtub', 'shower', 'washer', 'waterHeater',
  'waterMeter', 'pump', 'panel', 'outlet', 'light', 'aircon',
  'faucet', 'mixFaucet', 'outdoorFaucet', 'roofTank',
  'waterHeader', 'hotWaterHeader',
  'manholeSewage', 'manholeRain', 'manholeTrap', 'manholeInvert', 'publicSewage', 'publicRain',
] as const;
const fixtureType = z.enum(FIXTURE_TYPES);
const SHEET_KINDS = ['plan', 'foundation', 'elevation', 'section', 'site', 'detail', 'other', 'unknown'] as const;

export const truthSchema = z.object({
  id: z.string().min(1),
  /** 戸建／アパート／マンション */
  kind: z.enum(['detached', 'apartment', 'mansion']),
  structure: z.enum(['wood', 'steel', 'rc']).optional(),
  confirmedBy: z.string().optional(),
  confirmedAt: z.string().optional(),
  note: z.string().optional(),
  /** 図面ごと: 読み込むファイル名（拡張子なし可）・種類・縮尺 1/n の n */
  sheets: z.array(z.object({ name: z.string(), kind: z.enum(SHEET_KINDS), scale: num.positive().optional() })).optional(),
  /** 階ごとの階高(mm) */
  floors: z.array(z.object({ n: z.number().int(), height: num })).optional(),
  /** GL から 1 階の床まで(mm) */
  glToFl: num.optional(),
  walls: z.array(z.object({ floor: z.number().int(), a: vec, b: vec, thickness: num.positive() })).optional(),
  openings: z.array(z.object({ floor: z.number().int(), count: z.number().int().nonnegative() })).optional(),
  fixtures: z.array(z.object({ floor: z.number().int(), type: fixtureType, x: num, y: num })).optional(),
  /** 配置図の公共ます・ます・メーター・立水栓 */
  site: z.array(z.object({ type: fixtureType, x: num, y: num })).optional(),
  /** 実際に使った数量（見積の内訳・竣工の数量）。name: 品名（HIVP・VU・エルボ…）、spec: 口径など */
  quantities: z.array(z.object({ name: z.string(), spec: z.string().default(''), unit: z.enum(['m', '個', '台']), qty: num.nonnegative() })).optional(),
});
export type Truth = z.infer<typeof truthSchema> & { /** 人が確認した正解か */ confirmed: boolean };

export function parseTruth(json: unknown): Truth {
  const r = truthSchema.safeParse(json);
  if (!r.success) throw new Error(`正解データの形が違います: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' / ')}`);
  return { ...r.data, confirmed: !!(r.data.confirmedBy && r.data.confirmedAt) };
}
