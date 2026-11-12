import { describe, expect, test } from 'vitest';
import { addFloor, emptyBuilding } from './building';
import type { Doc } from './doc';
import { addPolyline, emptyNetwork, type Network } from './network';
import { findPipeClashes } from './clash';
import { computeEstimate } from './estimate';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const W = { system: 'water' as const, diameter: 20, material: 'HIVP' };
const D = { system: 'sewage' as const, diameter: 100, material: 'VU' };
const docOf = (net: Network): Doc => ({ building: addFloor(emptyBuilding(), { height: 3000 }).b, network: net, fixtures: {} });

describe('配管どうしの干渉', () => {
  test('同じ高さで十字に交わる給水と排水は干渉。重なり量と場所', () => {
    let net = addPolyline(emptyNetwork(), [v(0, 0, -300), v(2000, 0, -300)], D).net;
    net = addPolyline(net, [v(1000, -1000, -300), v(1000, 1000, -300)], W).net;
    const c = findPipeClashes(docOf(net));
    expect(c).toHaveLength(1);
    expect(c[0].point.x).toBeCloseTo(1000, 3); expect(c[0].point.y).toBeCloseTo(0, 3);
    expect(c[0].overlap).toBeGreaterThan(60); // 外径 114/2 + 26/2 = 70 くらい
  });
  test('上下に十分離れていれば干渉しない。外径の和より少し近いと干渉', () => {
    let net = addPolyline(emptyNetwork(), [v(0, 0, -300), v(2000, 0, -300)], D).net;
    net = addPolyline(net, [v(1000, -1000, -200), v(1000, 1000, -200)], W).net; // 中心間 100 > 70
    expect(findPipeClashes(docOf(net))).toEqual([]);
    net = addPolyline(net, [v(500, -1000, -240), v(500, 1000, -240)], W).net; // 中心間 60 < 70
    expect(findPipeClashes(docOf(net))).toHaveLength(1);
  });
  test('つながっている区間（同じ点・T 字の分岐・折れ曲がり）は干渉にしない', () => {
    let r = addPolyline(emptyNetwork(), [v(0, 0, -300), v(1000, 0, -300), v(1000, 1000, -300)], D);
    const mid = Object.values(r.net.nodes).find((n) => n.pos.x === 1000 && n.pos.y === 0)!;
    r = addPolyline(r.net, [v(1000, 0, -300), v(2000, 0, -300)], D, { startNodeId: mid.id });
    expect(findPipeClashes(docOf(r.net))).toEqual([]);
  });
  test('柔らかい管（PB・架橋ポリ）どうしが交差するのは干渉にしない（上下にずらして通す）。平行に重なるのは干渉', () => {
    const P = { system: 'water' as const, diameter: 20, material: 'PB保温5mm' };
    const H = { system: 'hotWater' as const, diameter: 20, material: '架橋ポリ' };
    let net = addPolyline(emptyNetwork(), [v(0, 0, -300), v(2000, 0, -300)], P).net;
    net = addPolyline(net, [v(1000, -1000, -300), v(1000, 1000, -300)], H).net;
    expect(findPipeClashes(docOf(net))).toEqual([]);
    net = addPolyline(net, [v(0, 10, -300), v(1500, 10, -300)], H).net; // 平行に 10mm
    expect(findPipeClashes(docOf(net)).length).toBeGreaterThanOrEqual(1);
    // 片方が硬い管なら交差も干渉
    const n2 = addPolyline(addPolyline(emptyNetwork(), [v(0, 0, -300), v(2000, 0, -300)], P).net, [v(1000, -1000, -300), v(1000, 1000, -300)], W).net;
    expect(findPipeClashes(docOf(n2))).toHaveLength(1);
  });
  test('同じ干渉を区間ごとに何度も出さない（分割された管に沿う管・継ぎ目での交差）', () => {
    let net = addPolyline(emptyNetwork(), [v(0, 0, -300), v(1000, 0, -300), v(2000, 0, -300), v(3000, 0, -300), v(4000, 0, -300)], D).net;
    net = addPolyline(net, [v(500, 30, -300), v(3500, 30, -300)], W).net; // 30mm 横を沿う
    expect(findPipeClashes(docOf(net))).toHaveLength(1);
    let n2 = addPolyline(emptyNetwork(), [v(0, 0, -300), v(1000, 0, -300), v(2000, 0, -300)], D).net;
    n2 = addPolyline(n2, [v(1000, -1000, -300), v(1000, 1000, -300)], W).net; // 継ぎ目で交差
    expect(findPipeClashes(docOf(n2))).toHaveLength(1);
  });
  test('柔らかい管でも、立て管が横の管を貫くのは干渉', () => {
    const P = { system: 'water' as const, diameter: 20, material: 'PB' };
    let net = addPolyline(emptyNetwork(), [v(0, 0, -300), v(2000, 0, -300)], P).net;
    net = addPolyline(net, [v(1000, 0, -800), v(1000, 0, 500)], { ...P, system: 'hotWater' as const }).net;
    expect(findPipeClashes(docOf(net))).toHaveLength(1);
  });
  test('積算の要確認に「干渉」として出る', () => {
    let net = addPolyline(emptyNetwork(), [v(0, 0, -300), v(2000, 0, -300)], D).net;
    net = addPolyline(net, [v(1000, -1000, -300), v(1000, 1000, -300)], W).net;
    const issues = computeEstimate(docOf(net)).issues.filter((i) => i.kind === 'clash');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('ぶつかっています');
  });
});
