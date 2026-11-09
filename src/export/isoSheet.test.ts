import { describe, expect, test } from 'vitest';
import { addFloor, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork } from '../model/network';
import { placeFixture, portNodes } from '../model/fixtures';
import { BUILTIN_PROFILES, STANDARD_PROFILE } from '../model/municipality';
import { buildIsometric } from '../model/isometric';
import { buildProfile, extractRoute } from '../model/profileDrawing';
import { drawIsometric, renderIsoSheet, renderIsoSvg } from './isoSheet';
import { renderProfileSvg } from './profileSheet';
import { sheetToSvg, type Sheet } from './sheet';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const meta = { siteName: 'テスト工事', date: new Date(2026, 10, 10) };

function waterDoc() {
  const b1 = addFloor(emptyBuilding(), { height: 3000 });
  let doc: Doc = { building: b1.b, network: emptyNetwork(), fixtures: {}, site: { designGL: -300 } };
  const m = placeFixture(doc, b1.floorId, 'waterMeter', { x: 0, y: 0 }); doc = m.doc;
  const out = portNodes(doc.network, m.fixtureId!).find((n) => n.portId === 'out')!;
  const t = placeFixture(doc, b1.floorId, 'faucet', { x: 4000, y: 2000 }); doc = t.doc;
  const p = portNodes(doc.network, t.fixtureId!)[0];
  const r = addPolyline(doc.network, [out.pos, v(4000, 0, out.pos.z), v(4000, 2000, out.pos.z), p.pos], { system: 'water', diameter: 20, material: 'HI' }, { startNodeId: out.id, endNodeId: p.id });
  return { ...doc, network: r.net };
}
function drainDoc() {
  let doc: Doc = { building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {}, site: { designGL: 0 } };
  const f = doc.building.floors[0].id;
  const m1 = placeFixture(doc, f, 'manholeSewage', { x: 0, y: 0 }); doc = m1.doc;
  const m2 = placeFixture(doc, f, 'publicSewage', { x: 5000, y: 0 }); doc = m2.doc;
  const p1 = portNodes(doc.network, m1.fixtureId!)[0], p2 = portNodes(doc.network, m2.fixtureId!)[0];
  const r = addPolyline(doc.network, [p1.pos, p2.pos], { system: 'sewage', diameter: 100, material: 'VU' }, { startNodeId: p1.id, endNodeId: p2.id });
  return { doc: { ...doc, network: r.net }, outlet: p2.id };
}

describe('アイソメ図の描画', () => {
  test('給水のアイソメ図: 管種口径×長さ、器具名、高さ、凡例、NO SCALE', () => {
    const iso = buildIsometric(waterDoc(), 'water', STANDARD_PROFILE);
    const svg = renderIsoSvg(iso, STANDARD_PROFILE, { ...meta, title: '立面図（展開図）' });
    expect(svg).toContain('HI20×3.9'); // メーターの出口（x=100）から 4000 まで
    expect(svg).toContain('HI20×2.0');
    expect(svg).toContain('水道メーター');
    expect(svg).toContain('水栓（壁付）');
    expect(svg).toContain('NO SCALE');
    expect(svg).toContain('給水');
    expect(svg).toContain('stroke="#d91e18"');
    expect(svg).toMatchSnapshot();
  });
  test('drawIsometric は与えた枠に収める（線が枠の外へ出ない）', () => {
    const iso = buildIsometric(waterDoc(), 'water', STANDARD_PROFILE);
    const sheet: Sheet = { width: 210, height: 297, ops: [] };
    drawIsometric(sheet, iso, STANDARD_PROFILE, { x: 20, y: 20, w: 170, h: 100 });
    const lines = sheet.ops.filter((o) => o.t === 'line') as { x1: number; y1: number; x2: number; y2: number }[];
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) { expect(x).toBeGreaterThanOrEqual(19); expect(x).toBeLessThanOrEqual(191); expect(y).toBeGreaterThanOrEqual(19); expect(y).toBeLessThanOrEqual(121); }
  });
  test('沖縄市の縦断図は上半分に排水のアイソメ図を描く', () => {
    const { doc, outlet } = drainDoc();
    const p = BUILTIN_PROFILES.find((x) => x.id === 'okinawa-city')!;
    const r = extractRoute(doc.network, outlet);
    const m = buildProfile(doc, 'route' in r ? r.route : [], p, '排水設備 縦断図');
    const iso = buildIsometric(doc, 'drain', p);
    const svg = renderProfileSvg(m, meta, iso);
    expect(svg).toContain('VU100×5.0'); // アイソメのラベル
    expect(svg).toContain('立面図（展開図）');
    // standard（drainageIsometric: false）では描かない
    const m2 = buildProfile(doc, 'route' in r ? r.route : [], STANDARD_PROFILE, '排水設備 縦断図');
    expect(renderProfileSvg(m2, meta, iso)).not.toContain('VU100×5.0');
  });
  test('renderIsoSheet は用紙 1 枚', () => {
    const iso = buildIsometric(waterDoc(), 'water', STANDARD_PROFILE);
    const sheet = renderIsoSheet(iso, STANDARD_PROFILE, { ...meta, title: 't' });
    expect(sheetToSvg(sheet)).toContain('viewBox="0 0 420 297"');
  });
});
