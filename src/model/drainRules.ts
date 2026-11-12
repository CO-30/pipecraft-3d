/**
 * 排水の決まり（自治体ごと）。値はデータ（MunicipalityProfile.drainage）で持ち、値ごとに状態と出典を付ける。
 *  - verified: 条例・規程の原文で確認 ／ general: 国の基準や一般的な値 ／ unverified: 未確認（既定値で計算し「要確認」と出す）
 * 出典: プロジェクト資料「自治体基準_排水チェック条件_2026-11-12.md」
 */
import { z } from 'zod';
import { defaultSlope as indoorMinSlope, maxSlope as velocityMaxSlope } from './slope';

export const ruleStatusSchema = z.enum(['verified', 'general', 'unverified']);
export type RuleStatus = z.infer<typeof ruleStatusSchema>;
const rv = <T extends z.ZodTypeAny>(t: T) => z.object({ value: t, status: ruleStatusSchema, source: z.string().optional() });
export type RuleValue<T> = { value: T; status: RuleStatus; source?: string };

export const drainageSchema = z.object({
  /** 口径(mm) → 最小勾配（比率） */
  minSlope: z.record(z.string(), rv(z.number().positive())),
  /** 口径(mm) → 最大勾配（比率、この値未満）。無い口径は流速 1.5m/秒 */
  maxSlope: z.record(z.string(), rv(z.number().positive())),
  /** 宅地内の土かぶり(mm) */
  coverPrivate: rv(z.number().nonnegative()),
  /** 私道内の土かぶり(mm) */
  coverPrivateRoad: rv(z.number().nonnegative()).optional(),
  /** 直線部の桝の間隔（管径の倍数） */
  manholeSpacingTimes: rv(z.number().positive()),
  /** 桝の内径の下限(mm) */
  manholeMinInner: rv(z.number().positive()),
  /** 桝の深さの上限(mm)。null = 未確認 */
  manholeMaxDepth: rv(z.number().positive().nullable()),
  /** ます内の落差（流入と流出の管底の差、mm） */
  manholeDrop: rv(z.number().nonnegative()),
  /** 自治体として規定を確かめられていないとき、その旨と問い合わせ先 */
  cityUnverified: z.string().optional(),
});
export type DrainageRules = z.infer<typeof drainageSchema>;

const LAW = '下水道法施行令 第8条（勾配 1/100 以上）・標準下水道条例（ますは直線部で内径の 120 倍以内）';
const JGS = '下水道排水設備指針と解説（日本下水道協会）の一般的な値';
const g = <T>(value: T, source = JGS): RuleValue<T> => ({ value, status: 'general', source });
const ok = <T>(value: T, source: string): RuleValue<T> => ({ value, status: 'verified', source });
const nc = <T>(value: T, source = '未確認（一般的な値で計算）'): RuleValue<T> => ({ value, status: 'unverified', source });

/** 国の基準＋一般的な値（自治体の規定を確かめていないとき） */
export const GENERAL_DRAINAGE: DrainageRules = {
  minSlope: { 75: g(0.03), 100: g(0.02), 125: g(0.017), 150: g(0.015), 200: g(0.012), 250: g(0.01) },
  maxSlope: {},
  coverPrivate: g(200),
  coverPrivateRoad: g(450),
  manholeSpacingTimes: ok(120, LAW),
  manholeMinInner: g(150),
  manholeMaxDepth: nc(null),
  manholeDrop: nc(20, '一般的には 2cm 程度（未確認）'),
};

const NAHA_RULE = '那覇市下水道条例施行規程 https://www1.g-reiki.net/naha/reiki_honbun/q902RG00000845.html';
const NAHA_ORD = '那覇市下水道条例 https://www1.g-reiki.net/naha/reiki_honbun/q902RG00000566.html';
/** 那覇市（条例・施行規程で確認 2026-11-12） */
export const NAHA_DRAINAGE: DrainageRules = {
  minSlope: { 75: g(0.03, `${NAHA_ORD}（φ75 は建物の汚水の一部・延長 3m 以下。勾配 3/100 は一般値）`), 100: ok(0.02, NAHA_RULE), 125: ok(0.017, NAHA_RULE), 150: ok(0.015, NAHA_RULE), 200: ok(0.012, NAHA_RULE), 250: ok(0.01, NAHA_RULE) },
  maxSlope: { 100: ok(0.1, NAHA_RULE), 125: ok(0.083, NAHA_RULE), 150: ok(0.065, NAHA_RULE), 200: ok(0.045, NAHA_RULE), 250: ok(0.034, NAHA_RULE) },
  coverPrivate: ok(200, NAHA_RULE),
  coverPrivateRoad: ok(450, NAHA_RULE),
  manholeSpacingTimes: ok(120, NAHA_RULE),
  manholeMinInner: ok(150, NAHA_RULE),
  manholeMaxDepth: nc(null),
  manholeDrop: nc(20, '一般的には 2cm 程度（那覇市の規定は未確認）'),
};

export const cityUnverifiedDrainage = (contact: string): DrainageRules => ({ ...GENERAL_DRAINAGE, cityUnverified: contact });

const FIELD_LABEL: Partial<Record<keyof DrainageRules, string>> = {
  coverPrivate: '土かぶり', coverPrivateRoad: '私道の土かぶり', manholeSpacingTimes: '桝の間隔', manholeMinInner: '桝の内径', manholeMaxDepth: '桝の深さの上限', manholeDrop: 'ます内の落差',
};

/** 計算に使う決まり */
export type DrainRuleSet = {
  city: string;
  minSlope(d: number): number;
  maxSlope(d: number): number;
  /** 屋外の勾配の既定: 最小勾配より少し上（+0.2/100）。最大勾配は超えない */
  defaultSlope(d: number): number;
  /** 床下: 2/100（low: 床下が低いとき 1.5/100）。原文で確認した自治体の最小勾配・管径別の屋内の最小勾配は下回らない */
  underfloorSlope(d: number, low: boolean): number;
  cover: number;
  /** 直線部の桝の間隔(mm) */
  spacing(d: number): number;
  drop: number;
  maxDepth?: number;
  /** 「要確認」として出す項目 */
  unverified: string[];
};

/** 口径以下でいちばん近い表の値 */
function lookup(table: Record<string, RuleValue<number>>, d: number): RuleValue<number> | undefined {
  let pick: RuleValue<number> | undefined, best = -Infinity;
  for (const [k, v] of Object.entries(table)) { const n = Number(k); if (Number.isFinite(n) && n <= d && n > best) { best = n; pick = v; } }
  return pick;
}

export const DEFAULT_MARGIN = 0.002;
export const UF_TARGET = 0.02;
export const UF_LOW = 0.015;

export function resolveDrainRules(profile: { name: string; drainage?: DrainageRules }): DrainRuleSet {
  const dr = profile.drainage ?? GENERAL_DRAINAGE;
  const city = profile.name;
  const minSlope = (d: number) => Math.max(0.01, lookup(dr.minSlope, d)?.value ?? indoorMinSlope(d));
  const maxSlope = (d: number) => lookup(dr.maxSlope, d)?.value ?? velocityMaxSlope(d);
  const unverified: string[] = [];
  if (!profile.drainage) unverified.push(`${city}：排水の決まりは未確認（一般的な値で計算）`);
  if (dr.cityUnverified) unverified.push(`${city}：未確認（${dr.cityUnverified}）`);
  if (Object.values(dr.minSlope).some((v) => v.status === 'unverified')) unverified.push('最小勾配');
  for (const [k, label] of Object.entries(FIELD_LABEL) as [keyof DrainageRules, string][]) {
    const v = dr[k] as RuleValue<unknown> | undefined;
    if (v && typeof v === 'object' && 'status' in v && v.status === 'unverified') unverified.push(label);
  }
  return {
    city, minSlope, maxSlope,
    defaultSlope: (d) => Math.min(minSlope(d) + DEFAULT_MARGIN, maxSlope(d) * 0.999),
    underfloorSlope: (d, low) => {
      const v = lookup(dr.minSlope, d);
      return Math.max(low ? UF_LOW : UF_TARGET, v?.status === 'verified' ? v.value : 0, indoorMinSlope(d));
    },
    cover: dr.coverPrivate.value,
    spacing: (d) => dr.manholeSpacingTimes.value * d,
    drop: dr.manholeDrop.value,
    ...(dr.manholeMaxDepth.value ? { maxDepth: dr.manholeMaxDepth.value } : {}),
    unverified,
  };
}
