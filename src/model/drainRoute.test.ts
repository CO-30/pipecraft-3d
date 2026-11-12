import { describe, expect, it } from 'vitest';
import { emptyDoc } from '../state/store';
import type { Doc } from './doc';
import { dropFixturePipes } from './dropPipes';
import { MANHOLE_OFFSET, openDrainEnds, routeDrainsOut } from './drainRoute';
import { moveFixture, placeFixture, portNodes, validateFixtures } from './fixtures';
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
    // 床下（GL+300）を水平に基礎の内側まで → 基礎の中で立ち下げ（基礎貫通スリーブ KSA）→ 地中で基礎を抜けて勾配でマスへ（外に配管を出さない）
    const net = r.doc.network;
    const port = portNodes(net, m.id)[0];
    expect(port.pos.z).toBe(-1200); // マスの管底 GL−600（標準）
    const [last] = segmentsAt(net, port.id);
    const a = net.nodes[last.a === port.id ? last.b : last.a];
    // 基礎の内側の面（立上りの幅 150 の半分）から 10 内で下ろす。φ75 は 3/100 以上 → 845 × 0.03 ≈ 25 上
    expect([a.pos.x, a.pos.y, a.pos.z]).toEqual([1000, D - 85, -1175]);
    expect([last.system, last.diameter]).toEqual(['sewage', 75]);
    const drop = segmentsAt(net, a.id).find((x) => x.id !== last.id)!;
    const x = net.nodes[drop.a === a.id ? drop.b : drop.a];
    // 起点（基礎の中で立ち下げる点）の管底を土間（スラブ天端 −550）に置き、器具へ 2/100 で上がる: 器具の下の端（便器の排水口 y=4550）は 825 × 2/100 上
    expect([x.pos.x, x.pos.y]).toEqual([1000, D - 85]);
    expect(x.pos.z).toBe(-550);
    const flat = segmentsAt(net, x.id).find((t) => t.id !== drop.id)!;
    const up = net.nodes[flat.a === x.id ? flat.b : flat.a];
    expect([up.pos.x, up.pos.y]).toEqual([1000, 4550]);
    expect(up.pos.z).toBeCloseTo(-550 + 825 * 0.02, 1);
    expect(flat.slope).toBe(0.02);
    // 地中の配管の上（管頂）は GL から 200 以上下（宅地内の土かぶり）
    expect(-600 - (a.pos.z + 89)).toBeGreaterThanOrEqual(200);
    expect(openDrainEnds(r.doc)).toHaveLength(0);
    // 給水の立て管はそのまま（つなぐのは排水だけ）
    expect(Object.values(r.doc.network.segments).filter((s) => s.system === 'water')).toHaveLength(1);
  });
  it('合流する配管も起点から上流へ勾配がつく（器具の下の端がいちばん高く、途中に逆勾配が無い）', () => {
    const r = routeDrainsOut(house([['toilet', 1000, 4700], ['washbasin', 1700, 5000]]));
    const net = r.doc.network;
    for (const sg of Object.values(net.segments)) {
      const a = net.nodes[sg.a].pos, b = net.nodes[sg.b].pos;
      const L = Math.hypot(a.x - b.x, a.y - b.y);
      if (L < 1 || Math.abs(a.z - b.z) > L || a.z > -150) continue; // 立て管・床上は除く
      if (a.z < -600) continue; // 地中（外）は別に確かめる
      expect(Math.abs(a.z - b.z) / L).toBeGreaterThanOrEqual(1 / 100 - 1e-3);
    }
  });
  it('器具を足してもう一度押すと、勾配のついた先の配管へ合流する（重ねない・地中へ下ろすのは 1 本）', () => {
    let doc = routeDrainsOut(house([['toilet', 1000, 4700]])).doc;
    doc = dropFixturePipes(placeFixture(doc, doc.building.floors[0].id, 'washbasin', { x: 1700, y: 5000 }).doc).doc;
    const r = routeDrainsOut(doc);
    expect(r).toMatchObject({ pipes: 1, manholes: 0, skipped: 0 });
    expect(validateNetwork(r.doc.network)).toEqual([]);
    const net = r.doc.network;
    const [m] = manholes(r.doc);
    expect(segmentsAt(net, portNodes(net, m.id)[0].id)).toHaveLength(1);
    // 起点から上流は勾配がつき、器具の下の端がいちばん高い（合流点もつながった勾配）
    for (const sg of Object.values(net.segments)) {
      const a = net.nodes[sg.a].pos, b = net.nodes[sg.b].pos, L = Math.hypot(a.x - b.x, a.y - b.y);
      if (sg.system === 'water' || L < 1 || Math.abs(a.z - b.z) > L || a.z < -600) continue;
      expect(Math.abs(a.z - b.z) / L).toBeGreaterThanOrEqual(1 / 100 - 1e-3);
    }
  });
  it('深く落とした配管でも、起点は地中の点より上・落とした高さより下（逆に上がらない）', () => {
    const r0 = buildFromSheets([{ name: 'a', page: planSheet() }, { name: 'b', page: foundationSheet() }]);
    let doc: Doc = { ...emptyDoc(), building: r0.building, site: { designGL: -600 } };
    doc = dropFixturePipes(placeFixture(doc, r0.building.floors[0].id, 'toilet', { x: 1000, y: 1000 }).doc, 1000).doc;
    const r = routeDrainsOut(doc);
    const net = r.doc.network, port = portNodes(net, manholes(r.doc)[0].id)[0];
    const [last] = segmentsAt(net, port.id);
    const under = net.nodes[last.a === port.id ? last.b : last.a];
    const drop = segmentsAt(net, under.id).find((t) => t.id !== last.id)!;
    const x = net.nodes[drop.a === under.id ? drop.b : drop.a];
    expect(x.pos.z).toBeGreaterThan(under.pos.z + 40);
    expect(x.pos.z).toBeLessThanOrEqual(-1000);
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
  it('土かぶりの決まり（自治体）が深ければ、新しいマスを深くして管頂の土かぶりを守る', () => {
    const r = routeDrainsOut(house([['toilet', 1000, 4500]]), undefined, { cover: 600 });
    const net = r.doc.network, port = portNodes(net, manholes(r.doc)[0].id)[0];
    const [last] = segmentsAt(net, port.id);
    const a = net.nodes[last.a === port.id ? last.b : last.a];
    // 管頂 = GL−600 → 管底 −600−600−89 = −1289。マスはそこから 3/100 で 845 下
    expect(a.pos.z).toBe(-1289);
    expect(port.pos.z).toBe(-1314);
  });
  it('配置図の敷地の高さで地面が下がっている所は、その地面から土かぶりを取る', () => {
    const doc0 = house([['toilet', 1000, 4500]]);
    // 基礎の所（地中へ下ろす所）の地面が GL−1200（絶対 −1800）。マスの所は GL±0
    const doc = { ...doc0, site: { ...doc0.site, groundPoints: [{ x: 1000, y: D - 85, gl: -1200 }, { x: 1000, y: D + 760, gl: 0 }] } };
    const r = routeDrainsOut(doc);
    const net = r.doc.network, port = portNodes(net, manholes(r.doc)[0].id)[0];
    const [last] = segmentsAt(net, port.id);
    const a = net.nodes[last.a === port.id ? last.b : last.a];
    // 管頂は低い方の地面（−1800）から 200 以上下。マスはそれに合わせて深くする
    expect(-1800 - (a.pos.z + 89)).toBeGreaterThanOrEqual(200);
    expect(port.pos.z).toBeLessThan(a.pos.z);
  });
  it('置いてあるマスが浅く土かぶりが取れないときはつながない', () => {
    let doc = house([['toilet', 1000, 4500]]);
    doc = placeFixture(doc, doc.building.floors[0].id, 'manholeSewage', { x: 1000, y: D + 60 + MANHOLE_OFFSET }).doc;
    const id = manholes(doc)[0].id;
    doc = moveFixture(doc, id, { x: 1000, y: D + 60 + MANHOLE_OFFSET }, undefined, { invertZ: -900 }); // 管底 GL−300
    const r = routeDrainsOut(doc);
    expect(r).toMatchObject({ pipes: 0, skipped: 1 });
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
    // 床下の横の配管（勾配つき。立て管を除く）
    const flat = Object.values(net.segments).filter((s) => { const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos, L = Math.hypot(a.x - b.x, a.y - b.y); return s.system === 'drain' && L >= 1 && Math.abs(a.z - b.z) < L * 0.1; });
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

describe('置いたマスへ集める・基礎貫通スリーブの形（2026-11-12）', () => {
  it('手で置いた汚水マスが器具の真横でなくても、その近くの基礎から床下へ入れて器具の排水を集める（新しいマスを足さない）', async () => {
    const { supplyHouse } = await import('./testSupplyHouse');
    const h = supplyHouse();
    let doc = placeFixture(h.doc, h.floorId, 'manholeSewage', { x: 5000, y: -800 }).doc;
    doc = dropFixturePipes(doc).doc;
    const r = routeDrainsOut(doc);
    expect(r.skipped).toBe(0);
    expect(manholes(r.doc)).toHaveLength(1);
    const m = manholes(r.doc)[0];
    // 3 つの器具の排水がすべてそのマスへ（排水管でたどれる）
    const net = r.doc.network;
    const seen = new Set([portNodes(net, m.id)[0].id]), st = [...seen];
    while (st.length) { const n = st.pop()!; for (const sg of segmentsAt(net, n)) for (const k of [sg.a, sg.b]) if (!seen.has(k) && (sg.system === 'drain' || sg.system === 'sewage')) { seen.add(k); st.push(k); } }
    for (const [fid, pid] of [[h.ids.toilet, 'sewage'], [h.ids.kitchen, 'drain'], [h.ids.washbasin, 'drain']] as const) {
      expect(seen.has(portNodes(net, fid).find((n) => n.portId === pid)!.id)).toBe(true);
    }
    // マスへ下りる配管は 1 本（床下で 1 本にまとめてから基礎を抜ける）
    expect(segmentsAt(net, portNodes(net, m.id)[0].id)).toHaveLength(1);
  });
  it('外に出た所では地面より上に排水管を出さない（基礎の中で立ち下げて地中で抜ける）', () => {
    const r = routeDrainsOut(house([['toilet', 1000, 4500], ['washbasin', 6000, 1000]]));
    const net = r.doc.network;
    for (const sg of Object.values(net.segments)) {
      if (sg.system !== 'drain' && sg.system !== 'sewage') continue;
      for (const id of [sg.a, sg.b]) {
        const q = net.nodes[id].pos;
        const outside = q.x < -60 || q.y < -60 || q.x > 7340 || q.y > D + 60;
        if (outside) expect(q.z).toBeLessThan(-600);
      }
    }
  });
});
