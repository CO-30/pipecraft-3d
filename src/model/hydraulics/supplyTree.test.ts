import { describe, expect, test } from 'vitest';
import { segmentLength } from '../network';
import { readSuiriSettings, writeSuiriSettings } from './settings';
import { buildSupplyTree, type SupplyTree } from './supplyTree';
import { kawasakiLike, newDoc, port, put, route } from './testSupply';

const tree = (t: ReturnType<typeof buildSupplyTree>): SupplyTree => {
  if ('error' in t) throw new Error(t.error);
  return t;
};

describe('設定（site.application の suiri.*）', () => {
  test('書いて読むと戻る。他のキーは残る', () => {
    const app = writeSuiriSettings({ x: '1' }, { pressure: 0.2, meterDia: 20, use: ['a', 'b'], flows: { f1: 24 } });
    expect(app).toEqual({ x: '1', 'suiri.pressure': '0.2', 'suiri.meterDia': '20', 'suiri.use': 'a,b', 'suiri.flow.f1': '24' });
    expect(readSuiriSettings(app)).toEqual({ pressure: 0.2, meterDia: 20, use: ['a', 'b'], flows: { f1: 24 } });
  });
  test('空にしたキーは消える', () => {
    const app = writeSuiriSettings({ 'suiri.use': 'a', 'suiri.pressure': '0.2', 'suiri.flow.f1': '24' }, { use: [], pressure: undefined, flows: {} });
    expect(app).toEqual({});
  });
  test('数字でない値は読まない', () => expect(readSuiriSettings({ 'suiri.margin': 'abc' })).toEqual({ flows: {} }));
});

describe('給水の木', () => {
  test('器具 4 つ（給湯器を含む）、給湯の先は数えない', () => {
    const { doc, ids } = kawasakiLike();
    const t = tree(buildSupplyTree(doc));
    expect(t.outlets.map((o) => o.fixtureId).sort()).toEqual([ids.kitchen, ids.washbasin, ids.toilet, ids.heater].sort());
    expect(t.outlets.find((o) => o.fixtureId === ids.heater)!.dia).toBe(20);
    expect(t.meterId).toBe(ids.meter);
  });
  test('区間の長さの和は給水管の長さの和', () => {
    const { doc } = kawasakiLike();
    const t = tree(buildSupplyTree(doc));
    const all = Object.values(doc.network.segments).filter((s) => s.system === 'water').reduce((a, s) => a + segmentLength(doc.network, s.id), 0);
    expect(t.edges.reduce((a, e) => a + e.length, 0)).toBeCloseTo(all, 6);
  });
  test('区切りは分岐・器具・口径の変わり目（F と E が区切り）', () => {
    const { doc, ids } = kawasakiLike();
    const t = tree(buildSupplyTree(doc));
    const trunk = t.edges.find((e) => e.from === t.rootNodeId)!;
    expect(trunk.to).toBe(ids.F);
    expect(trunk.diameter).toBe(25);
    expect(t.edges.find((e) => e.from === ids.F && e.to === ids.E)!.diameter).toBe(20);
    expect(t.edges.filter((e) => e.from === ids.E)).toHaveLength(3);
    expect(t.edges.filter((e) => e.toFixture)).toHaveLength(4);
    expect(t.parentEdge[ids.E]).toBe(t.edges.findIndex((e) => e.to === ids.E));
  });
  test('実測長がある区間はその長さ', () => {
    const { doc, ids } = kawasakiLike();
    const t0 = tree(buildSupplyTree(doc));
    const seg = t0.edges.find((e) => e.from === ids.F && e.to === ids.E)!.segIds[0];
    const d2 = { ...doc, network: { ...doc.network, segments: { ...doc.network.segments, [seg]: { ...doc.network.segments[seg], measuredLength: 9999 } } } };
    const t = tree(buildSupplyTree(d2));
    const e = t.edges.find((x) => x.from === ids.F && x.to === ids.E)!;
    expect(e.length).toBeCloseTo(9999 + (e.segIds.length > 1 ? e.segIds.slice(1).reduce((a, s) => a + segmentLength(doc.network, s), 0) : 0), 6);
  });
  test('ヘッダーは通り抜ける', () => {
    let { doc, floorId } = newDoc();
    let r = put(doc, floorId, 'waterMeter', 0, 0); doc = r.doc; const meter = r.id;
    r = put(doc, floorId, 'waterHeader', 2000, 0); doc = r.doc; const header = r.id;
    r = put(doc, floorId, 'faucet', 4000, 2000); doc = r.doc; const faucet = r.id;
    let net = doc.network;
    net = route(net, port(net, meter, 'out').id, port(net, header, 'in').id, 20).net;
    net = route(net, port(net, header, 'out1').id, port(net, faucet, 'water').id, 13).net;
    const t = tree(buildSupplyTree({ ...doc, network: net }));
    expect(t.outlets.map((o) => o.fixtureId)).toEqual([faucet]);
    // 使っていない出口は枝にしない（長さ 0 の偽の枝を図に出さない）
    expect(t.edges.every((e) => e.segIds.length > 0)).toBe(true);
  });
  test('ポンプ・高置水槽・メーター 2 個は対象外として理由を持つ', () => {
    const k = kawasakiLike();
    expect(tree(buildSupplyTree(k.doc)).outOfScope).toBeNull();
    const doc = put(k.doc, k.floorId, 'pump', -3000, 3000).doc;
    expect(tree(buildSupplyTree(doc)).outOfScope).toMatch(/ポンプ/);
  });
  test('メーターが無ければ理由を返す', () => {
    const { doc } = newDoc();
    const t = buildSupplyTree(doc);
    expect('error' in t && t.error).toMatch(/水道メーター/);
  });
  test('メーター 2 個・ポンプは対象外と知らせる', () => {
    const k = kawasakiLike();
    let doc = put(k.doc, k.floorId, 'waterMeter', -3000, 0).doc;
    doc = put(doc, k.floorId, 'pump', -3000, 3000).doc;
    const t = tree(buildSupplyTree(doc));
    expect(t.warnings.join()).toMatch(/対象外/);
  });
  test('輪になった配管は一度だけたどる', () => {
    const { doc, ids } = kawasakiLike();
    const net = route(doc.network, ids.E, { x: doc.network.nodes[ids.F].pos.x + 1000, y: 0, z: doc.network.nodes[ids.F].pos.z }, 20).net;
    // 終点を幹線の上に置いて F の先とつなぐ
    const end = Object.values(net.nodes).find((n) => n.pos.x === doc.network.nodes[ids.F].pos.x + 1000 && n.pos.y === 0)!;
    const loop = route(net, end.id, ids.F, 20).net;
    const t = tree(buildSupplyTree({ ...doc, network: loop }));
    expect(t.warnings.join()).toMatch(/輪/);
  });
  test('引込: メーターの入口の上流に描いた管があればその長さ', () => {
    const k = kawasakiLike();
    const t0 = tree(buildSupplyTree(k.doc));
    // メーターの口径は申請書と同じ決め方（入口・出口の管）。出口の管が 25
    expect(t0.meterDia).toBe(25);
    expect(t0.service).toEqual({ length: 0, diameter: 25, drawn: false });
    const inp = port(k.doc.network, k.ids.meter, 'in');
    const net = route(k.doc.network, inp.id, { x: inp.pos.x - 2000, y: 0, z: inp.pos.z }, 25).net;
    const t = tree(buildSupplyTree({ ...k.doc, network: net }));
    expect(t.service.drawn).toBe(true);
    expect(t.service.length).toBeCloseTo(2000, 6);
    expect(t.service.diameter).toBe(25);
  });
});
