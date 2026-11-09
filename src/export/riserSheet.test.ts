import { describe, expect, test } from 'vitest';
import { addFloor, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork } from '../model/network';
import { placeFixture, portNodes } from '../model/fixtures';
import { STANDARD_PROFILE } from '../model/municipality';
import { buildRiser } from '../model/riser';
import { renderRiserSvg } from './riserSheet';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const W = { system: 'water' as const, diameter: 20, material: 'HIVP' };
function twoFloors() {
  const b1 = addFloor(emptyBuilding(), { height: 3000 });
  const b2 = addFloor(b1.b, { height: 3000 });
  let doc: Doc = { building: b2.b, network: emptyNetwork(), fixtures: {}, site: { designGL: -300 } };
  const m = placeFixture(doc, b1.floorId, 'waterMeter', { x: 0, y: 0 }); doc = m.doc;
  const out = portNodes(doc.network, m.fixtureId!).find((n) => n.portId === 'out')!;
  const t1 = placeFixture(doc, b1.floorId, 'faucet', { x: 4000, y: 0 }); doc = t1.doc;
  const p1 = portNodes(doc.network, t1.fixtureId!)[0];
  const t2 = placeFixture(doc, b2.floorId, 'faucet', { x: 4000, y: 0 }); doc = t2.doc;
  const p2 = portNodes(doc.network, t2.fixtureId!)[0];
  let r = addPolyline(doc.network, [out.pos, v(2000, 0, out.pos.z), p1.pos], W, { startNodeId: out.id, endNodeId: p1.id });
  r = addPolyline(r.net, [v(2000, 0, out.pos.z), v(2000, 0, p2.pos.z), p2.pos], { ...W, diameter: 13 }, { startNodeId: r.nodeIds[1], endNodeId: p2.id });
  return { doc: { ...doc, network: r.net }, out: out.id };
}
const meta = { siteName: 'テスト工事', date: new Date(2026, 10, 9) };

describe('給水立面図の描画', () => {
  test('スナップショット', () => {
    const { doc, out } = twoFloors();
    expect(renderRiserSvg(buildRiser(doc, out, STANDARD_PROFILE, '給水装置 立面図'), meta)).toMatchSnapshot();
  });
  test('口径・高さ・階名・図面名を含む', () => {
    const { doc, out } = twoFloors();
    const svg = renderRiserSvg(buildRiser(doc, out, STANDARD_PROFILE, '給水装置 立面図'), meta);
    expect(svg).toContain('φ20');
    expect(svg).toContain('φ13');
    expect(svg).toContain('FL+1040');
    expect(svg).toContain('給水装置 立面図');
    expect(svg).toContain(doc.building.floors[1].name);
    expect(svg).toContain('水道メーター');
  });
  test('showFloorLines:false なら階名が無い', () => {
    const { doc, out } = twoFloors();
    const p = { ...STANDARD_PROFILE, riser: { ...STANDARD_PROFILE.riser, showFloorLines: false } };
    const svg = renderRiserSvg(buildRiser(doc, out, p, 't'), meta);
    expect(svg).not.toContain(doc.building.floors[1].name);
  });
});
