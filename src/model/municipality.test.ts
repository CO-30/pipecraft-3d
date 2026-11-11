import { describe, expect, test } from 'vitest';
import { BUILTIN_PROFILES, profileForAddress, DEFAULT_COLORS, duplicateProfile, formatSlope, isBuiltinProfile, minSlopeFor, municipalityProfileSchema, parseProfileJson, resolveProfile, STANDARD_PROFILE } from './municipality';

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
  test('沖縄市・糸満市は A3 二つ折り（A4 縦）、3 市町とも色分けは 新設=赤・既設=青・公共=黒', () => {
    for (const id of ['okinawa-city', 'itoman']) {
      const p = BUILTIN_PROFILES.find((x) => x.id === id)!;
      expect(p.paper, id).toMatchObject({ size: 'A4', orientation: 'portrait' });
      expect(p.colors, id).toEqual(DEFAULT_COLORS);
      expect(p.unverified.join(' '), id).toContain('最小勾配');
    }
    expect(BUILTIN_PROFILES.find((x) => x.id === 'haebaru')!.colors).toEqual(DEFAULT_COLORS);
  });
  test('colors を省略した古いプロファイル JSON は既定の色になる', () => {
    const { colors: _c, ...rest } = STANDARD_PROFILE;
    const r = municipalityProfileSchema.safeParse(rest);
    expect(r.success && r.data.colors).toEqual(DEFAULT_COLORS);
  });
});

describe('レビュー修正', () => {
  test('色は #rrggbb のみ受け付ける（SVG への注入を防ぐ）', () => {
    const bad = { ...STANDARD_PROFILE, colors: { ...DEFAULT_COLORS, newWork: '"/><img src=x onerror=alert(1)>' } };
    expect(municipalityProfileSchema.safeParse(bad).success).toBe(false);
    expect(municipalityProfileSchema.safeParse({ ...STANDARD_PROFILE, colors: { ...DEFAULT_COLORS, newWork: 'red' } }).success).toBe(false);
    expect(municipalityProfileSchema.safeParse({ ...STANDARD_PROFILE, colors: { ...DEFAULT_COLORS, newWork: '#FF0000' } }).success).toBe(true);
    expect('error' in parseProfileJson(JSON.stringify(bad))).toBe(true);
  });
  test('同梱プロファイル同士・standard と配列やオブジェクトを共有しない', () => {
    for (const p of BUILTIN_PROFILES.slice(1)) {
      expect(p.paper.titleBlockFields).not.toBe(STANDARD_PROFILE.paper.titleBlockFields);
      expect(p.profileTable.rows).not.toBe(STANDARD_PROFILE.profileTable.rows);
      expect(p.colors).not.toBe(STANDARD_PROFILE.colors);
      expect(p.symbols).not.toBe(STANDARD_PROFILE.symbols);
    }
    expect(STANDARD_PROFILE.colors).not.toBe(DEFAULT_COLORS);
  });
  test('南風原町は用紙が未確認なので standard と同じ A3 横のまま。糸満市も表の項目の順番は要確認', () => {
    const h = BUILTIN_PROFILES.find((x) => x.id === 'haebaru')!;
    expect(h.paper).toMatchObject({ size: 'A3', orientation: 'landscape' });
    expect(h.unverified.join(' ')).toContain('用紙');
    expect(h.source.title).toContain('赤');
    const i = BUILTIN_PROFILES.find((x) => x.id === 'itoman')!;
    expect(i.unverified.join(' ')).toContain('順番');
  });
});

describe('沖縄市の実際の申請図面に合わせた項目', () => {
  test('formatSlope の per100（3.0/100）', () => {
    expect(formatSlope(0.03, 'per100')).toBe('3.0/100');
    expect(formatSlope(0.033, 'per100')).toBe('3.3/100');
    expect(formatSlope(0.01, 'per100')).toBe('1.0/100');
  });
  test('沖縄市: 公共桝の管底を ±0、表は 地盤高・土かぶり・管底高、100VU、3.0/100、長さ 2 桁、桝の名前は図の上、縮尺 1/200', () => {
    const p = BUILTIN_PROFILES.find((x) => x.id === 'okinawa-city')!;
    expect(p.profileTable.rows.map((r) => r.key)).toEqual(['groundLevel', 'cover', 'invertLevel']);
    expect(p.profileTable.rows.map((r) => r.label)).toEqual(['地盤高', '土かぶり', '管底高']);
    expect(p.profileTable.slopeFormat).toBe('per100');
    expect(p.profileTable.pipeSpecFormat).toBe('diameterFirst');
    expect(p.profileTable.lengthDecimals).toBe(2);
    expect(p.profileTable.datum).toBe('publicInvert');
    expect(p.profileTable.manholeLabel).toBe('above');
    expect(p.profileTable.hScale).toBe(200);
    expect(p.profileTable.vScale).toBe(200);
    expect(p.paper).toMatchObject({ size: 'A4', orientation: 'portrait' });
    expect(p.paper.titleBlockFields).toEqual(['申請地', '申請者', '指定工事店']);
    expect(p.paper.headerFields).toEqual(['受付番号', '水道番号', '縮尺']);
    // 最小勾配は日下協テキストの標準値（実例 2 件の 2.0〜5.4/100 と整合）。手引きでの確認は残す
    expect(p.profileTable.minSlopeByDiameter).toEqual({ 75: 100 / 3, 100: 50, 125: 100 / 1.7, 150: 100 / 1.5 });
    expect(STANDARD_PROFILE.paper.headerFields).toEqual([]);
    expect(p.source.title).toContain('受理');
    expect(p.unverified.join(' ')).toContain('最小勾配');
    expect(p.unverified.join(' ')).not.toContain('表の行');
    expect(p.unverified.join(' ')).not.toContain('用紙');
  });
  test('新しい項目は省略できる（既定: absolute / materialFirst / 3 桁 / table）', () => {
    const r = municipalityProfileSchema.safeParse(STANDARD_PROFILE);
    expect(r.success && r.data.profileTable).toMatchObject({ datum: 'absolute', pipeSpecFormat: 'materialFirst', lengthDecimals: 3, manholeLabel: 'table' });
  });
});

describe('住所から自治体プロファイルを選ぶ（profileForAddress）', () => {
  test('住所に入っている市町村のプロファイルを選ぶ。県名・全角・空白があってもよい', () => {
    expect(profileForAddress('沖縄県豊見城市字高安 123', BUILTIN_PROFILES)).toMatchObject({ city: '豊見城市', profile: { id: 'tomigusuku' } });
    expect(profileForAddress('那覇市おもろまち１－１', BUILTIN_PROFILES).profile?.id).toBe('naha');
    expect(profileForAddress('沖縄県 沖縄市 美里5丁目28-2', BUILTIN_PROFILES).profile?.id).toBe('okinawa-city');
    expect(profileForAddress('島尻郡南風原町字兼城', BUILTIN_PROFILES)).toMatchObject({ city: '南風原町', profile: { id: 'haebaru' } });
  });
  test('「沖縄県」を沖縄市と取り違えない。プロファイルの無い市町村は市町村名だけ返す', () => {
    expect(profileForAddress('沖縄県宜野湾市大山', BUILTIN_PROFILES)).toEqual({ city: '宜野湾市' });
    expect(profileForAddress('千葉県市原市五井', BUILTIN_PROFILES)).toEqual({ city: '市原市' });
    expect(profileForAddress('', BUILTIN_PROFILES)).toEqual({});
  });
  test('この端末で作ったプロファイル（名前に市町村名）も選べる。名前の長い方を優先', () => {
    const mine = { ...duplicateProfile(STANDARD_PROFILE, '市原市（自作）'), id: 'u1' };
    expect(profileForAddress('千葉県市原市五井', [...BUILTIN_PROFILES, mine]).profile?.id).toBe('u1');
  });
});
