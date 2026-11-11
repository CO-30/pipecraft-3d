import { describe, expect, test } from 'vitest';
import { calcSupply, type SupplyCalc } from '../model/hydraulics/calc';
import { resolveSupplyRules } from '../model/hydraulics/supplyRules';
import { crowdedSupply, kawasakiLike } from '../model/hydraulics/testSupply';
import { findTextOverlaps } from './labelLayout';
import { WARN, type Sheet } from './sheet';
import { renderSuiriSheets } from './suiriSheet';

const meta = { siteName: 'テスト工事', date: new Date(2026, 10, 12) };
const calc = (doc = kawasakiLike().doc, rules = resolveSupplyRules({}), s = { flows: {} }): SupplyCalc => {
  const c = calcSupply(doc, rules, s);
  if ('error' in c) throw new Error(c.error);
  return c;
};
const texts = (sheets: Sheet[]) => sheets.flatMap((sh) => sh.ops.filter((o) => o.t === 'text').map((o) => (o as { s: string }).s));
const inside = (sh: Sheet) => sh.ops.every((o) => o.t !== 'text' || (o.x >= 0 && o.x <= sh.width && o.y >= 0 && o.y <= sh.height));

describe('水理計算書', () => {
  test('A4 縦。表題・工事名・方式・設計水圧・記号・判定', () => {
    const c = calc();
    const sheets = renderSuiriSheets(c, meta);
    expect(sheets[0].width).toBe(210);
    expect(sheets[0].height).toBe(297);
    const all = texts(sheets).join('\n');
    expect(all).toContain('給水装置 水理計算書');
    expect(all).toContain('テスト工事');
    expect(all).toContain('直結直圧式');
    expect(all).toMatch(/設計水圧.*0\.15/);
    for (const o of c.outlets) expect(all).toContain(o.letter);
    for (const r of c.rows) expect(all).toContain(r.label);
    expect(all).toContain('適当');
  });
  test('不適当も書く', () => {
    const all = texts(renderSuiriSheets(calc(undefined, undefined, { pressure: 0.05, flows: {} } as never), meta)).join('\n');
    expect(all).toContain('不適当');
  });
  test('要確認は橙で書く', () => {
    const sheets = renderSuiriSheets(calc(undefined, resolveSupplyRules({ address: '宜野湾市大山' })), meta);
    const ops = sheets.flatMap((s) => s.ops).filter((o) => o.t === 'text' && o.s.includes('要確認'));
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((o) => o.t === 'text' && o.color === WARN)).toBe(true);
  });
  test('行が多くても全部の行がどこかのページにあり、用紙からはみ出さない', () => {
    const c = calc();
    const many: SupplyCalc = { ...c, rows: Array.from({ length: 60 }, (_, i) => ({ ...c.rows[i % c.rows.length], label: `区間${i + 1}` })) };
    const sheets = renderSuiriSheets(many, meta);
    expect(sheets.length).toBeGreaterThan(1);
    const all = texts(sheets);
    for (let i = 1; i <= 60; i++) expect(all).toContain(`区間${i}`);
    expect(sheets.every(inside)).toBe(true);
  });
  test('器具が固まった現場でも文字が重ならない', () => {
    const sheets = renderSuiriSheets(calc(crowdedSupply()), meta);
    for (const sh of sheets) expect(findTextOverlaps(sh)).toEqual([]);
  });
});
