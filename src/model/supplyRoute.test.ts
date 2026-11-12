import { describe, expect, test } from 'vitest';
import type { Doc } from './doc';
import { buildSupplyTree, type SupplyTree } from './hydraulics/supplyTree';
import { calcSupply } from './hydraulics/calc';
import { resolveSupplyRules } from './hydraulics/supplyRules';
import { isPB } from './materials';
import { routeSupplies, UNDERFLOOR_Z } from './supplyRoute';
import { supplyHouse } from './testSupplyHouse';

const tree = (doc: Doc): SupplyTree => {
  const t = buildSupplyTree(doc);
  if ('error' in t) throw new Error(t.error);
  return t;
};
/** from の点から hotWater の区間だけをたどって着く器具 */
const hotReach = (doc: Doc, fromNodeId: string): Set<string> => {
  const seen = new Set([fromNodeId]), stack = [fromNodeId], out = new Set<string>();
  const nodes = Object.values(doc.network.nodes);
  while (stack.length) {
    const id = stack.pop()!;
    const n = doc.network.nodes[id];
    if (n.fixtureId && id !== fromNodeId) {
      const fx = doc.fixtures[n.fixtureId];
      if (fx.type !== 'hotWaterHeader') { out.add(fx.id); continue; }
      for (const p of nodes) if (p.fixtureId === fx.id && !seen.has(p.id)) { seen.add(p.id); stack.push(p.id); }
    }
    for (const s of Object.values(doc.network.segments)) {
      if (s.system !== 'hotWater' || (s.a !== id && s.b !== id)) continue;
      const o = s.a === id ? s.b : s.a;
      if (!seen.has(o)) { seen.add(o); stack.push(o); }
    }
  }
  return out;
};

describe('給水・給湯を床下でつなぐ（案）', () => {
  const h = supplyHouse();
  const r = routeSupplies(h.doc);

  test('給水: メーターから 4 栓（キッチン・洗面台・トイレ・給湯器）', () => {
    expect(r.error).toBeUndefined();
    const t = tree(r.doc);
    expect(t.outlets.map((o) => o.fixtureId).sort()).toEqual([h.ids.kitchen, h.ids.washbasin, h.ids.toilet, h.ids.heater].sort());
    expect(r.connected).toEqual({ water: 4, hot: 2 });
    const c = calcSupply(r.doc, resolveSupplyRules({}), { flows: {} });
    expect('error' in c).toBe(false);
  });
  test('給湯: 給湯器の出口からキッチン・洗面台の給湯口へ', () => {
    const out = Object.values(r.doc.network.nodes).find((n) => n.fixtureId === h.ids.heater && n.portId === 'out')!;
    expect([...hotReach(r.doc, out.id)].sort()).toEqual([h.ids.kitchen, h.ids.washbasin].sort());
  });
  test('ヘッダーは床下（設置面 −400）に給水・給湯 1 台ずつ', () => {
    const hs = Object.values(r.doc.fixtures).filter((f) => f.type === 'waterHeader' || f.type === 'hotWaterHeader');
    expect(hs.map((f) => f.type).sort()).toEqual(['hotWaterHeader', 'waterHeader']);
    expect(hs.every((f) => f.params?.mountZ === -400)).toBe(true);
    expect(r.headers).toBe(2);
  });
  test('内部の立上りは人通口を通って貫通しない。外周の貫通は 3（引込・給湯器の入口と出口）', () => {
    expect(r.crossings).toBe(0);
    expect(r.sleeves).toBe(3);
  });
  test('床下の給水管は PB、地中の管は HIVP', () => {
    const net = r.doc.network;
    const segs = Object.values(net.segments).filter((s) => s.system === 'water');
    const inHouse = (p: { x: number; y: number }) => p.x > 75 && p.x < 7925 && p.y > 75 && p.y < 5925;
    const under = segs.filter((s) => net.nodes[s.a].pos.z === UNDERFLOOR_Z && net.nodes[s.b].pos.z === UNDERFLOOR_Z && inHouse(net.nodes[s.a].pos) && inHouse(net.nodes[s.b].pos));
    expect(under.length).toBeGreaterThan(0);
    expect(under.every((s) => isPB(s.material))).toBe(true);
    const buried = segs.filter((s) => net.nodes[s.a].pos.z < -611 && net.nodes[s.b].pos.z < -611);
    expect(buried.length).toBeGreaterThan(0);
    expect(buried.every((s) => s.material === 'HIVP')).toBe(true);
  });
  test('もう一度押しても増えない', () => {
    const r2 = routeSupplies(r.doc);
    expect(r2.pipes).toBe(0);
    expect(r2.doc).toBe(r.doc);
  });
});

describe('条件を変える', () => {
  test('床下のヘッダーがあればそれを使う', () => {
    const h = supplyHouse({ header: true });
    const r = routeSupplies(h.doc);
    expect(Object.values(r.doc.fixtures).filter((f) => f.type === 'waterHeader')).toHaveLength(1);
    expect(tree(r.doc).outlets).toHaveLength(4);
  });
  test('給水口が 7 つ（給湯器を含む）ならヘッダーは 2 台、全部つながる', () => {
    const h = supplyHouse({ extraWater: 3 });
    const r = routeSupplies(h.doc);
    expect(Object.values(r.doc.fixtures).filter((f) => f.type === 'waterHeader')).toHaveLength(2);
    expect(tree(r.doc).outlets).toHaveLength(7);
  });
  test('メーターが無ければ何もしない', () => {
    const h = supplyHouse({ meter: false });
    const r = routeSupplies(h.doc);
    expect(r.error).toMatch(/水道メーター/);
    expect(r.doc).toBe(h.doc);
  });
  test('宜野湾市は地中の管を GL から 600 下に', () => {
    const h = supplyHouse();
    const r = routeSupplies(h.doc, { burial: resolveSupplyRules({ address: '宜野湾市' }).burial.v });
    const zs = Object.values(r.doc.network.nodes).map((n) => n.pos.z);
    expect(Math.min(...zs)).toBe(-611 - 600);
  });
});
