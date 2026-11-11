import { describe, expect, test } from 'vitest';
import type { Doc } from '../doc';
import { calcSupply } from './calc';
import { buildSupplyTree, type SupplyTree } from './supplyTree';
import { suggestDiameters, type DiameterChange } from './suggest';
import { resolveSupplyRules } from './supplyRules';
import { kawasakiLike, newDoc, port, put, route } from './testSupply';

const STD = resolveSupplyRules({});
const apply = (doc: Doc, changes: DiameterChange[]): Doc => {
  const segments = { ...doc.network.segments };
  for (const c of changes) segments[c.segId] = { ...segments[c.segId], diameter: c.to };
  return { ...doc, network: { ...doc.network, segments } };
};
const okAfter = (doc: Doc, pressure: number) => {
  const c = calcSupply(doc, STD, { pressure, flows: {} });
  return !('error' in c) && c.ok;
};

describe('口径の提案', () => {
  test('足りていれば提案なし', () => {
    const r = suggestDiameters(kawasakiLike().doc, STD, { flows: {} });
    expect(r).toEqual({ changes: [], ok: true });
  });

  test('足りないとき: 提案どおりにすると適当。太くするだけ。上流は下流より細くない', () => {
    const { doc } = kawasakiLike();
    expect(okAfter(doc, 0.07)).toBe(false);
    const r = suggestDiameters(doc, STD, { pressure: 0.07, flows: {} });
    expect(r.ok).toBe(true);
    expect(r.changes.length).toBeGreaterThan(0);
    for (const c of r.changes) expect(c.to).toBeGreaterThan(c.from);
    const after = apply(doc, r.changes);
    expect(okAfter(after, 0.07)).toBe(true);
    const t = buildSupplyTree(after) as SupplyTree;
    for (const e of t.edges) {
      const up = t.parentEdge[e.from];
      if (up !== undefined) expect(t.edges[up].diameter).toBeGreaterThanOrEqual(e.diameter);
    }
  });

  test('器具につながる区間は、他を太くして足りるなら変えない', () => {
    const { doc } = kawasakiLike();
    const t = buildSupplyTree(doc) as SupplyTree;
    const fixtureSegs = new Set(t.edges.filter((e) => e.toFixture).flatMap((e) => e.segIds));
    expect(okAfter(doc, 0.0795)).toBe(false);
    const r = suggestDiameters(doc, STD, { pressure: 0.0795, flows: {} });
    expect(r.ok).toBe(true);
    expect(r.changes.some((c) => fixtureSegs.has(c.segId))).toBe(false);
  });

  test('流速超過は、その区間を太くする', () => {
    const k = kawasakiLike();
    const r = suggestDiameters(k.doc, STD, { flows: { [k.ids.kitchen]: 30 } });
    expect(r.ok).toBe(true);
    const c = calcSupply(apply(k.doc, r.changes), STD, { flows: { [k.ids.kitchen]: 30 } });
    expect('error' in c ? [] : c.rows.filter((x) => x.over)).toEqual([]);
  });

  test('メーターと引込の口径は提案で変わらず、家の管はメーターより太くしない', () => {
    const { doc } = kawasakiLike();
    const meterBefore = (buildSupplyTree(doc) as SupplyTree).meterDia;
    for (const p of [0.07, 0.0795]) {
      const r = suggestDiameters(doc, STD, { pressure: p, flows: {} });
      for (const ch of r.changes) expect(ch.to).toBeLessThanOrEqual(meterBefore);
      const after = calcSupply(apply(doc, r.changes), STD, { pressure: p, flows: {} });
      if ('error' in after) throw new Error(after.error);
      expect(after.meterDia).toBe(meterBefore);
      expect(after.ok).toBe(r.ok);
    }
  });
  test('長さ 0 の区間（ヘッダーの出口ですぐ分かれる）で止まらない', () => {
    let { doc, floorId } = newDoc();
    let q = put(doc, floorId, 'waterMeter', 0, 0); doc = q.doc; const meter = q.id;
    q = put(doc, floorId, 'waterHeader', 2000, 0); doc = q.doc; const header = q.id;
    q = put(doc, floorId, 'faucet', 9000, 2000); doc = q.doc; const f1 = q.id;
    // 2 つ目の水栓は出口の真下（x が同じ）に置き、出口の点で枝が分かれるようにする
    const o1x = port(doc.network, header, 'out1').pos.x;
    q = put(doc, floorId, 'faucet', o1x, -3000); doc = q.doc; const f2 = q.id;
    q = put(doc, floorId, 'faucet', 2500, 1500); doc = q.doc; const f3 = q.id; // 近い（いちばん条件の悪い末端は出口 1 の先）
    let net = doc.network;
    net = route(net, port(net, meter, 'out').id, port(net, header, 'in').id, 25).net;
    // 出口 2 にも器具（ヘッダーの入口が分岐点になる）
    net = route(net, port(net, header, 'out2').id, port(net, f3, 'water').id, 13).net;
    const o1 = port(net, header, 'out1').id;
    net = route(net, o1, port(net, f1, 'water').id, 13).net;
    net = route(net, o1, port(net, f2, 'water').id, 13).net;
    // メーター本体の口径が 25 と決まっていて、計算では 40 として扱う場合（長さ 0 の区間は 25 のまま）
    const d = { ...doc, network: net, fixtures: { ...doc.fixtures, [meter]: { ...doc.fixtures[meter], params: { diameter: 25 } } } };
    const t = buildSupplyTree(d) as SupplyTree;
    const zero = t.edges.findIndex((e) => e.segIds.length === 0);
    expect(zero).toBeGreaterThanOrEqual(0);
    expect(t.edges[zero].to).toBe(o1);
    // メーターを 40 と指定（長さ 0 の区間はメーターの口径を持つので、40 までは太くできる扱いになる）
    const base = calcSupply(d, STD, { meterDia: 40, flows: {} });
    if ('error' in base) throw new Error(base.error);
    // 幹線を太くするだけでは足りず、器具の枝まで太くしないと届かない水圧
    const p = (base.required - 1.0) / 102;
    const r = suggestDiameters(d, STD, { pressure: p, meterDia: 40, flows: {} });
    expect(r.ok).toBe(true);
  });
  test('50 にしても足りなければ、メーター・増圧の検討を知らせる', () => {
    const r = suggestDiameters(kawasakiLike().doc, STD, { pressure: 0.01, flows: {} });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/メーター/);
  });
});
