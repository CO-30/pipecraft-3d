import { describe, expect, it } from 'vitest';
import { addFloor, emptyBuilding } from './building';
import type { Doc } from './doc';
import { addPolyline, emptyNetwork, type SegmentAttrs } from './network';
import { placeFixture, portNodes } from './fixtures';
import { analyzeFittings } from './fittings';
import { computeEstimate, defaultEstimate } from './estimate';
import { gluePerJoint, tapePerJoint } from './consumables';
import { defaultSupportSettings } from './supports';

const W13: SegmentAttrs = { system: 'water', diameter: 13, material: 'HIVP' };
const base = (): Doc => ({
  building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {},
  estimate: { ...defaultEstimate(), supports: { ...defaultSupportSettings(), enabled: false } },
});

/** 壁付水栓に給水管を L 字（エルボ1）でつなぐ */
function faucetDoc(type: 'faucet' | 'outdoorFaucet' = 'faucet') {
  let d = base();
  const r = placeFixture(d, d.building.floors[0].id, type, { x: 1000, y: 1000 });
  d = r.doc;
  const port = portNodes(d.network, r.fixtureId!)[0];
  const p = port.pos;
  const pl = addPolyline(d.network, [p, { ...p, x: p.x + 2000 }, { ...p, x: p.x + 2000, y: p.y - 2000 }], W13, { startNodeId: port.id });
  return { ...d, network: pl.net };
}

describe('水栓とネジ継手', () => {
  it('壁付水栓の接続口は給水栓用エルボ（ネジ）、立水栓は給水栓用ソケット', () => {
    const d = faucetDoc();
    expect(analyzeFittings(d.network, d.fixtures).map((f) => f.type).filter((t) => t !== 'none').sort()).toEqual(['elbow90', 'faucetElbow']);
    const o = faucetDoc('outdoorFaucet');
    expect(analyzeFittings(o.network, o.fixtures).some((f) => f.type === 'faucetSocket')).toBe(true);
  });
  it('器具を渡さなければ従来どおり器具接続継手', () => {
    const d = faucetDoc();
    expect(analyzeFittings(d.network).some((f) => f.type === 'adapter')).toBe(true);
  });
  it('給湯器の給水はバルブ用ソケット、排水の器具接続は接着のまま', () => {
    let d = base();
    const r = placeFixture(d, d.building.floors[0].id, 'washbasin', { x: 0, y: 0 });
    d = r.doc;
    const drain = portNodes(d.network, r.fixtureId!).find((n) => n.portId === 'drain')!;
    const net = addPolyline(d.network, [drain.pos, { ...drain.pos, x: drain.pos.x + 1000 }], { system: 'drain', diameter: 40, material: 'VP' }, { startNodeId: drain.id }).net;
    expect(analyzeFittings(net, d.fixtures).find((f) => f.nodeId === drain.id)!.type).toBe('adapter');
  });
});

describe('シールテープ・接着剤', () => {
  it('ネジ1か所 → シールテープ1巻、接着口 = 水栓エルボ1口＋エルボ2口', () => {
    const e = computeEstimate(faucetDoc());
    const tape = e.consumables.find((l) => l.key === 'con|sealTape')!;
    expect(tape.count).toBe(1);
    expect(tape.note).toContain('ネジ 1か所');
    expect(tape.price?.material).toBe(212);
    const glue = e.consumables.find((l) => l.key === 'con|glue|hi')!;
    expect(glue.count).toBe(1);
    expect(glue.note).toContain('接着 3口');
    // 見積の材料にも入る
    expect(e.lines.some((l) => l.name === 'シールテープ' && l.amount === 212)).toBe(true);
    // 水栓エルボの参考単価
    expect(e.fittings.find((f) => f.type === 'faucetElbow')!.price?.material).toBe(740);
  });
  it('巻・缶の大きさで切り上げ、集計しない設定', () => {
    const d = faucetDoc();
    const e = computeEstimate({ ...d, estimate: { ...d.estimate!, consumables: { enabled: true, tapeRoll: 0.3, glueCan: 2 } } });
    expect(e.consumables.find((l) => l.key === 'con|sealTape')!.count).toBe(2); // 0.5m ÷ 0.3m
    expect(e.consumables.find((l) => l.key === 'con|glue|hi')!.count).toBe(2); // 3g ÷ 2g
    const off = computeEstimate({ ...d, estimate: { ...d.estimate!, consumables: { enabled: false, tapeRoll: 15, glueCan: 500 } } });
    expect(off.consumables).toEqual([]);
  });
  it('VP は VP用、HTVP は HT用、HI と VP をつなぐ口は HI用', () => {
    let d = base();
    const a = addPolyline(d.network, [{ x: 0, y: 0, z: 100 }, { x: 1000, y: 0, z: 100 }], { system: 'drain', diameter: 50, material: 'VP' });
    const b = addPolyline(a.net, [{ x: 1000, y: 0, z: 100 }, { x: 1000, y: 1000, z: 100 }], { system: 'water', diameter: 50, material: 'HIVP' }, { startNodeId: a.nodeIds[1] });
    d = { ...d, network: b.net };
    const e = computeEstimate(d);
    // 異種の接続は要確認（other）なので接着は数えない
    expect(e.consumables).toEqual([]);
    const v = addPolyline(emptyNetwork(), [{ x: 0, y: 0, z: 100 }, { x: 1000, y: 0, z: 100 }, { x: 1000, y: 1000, z: 100 }], { system: 'drain', diameter: 50, material: 'VP' });
    const e2 = computeEstimate({ ...base(), network: v.net });
    expect(e2.consumables.map((l) => l.key)).toEqual(['con|glue|vp']);
    expect(e2.issues.some((i) => i.target.id === 'con|glue|vp' && i.kind === 'noPrice')).toBe(true);
    const h = addPolyline(emptyNetwork(), [{ x: 0, y: 0, z: 100 }, { x: 1000, y: 0, z: 100 }, { x: 1000, y: 1000, z: 100 }], { system: 'hotWater', diameter: 13 });
    expect(computeEstimate({ ...base(), network: h.net }).consumables.map((l) => [l.key, l.price?.material])).toEqual([['con|glue|ht', 2714]]);
  });
  it('定尺の継ぎ足しソケットは2口ずつ', () => {
    const v = addPolyline(emptyNetwork(), [{ x: 0, y: 0, z: 100 }, { x: 9000, y: 0, z: 100 }], { system: 'drain', diameter: 50, material: 'VP' });
    const e = computeEstimate({ ...base(), network: v.net });
    expect(e.fittings.find((f) => f.type === 'socket')!.count).toBe(2);
    expect(e.consumables[0].note).toContain('接着 4口');
  });
  it('1口・1か所あたりの目安', () => {
    expect([13, 20, 25, 50].map(tapePerJoint)).toEqual([0.5, 0.7, 0.9, 1.2]);
    expect([13, 20, 100, 200].map(gluePerJoint)).toEqual([1, 1.5, 20, 53]);
  });
});
