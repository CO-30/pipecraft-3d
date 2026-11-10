/**
 * 「全ての申請図面で文字が重ならない」を守るテスト。
 * 器具やマスが近くに固まった現場（短い管が続く）を全種類の図面・全自治体プロファイルで描いて、文字の重なりが 0 であることを確かめる。
 */
import { describe, expect, test } from 'vitest';
import { addFloor, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork } from '../model/network';
import { placeFixture, portNodes } from '../model/fixtures';
import { BUILTIN_PROFILES, STANDARD_PROFILE } from '../model/municipality';
import { buildIsometric } from '../model/isometric';
import { buildProfile, extractRoute } from '../model/profileDrawing';
import { buildRiser } from '../model/riser';
import { renderIsoSheet } from './isoSheet';
import { renderProfileSheet } from './profileSheet';
import { renderRiserSheet } from './riserSheet';
import { findTextOverlaps } from './labelLayout';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const meta = { siteName: 'テスト工事', date: new Date(2026, 10, 10) };
const PROFILES = [STANDARD_PROFILE, ...BUILTIN_PROFILES.filter((p) => p.id !== STANDARD_PROFILE.id)];
const S = { system: 'sewage' as const, diameter: 75, material: 'VU' };

/** トイレ → 短い管 3 本 → 汚水マス → 小口径マス 2 つ（近い）→ 6m → 公共桝。画面写真の現場に近い形 */
export function crowdedDrain() {
  let doc: Doc = { building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {}, site: { designGL: 0 } };
  const f = doc.building.floors[0].id;
  const put = (type: Parameters<typeof placeFixture>[2], x: number, y: number, z?: number) => {
    const r = placeFixture(doc, f, type, { x, y });
    doc = r.doc;
    const port = portNodes(doc.network, r.fixtureId!).find((n) => n.portId === 'sewage' || n.portId === 'pipe')!;
    if (z !== undefined) {
      const fx = doc.fixtures[r.fixtureId!];
      doc = { ...doc, fixtures: { ...doc.fixtures, [fx.id]: { ...fx, params: { invertZ: z } } }, network: { ...doc.network, nodes: { ...doc.network.nodes, [port.id]: { ...port, pos: { ...port.pos, z } } } } };
    }
    return doc.network.nodes[port.id];
  };
  const t = put('toilet', 0, 0);
  const m1 = put('manholeSewage', 1000, 300, -400);
  const m2 = put('manholeSewage', 1350, 300, -410);
  const m3 = put('manholeTrap', 1700, 300, -420);
  const pub = put('publicSewage', 7700, 300, -600);
  let r = addPolyline(doc.network, [t.pos, v(t.pos.x, t.pos.y, -300), v(100, 300, -300), m1.pos], S, { startNodeId: t.id, endNodeId: m1.id });
  r = addPolyline(r.net, [m1.pos, m2.pos], { ...S, diameter: 100 }, { startNodeId: m1.id, endNodeId: m2.id });
  r = addPolyline(r.net, [m2.pos, m3.pos], { ...S, diameter: 100 }, { startNodeId: m2.id, endNodeId: m3.id });
  r = addPolyline(r.net, [m3.pos, pub.pos], { ...S, diameter: 100 }, { startNodeId: m3.id, endNodeId: pub.id });
  return { doc: { ...doc, network: r.net }, outlet: pub.id };
}

/** メーター → すぐ近くに水栓 3 つと給湯器（短い枝が続く） */
export function crowdedWater() {
  const b1 = addFloor(emptyBuilding(), { height: 3000 });
  let doc: Doc = { building: b1.b, network: emptyNetwork(), fixtures: {}, site: { designGL: -300 } };
  const W = { system: 'water' as const, diameter: 20, material: 'HIVP' };
  const m = placeFixture(doc, b1.floorId, 'waterMeter', { x: 0, y: 0 }); doc = m.doc;
  const out = portNodes(doc.network, m.fixtureId!).find((n) => n.portId === 'out')!;
  let net = doc.network;
  let prev = out.id, px = out.pos.x;
  const z = out.pos.z;
  for (const [i, type] of (['faucet', 'faucet', 'outdoorFaucet', 'faucet', 'faucet'] as const).entries()) {
    const x = 600 + i * 250;
    const fx = placeFixture({ ...doc, network: net }, b1.floorId, type, { x, y: 400 }); doc = fx.doc; net = doc.network;
    const p = portNodes(net, fx.fixtureId!)[0];
    const r1 = addPolyline(net, [v(px, 0, z), v(x, 0, z)], W, { startNodeId: prev });
    const tee = r1.nodeIds[r1.nodeIds.length - 1];
    const r2 = addPolyline(r1.net, [v(x, 0, z), v(x, 400, z), p.pos], { ...W, diameter: 13 }, { startNodeId: tee, endNodeId: p.id });
    net = r2.net; prev = tee; px = x;
  }
  return { doc: { ...doc, network: net }, out: out.id };
}

describe('全ての申請図面で文字が重ならない', () => {
  for (const profile of PROFILES) {
    test(`排水のアイソメ図（${profile.name}）`, () => {
      const { doc } = crowdedDrain();
      const iso = buildIsometric(doc, 'drain', profile);
      expect(iso.lines.length).toBeGreaterThan(5);
      expect(findTextOverlaps(renderIsoSheet(iso, profile, { ...meta, title: '立面図（展開図）' }))).toEqual([]);
    });
    test(`給水のアイソメ図（${profile.name}）`, () => {
      const { doc } = crowdedWater();
      const iso = buildIsometric(doc, 'water', profile);
      expect(findTextOverlaps(renderIsoSheet(iso, profile, { ...meta, title: '立面図（展開図）' }))).toEqual([]);
    });
    test(`排水縦断図（${profile.name}）`, () => {
      const { doc, outlet } = crowdedDrain();
      const route = extractRoute(doc.network, outlet);
      if (!('route' in route)) throw new Error('経路が取れない');
      const model = buildProfile(doc, route.route, profile, '排水設備 縦断図');
      expect(model.nodes.length).toBeGreaterThan(5);
      const iso = buildIsometric(doc, 'drain', profile);
      expect(findTextOverlaps(renderProfileSheet(model, meta, iso))).toEqual([]);
    });
    test(`給水立面図（${profile.name}）`, () => {
      const { doc, out } = crowdedWater();
      expect(findTextOverlaps(renderRiserSheet(buildRiser(doc, out, profile, '給水装置 立面図'), meta))).toEqual([]);
    });
  }
});
