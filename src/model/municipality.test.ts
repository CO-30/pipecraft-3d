import { describe, expect, test } from 'vitest';
import { BUILTIN_PROFILES, duplicateProfile, formatSlope, isBuiltinProfile, minSlopeFor, municipalityProfileSchema, parseProfileJson, resolveProfile, STANDARD_PROFILE } from './municipality';

describe('自治体プロファイル', () => {
  test('STANDARD_PROFILE は schema を通り、同梱として扱われる', () => {
    expect(municipalityProfileSchema.safeParse(STANDARD_PROFILE).success).toBe(true);
    expect(STANDARD_PROFILE.id).toBe('standard');
    expect(isBuiltinProfile('standard')).toBe(true);
    expect(isBuiltinProfile('mp_x')).toBe(false);
    expect(BUILTIN_PROFILES).toHaveLength(1);
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
