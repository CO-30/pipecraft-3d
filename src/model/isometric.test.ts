import { describe, expect, test } from 'vitest';
import { addFloor, emptyBuilding } from './building';
import type { Doc } from './doc';
import { addPolyline, emptyNetwork } from './network';
import { FIXTURE_CATALOG, placeFixture, portNodes } from './fixtures';
import { BUILTIN_PROFILES, STANDARD_PROFILE } from './municipality';
import { buildIsometric, isoProject } from './isometric';

const v = (x: number, y: number, z = 0) => ({ x, y, z });

describe('アイソメ図（立面図・展開図）', () => {
  test('isoProject: x は右下がり、y は右上がり、z は上', () => {
    const o = isoProject({ x: 0, y: 0, z: 0 });
    const px = isoProject({ x: 1000, y: 0, z: 0 });
    const py = isoProject({ x: 0, y: 1000, z: 0 });
    const pz = isoProject({ x: 0, y: 0, z: 1000 });
    expect(px.x).toBeGreaterThan(o.x); expect(px.y).toBeGreaterThan(o.y); // 右下
    expect(py.x).toBeLessThan(o.x); expect(py.y).toBeGreaterThan(o.y); // 左下（y は奥行き。画面では左下へ）
    expect(pz.x).toBe(o.x); expect(pz.y).toBeLessThan(o.y); // 上
    expect(Math.hypot(px.x - o.x, px.y - o.y)).toBeCloseTo(1000, 6); // 長さは保つ
  });

  test('給水: メーター→水栓を区間ごとの線にして、ラベルは 管種口径×長さ(m 1桁)、器具名と高さ', () => {
    const b1 = addFloor(emptyBuilding(), { height: 3000 });
    let doc: Doc = { building: b1.b, network: emptyNetwork(), fixtures: {}, site: { designGL: -300 } };
    const m = placeFixture(doc, b1.floorId, 'waterMeter', { x: 0, y: 0 }); doc = m.doc;
    const out = portNodes(doc.network, m.fixtureId!).find((n) => n.portId === 'out')!;
    const t = placeFixture(doc, b1.floorId, 'faucet', { x: 4000, y: 0 }); doc = t.doc;
    const p = portNodes(doc.network, t.fixtureId!)[0];
    const r = addPolyline(doc.network, [out.pos, v(4000, 0, out.pos.z), p.pos], { system: 'water', diameter: 20, material: 'HI' }, { startNodeId: out.id, endNodeId: p.id });
    // 排水も混ぜる（給水の図には出ない）
    const r2 = addPolyline(r.net, [v(0, 2000, -400), v(3000, 2000, -430)], { system: 'sewage', diameter: 100, material: 'VU' });
    doc = { ...doc, network: r2.net };
    const iso = buildIsometric(doc, 'water', STANDARD_PROFILE);
    expect(iso.lines).toHaveLength(2);
    expect(iso.lines.map((l) => l.label)).toEqual([`HI20×${((4000 - out.pos.x) / 1000).toFixed(1)}`, `HI20×${((p.pos.z - out.pos.z) / 1000).toFixed(1)}`]);
    expect(iso.lines[0].system).toBe('water');
    // 竣工図: 長さの関数を渡すとその長さ（実測）で書く
    const asBuilt = buildIsometric(doc, 'water', STANDARD_PROFILE, { lengthOf: (id) => (id === iso.lines[0].segId ? 4567 : 1000) });
    expect(asBuilt.lines.map((l) => l.label)).toEqual(['HI20×4.6', 'HI20×1.0']);
    const labels = iso.points.map((pt) => pt.label);
    expect(labels).toContain('水道メーター');
    expect(labels).toContain('水栓（壁付）');
    // 水栓の高さ: FL からの高さ(m 1桁)
    const faucet = iso.points.find((pt) => pt.label === '水栓（壁付）')!;
    expect(faucet.height).toBe((p.pos.z / 1000).toFixed(1));
    expect(iso.bounds.maxX).toBeGreaterThan(iso.bounds.minX);
  });

  test('排水: マスも点に入り、公共マスは isPublic。通気も含む', () => {
    let doc: Doc = { building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {}, site: { designGL: 0 } };
    const f = doc.building.floors[0].id;
    const m1 = placeFixture(doc, f, 'manholeSewage', { x: 0, y: 0 }); doc = m1.doc;
    const m2 = placeFixture(doc, f, 'publicSewage', { x: 5000, y: 0 }); doc = m2.doc;
    const p1 = portNodes(doc.network, m1.fixtureId!)[0], p2 = portNodes(doc.network, m2.fixtureId!)[0];
    const r = addPolyline(doc.network, [p1.pos, p2.pos], { system: 'sewage', diameter: 100, material: 'VU' }, { startNodeId: p1.id, endNodeId: p2.id });
    const r2 = addPolyline(r.net, [p1.pos, v(0, 0, 2000)], { system: 'vent', diameter: 50, material: 'VU' }, { startNodeId: p1.id });
    doc = { ...doc, network: r2.net };
    const iso = buildIsometric(doc, 'drain', STANDARD_PROFILE);
    expect(iso.lines.map((l) => l.label).sort()).toEqual(['VU100×5.0', 'VU50×2.6'].sort()); // 通気は管底 −600 から +2000
    const pub = iso.points.find((pt) => pt.isPublic);
    expect(pub?.label).toBe('公共汚水マス');
  });

  test('接続口が複数の器具は、カタログの最初の接続口（メーターなら入口）に点を置く', () => {
    const b1 = addFloor(emptyBuilding(), { height: 3000 });
    let doc: Doc = { building: b1.b, network: emptyNetwork(), fixtures: {} };
    const m = placeFixture(doc, b1.floorId, 'waterMeter', { x: 0, y: 0 }); doc = m.doc;
    const ports = portNodes(doc.network, m.fixtureId!);
    const inP = ports.find((n) => n.portId === 'in')!, outP = ports.find((n) => n.portId === 'out')!;
    // 出口側を先につなぎ、入口側を後につなぐ（反復順に依存しないことを確認）
    let r = addPolyline(doc.network, [outP.pos, v(3000, 0, outP.pos.z)], { system: 'water', diameter: 20 }, { startNodeId: outP.id });
    r = addPolyline(r.net, [v(-3000, 0, inP.pos.z), inP.pos], { system: 'water', diameter: 20 }, { endNodeId: inP.id });
    const iso = buildIsometric({ ...doc, network: r.net }, 'water', STANDARD_PROFILE);
    const meter = iso.points.find((pt) => pt.label === '水道メーター')!;
    expect(meter.nodeId).toBe(inP.id);
  });
  test('沖縄市は立面図がアイソメで、縦断図の上に排水のアイソメを描く', () => {
    const p = BUILTIN_PROFILES.find((x) => x.id === 'okinawa-city')!;
    expect(p.riser.lineStyle).toBe('isometric');
    expect(p.profileTable.drainageIsometric).toBe(true);
    expect(STANDARD_PROFILE.riser.lineStyle).toBe('single');
    expect(STANDARD_PROFILE.profileTable.drainageIsometric).toBe(false);
  });
});

describe('ヘッダー工法', () => {
  test('給水ヘッダー・給湯ヘッダーは入口 1 と出口 6/4 の接続口。アイソメ図の名前は配管をつないだ出口の数で「給水ヘッダー3P」', () => {
    expect(FIXTURE_CATALOG.waterHeader.ports.map((p) => p.id)).toEqual(['in', 'out1', 'out2', 'out3', 'out4', 'out5', 'out6']);
    expect(FIXTURE_CATALOG.hotWaterHeader.ports.map((p) => p.id)).toEqual(['in', 'out1', 'out2', 'out3', 'out4']);
    expect(FIXTURE_CATALOG.hotWaterHeader.ports.every((p) => p.system === 'hotWater')).toBe(true);
    let d: Doc = { building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {} };
    const fl = d.building.floors[0].id;
    const h = placeFixture(d, fl, 'waterHeader', { x: 0, y: 0 }); d = h.doc;
    const ports = portNodes(d.network, h.fixtureId!);
    const inP = ports.find((p) => p.portId === 'in')!;
    const m = placeFixture(d, fl, 'waterMeter', { x: -3000, y: 0 }); d = m.doc;
    const mo = portNodes(d.network, m.fixtureId!).find((p) => p.portId === 'out')!;
    d = { ...d, network: addPolyline(d.network, [mo.pos, inP.pos], { system: 'water', diameter: 20, material: 'HI' }, { startNodeId: mo.id, endNodeId: inP.id }).net };
    for (const k of [1, 2, 3]) {
      const f = placeFixture(d, fl, 'faucet', { x: 2000 * k, y: 2000 }); d = f.doc;
      const fp = portNodes(d.network, f.fixtureId!)[0];
      const op = ports.find((p) => p.portId === `out${k}`)!;
      d = { ...d, network: addPolyline(d.network, [op.pos, fp.pos], { system: 'water', diameter: 13, material: 'PB' }, { startNodeId: op.id, endNodeId: fp.id }).net };
    }
    const iso = buildIsometric(d, 'water', STANDARD_PROFILE);
    const hp = iso.points.find((p) => p.nodeId === inP.id)!;
    expect(hp.label).toBe('給水ヘッダー3P');
    // 出口の点は名前を重ねない
    expect(iso.points.filter((p) => p.label.startsWith('給水ヘッダー')).length).toBe(1);
    expect(iso.lines.some((l) => l.label.startsWith('PB13×'))).toBe(true);
  });
});
