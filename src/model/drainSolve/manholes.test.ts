/** マスの自動配置（起点・曲がり・合流・管径が変わる所・公共ますの手前・一定の長さごと） */
import { describe, expect, it } from 'vitest';
import type { Doc } from '../doc';
import { isManhole, placeFixture, portNodes } from '../fixtures';
import { addPolyline, type SegmentAttrs } from '../network';
import { BUILTIN_PROFILES } from '../municipality';
import { resolveDrainRules } from '../drainRules';
import { placeManholes } from './manholes';
import { testSite } from './testSite';

const NAHA = resolveDrainRules(BUILTIN_PROFILES.find((p) => p.id === 'naha')!);
const S: SegmentAttrs = { system: 'sewage', diameter: 100 };
const v = (x: number, y: number, z: number) => ({ x, y, z });
const autos = (d: Doc) => Object.values(d.fixtures).filter((f) => isManhole(f.type) && f.params?.auto);
const near = (d: Doc, x: number, y: number) => autos(d).some((f) => Math.hypot(f.x - x, f.y - y) < 1);

describe('マスの自動配置（placeManholes）', () => {
  it('起点（基礎の外で立ち下げた所）と曲がり点に置く。建物の中（床下）には置かない', () => {
    const { doc, pub } = testSite();
    // 公共ます → 曲がり C(−5700, 1000) → 起点 B(−700, 1000) → 立ち上げ → 家の中で曲がる
    const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-5700, 3000, -1000), v(-5700, 1000, -950), v(-700, 1000, -900), v(-700, 1000, -500), v(2000, 1000, -500), v(2000, 2500, -480)], S, { startNodeId: pub });
    const out = placeManholes({ ...doc, network: r.net }, NAHA);
    expect(near(out, -5700, 3000)).toBe(true);
    expect(near(out, -5700, 1000)).toBe(true);
    expect(near(out, -700, 1000)).toBe(true);
    expect(near(out, 2000, 1000)).toBe(false);
  });

  it('直線は管径の 120 倍（φ100 → 12m）ごと。公共ますの手前（60 倍 = 6m 以内）にも置く', () => {
    const { doc, pub } = testSite(-1200, -30700);
    const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-700, 3000, -900), v(-700, 3000, -500), v(1000, 3000, -500)], S, { startNodeId: pub });
    const out = placeManholes({ ...doc, network: r.net }, NAHA);
    const xs = [-30700, ...autos(out).map((f) => f.x), -700].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(12000 + 1);
    expect(autos(out).some((f) => f.x - -30700 <= 6000)).toBe(true);
  });

  it('合流点に置く。使う人が消した所（manholeSuppressed）には置かない', () => {
    const { doc, pub } = testSite();
    const a = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-5700, 3000, -1000)], S, { startNodeId: pub });
    const b1 = addPolyline(a.net, [v(-5700, 3000, -1000), v(-700, 3000, -900)], S, { startNodeId: a.nodeIds[1] });
    const b2 = addPolyline(b1.net, [v(-5700, 3000, -1000), v(-5700, 6000, -900)], S, { startNodeId: a.nodeIds[1] });
    const d = { ...doc, network: b2.net };
    expect(near(placeManholes(d, NAHA), -5700, 3000)).toBe(true);
    const suppressed = placeManholes({ ...d, site: { ...d.site, manholeSuppressed: [{ x: -5700, y: 3000 }] } }, NAHA);
    expect(near(suppressed, -5700, 3000)).toBe(false);
  });

  it('管径が変わる所に置く', () => {
    const { doc, pub } = testSite();
    const a = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-5700, 3000, -1000)], { system: 'sewage', diameter: 150 }, { startNodeId: pub });
    const b = addPolyline(a.net, [v(-5700, 3000, -1000), v(-2000, 3000, -900)], S, { startNodeId: a.nodeIds[1] });
    expect(near(placeManholes({ ...doc, network: b.net }, NAHA), -5700, 3000)).toBe(true);
  });

  it('もう一度しても増えない（同じ doc）。マスの無い描きかけの管には置かない', () => {
    const { doc, pub } = testSite();
    const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-5700, 3000, -1000), v(-5700, 1000, -950)], S, { startNodeId: pub });
    const once = placeManholes({ ...doc, network: r.net }, NAHA);
    expect(placeManholes(once, NAHA)).toBe(once);
    const lone = addPolyline(doc.network, [v(-9000, 0, -900), v(-5000, 0, -900), v(-5000, -3000, -900)], S);
    const bare = { ...doc, fixtures: {}, network: lone.net };
    expect(placeManholes(bare, NAHA)).toBe(bare);
  });
});

describe('マスの自動配置: 近すぎる所', () => {
  it('既にあるマスから 1m 以内には置かない（つなぐ案のマスと基礎の外の立ち下げ）', () => {
    const { doc: d0, pub, floorId } = testSite();
    const m = placeFixture(d0, floorId, 'manholeSewage', { x: -1300, y: 1000 });
    const mh = portNodes(m.doc.network, m.fixtureId!)[0].id;
    const a = addPolyline(m.doc.network, [m.doc.network.nodes[pub].pos, m.doc.network.nodes[mh].pos], S, { startNodeId: pub, endNodeId: mh });
    const b = addPolyline(a.net, [m.doc.network.nodes[mh].pos, v(-700, 1000, -900), v(-700, 1000, -500), v(1000, 1000, -500)], S, { startNodeId: mh });
    expect(near(placeManholes({ ...m.doc, network: b.net }, NAHA), -700, 1000)).toBe(false);
  });
});
