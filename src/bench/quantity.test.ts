import { describe, expect, it } from 'vitest';
import type { MatSummary } from '../model/materialSummary';
import { compareQuantities, formatQuantities, qtyKey } from './quantity';

const sum = (items: { kind: 'pipe' | 'fitting' | 'fixture' | 'manhole'; name: string; spec: string; unit: 'm' | '個' | '台'; total: number }[]): MatSummary =>
  ({ axis: 'place', columns: [], warnings: [], sections: [{ title: 'x', items: items.map((i) => ({ ...i, qty: {} })) }] });

describe('品目の合わせ方（qtyKey）', () => {
  it('管は管種と口径で合わせる（アプリの「給水管 / HIVP φ20」と見積の「HIVP 20」は同じ）', () => {
    expect(qtyKey('給水管', 'HIVP φ20', 'm')).toBe(qtyKey('HIVP', '20', 'm'));
    expect(qtyKey('排水管', 'VU φ100', 'm')).toBe(qtyKey('塩ビパイプ', 'VU100', 'm'));
    expect(qtyKey('給水管', 'HIVP φ20', 'm')).not.toBe(qtyKey('HIVP', '25', 'm'));
  });
  it('口径は φ の後ろの数字（「PB保温10mm φ13」の 10 は口径ではない）', () => {
    expect(qtyKey('給水管', 'PB保温10mm φ13', 'm')).toBe(qtyKey('PB', '13', 'm'));
    expect(qtyKey('給水管', 'PB保温5mm φ20', 'm')).not.toBe(qtyKey('給水管', 'PB保温5mm φ13', 'm'));
  });
  it('管種は語として合わせる（「PEX」「CHIP」を PE・HI にしない）', () => {
    expect(qtyKey('架橋ポリエチレン管', 'PEX φ13', 'm')).not.toBe(qtyKey('PE', '13', 'm'));
    expect(qtyKey('HI', '20', 'm')).toBe(qtyKey('給水管', 'HIVP φ20', 'm')); // 申請図の「HI20」は HIVP の略
    expect(qtyKey('VP40 L=4m', '', 'm')).toBe(qtyKey('VP', 'φ40', 'm'));
  });
  it('継手・部品は名前と口径。全角・空白の違いは無視', () => {
    expect(qtyKey('エルボ', '給水 HIVP φ20', '個')).toBe(qtyKey('ｴﾙﾎﾞ', 'HIVP 20', '個'));
    expect(qtyKey('止水栓', '', '個')).toBe(qtyKey('止水栓', '', '個'));
    expect(qtyKey('エルボ', 'φ20', '個')).not.toBe(qtyKey('チーズ', 'φ20', '個'));
  });
});

describe('数量の照合（compareQuantities）', () => {
  it('品目ごとに 自動の数量・実際の数量・差・率。片方にしか無い品目も出す', () => {
    const rows = compareQuantities(
      [{ name: 'HIVP', spec: '20', unit: 'm', qty: 10 }, { name: '止水栓', spec: '', unit: '個', qty: 4 }],
      sum([
        { kind: 'pipe', name: '給水管', spec: 'HIVP φ20', unit: 'm', total: 6 },
        { kind: 'pipe', name: '給湯管', spec: 'HIVP φ20', unit: 'm', total: 6 },
        { kind: 'fitting', name: 'エルボ', spec: '給水 HIVP φ20', unit: '個', total: 3 },
      ]),
    );
    expect(rows).toEqual([
      { label: 'HIVP 20', unit: 'm', design: 12, actual: 10, diff: 2, rate: 0.2 },
      { label: '止水栓', unit: '個', design: 0, actual: 4, diff: -4, rate: -1 },
      { label: 'エルボ（給水 HIVP φ20）', unit: '個', design: 3, actual: null, diff: null, rate: null },
    ]);
  });
  it('表（Markdown）: 管は長さの合計で見た誤差、部品は品目ごとの誤差の平均、実際に無い品目の数を見出しに', () => {
    const md = formatQuantities([
      { label: 'HIVP 20', unit: 'm', design: 12, actual: 10, diff: 2, rate: 0.2 },
      { label: 'VU 100', unit: 'm', design: 25, actual: 30, diff: -5, rate: -0.167 },
      { label: '止水栓', unit: '個', design: 3, actual: 4, diff: -1, rate: -0.25 },
      { label: 'x', unit: '個', design: 1, actual: null, diff: null, rate: null },
    ]);
    expect(md).toContain('管の長さの誤差 17.5%（差の合計 7m ÷ 実際 40m）');
    expect(md).toContain('部品・器具の数の誤差（平均）25.0%');
    expect(md).toContain('実際の数量に無い品目 1');
    expect(md).toContain('系統ごとの長さ（管種を問わない）: 給水・給湯 自動 12m / 実際 10m・排水 自動 25m / 実際 30m');
    expect(md).toContain('| HIVP 20 | m | 12 | 10 | +2 | +20.0% |');
    expect(md).toContain('| x | 個 | 1 | — | — | — |');
  });
});
