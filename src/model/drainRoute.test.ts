import { describe, expect, it } from 'vitest';
import { emptyDoc } from '../state/store';
import type { Doc } from './doc';
import { dropFixturePipes } from './dropPipes';
import { MANHOLE_OFFSET, openDrainEnds, routeDrainsOut } from './drainRoute';
import { placeFixture, portNodes, validateFixtures } from './fixtures';
import { segmentsAt, validateNetwork } from './network';
import { buildFromSheets } from './planRead/assemble';
import { D, W, foundationSheet, planSheet } from './planRead/testHouse';

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
  it('近い出口は 1 つのマスにまとめ、壁に平行に寄ってから直角に出る', () => {
    const r = routeDrainsOut(house([['toilet', 1000, 4700], ['washbasin', 1700, 5000]]));
    expect(r).toMatchObject({ pipes: 2, manholes: 1, skipped: 0 });
    const [m] = manholes(r.doc);
    expect(segmentsAt(r.doc.network, portNodes(r.doc.network, m.id)[0].id)).toHaveLength(2);
    // どの水平区間も壁に平行か直角（斜めに引かない）
    const flat = Object.values(r.doc.network.segments).filter((s) => {
      const a = r.doc.network.nodes[s.a].pos, b = r.doc.network.nodes[s.b].pos;
      return Math.abs(a.z - b.z) < 1;
    });
    expect(flat.length).toBeGreaterThanOrEqual(3);
    expect(flat.every((s) => { const a = r.doc.network.nodes[s.a].pos, b = r.doc.network.nodes[s.b].pos; return Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1; })).toBe(true);
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
  it('マスは必ず建物の外（どの器具でも、壁に囲まれた範囲の外に置かれる）', () => {
    const r = routeDrainsOut(house([['toilet', 3000, 2000], ['washbasin', 4200, 2600], ['bathtub', 5500, 4000], ['kitchen', 2000, 600]]));
    expect(r.skipped).toBe(0);
    for (const m of manholes(r.doc)) expect(m.x < -60 || m.x > W + 60 || m.y < -60 || m.y > D + 60).toBe(true);
  });
});
