import { describe, expect, test } from 'vitest';
import type { Doc } from '../doc';
import { calcSupply } from './calc';
import { buildSupplyTree, type SupplyTree } from './supplyTree';
import { suggestDiameters, type DiameterChange } from './suggest';
import { resolveSupplyRules } from './supplyRules';
import { kawasakiLike } from './testSupply';

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
    expect(okAfter(doc, 0.078)).toBe(false);
    const r = suggestDiameters(doc, STD, { pressure: 0.078, flows: {} });
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

  test('50 にしても足りなければ、メーター・増圧の検討を知らせる', () => {
    const r = suggestDiameters(kawasakiLike().doc, STD, { pressure: 0.01, flows: {} });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/メーター/);
  });
});
