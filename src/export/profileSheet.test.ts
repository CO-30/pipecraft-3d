import { describe, expect, test } from 'vitest';
import { addFloor, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork } from '../model/network';
import { placeFixture, portNodes, type FixtureType } from '../model/fixtures';
import { BUILTIN_PROFILES, STANDARD_PROFILE } from '../model/municipality';
import { buildProfile, extractRoute } from '../model/profileDrawing';
import { renderProfileSheet, renderProfileSvg } from './profileSheet';
import { sheetsToSvg } from './sheet';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const base = (designGL?: number): Doc => ({ building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {}, site: designGL === undefined ? {} : { designGL } });
function manhole(d: Doc, type: FixtureType, x: number, y: number, invertZ: number) {
  const r = placeFixture(d, d.building.floors[0].id, type, { x, y });
  const f = r.doc.fixtures[r.fixtureId!];
  const port = portNodes(r.doc.network, f.id)[0];
  const doc: Doc = { ...r.doc, fixtures: { ...r.doc.fixtures, [f.id]: { ...f, params: { invertZ } } }, network: { ...r.doc.network, nodes: { ...r.doc.network.nodes, [port.id]: { ...port, pos: { ...port.pos, z: invertZ } } } } };
  return { doc, port: port.id };
}
function caseA(designGL: number | null = -100) {
  let d = base(designGL ?? undefined);
  const a = manhole(d, 'manholeSewage', 0, 0, -700); d = a.doc;
  const b = manhole(d, 'publicSewage', 10000, 0, -800); d = b.doc;
  const r = addPolyline(d.network, [v(0, 0, -700), v(10000, 0, -800)], { system: 'sewage', diameter: 100, material: 'VU' }, { startNodeId: a.port, endNodeId: b.port });
  const doc = { ...d, network: r.net };
  const route = extractRoute(doc.network, b.port);
  return buildProfile(doc, 'route' in route ? route.route : [], STANDARD_PROFILE, '排水設備 縦断図');
}
const meta = { siteName: 'テスト工事', date: new Date(2026, 10, 9) };

describe('排水縦断図の描画', () => {
  test('ケース A のスナップショット', () => {
    expect(renderProfileSvg(caseA(), meta)).toMatchSnapshot();
  });
  test('数値・見出し・縮尺が入る', () => {
    const svg = renderProfileSvg(caseA(), meta);
    expect(svg).toContain('1/100'); // 勾配
    expect(svg).toContain('10.000'); // 累加距離 m
    expect(svg).toContain('0.486'); // 土被り m
    expect(svg).toContain('-0.800'); // 管底高
    expect(svg).toContain('排水設備 縦断図');
    expect(svg).toContain('テスト工事');
    expect(svg).toContain('H 1/100 V 1/50');
    expect(svg).toContain('2026年11月9日');
    expect(svg).not.toContain('※');
  });
  test('GL未入力は仮表示', () => {
    const svg = renderProfileSvg(caseA(null), meta);
    expect(svg).toContain('（仮）');
    expect(svg).toContain('設計GL');
  });
  test('警告は赤で欄外に一覧', () => {
    const m = caseA();
    m.warnings.push({ kind: 'cover', nodeId: m.nodes[0].nodeId, message: '点 1: 土被りが少ない' });
    const svg = renderProfileSvg(m, meta);
    expect(svg).toContain('※');
    expect(svg).toContain('土被りが少ない');
    expect(svg).toContain('#ea580c');
  });
  test('長い経路は収まる縮尺に上げる（A3 横）', () => {
    const m = caseA();
    m.nodes[1].cumDistance = 60000; // 60m → 1/100 だと 600mm で収まらない
    m.segments[0].distance = 60000;
    const sheet = renderProfileSheet(m, meta);
    expect(sheet.width).toBe(420);
    const svg = renderProfileSvg(m, meta);
    expect(svg).toMatch(/H 1\/(200|250|300)/);
  });
  test('分岐点の注記は図に出る。警告が多いときは「他 n 件」', () => {
    const m = caseA();
    m.nodes[0].note = '→別図 枝1';
    for (let i = 0; i < 10; i++) m.warnings.push({ kind: 'cover', message: `警告 ${i}` });
    const svg = renderProfileSvg(m, meta);
    expect(svg).toContain('→別図 枝1');
    expect(svg).toContain('他 3 件');
    expect(svg).not.toContain('警告 9');
    expect(svg).not.toContain('⚠'); // PDF のフォントに無い記号は使わない
  });
  test('sheetsToSvg は複数ページを縦に並べた 1 つの SVG', () => {
    const a = renderProfileSheet(caseA(), meta), b = renderProfileSheet(caseA(), meta);
    const svg = sheetsToSvg([a, b]);
    expect(svg).toContain('viewBox="0 0 420 594"');
    expect(svg.match(/排水設備 縦断図/g)?.length).toBe(4); // 見出し＋表題欄 × 2 ページ
  });
  test('色分け: 新設の管とマスは赤、公共マスは黒、既設の区間は青。凡例あり', () => {
    const m = caseA();
    const svg = renderProfileSvg(m, meta);
    expect(svg).toContain('凡例');
    expect(svg).toContain('stroke="#d91e18"'); // 新設の管・汚水マス
    // 公共マスの記号（◎の点）は黒
    expect(svg).toMatch(/<circle[^>]*fill="#1f2328"[^>]*stroke="#1f2328"/);
    const m2 = caseA();
    m2.segments[0].existing = true;
    m2.nodes[0].existing = true;
    const svg2 = renderProfileSvg(m2, meta);
    expect(svg2).toContain('stroke="#1d4ed8"');
    expect(svg2).not.toContain('stroke="#d91e18"'); // 既設だけなら赤は無い
    // 警告は橙（赤＝新設と区別）
    const m3 = caseA();
    m3.warnings.push({ kind: 'cover', nodeId: m3.nodes[0].nodeId, message: '点 1: 土被りが少ない' });
    expect(renderProfileSvg(m3, meta)).toContain('#ea580c');
  });
  test('器具の無い曲がり点は、両側の区間が既設なら青、どちらかが新設なら赤', () => {
    // A(マス) → 曲がり点 → B(公共マス)。区間 1 既設、区間 2 新設
    const d = base(-100);
    const a = manhole(d, 'manholeSewage', 0, 0, -700);
    const b = manhole(a.doc, 'publicSewage', 8000, 0, -800);
    const r = addPolyline(b.doc.network, [v(0, 0, -700), v(4000, 0, -750), v(8000, 0, -800)], { system: 'sewage', diameter: 100, material: 'VU' }, { startNodeId: a.port, endNodeId: b.port });
    const seg1 = r.segmentIds[0], seg2 = r.segmentIds[1];
    const mk = (ex1: boolean, ex2: boolean) => {
      const net = { ...r.net, segments: { ...r.net.segments, [seg1]: { ...r.net.segments[seg1], existing: ex1 }, [seg2]: { ...r.net.segments[seg2], existing: ex2 } } };
      const route = extractRoute(net, b.port);
      return buildProfile({ ...b.doc, network: net }, 'route' in route ? route.route : [], STANDARD_PROFILE, 't');
    };
    const both = renderProfileSvg(mk(true, true), meta);
    expect(both).toMatch(/<circle[^>]*r="0.8"[^>]*fill="#1d4ed8"/);
    const mixed = renderProfileSvg(mk(true, false), meta);
    expect(mixed).toMatch(/<circle[^>]*r="0.8"[^>]*fill="#d91e18"/);
  });
  test('A4 縦でも凡例が表題欄に重ならず収まる（糸満市）', () => {
    const m = caseA();
    m.profile = BUILTIN_PROFILES.find((p) => p.id === 'itoman')!;
    const sheet = renderProfileSheet(m, meta);
    expect(sheet.width).toBe(210);
    const legend = sheet.ops.find((o) => o.t === 'text' && o.s.startsWith('凡例')) as { s: string; x: number } | undefined;
    expect(legend).toBeTruthy();
    // 文字数 × 2.4mm が 表題欄の左端 (210-10-84=116) − 余白 に収まる
    expect(legend!.s.length * 2.4).toBeLessThanOrEqual(116 - legend!.x + 1);
  });
  test('沖縄市の様式: 桝の名前が図の上に「NO.1汚水マス φ300 H600」、表は 3 行、長さは 2 桁、基準の注記', () => {
    const p = BUILTIN_PROFILES.find((x) => x.id === 'okinawa-city')!;
    const d = base(-100);
    const a = manhole(d, 'manholeSewage', 0, 0, -700);
    const b = manhole(a.doc, 'publicSewage', 10000, 0, -800);
    const r = addPolyline(b.doc.network, [v(0, 0, -700), v(10000, 0, -800)], { system: 'sewage', diameter: 100, material: 'VU' }, { startNodeId: a.port, endNodeId: b.port });
    const doc = { ...b.doc, network: r.net };
    const rt = extractRoute(doc.network, b.port);
    const model = buildProfile(doc, 'route' in rt ? rt.route : [], p, '排水設備 縦断図');
    const svg = renderProfileSvg(model, meta);
    expect(svg).toContain('NO.1汚水マス φ300 H600');
    expect(svg).toContain('公共汚水マス φ300 H700');
    expect(svg).toContain('10.00'); // 長さ 2 桁
    expect(svg).toContain('1.0/100');
    expect(svg).toContain('100VU');
    expect(svg).toContain('公共桝の管底を ±0');
    expect(svg).toContain('(±0)');
    expect(svg).toContain('S=1/200');
    expect(svg).not.toContain('累加距離');
  });
  test('unverified は要確認として出る', () => {
    const m = caseA();
    m.profile = { ...m.profile, unverified: ['土被りの最小値'] };
    expect(renderProfileSvg(m, meta)).toContain('要確認: 土被りの最小値');
  });
});
