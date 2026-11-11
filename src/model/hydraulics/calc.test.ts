import { describe, expect, test } from 'vitest';
import { calcSupply, type SupplyCalc } from './calc';
import { MPA_HEAD, westonGradient } from './formulas';
import { resolveSupplyRules } from './supplyRules';
import { kawasakiLike } from './testSupply';

const STD = resolveSupplyRules({});
const run = (s: Parameters<typeof calcSupply>[2] = { flows: {} }, rules = STD, doc = kawasakiLike().doc): SupplyCalc => {
  const c = calcSupply(doc, rules, s);
  if ('error' in c) throw new Error(c.error);
  return c;
};

describe('水理計算（川崎市の計算例に近い現場）', () => {
  const k = kawasakiLike();
  const c = run({ flows: {} }, STD, k.doc);

  test('4 栓 → 同時に 2 栓。いちばん遠いキッチンと、水量の大きい給湯器', () => {
    expect(c.totalOutlets).toBe(4);
    expect(c.simultaneous).toBe(2);
    expect(c.outlets.filter((o) => o.used).map((o) => o.fixtureId).sort()).toEqual([k.ids.kitchen, k.ids.heater].sort());
    expect(c.criticalFixtureId).toBe(k.ids.kitchen);
    expect(c.plannedFlow).toBe(32);
  });
  test('メーター〜F の区間は 32 L/min・25mm、動水勾配はウエストン', () => {
    const row = c.rows.find((r) => r.kind === 'pipe' && r.edge !== undefined && c.tree.edges[r.edge].to === k.ids.F)!;
    expect(row.flow).toBe(32);
    expect(row.diameter).toBe(25);
    expect(row.gradient).toBeCloseTo(westonGradient(32, 25), 9);
  });
  test('管の損失 = 動水勾配 × 延長（実長 × 1.1）', () => {
    for (const r of c.rows.filter((x) => x.kind === 'pipe')) {
      expect(r.loss).toBeCloseTo((r.gradient * r.length) / 1000, 9);
      if (r.edge !== undefined) expect(r.length).toBeCloseTo((c.tree.edges[r.edge].length / 1000) * 1.1, 9);
    }
  });
  test('全所要水頭 = いちばん大きい末端の所要水頭 ＋ 引込。余裕 3m を足して設計水圧と比べる', () => {
    const service = c.rows.filter((r) => r.edge === undefined && !r.label.startsWith('給水栓') && !r.label.startsWith('バルブ'));
    const maxPath = Math.max(...c.outlets.filter((o) => o.used).map((o) => o.pathHead));
    expect(c.total).toBeCloseTo(maxPath + service.reduce((a, r) => a + r.head, 0), 9);
    expect(c.required).toBeCloseTo(c.total + 3, 9);
    expect(c.available).toBeCloseTo(0.15 * MPA_HEAD, 9);
    expect(c.ok).toBe(true);
  });
  test('立上りの和（いちばん条件の悪い末端の道筋）= 末端の高さ −（メーター − 0.9m）', () => {
    const crit = c.rows.filter((r) => r.critical);
    const kitchenZ = c.tree.outlets.find((o) => o.fixtureId === k.ids.kitchen)!.z;
    expect(crit.reduce((a, r) => a + r.rise, 0)).toBeCloseTo((kitchenZ - (c.tree.meterZ - 900)) / 1000, 9);
  });
  test('記号: 器具が A から、配水管の分岐が最後', () => {
    const letters = c.outlets.map((o) => o.letter);
    expect(letters.slice().sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(Object.values(c.letters).length).toBeGreaterThan(4);
    expect(c.rows.at(-1)!.label).toMatch(/分水栓/);
  });
});

describe('条件を変える', () => {
  const k = kawasakiLike();
  test('設計水圧が低いと不適当', () => expect(run({ pressure: 0.05, flows: {} }, STD, k.doc).ok).toBe(false));
  test('同時に使う器具を選び直せる', () => {
    const c = run({ use: [k.ids.washbasin, k.ids.toilet], flows: {} }, STD, k.doc);
    expect(c.outlets.filter((o) => o.used).map((o) => o.fixtureId).sort()).toEqual([k.ids.washbasin, k.ids.toilet].sort());
    expect(c.plannedFlow).toBe(20);
  });
  test('消えた器具の id は無視して自動で選ぶ', () => {
    const c = run({ use: ['f_gone'], flows: {} }, STD, k.doc);
    expect(c.outlets.filter((o) => o.used)).toHaveLength(2);
  });
  test('一部だけ消えた選び方も、自動で選び直す（少ない器具で甘く計算しない）', () => {
    const c = run({ use: [k.ids.kitchen, 'f_gone'], flows: {} }, STD, k.doc);
    expect(c.plannedFlow).toBe(32);
    expect(c.warnings.join()).toMatch(/自動で選び直し/);
  });
  test('メーターの口径を指定できる（メーターと引込の行に効く）', () => {
    const c = run({ meterDia: 20, flows: {} }, STD, k.doc);
    expect(c.meterDia).toBe(20);
    expect(c.rows.find((r) => r.label === '水道メーター')!.diameter).toBe(20);
    expect(c.rows.find((r) => r.label.startsWith('引込管'))!.diameter).toBe(20);
  });
  test('対象外の方式は理由を返す（判定は参考）', () => {
    expect(run({ flows: {} }, STD, k.doc).outOfScope).toBeNull();
  });
  test('器具の水量を上書きできる', () => expect(run({ flows: { [k.ids.heater]: 24 } }, STD, k.doc).plannedFlow).toBe(36));
  test('13mm の管に 40 L/min は流速超過で不適当', () => {
    const c = run({ flows: { [k.ids.kitchen]: 40 } }, STD, k.doc);
    expect(c.rows.some((r) => r.over && r.diameter === 13)).toBe(true);
    expect(c.ok).toBe(false);
    expect(c.warnings.join()).toMatch(/流速/);
  });
  test('引込を描いていないときは延長 3m で計算し、その旨を知らせる', () => {
    const c = run({ flows: {} }, STD, k.doc);
    expect(c.rows.find((r) => r.label.startsWith('引込管'))!.length).toBeCloseTo(3 * 1.1, 9);
    expect(c.warnings.join()).toMatch(/引込/);
  });
  test('宜野湾市は設計水圧が要確認', () => {
    const c = run({ flows: {} }, resolveSupplyRules({ address: '宜野湾市大山' }), k.doc);
    expect(c.unverified.join()).toMatch(/宜野湾市/);
    expect(run({ pressure: 0.2, flows: {} }, resolveSupplyRules({ address: '宜野湾市大山' }), k.doc).unverified).toEqual([]);
  });
  test('器具が無ければ理由を返す', () => {
    const doc = { ...k.doc, fixtures: Object.fromEntries(Object.entries(k.doc.fixtures).filter(([, f]) => f.type === 'waterMeter')) };
    const net = { ...doc.network, nodes: Object.fromEntries(Object.entries(doc.network.nodes).filter(([, n]) => !n.fixtureId || doc.fixtures[n.fixtureId])) };
    const segs = Object.fromEntries(Object.entries(net.segments).filter(([, s]) => net.nodes[s.a] && net.nodes[s.b]));
    const c = calcSupply({ ...doc, network: { nodes: net.nodes, segments: segs } }, STD, { flows: {} });
    expect('error' in c && c.error).toMatch(/器具/);
  });
});
