import { describe, expect, test } from 'vitest';
import type { Doc } from './doc';
import { buildSupplyTree, type SupplyTree } from './hydraulics/supplyTree';
import { calcSupply } from './hydraulics/calc';
import { resolveSupplyRules } from './hydraulics/supplyRules';
import { isPB } from './materials';
import { routeSupplies, UNDERFLOOR_Z } from './supplyRoute';
import { supplyHouse } from './testSupplyHouse';
import { dropFixturePipes } from './dropPipes';
import { placeFixture, moveFixture } from './fixtures';
import { addPolyline } from './network';
import { createBuildingFromDims, deleteWall } from './building';

/** 床下（z = −300）の水平な給水・給湯管どうしが、40mm 未満の離れで平行に重なって走っている組（10mm を超えて重なるもの） */
function overlaps(doc: Doc): string[] {
  const net = doc.network, out: string[] = [];
  const segs = Object.values(net.segments).filter((s) => (s.system === 'water' || s.system === 'hotWater') && net.nodes[s.a].pos.z === UNDERFLOOR_Z && net.nodes[s.b].pos.z === UNDERFLOOR_Z);
  const axis = (s: (typeof segs)[0]) => { const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos; return Math.abs(a.y - b.y) < 60 ? 'h' : Math.abs(a.x - b.x) < 60 ? 'v' : null; };
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j], ax = axis(A);
    if (!ax || ax !== axis(B)) continue;
    const [a0, a1, b0, b1] = [net.nodes[A.a].pos, net.nodes[A.b].pos, net.nodes[B.a].pos, net.nodes[B.b].pos];
    const off = ax === 'h' ? Math.abs((a0.y + a1.y) / 2 - (b0.y + b1.y) / 2) : Math.abs((a0.x + a1.x) / 2 - (b0.x + b1.x) / 2);
    const [p0, p1, q0, q1] = ax === 'h' ? [a0.x, a1.x, b0.x, b1.x] : [a0.y, a1.y, b0.y, b1.y];
    const ov = Math.min(Math.max(p0, p1), Math.max(q0, q1)) - Math.max(Math.min(p0, p1), Math.min(q0, q1));
    if (off < 40 && ov > 10) out.push(`${A.id}/${B.id}`);
  }
  return out;
}

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
    // 地中で基礎貫通スリーブ（KSS）を通る所は PB のまま、基礎の外で HIVP に替える
    const away = (p: { x: number; y: number }) => p.x < -400 || p.x > 8400 || p.y < -400 || p.y > 6400;
    const buried = segs.filter((s) => net.nodes[s.a].pos.z < -611 && net.nodes[s.b].pos.z < -611 && (away(net.nodes[s.a].pos) || away(net.nodes[s.b].pos)));
    expect(buried.length).toBeGreaterThan(0);
    expect(buried.every((s) => s.material === 'HIVP')).toBe(true);
  });
  test('床下の管どうしを平行に重ねない', () => expect(overlaps(r.doc)).toEqual([]));
  test('各器具の給水・給湯と給湯器の入口に止水栓（口のすぐ先）。水理計算にも入る', () => {
    const net = r.doc.network;
    const ports = Object.values(net.nodes).filter((n) => n.fixtureId && ['kitchen', 'washbasin', 'toilet'].includes(r.doc.fixtures[n.fixtureId].type) && (n.portId === 'water' || n.portId === 'hot'));
    ports.push(Object.values(net.nodes).find((n) => n.fixtureId === h.ids.heater && n.portId === 'in')!);
    expect(ports).toHaveLength(6);
    for (const p of ports) {
      const segs = Object.values(net.segments).filter((s) => s.a === p.id || s.b === p.id);
      expect(segs).toHaveLength(1);
      const o = net.nodes[segs[0].a === p.id ? segs[0].b : segs[0].a];
      expect(o.kind).toBe('valve');
    }
    expect(r.valves).toBe(6);
    const c = calcSupply(r.doc, resolveSupplyRules({}), { flows: {} });
    expect('error' in c ? [] : c.rows.filter((x) => x.label.startsWith('バルブ'))).not.toEqual([]);
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
  test('先に「器具の真下に配管を落とす」を押していても、その立て管を使ってつなぐ（深さが違えば床下の高さまで足す）', () => {
    const h = supplyHouse();
    const dropped = dropFixturePipes(h.doc, 400).doc;
    const r = routeSupplies(dropped);
    expect(r.connected).toEqual({ water: 4, hot: 2 });
    expect(tree(r.doc).outlets).toHaveLength(4);
  });
  test('給湯器が無ければ給湯は知らせて残し、あとで置いて押すとつながる', () => {
    const h = supplyHouse();
    const noHeater = { ...h.doc, fixtures: Object.fromEntries(Object.entries(h.doc.fixtures).filter(([id]) => id !== h.ids.heater)), network: { ...h.doc.network, nodes: Object.fromEntries(Object.entries(h.doc.network.nodes).filter(([, n]) => n.fixtureId !== h.ids.heater)) } };
    const r1 = routeSupplies(noHeater);
    expect(r1.connected.hot).toBe(0);
    expect(r1.notes.join()).toMatch(/給湯器/);
    const withHeater = placeFixture(r1.doc, h.floorId, 'waterHeater', { x: 2000, y: -300 }).doc;
    const r2 = routeSupplies(withHeater);
    expect(r2.connected.hot).toBe(2);
    expect(overlaps(r2.doc)).toEqual([]);
  });
  test('あとから器具を足して押すと、2 台目のヘッダーも同じ引込から分ける', () => {
    const h = supplyHouse();
    let d = routeSupplies(h.doc).doc;
    for (let i = 0; i < 3; i++) d = placeFixture(d, h.floorId, 'faucet', { x: 2400 + i * 400, y: 2000 }).doc;
    const r = routeSupplies(d);
    expect(r.connected.water).toBe(3);
    expect(tree(r.doc).outlets).toHaveLength(7);
    expect(r.notes.join()).not.toMatch(/入口へ配管をつなげませんでした/);
  });
  test('ヘッダーは内部の立上りの上に置かない', () => {
    const h = supplyHouse();
    const d = moveFixture(h.doc, h.ids.meter!, { x: 4000, y: -1500 });
    const r = routeSupplies(d);
    for (const f of Object.values(r.doc.fixtures).filter((x) => x.type === 'waterHeader' || x.type === 'hotWaterHeader')) expect(Math.abs(f.x - 4000)).toBeGreaterThanOrEqual(210 + 75 + 60);
  });
  test('給湯器を回して置いても、給水と給湯は別の所で基礎を貫通する', () => {
    const h = supplyHouse();
    const d = moveFixture(h.doc, h.ids.heater, { x: 2000, y: -300 }, 90);
    const r = routeSupplies(d);
    expect(r.sleeves).toBe(3);
    expect(overlaps(r.doc)).toEqual([]);
  });
  test('建物の中の給湯器（東の壁ぎわ）でも給湯ヘッダーを置いてつなぐ', () => {
    const h = supplyHouse();
    const d = moveFixture(h.doc, h.ids.heater, { x: 7500, y: 3000 });
    const r = routeSupplies(d);
    expect(r.connected.hot).toBe(2);
  });
  test('メーターの出口にすでに配管があれば引込は足さず、知らせる', () => {
    const h = supplyHouse();
    const out = Object.values(h.doc.network.nodes).find((n) => n.fixtureId === h.ids.meter && n.portId === 'out')!;
    const stub = addPolyline(h.doc.network, [out.pos, { ...out.pos, x: out.pos.x + 300 }], { system: 'water', diameter: 20 }, { startNodeId: out.id }).net;
    const r = routeSupplies({ ...h.doc, network: stub });
    expect(r.notes.join()).toMatch(/すでに配管/);
  });
  test('立上りで囲まれた器具も（貫通して）つなぎ、貫通の数を返す', () => {
    const h = supplyHouse();
    const b = ['a', 'b', 'c', 'd'].reduce((bb, _, i) => {
      const pts = [{ x: 5600, y: 4200 }, { x: 7400, y: 4200 }, { x: 7400, y: 5800 }, { x: 5600, y: 5800 }];
      const m = { id: `box${i}`, kind: 'footing' as const, floorId: h.floorId, a: pts[i], b: pts[(i + 1) % 4], width: 150, z0: -700, z1: -150 };
      return { ...bb, members: { ...(bb.members ?? {}), [m.id]: m } };
    }, h.doc.building);
    const r = routeSupplies({ ...h.doc, building: b });
    expect(r.connected.water).toBe(4);
    expect(r.crossings).toBeGreaterThan(0);
  });
  test('外壁が 1 周つながっていない（立上りも無い）と、建物の中の器具が分からないことを知らせる', () => {
    let b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    b = deleteWall(b, Object.keys(b.walls)[0]);
    let d: Doc = { building: b, network: { nodes: {}, segments: {} }, fixtures: {}, site: { designGL: -611 } };
    d = placeFixture(d, b.floors[0].id, 'waterMeter', { x: -1500, y: 3000 }).doc;
    d = placeFixture(d, b.floors[0].id, 'kitchen', { x: 4000, y: 3000 }).doc;
    const r = routeSupplies(d);
    expect(r.error).toMatch(/建物の中/);
    expect(r.doc).toBe(d);
  });
  test('大きい家（12×9m・器具 15）でも 1.5 秒以内', () => {
    let b = createBuildingFromDims({ width: 12000, depth: 9000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    let d: Doc = { building: b, network: { nodes: {}, segments: {} }, fixtures: {}, site: { designGL: -611 } };
    const f = b.floors[0].id;
    d = placeFixture(d, f, 'waterMeter', { x: -1500, y: 4500 }).doc;
    d = placeFixture(d, f, 'waterHeater', { x: 3000, y: -300 }).doc;
    const types = ['kitchen', 'washbasin', 'toilet', 'shower', 'washer'] as const;
    for (let i = 0; i < 15; i++) d = placeFixture(d, f, types[i % 5], { x: 1500 + (i % 5) * 2000, y: 1500 + Math.floor(i / 5) * 2800 }).doc;
    b = d.building;
    const t0 = performance.now();
    const r = routeSupplies(d);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(r.connected.water).toBeGreaterThan(10);
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
