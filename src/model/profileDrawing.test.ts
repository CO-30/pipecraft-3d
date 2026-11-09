import { describe, expect, test } from 'vitest';
import { addFloor, emptyBuilding } from './building';
import type { Doc } from './doc';
import { addPolyline, emptyNetwork, type Network } from './network';
import { placeFixture, portNodes, type FixtureType } from './fixtures';
import { STANDARD_PROFILE } from './municipality';
import { branchPoints, buildProfile, extractRoute, outerDiameter } from './profileDrawing';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const base = (designGL?: number): Doc => ({ building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {}, site: designGL === undefined ? {} : { designGL } });
const floorId = (d: Doc) => d.building.floors[0].id;

/** マスを置いて接続口ノード ID を返す */
function manhole(d: Doc, type: FixtureType, x: number, y: number, invertZ: number): { doc: Doc; port: string; fixtureId: string } {
  const r = placeFixture(d, floorId(d), type, { x, y });
  const f = r.doc.fixtures[r.fixtureId!];
  const doc = { ...r.doc, fixtures: { ...r.doc.fixtures, [f.id]: { ...f, params: { invertZ } } } };
  const port = portNodes(doc.network, f.id)[0];
  return { doc: { ...doc, network: { ...doc.network, nodes: { ...doc.network.nodes, [port.id]: { ...port, pos: { ...port.pos, z: invertZ } } } } }, port: port.id, fixtureId: f.id };
}
const pipe = (net: Network, pts: ReturnType<typeof v>[], start?: string, end?: string, diameter = 100) =>
  addPolyline(net, pts, { system: 'sewage', diameter, material: 'VU' }, { startNodeId: start, endNodeId: end });

/** ケース A: マス A(0,0) 管底 −700 → 公共マス B(10000,0) 管底 −800、GL −100、φ100 */
function caseA() {
  let d = base(-100);
  const a = manhole(d, 'manholeSewage', 0, 0, -700); d = a.doc;
  const b = manhole(d, 'publicSewage', 10000, 0, -800); d = b.doc;
  const r = pipe(d.network, [v(0, 0, -700), v(10000, 0, -800)], a.port, b.port);
  return { doc: { ...d, network: r.net }, a: a.port, b: b.port, seg: r.segmentIds[0] };
}

describe('経路の抽出', () => {
  test('公共マスから上流へたどる（直線）', () => {
    const { doc, a, b } = caseA();
    const r = extractRoute(doc.network, b);
    expect('route' in r && r.route).toEqual([b, a]);
    expect('route' in r && r.branches).toEqual([]);
  });
  test('分岐: branchPoints が分岐点と選択肢を返し、choice で本線を決め他は branches', () => {
    let d = base(-100);
    const out = manhole(d, 'publicSewage', 8000, 0, -800); d = out.doc;
    const c = manhole(d, 'manholeSewage', 4000, 0, -750); d = c.doc;
    const a1 = manhole(d, 'manholeSewage', 0, 0, -700); d = a1.doc;
    const a2 = manhole(d, 'manholeSewage', 4000, 3000, -700); d = a2.doc;
    let net = pipe(d.network, [v(4000, 0, -750), v(8000, 0, -800)], c.port, out.port).net;
    net = pipe(net, [v(0, 0, -700), v(4000, 0, -750)], a1.port, c.port).net;
    net = pipe(net, [v(4000, 3000, -700), v(4000, 0, -750)], a2.port, c.port).net;
    const bp = branchPoints(net, out.port);
    expect(bp).toHaveLength(1);
    expect(bp[0].nodeId).toBe(c.port);
    expect(new Set(bp[0].options)).toEqual(new Set([a1.port, a2.port]));
    const r = extractRoute(net, out.port, { [c.port]: a1.port });
    expect('route' in r && r.route).toEqual([out.port, c.port, a1.port]);
    expect('route' in r && r.branches).toEqual([{ atNodeId: c.port, nodeIds: [c.port, a2.port] }]);
    // 未指定なら長いほう（a2 側 3000 < a1 側 4000 → a1）が本線
    const r2 = extractRoute(net, out.port);
    expect('route' in r2 && r2.route).toEqual([out.port, c.port, a1.port]);
  });
  test('排水がつながっていない点・閉路はエラー', () => {
    const d = base(-100);
    const w = addPolyline(d.network, [v(0, 0), v(1000, 0)], { system: 'water', diameter: 20 });
    const r = extractRoute(w.net, w.nodeIds[0]);
    expect('error' in r && r.error).toBe('排水の配管がつながっていません');
    // 閉路 a→b→c→a
    const loop = addPolyline(emptyNetwork(), [v(0, 0), v(3000, 0), v(3000, 3000)], { system: 'sewage', diameter: 100 });
    const closed = addPolyline(loop.net, [v(3000, 3000), v(0, 0)], { system: 'sewage', diameter: 100 }, { startNodeId: loop.nodeIds[2], endNodeId: loop.nodeIds[0] });
    const r2 = extractRoute(closed.net, loop.nodeIds[0]);
    expect('error' in r2 && r2.error).toBe('経路が輪になっています');
  });
});

describe('縦断図の計算（手計算ケース）', () => {
  test('外径表', () => {
    expect(outerDiameter(100)).toBe(114);
    expect(outerDiameter(75)).toBe(89);
    expect(outerDiameter(300)).toBe(330);
  });
  test('ケース A: 直線 1 本', () => {
    const { doc, b } = caseA();
    const r = extractRoute(doc.network, b);
    const m = buildProfile(doc, 'route' in r ? r.route : [], STANDARD_PROFILE, 'テスト');
    expect(m.nodes.map((n) => n.cumDistance)).toEqual([0, 10000]);
    expect(m.nodes.map((n) => n.groundLevel)).toEqual([-100, -100]);
    expect(m.nodes.map((n) => n.invertLevel)).toEqual([-700, -800]);
    expect(m.nodes[0].cover).toBe(486); // -100 - (-700 + 114)
    expect(m.nodes[0].manhole).toMatchObject({ type: 'manholeSewage', diameter: 300, depth: 600, symbol: 'circle' });
    expect(m.nodes[1].manhole).toMatchObject({ type: 'publicSewage', depth: 700 });
    expect(m.segments).toHaveLength(1);
    expect(m.segments[0]).toMatchObject({ distance: 10000, slopeText: '1/100', diameter: 100, pipeSpec: 'VUφ100' });
    expect(m.segments[0].slope).toBeCloseTo(0.01, 9);
    expect(m.warnings).toEqual([]);
    expect(m.tentativeGL).toBe(false);
  });
  test('ケース B: 折れ 2 区間（上流→下流の順に並ぶ）', () => {
    let d = base(0);
    const a = manhole(d, 'manholeSewage', 0, 0, -600); d = a.doc;
    const c = manhole(d, 'manholeInvert', 4000, 0, -640); d = c.doc;
    const b = manhole(d, 'publicSewage', 4000, 3000, -700); d = b.doc;
    let net = pipe(d.network, [v(0, 0, -600), v(4000, 0, -640)], a.port, c.port).net;
    net = pipe(net, [v(4000, 0, -640), v(4000, 3000, -700)], c.port, b.port).net;
    const doc = { ...d, network: net };
    const r = extractRoute(net, b.port);
    const m = buildProfile(doc, 'route' in r ? r.route : [], STANDARD_PROFILE, 't');
    expect(m.nodes.map((n) => n.nodeId)).toEqual([a.port, c.port, b.port]);
    expect(m.nodes.map((n) => n.cumDistance)).toEqual([0, 4000, 7000]);
    expect(m.segments.map((s) => s.distance)).toEqual([4000, 3000]);
    expect(m.segments.map((s) => s.slopeText)).toEqual(['1/100', '1/50']);
  });
  test('警告: 逆勾配・最小勾配未満・土被り不足。GL 未入力は仮', () => {
    let d = base(); // designGL なし
    const a = manhole(d, 'manholeSewage', 0, 0, -200); d = a.doc;
    const c = manhole(d, 'manholeSewage', 3000, 0, -220); d = c.doc; // 1/150 < 1/100
    const b = manhole(d, 'publicSewage', 6000, 0, -200); d = b.doc; // 逆勾配
    let net = pipe(d.network, [v(0, 0, -200), v(3000, 0, -220)], a.port, c.port).net;
    net = pipe(net, [v(3000, 0, -220), v(6000, 0, -200)], c.port, b.port).net;
    const doc = { ...d, network: net };
    const r = extractRoute(net, b.port);
    const m = buildProfile(doc, 'route' in r ? r.route : [], STANDARD_PROFILE, 't');
    const kinds = m.warnings.map((w) => w.kind);
    expect(kinds).toContain('minSlope');
    expect(kinds).toContain('reverseSlope');
    expect(kinds).toContain('cover'); // 0 - (-200 + 114) = 86 < 200
    expect(kinds).toContain('tentativeGL');
    expect(m.tentativeGL).toBe(true);
    expect(m.nodes[0].groundLevel).toBe(0);
    expect(m.segments[1].slope).toBeLessThan(0);
  });
  test('立て管（水平距離 0）は勾配なし', () => {
    const d = base(0);
    const r = addPolyline(d.network, [v(0, 0, 0), v(0, 0, -1000), v(3000, 0, -1030)], { system: 'drain', diameter: 75 });
    const route = extractRoute(r.net, r.nodeIds[2]);
    const m = buildProfile({ ...d, network: r.net }, 'route' in route ? route.route : [], STANDARD_PROFILE, 't');
    expect(m.segments[0]).toMatchObject({ slope: null, slopeText: '立管', distance: 0 });
    expect(m.nodes.map((n) => n.cumDistance)).toEqual([0, 0, 3000]);
  });
});
