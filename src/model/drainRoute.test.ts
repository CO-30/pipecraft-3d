import { describe, expect, it } from 'vitest';
import { emptyDoc } from '../state/store';
import type { Doc } from './doc';
import { dropFixturePipes } from './dropPipes';
import { MANHOLE_OFFSET, openDrainEnds, routeDrainsOut } from './drainRoute';
import { placeFixture, portNodes, validateFixtures } from './fixtures';
import { addPolyline, segmentsAt, validateNetwork } from './network';
import { addFloor, addWall, emptyBuilding } from './building';
import { membersOf, withMember } from './members';
import { buildFromSheets } from './planRead/assemble';
import { D, foundationSheet, planSheet } from './planRead/testHouse';

/** 作り物の家（7280 × 5460、中央 x = 3640 に間仕切りと立上り・人通口 y 2730〜3330）に器具を置いて床下へ落とす */
function house(fixtures: [Parameters<typeof placeFixture>[2], number, number][], footing = true): Doc {
  const r = buildFromSheets([{ name: 'a', page: planSheet() }, ...(footing ? [{ name: 'b', page: foundationSheet() }] : [])]);
  let doc: Doc = { ...emptyDoc(), building: r.building, site: { designGL: -600 } };
  for (const [type, x, y] of fixtures) doc = placeFixture(doc, r.building.floors[0].id, type, { x, y }).doc;
  return dropFixturePipes(doc).doc;
}
const manholes = (doc: Doc) => Object.values(doc.fixtures).filter((f) => f.type === 'manholeSewage');

describe('排水のつなぎ案（drainRoute）', () => {
  it('落とした排水の下の端を、いちばん近い外壁の外に置いた汚水マスへつなぐ', () => {
    const doc = house([['toilet', 1000, 4500]]); // 北の壁（y = 5460）まで約 900、西の壁まで 1000
    expect(openDrainEnds(doc)).toHaveLength(1);
    const r = routeDrainsOut(doc);
    expect(r).toMatchObject({ pipes: 1, manholes: 1, sleeves: 1, skipped: 0 });
    expect(validateNetwork(r.doc.network)).toEqual([]);
    expect(validateFixtures(r.doc)).toEqual([]);
    const [m] = manholes(r.doc);
    expect([m.x, m.y]).toEqual([1000, D + 60 + MANHOLE_OFFSET]);
    // 床下を水平に出て、マスの真上から立ち下げる。汚水 φ75 のまま
    const port = portNodes(r.doc.network, m.id)[0];
    const [last] = segmentsAt(r.doc.network, port.id);
    const top = r.doc.network.nodes[last.a === port.id ? last.b : last.a];
    expect([top.pos.x, top.pos.y, top.pos.z]).toEqual([1000, D + 60 + MANHOLE_OFFSET, -300]);
    expect(port.pos.z).toBe(-1200);
    expect([last.system, last.diameter]).toEqual(['sewage', 75]);
    expect(openDrainEnds(r.doc)).toHaveLength(0);
    // 給水の立て管はそのまま（つなぐのは排水だけ）
    expect(Object.values(r.doc.network.segments).filter((s) => s.system === 'water')).toHaveLength(1);
  });
  it('もう一度押しても増えない。排水が無ければ何もしない', () => {
    const once = routeDrainsOut(house([['toilet', 1000, 4500]]));
    const again = routeDrainsOut(once.doc);
    expect(again).toMatchObject({ pipes: 0, manholes: 0 });
    expect(again.doc).toBe(once.doc);
    expect(routeDrainsOut(house([['waterHeater', 1000, 4500]])).pipes).toBe(0);
  });
  it('近い出口は 1 つのマスにまとめ、先の配管に合流する（同じ所に配管を重ねない・斜めに引かない）', () => {
    const r = routeDrainsOut(house([['toilet', 1000, 4700], ['washbasin', 1700, 5000]]));
    expect(r).toMatchObject({ pipes: 2, manholes: 1, skipped: 0 });
    expect(validateNetwork(r.doc.network)).toEqual([]);
    expect(validateFixtures(r.doc)).toEqual([]);
    expect(openDrainEnds(r.doc)).toHaveLength(0);
    const net = r.doc.network;
    const [m] = manholes(r.doc);
    // マスへ立ち下げる配管は 1 本だけ
    expect(segmentsAt(net, portNodes(net, m.id)[0].id)).toHaveLength(1);
    const flat = Object.values(net.segments).filter((s) => Math.abs(net.nodes[s.a].pos.z - net.nodes[s.b].pos.z) < 1);
    expect(flat.every((s) => { const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos; return Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1; })).toBe(true);
    // 水平の配管どうしは重ならない: 同じ線の上にある区間は端でだけ触れる
    for (const s of flat) for (const t of flat) {
      if (s.id >= t.id) continue;
      const [a, b, c, d] = [net.nodes[s.a].pos, net.nodes[s.b].pos, net.nodes[t.a].pos, net.nodes[t.b].pos];
      const sameX = [a, b, c, d].every((v) => Math.abs(v.x - a.x) < 1), sameY = [a, b, c, d].every((v) => Math.abs(v.y - a.y) < 1);
      if (!sameX && !sameY) continue;
      const k = sameX ? 'y' : 'x';
      expect(Math.min(Math.max(a[k], b[k]), Math.max(c[k], d[k])) - Math.max(Math.min(a[k], b[k]), Math.min(c[k], d[k]))).toBeLessThan(1);
    }
    // 合流点は 3 方向（チーズ）
    expect(Object.values(net.nodes).filter((n) => !n.fixtureId && segmentsAt(net, n.id).length === 3)).toHaveLength(1);
  });
  it('同じ線の上に並ぶ器具・奥にある器具も、先の配管につながる', () => {
    // 2 つとも x = 2000 の線の上（手前 4900・奥 3800）。3 つ目はさらに奥で横にずれている。どれも北の外壁がいちばん近い
    const r = routeDrainsOut(house([['shower', 2000, 4900], ['shower', 2000, 3800], ['shower', 2600, 3300]]));
    expect(r).toMatchObject({ pipes: 3, manholes: 1, skipped: 0 });
    expect(validateNetwork(r.doc.network)).toEqual([]);
    expect(openDrainEnds(r.doc)).toHaveLength(0);
    expect(segmentsAt(r.doc.network, portNodes(r.doc.network, manholes(r.doc)[0].id)[0].id)).toHaveLength(1);
  });
  it('離れた器具は別々のマスへ。置いてあるマスが近ければそれを使う', () => {
    const far = routeDrainsOut(house([['toilet', 1000, 4700], ['kitchen', 6000, 800]]));
    expect(far).toMatchObject({ pipes: 2, manholes: 2 });
    let doc = house([['toilet', 1000, 4700]]);
    doc = placeFixture(doc, doc.building.floors[0].id, 'manholeSewage', { x: 1400, y: D + 900 }).doc;
    const r = routeDrainsOut(doc);
    expect(r).toMatchObject({ pipes: 1, manholes: 0 });
    expect(manholes(r.doc)).toHaveLength(1);
  });
  it('基礎の貫通が少ない出口を選ぶ: 中央の立上りの向こうより、遠くても手前の外壁へ', () => {
    // x = 3300: 中央の立上り（x = 3640）のすぐ西。東の外壁は遠く、北の外壁（約 2200）へ出る
    const r = routeDrainsOut(house([['washer', 3300, 3900]]));
    expect(r.sleeves).toBe(1);
    expect(manholes(r.doc)[0].y).toBeGreaterThan(D);
  });
  it('基礎が無い建物でも出せる（貫通は 0）。壁が無ければ出口が決まらないので飛ばす', () => {
    expect(routeDrainsOut(house([['toilet', 1000, 4500]], false))).toMatchObject({ pipes: 1, manholes: 1, sleeves: 0 });
    let doc: Doc = { ...emptyDoc() };
    doc = dropFixturePipes(placeFixture(doc, doc.building.floors[0].id, 'toilet', { x: 0, y: 0 }).doc).doc;
    const r = routeDrainsOut(doc);
    expect(r).toMatchObject({ pipes: 0, manholes: 0, skipped: 1 });
    expect(r.doc).toBe(doc);
  });
  it('建物の外にある器具・器具からでない排水の立て管（雨どいなど）はつながない', () => {
    const out = routeDrainsOut(house([['washer', -1500, 2000]]));
    expect(out).toMatchObject({ pipes: 0, manholes: 0, skipped: 1 });
    let doc = house([]);
    const stub = addPolyline(doc.network, [{ x: 1000, y: 4500, z: -100 }, { x: 1000, y: 4500, z: -400 }], { system: 'drain', diameter: 75 });
    doc = { ...doc, network: stub.net };
    expect(openDrainEnds(doc)).toHaveLength(0);
    expect(routeDrainsOut(doc).pipes).toBe(0);
  });
  it('深く落とした配管でも、新しいマスの管底を配管より下げてつなぐ（GL 未入力）', () => {
    const r0 = buildFromSheets([{ name: 'a', page: planSheet() }]);
    let doc: Doc = { ...emptyDoc(), building: r0.building };
    doc = dropFixturePipes(placeFixture(doc, r0.building.floors[0].id, 'toilet', { x: 1000, y: 4500 }).doc, 1000).doc;
    const r = routeDrainsOut(doc);
    expect(r).toMatchObject({ pipes: 1, manholes: 1, skipped: 0 });
    expect(portNodes(r.doc.network, manholes(r.doc)[0].id)[0].pos.z).toBe(-1300);
    expect(validateFixtures(r.doc)).toEqual([]);
  });
  it('置いてあるマスが壁の内側・管底が高すぎるときは使わない／つながない', () => {
    let doc = house([['toilet', 1000, 4700]]);
    const f1 = doc.building.floors[0].id;
    doc = placeFixture(doc, f1, 'manholeSewage', { x: 1000, y: D - 400 }).doc; // 室内に置いてあるマス
    const r = routeDrainsOut(doc);
    expect(r).toMatchObject({ pipes: 1, manholes: 1 });
    expect(manholes(r.doc).map((m) => m.y).sort((a, b) => a - b)).toEqual([D - 400, D + 60 + MANHOLE_OFFSET]);
  });
  it('L 字の建物: マスは凹んだ所の内側や別の棟の中に置かず、配管は凹みをまたがない', () => {
    // 10000 × 8000 の右上（x > 6000・y > 4000）が欠けた L 字
    const poly = [[0, 0], [10000, 0], [10000, 4000], [6000, 4000], [6000, 8000], [0, 8000]];
    let b = emptyBuilding();
    const f = addFloor(b, { height: 2800 });
    b = f.b;
    poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; b = addWall(b, f.floorId, { x: p[0], y: p[1] }, { x: q[0], y: q[1] }, { kind: 'exterior', thickness: 120 }).b; });
    let doc: Doc = { ...emptyDoc(), building: b, site: { designGL: -600 } };
    // 凹みの角のそば・下の棟の右寄り・上の棟
    for (const [x, y] of [[5500, 4500], [8000, 3500], [3000, 7000], [7000, 1000]]) doc = placeFixture(doc, f.floorId, 'shower', { x, y }).doc;
    const r = routeDrainsOut(dropFixturePipes(doc).doc);
    expect(r).toMatchObject({ pipes: 4, skipped: 0 });
    expect(validateNetwork(r.doc.network)).toEqual([]);
    const inL = (x: number, y: number) => x > 0 && y > 0 && ((x < 10000 && y < 4000) || (x < 6000 && y < 8000));
    for (const m of manholes(r.doc)) {
      expect(inL(m.x, m.y)).toBe(false);
      // どの壁の芯からも 260（壁の厚さの半分 + マスの周りの空き）以上離れている
      const dist = Math.min(...poly.map((p, i) => { const q = poly[(i + 1) % poly.length]; const L2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; const t = Math.max(0, Math.min(1, ((m.x - p[0]) * (q[0] - p[0]) + (m.y - p[1]) * (q[1] - p[1])) / L2)); return Math.hypot(m.x - p[0] - (q[0] - p[0]) * t, m.y - p[1] - (q[1] - p[1]) * t); }));
      expect(dist).toBeGreaterThanOrEqual(260);
    }
    // 床下の水平の配管は、マスへ出る最後の区間を除いて建物の中だけを通る（中点で確かめる）
    const net = r.doc.network;
    for (const s of Object.values(net.segments)) {
      const a = net.nodes[s.a].pos, c = net.nodes[s.b].pos;
      if (Math.abs(a.z - c.z) > 1) continue;
      const outEnd = !inL(a.x, a.y) || !inL(c.x, c.y);
      if (!outEnd) expect(inL((a.x + c.x) / 2, (a.y + c.y) / 2)).toBe(true);
      else expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeLessThan(4200); // 外へ出る区間は 1 つの壁を越えるだけ
    }
  });
  it('内部の立上りは人通口を通って避ける（貫通は外周の 1 か所だけ）', () => {
    // 中央に立上りで囲まれた区画（x 2000〜5280・y 1000〜4460）。西の辺だけ y 2500〜3100 が人通口
    let doc = house([]);
    const f1 = doc.building.floors[0].id;
    const ft = membersOf(doc.building).find((m) => m.kind === 'footing')!;
    let b = doc.building;
    const add = (ax: number, ay: number, bx: number, by: number) => { b = withMember(b, { kind: 'footing', floorId: f1, a: { x: ax, y: ay }, b: { x: bx, y: by }, width: 150, z0: ft.z0, z1: ft.z1 }).b; };
    add(2000, 1000, 5280, 1000); add(2000, 4460, 5280, 4460); add(5280, 1000, 5280, 4460);
    add(2000, 1000, 2000, 2500); add(2000, 3100, 2000, 4460);
    doc = { ...doc, building: b };
    doc = dropFixturePipes(placeFixture(doc, f1, 'washer', { x: 4000, y: 1500 }).doc).doc;
    const r = routeDrainsOut(doc);
    expect(r).toMatchObject({ pipes: 1, manholes: 1, skipped: 0, sleeves: 1 });
    expect(validateNetwork(r.doc.network)).toEqual([]);
    // 床下の水平な配管は、外周の立上りより内側では、どの内部の立上りも横切らない
    const net = r.doc.network;
    const inner = membersOf(r.doc.building).filter((m) => m.kind === 'footing' && m.a.x > 100 && m.a.x < 7180 && m.b.x > 100 && m.b.x < 7180 && m.a.y > 100 && m.a.y < D - 100 && m.b.y > 100 && m.b.y < D - 100);
    const cross = (p: { x: number; y: number }, q: { x: number; y: number }, a: { x: number; y: number }, c: { x: number; y: number }) => {
      const d = (q.x - p.x) * (c.y - a.y) - (q.y - p.y) * (c.x - a.x);
      if (Math.abs(d) < 1e-9) return false;
      const t = ((a.x - p.x) * (c.y - a.y) - (a.y - p.y) * (c.x - a.x)) / d, u = ((a.x - p.x) * (q.y - p.y) - (a.y - p.y) * (q.x - p.x)) / d;
      return t > 0 && t < 1 && u > 0 && u < 1;
    };
    const flat = Object.values(net.segments).filter((s) => s.system === 'drain' && Math.abs(net.nodes[s.a].pos.z - net.nodes[s.b].pos.z) < 1);
    expect(flat.length).toBeGreaterThan(1);
    for (const s of flat) for (const m of inner) expect(cross(net.nodes[s.a].pos, net.nodes[s.b].pos, m.a, m.b)).toBe(false);
  });
  it('先の配管が外周の壁ぎわから出ていても、その点へ合流する（飛ばさない・重ねない）', () => {
    let doc = house([['toilet', 1000, 4200]]);
    const f1 = doc.building.floors[0].id;
    const r0 = placeFixture(doc, f1, 'manholeSewage', { x: 1600, y: D + 760 });
    doc = r0.doc;
    const port = portNodes(doc.network, r0.fixtureId!)[0];
    // 壁ぎわ（壁芯から 60mm）から外のマスへ出る先の配管
    doc = { ...doc, network: addPolyline(doc.network, [{ x: 1600, y: D - 60, z: -300 }, { x: 1600, y: D + 760, z: -300 }, port.pos], { system: 'sewage', diameter: 75 }, { endNodeId: port.id }).net };
    const r = routeDrainsOut(doc);
    expect(r).toMatchObject({ pipes: 1, manholes: 0, skipped: 0 });
    expect(validateNetwork(r.doc.network)).toEqual([]);
    const net = r.doc.network;
    const joint = Object.values(net.nodes).find((n) => Math.abs(n.pos.x - 1600) < 1 && Math.abs(n.pos.y - (D - 60)) < 1)!;
    expect(segmentsAt(net, joint.id)).toHaveLength(2);
  });
});
