import { describe, expect, test } from 'vitest';
import { defaultFlow, equivLength, resolveSupplyRules, simultaneousCount } from './supplyRules';

describe('同時使用率を考慮した給水用具数', () => {
  test.each([[1, 1], [4, 2], [5, 3], [10, 3], [11, 4], [20, 5], [30, 6], [31, 7], [45, 8]])('%i 栓 → %i 栓', (n, want) => expect(simultaneousCount(n)).toBe(want));
  test('0 栓 → 0', () => expect(simultaneousCount(0)).toBe(0));
});

describe('直管換算長', () => {
  test('給水栓 13mm 3.0m', () => expect(equivLength('faucet', 13)).toBe(3));
  test('メーター 20mm 11m', () => expect(equivLength('meter', 20)).toBe(11));
  test('メーター 40mm は 25 の値 × 40/25', () => expect(equivLength('meter', 40)).toBeCloseTo(24, 6));
  test('13 未満は 13 の値', () => expect(equivLength('valve', 10)).toBe(0.12));
});

describe('使用水量の既定', () => {
  test('キッチン 13 → 12', () => expect(defaultFlow('kitchen', 13)).toBe(12));
  test('洗面台 13 → 8', () => expect(defaultFlow('washbasin', 13)).toBe(8));
  test('給湯器 → 20', () => expect(defaultFlow('waterHeater', 20)).toBe(20));
  test('口径 20 の水栓 → 20', () => expect(defaultFlow('faucet', 20)).toBe(20));
});

describe('自治体の値', () => {
  test('宜野湾市: 設計水圧は未確認（0.15）、規程の確認済みの注意あり', () => {
    const r = resolveSupplyRules({ address: '沖縄県宜野湾市大山1-1' });
    expect(r.city).toBe('宜野湾市');
    expect(r.designPressure.status).toBe('unknown');
    expect(r.designPressure.v).toBe(0.15);
    expect(r.notes.some((n) => n.status === 'ok')).toBe(true);
    expect(r.serviceItems).toEqual(['tap', 'stopValve', 'meter', 'checkValve']);
  });
  test('プロファイル名から市町村（那覇市）', () => expect(resolveSupplyRules({ profileName: '那覇市（排水設備）', address: '宜野湾市' }).city).toBe('那覇市'));
  test('分からないときは標準（一般値）', () => {
    const r = resolveSupplyRules({});
    expect(r.city).toBeNull();
    expect(r.designPressure.status).toBe('general');
    expect(r.margin.v).toBe(3);
    expect(r.lengthFactor.v).toBe(1.1);
    expect(r.maxVelocity.v).toBe(2);
    expect(r.mainDrop.v).toBe(0.9);
    expect(r.serviceLength.v).toBe(3);
  });
  test('沖縄以外の市町村も標準の値で、市町村名は残す', () => {
    const r = resolveSupplyRules({ address: '神奈川県川崎市中原区1-1' });
    expect(r.city).toBe('川崎市');
    expect(r.designPressure.status).toBe('unknown');
  });
});
