import { describe, expect, test } from 'vitest';
import { addFloor, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork } from '../model/network';
import { placeFixture, portNodes, type FixtureType } from '../model/fixtures';
import { STANDARD_PROFILE } from '../model/municipality';
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
    expect(svg).toContain('stroke="#1f2328"'); // 公共マス
    const m2 = caseA();
    m2.segments[0].existing = true;
    m2.nodes[0].existing = true;
    const svg2 = renderProfileSvg(m2, meta);
    expect(svg2).toContain('stroke="#1d4ed8"');
    // 警告は橙（赤＝新設と区別）
    const m3 = caseA();
    m3.warnings.push({ kind: 'cover', nodeId: m3.nodes[0].nodeId, message: '点 1: 土被りが少ない' });
    expect(renderProfileSvg(m3, meta)).toContain('#ea580c');
  });
  test('unverified は要確認として出る', () => {
    const m = caseA();
    m.profile = { ...m.profile, unverified: ['土被りの最小値'] };
    expect(renderProfileSvg(m, meta)).toContain('要確認: 土被りの最小値');
  });
});
