/**
 * 上流から決める・公共ますの手前でドロップ（2026-11-13 ユーザー要望）:
 *  - 床下から外へ出る所（いちばん上流の外の管底）は GL − 370 に固定し、公共ますが深くても引きずられない
 *  - いちばん上流の管底（マスの管底を手で入れる）を変えると、公共ますまでの高さが自動で変わる
 *  - 勾配が強すぎるときは、標準の勾配のまま公共ますの手前のマスでドロップ（落差）にする
 */
import { describe, expect, it } from 'vitest';
import type { Doc } from '../doc';
import { placeFixture, portNodes } from '../fixtures';
import { addPolyline, type SegmentAttrs } from '../network';
import { BUILTIN_PROFILES } from '../municipality';
import { resolveDrainRules } from '../drainRules';
import { solveHeights } from './heights';
import { testSite } from './testSite';

const NAHA = resolveDrainRules(BUILTIN_PROFILES.find((p) => p.id === 'naha')!);
const S: SegmentAttrs = { system: 'sewage', diameter: 100 };
const v = (x: number, y: number, z: number) => ({ x, y, z });
const z = (d: Doc, id: string) => d.network.nodes[id].pos.z;
const DEF = NAHA.defaultSlope(100);
/** いちばん上流の外の管底: GL − 370（テストの GL は −600） */
const KSA_Z = -600 - 370;

/** 公共ます（西 10.7m）← 汚水マス M2（-5700）← 汚水マス M1（-700）← 基礎の内側で地中へ下ろした点 X ← 床下 */
function house(pubZ: number) {
  const { doc: d0, pub, floorId } = testSite(pubZ);
  const m1 = placeFixture(d0, floorId, 'manholeSewage', { x: -700, y: 3000 });
  const m2 = placeFixture(m1.doc, floorId, 'manholeSewage', { x: -5700, y: 3000 });
  let doc = m2.doc;
  const M1 = portNodes(doc.network, m1.fixtureId!)[0].id, M2 = portNodes(doc.network, m2.fixtureId!)[0].id;
  const P = (id: string) => doc.network.nodes[id].pos;
  let net = addPolyline(doc.network, [P(pub), P(M2)], S, { startNodeId: pub, endNodeId: M2 }).net;
  net = addPolyline(net, [P(M2), P(M1)], S, { startNodeId: M2, endNodeId: M1 }).net;
  // 外壁の芯 x=0（厚さ 150）の内側の面のすぐ内（x=85）で地中へ下ろし、床下（−300）へ立ち上げる
  const r = addPolyline(net, [P(M1), v(85, 3000, -1500), v(85, 3000, -300), v(2000, 3000, -300)], S, { startNodeId: M1 });
  doc = { ...doc, network: r.net };
  return { doc, pub, M1, M2, X: r.nodeIds[1], m1: m1.fixtureId!, m2: m2.fixtureId! };
}

describe('上流から決める・公共ますの手前でドロップ', () => {
  it('床下から出る所は KSA の高さのまま。公共ますが深くても引きずられず、手前のマスでドロップ', () => {
    const h = house(-2500);
    const out = solveHeights(h.doc, NAHA);
    expect(z(out.doc, h.X)).toBe(KSA_Z);
    // 外の配管は標準の勾配
    const M1z = z(out.doc, h.M1), M2z = z(out.doc, h.M2);
    expect(M1z).toBeCloseTo(KSA_Z - 785 * DEF - NAHA.drop, 0);
    expect(M2z).toBeCloseTo(-2500 + 5000 * DEF, 0);
    // 差は公共ますの手前のマス（M2）の落差
    const drop = out.doc.network.nodes[h.M2].dropIn!;
    expect(drop).toBeGreaterThan(300);
    expect(M2z + drop + 5000 * DEF).toBeCloseTo(M1z, 0);
    expect(out.doc.fixtures[h.m2].params?.invertZ).toBeCloseTo(M2z, 0);
  });

  it('勾配が強すぎなければドロップせず、間に勾配を割り振る', () => {
    const h = house(-1350);
    const out = solveHeights(h.doc, NAHA);
    expect(z(out.doc, h.X)).toBe(KSA_Z);
    expect(out.doc.network.nodes[h.M2].dropIn ?? 0).toBeLessThanOrEqual(NAHA.drop);
    expect(z(out.doc, h.M2)).toBeGreaterThan(-1350 + 5000 * DEF);
  });

  it('いちばん上流のマスの管底を手で変えると、公共ますまでの高さ（ドロップ）が変わる', () => {
    const h = house(-2500);
    const pin = (zz: number): Doc => ({ ...h.doc, fixtures: { ...h.doc.fixtures, [h.m1]: { ...h.doc.fixtures[h.m1], params: { ...h.doc.fixtures[h.m1].params, invertZ: zz, invertPin: true } } }, network: { ...h.doc.network, nodes: { ...h.doc.network.nodes, [h.M1]: { ...h.doc.network.nodes[h.M1], pos: { ...h.doc.network.nodes[h.M1].pos, z: zz } } } } });
    const a = solveHeights(pin(-1000), NAHA), b = solveHeights(pin(-1300), NAHA);
    expect(z(a.doc, h.M1)).toBe(-1000);
    expect(z(b.doc, h.M1)).toBe(-1300);
    expect(a.doc.network.nodes[h.M2].dropIn! - b.doc.network.nodes[h.M2].dropIn!).toBeCloseTo(300, 0);
  });

  it('公共ますの手前にマスが無ければ、公共ますへ入る所でドロップ', () => {
    const { doc, pub } = testSite(-2500);
    const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-700, 3000, -600)], S, { startNodeId: pub });
    const B = r.nodeIds[1];
    const net = { ...r.net, nodes: { ...r.net.nodes, [B]: { ...r.net.nodes[B], zPin: true } } };
    const out = solveHeights({ ...doc, network: net }, NAHA);
    expect(out.segSlopes[r.segmentIds[0]]).toBeCloseTo(DEF, 6);
    expect(out.doc.network.nodes[pub].dropIn).toBeCloseTo(-600 - 10000 * DEF + 2500, 0);
  });
});
