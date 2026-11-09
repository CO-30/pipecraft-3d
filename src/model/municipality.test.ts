import { describe, expect, test } from 'vitest';
import { BUILTIN_PROFILES, DEFAULT_COLORS, duplicateProfile, formatSlope, isBuiltinProfile, minSlopeFor, municipalityProfileSchema, parseProfileJson, resolveProfile, STANDARD_PROFILE } from './municipality';

describe('自治体プロファイル', () => {
  test('STANDARD_PROFILE は schema を通り、同梱として扱われる', () => {
    expect(municipalityProfileSchema.safeParse(STANDARD_PROFILE).success).toBe(true);
    expect(STANDARD_PROFILE.id).toBe('standard');
    expect(isBuiltinProfile('standard')).toBe(true);
    expect(isBuiltinProfile('mp_x')).toBe(false);
    expect(BUILTIN_PROFILES).toHaveLength(7);
    expect(BUILTIN_PROFILES[0]).toBe(STANDARD_PROFILE);
  });
  test('parseProfileJson は rows が空ならエラー、壊れた JSON もエラー', () => {
    const bad = { ...STANDARD_PROFILE, profileTable: { ...STANDARD_PROFILE.profileTable, rows: [] } };
    const r = parseProfileJson(JSON.stringify(bad));
    expect('error' in r && r.error.length > 0).toBe(true);
    expect('error' in parseProfileJson('{')).toBe(true);
    const ok = parseProfileJson(JSON.stringify(STANDARD_PROFILE));
    expect('profile' in ok && ok.profile.id).toBe('standard');
  });
  test('unit を省略すると m', () => {
    const { unit: _u, ...pt } = STANDARD_PROFILE.profileTable;
    const r = municipalityProfileSchema.safeParse({ ...STANDARD_PROFILE, profileTable: pt });
    expect(r.success && r.data.profileTable.unit).toBe('m');
  });
  test('formatSlope', () => {
    expect(formatSlope(0.01, 'ratio')).toBe('1/100');
    expect(formatSlope(0.01, 'permille')).toBe('10.0‰');
    expect(formatSlope(0.01, 'percent')).toBe('1.00%');
    expect(formatSlope(0, 'ratio')).toBe('水平');
  });
  test('minSlopeFor: 口径表、無ければ下の口径、それも無ければ undefined', () => {
    expect(minSlopeFor(STANDARD_PROFILE, 100)).toBeCloseTo(1 / 100, 9);
    expect(minSlopeFor(STANDARD_PROFILE, 90)).toBeCloseTo(1 / 100, 9);
    expect(minSlopeFor(STANDARD_PROFILE, 150)).toBeCloseTo(1 / 200, 9);
    expect(minSlopeFor(STANDARD_PROFILE, 50)).toBeUndefined();
  });
  test('duplicateProfile は id が変わり同梱でない', () => {
    const d = duplicateProfile(STANDARD_PROFILE, '那覇市（仮）');
    expect(d.id).not.toBe('standard');
    expect(d.name).toBe('那覇市（仮）');
    expect(isBuiltinProfile(d.id)).toBe(false);
    expect(municipalityProfileSchema.safeParse(d).success).toBe(true);
  });
  test('resolveProfile はユーザー分を優先し、無ければ standard', () => {
    const d = duplicateProfile(STANDARD_PROFILE, 'x');
    expect(resolveProfile(d.id, [d])).toBe(d);
    expect(resolveProfile('nope', [d])).toBe(STANDARD_PROFILE);
    expect(resolveProfile(undefined, [])).toBe(STANDARD_PROFILE);
  });
});

describe('同梱の自治体プロファイル', () => {
  test('沖縄本島南部 6 自治体が入っていて、schema を通り、確認できていない項目は unverified に入っている', () => {
    const ids = BUILTIN_PROFILES.map((p) => p.id);
    expect(ids).toEqual(['standard', 'okinawa-city', 'itoman', 'haebaru', 'naha', 'tomigusuku', 'yonabaru']);
    for (const p of BUILTIN_PROFILES.slice(1)) {
      expect(municipalityProfileSchema.safeParse(p).success, p.id).toBe(true);
      expect(p.unverified.length, p.id).toBeGreaterThan(0);
      expect(p.source.url, p.id).toMatch(/^https?:\/\//);
      expect(p.source.checkedAt, p.id).toBe('2026-11-10');
      expect(isBuiltinProfile(p.id)).toBe(true);
    }
  });
  test('沖縄市・糸満市・南風原町は A3 二つ折り（A4 縦）、色分けは 新設=赤・既設=青・公共=黒', () => {
    for (const id of ['okinawa-city', 'itoman', 'haebaru']) {
      const p = BUILTIN_PROFILES.find((x) => x.id === id)!;
      expect(p.paper, id).toMatchObject({ size: 'A4', orientation: 'portrait' });
      expect(p.colors, id).toEqual(DEFAULT_COLORS);
      expect(p.unverified.join(' '), id).toContain('最小勾配');
    }
    // 糸満市は縦断面図に「管渠の大きさと勾配、ますの大きさ、地表と管渠の高さ」が明記されているので、その行は要確認に含めない
    const itoman = BUILTIN_PROFILES.find((x) => x.id === 'itoman')!;
    expect(itoman.unverified.join(' ')).not.toContain('表の行');
  });
  test('colors を省略した古いプロファイル JSON は既定の色になる', () => {
    const { colors: _c, ...rest } = STANDARD_PROFILE;
    const r = municipalityProfileSchema.safeParse(rest);
    expect(r.success && r.data.colors).toEqual(DEFAULT_COLORS);
  });
});
