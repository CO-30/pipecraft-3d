/**
 * 外回りの給水・給湯（2026-11-13 ユーザーの施工）:
 * メーター → GL 以下を HI で給湯器の近くまで → 外で立ち上げて基礎を抜けて床下へ（コーキング）。
 * 給湯器へは HI を立ち上げ → 止水栓 → ベンリカン。戻りはベンリカン → 止水栓 → PB で下ろし → L で床下へ（コーキング）。
 * 立上りは φ40 さや管。立水栓は床下に入れず、地中で外の HI に分岐。
 */
import { describe, expect, test } from 'vitest';
import type { Doc } from './doc';
import { routeSupplies, UNDERFLOOR_Z } from './supplyRoute';
import { supplyHouse } from './testSupplyHouse';
import { placeFixture, portNodes } from './fixtures';
import { segmentsAt, type Network, type Segment } from './network';
import { BENRIKAN, isPB } from './materials';
import { analyzeFittings } from './fittings';
import { computeEstimate } from './estimate';
import { sleeveSchedule } from './sleeves';
import { buildSupplyTree } from './hydraulics/supplyTree';

const GL = -611;
const port = (doc: Doc, fid: string, pid: string) => portNodes(doc.network, fid).find((n) => n.portId === pid)!;
const other = (net: Network, s: Segment, nid: string) => net.nodes[s.a === nid ? s.b : s.a];
/** 口から、管をたどった点の列（枝分かれまで） */
function walk(net: Network, start: string, max = 10): { node: string; seg: Segment }[] {
  const out: { node: string; seg: Segment }[] = [];
  let cur = start, prev: string | null = null;
  for (let i = 0; i < max; i++) {
    const segs = segmentsAt(net, cur).filter((s) => s.id !== prev);
    if (segs.length !== 1) break;
    const s = segs[0], o = other(net, s, cur);
    out.push({ node: o.id, seg: s });
    prev = s.id; cur = o.id;
  }
  return out;
}

describe('外回りの給水・給湯（給湯器が外の家）', () => {
  const h = supplyHouse();
  const r = routeSupplies(h.doc, { headers: 'avoid' });
  const net = r.doc.network;

  test('給湯器の入口: ベンリカン → 止水栓 → HI の立上りで地中へ', () => {
    expect(r.error).toBeUndefined();
    const inP = port(r.doc, h.ids.heater, 'in');
    const w = walk(net, inP.id, 3);
    expect(w[0].seg.material).toBe(BENRIKAN);
    expect(net.nodes[w[0].node].kind).toBe('valve');
    expect(w[1].seg.material).toBe('HIVP');
    expect(net.nodes[w[1].node].pos.z).toBeLessThan(GL);
    // 止水栓は GL より上、入口より下
    const v = net.nodes[w[0].node].pos.z;
    expect(v).toBeGreaterThan(GL);
    expect(v).toBeLessThan(inP.pos.z);
  });

  test('給湯の戻り: ベンリカン → 止水栓 → PB で床下の高さへ下ろし、エルボで基礎を抜けて床下へ', () => {
    const outP = port(r.doc, h.ids.heater, 'out');
    const w = walk(net, outP.id, 4);
    expect(w[0].seg.material).toBe(BENRIKAN);
    expect(net.nodes[w[0].node].kind).toBe('valve');
    expect(isPB(w[1].seg.material)).toBe(true);
    const bend = net.nodes[w[1].node];
    expect(bend.pos.z).toBe(UNDERFLOOR_Z);
    expect(analyzeFittings(net, r.doc.fixtures).find((f) => f.nodeId === bend.id)?.type).toBe('elbow90');
    // 床下まで PB のまま（外の HT は使わない）
    expect(isPB(w[2].seg.material)).toBe(true);
    expect(net.nodes[w[2].node].pos.y).toBeGreaterThan(75);
  });

  test('床下へは地上で基礎を水平に抜ける（給水・給湯の 2 か所）。地中の基礎貫通スリーブは使わない', () => {
    const rows = sleeveSchedule(r.doc).filter((x) => (x.system === 'water' || x.system === 'hotWater') && x.part === 'footingOuter');
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => Math.abs(x.point.z - UNDERFLOOR_Z) < 1)).toBe(true);
    expect(r.sleeves).toBe(2);
  });

  test('給水の床下への入口は給湯器の近く（メーターの近くではない）。地中の管は HI', () => {
    const rows = sleeveSchedule(r.doc).filter((x) => x.system === 'water' && x.part === 'footingOuter');
    expect(Math.abs(rows[0].point.y - 0)).toBeLessThan(200); // 南の外壁（給湯器の側）
    expect(Math.abs(rows[0].point.x - 2000)).toBeLessThan(1000);
    const buried = Object.values(net.segments).filter((s) => s.system === 'water' && net.nodes[s.a].pos.z < GL && net.nodes[s.b].pos.z < GL);
    expect(buried.length).toBeGreaterThan(0);
    expect(buried.every((s) => s.material === 'HIVP')).toBe(true);
  });

  test('メーターから給湯器・器具まで 1 つの給水の木になる（給湯器の入口も）', () => {
    const t = buildSupplyTree(r.doc);
    if ('error' in t) throw new Error(t.error);
    expect(t.outlets.map((o) => o.fixtureId)).toContain(h.ids.heater);
    expect(r.connected.water).toBe(4);
  });

  test('積算: コーキング 2 か所・φ40 さや管（立上り）・ベンリカン 2 本。ベンリカンは管の長さに入れない', () => {
    const e = computeEstimate(r.doc);
    const k = (key: string) => e.kiso.find((l) => l.key === key);
    expect(k('kiso|caulk')?.count).toBe(2);
    expect(k('kiso|sheath|40')?.count).toBeGreaterThan(0.8);
    expect(k('kiso|benrikan|20')?.count).toBe(2);
    expect(e.pipes.some((p) => p.material === BENRIKAN)).toBe(false);
    expect(e.kiso.some((l) => l.spec.startsWith('KSS'))).toBe(false);
  });

  test('もう一度押しても増えない', () => {
    const again = routeSupplies(r.doc, { headers: 'avoid' });
    expect(Object.keys(again.doc.network.segments).length).toBe(Object.keys(net.segments).length);
  });
});

describe('立水栓は床下に入れず、地中で外の HI に分岐', () => {
  test('立水栓の給水は地中で外の給水管（HI）にチーズでつながり、建物に入らない', () => {
    const h = supplyHouse();
    const p = placeFixture(h.doc, h.floorId, 'outdoorFaucet', { x: -1000, y: 800 });
    const r = routeSupplies(p.doc, { headers: 'avoid' });
    const net = r.doc.network;
    const fp = port(r.doc, p.fixtureId!, 'water');
    expect(segmentsAt(net, fp.id)).toHaveLength(1);
    // 立水栓から先をたどって、地中のチーズ（3 本）に着く。途中で建物に入らない
    let cur = fp.id, prev: string | null = null, guard = 0;
    for (; guard < 20; guard++) {
      const segs = segmentsAt(net, cur).filter((s) => s.id !== prev);
      if (segs.length !== 1) break;
      const o = other(net, segs[0], cur);
      expect(o.pos.x < 0 || o.pos.y < 0 || o.pos.x > 8000 || o.pos.y > 6000).toBe(true);
      prev = segs[0].id; cur = o.id;
    }
    expect(segmentsAt(net, cur)).toHaveLength(3);
    expect(net.nodes[cur].pos.z).toBeLessThan(GL);
    expect(r.notes.join()).not.toMatch(/屋外の水栓/);
    const t = buildSupplyTree(r.doc);
    if ('error' in t) throw new Error(t.error);
    expect(t.outlets.map((o) => o.fixtureId)).toContain(p.fixtureId);
  });
});

describe('給湯器が無い家・床下が GL より低い家', () => {
  test('給湯器が無ければ、メーターに近い外壁で立ち上げて床下へ（コーキング）', () => {
    const h = supplyHouse();
    const d: Doc = { ...h.doc, fixtures: Object.fromEntries(Object.entries(h.doc.fixtures).filter(([id]) => id !== h.ids.heater)), network: { ...h.doc.network, nodes: Object.fromEntries(Object.entries(h.doc.network.nodes).filter(([, n]) => n.fixtureId !== h.ids.heater)) } };
    const r = routeSupplies(d, { headers: 'avoid' });
    const rows = sleeveSchedule(r.doc).filter((x) => x.system === 'water' && x.part === 'footingOuter');
    expect(rows).toHaveLength(1);
    expect(Math.abs(rows[0].point.x)).toBeLessThan(200); // 西の外壁（メーターの側）
    expect(Math.abs(rows[0].point.z - UNDERFLOOR_Z)).toBeLessThan(1);
  });
  test('床下の高さが GL より上に出ないときは、これまでどおり基礎貫通スリーブ（KSS）', () => {
    const h = supplyHouse();
    const d: Doc = { ...h.doc, site: { designGL: -200 } };
    const r = routeSupplies(d, { headers: 'avoid' });
    const e = computeEstimate(r.doc);
    expect(e.kiso.some((l) => l.spec.startsWith('KSS'))).toBe(true);
    expect(e.kiso.find((l) => l.key === 'kiso|caulk')).toBeUndefined();
  });
});
