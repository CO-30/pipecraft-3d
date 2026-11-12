/** 自治体の排水ルール（データ → 計算に使う決まり） */
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES, STANDARD_PROFILE } from './municipality';
import { resolveDrainRules } from './drainRules';
import { maxSlope } from './slope';

const prof = (id: string) => BUILTIN_PROFILES.find((p) => p.id === id)!;

describe('自治体の排水ルール（resolveDrainRules）', () => {
  it('那覇市（施行規程で確認）: 最小・最大勾配、土かぶり、桝の間隔。未確認は桝の深さの上限・ます内の落差', () => {
    const r = resolveDrainRules(prof('naha'));
    expect(r.city).toBe('那覇市');
    expect(r.minSlope(100)).toBe(0.02);
    expect(r.maxSlope(100)).toBe(0.1);
    expect(r.minSlope(125)).toBe(0.017);
    expect(r.maxSlope(150)).toBe(0.065);
    expect(r.minSlope(200)).toBe(0.012);
    expect(r.defaultSlope(100)).toBeCloseTo(0.022, 6);
    expect(r.cover).toBe(200);
    expect(r.spacing(100)).toBe(12000);
    expect(r.spacing(150)).toBe(18000);
    expect(r.drop).toBe(20);
    expect(r.unverified.join('／')).toContain('桝の深さの上限');
    expect(r.unverified.join('／')).toContain('ます内の落差');
    expect(r.unverified.join('／')).not.toContain('最小勾配');
  });

  it('宜野湾市・豊見城市は一般値で計算し「未確認」（問い合わせ先つき）', () => {
    const g = resolveDrainRules(prof('ginowan'));
    expect(g.city).toBe('宜野湾市');
    expect(g.minSlope(100)).toBe(0.02);
    expect(g.unverified).toContain('宜野湾市：未確認（宜野湾市上下水道局 下水道施設課 098-892-4156）');
    const t = resolveDrainRules(prof('tomigusuku'));
    expect(t.unverified.some((u) => u.startsWith('豊見城市：未確認'))).toBe(true);
  });

  it('標準: 勾配は 1/100 を下回らない（下水道法施行令）。最大勾配は自治体の値が無ければ流速 1.5m/秒', () => {
    const r = resolveDrainRules(STANDARD_PROFILE);
    expect(r.minSlope(50)).toBeGreaterThanOrEqual(0.01);
    expect(r.minSlope(300)).toBeGreaterThanOrEqual(0.01);
    expect(r.maxSlope(100)).toBe(maxSlope(100));
    expect(r.unverified.some((u) => u.includes('未確認'))).toBe(true);
  });

  it('床下: 2/100（低ければ 1.5/100）。自治体の最小勾配は下回らない', () => {
    expect(resolveDrainRules(STANDARD_PROFILE).underfloorSlope(100, false)).toBe(0.02);
    expect(resolveDrainRules(STANDARD_PROFILE).underfloorSlope(100, true)).toBe(0.015);
    expect(resolveDrainRules(prof('naha')).underfloorSlope(100, true)).toBe(0.02);
  });

  it('φ75 は 3/100（建物の汚水の一部・延長 3m 以下の例外）', () => {
    expect(resolveDrainRules(prof('naha')).minSlope(75)).toBe(0.03);
  });
});
