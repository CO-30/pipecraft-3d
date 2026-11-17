/**
 * 上流から決める・公共ますの手前でドロップ（2026-11-13 ユーザー要望）:
 *  - 床下から外へ出る所（いちばん上流の外の管底）は GL − 370 に固定し、公共ますが深くても引きずられない
 *  - いちばん上流の管底（マスの管底を手で入れる）を変えると、公共ますまでの高さが自動で変わる
 *  - 勾配が強すぎるときは、標準の勾配のまま公共ますの手前のマスでドロップ（落差）にする
 */
import { describe, expect, it } from 'vitest';
import type { Doc } from '../doc';
import { groundZAt, placeFixture, portNodes } from '../fixtures';
import { addPolyline, type SegmentAttrs } from '../network';
import { BUILTIN_PROFILES } from '../municipality';
import { resolveDrainRules } from '../drainRules';
import { solveHeights } from './heights';
import { outerDiameter } from '../slope';
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

  it('公共ますへ直接入る急な経路が 2 つあっても、ドロップは 1 回だけで、先に決めた高さを変えない', () => {
    const { doc, pub } = testSite(-2500);
    const P0 = doc.network.nodes[pub].pos;
    const r1 = addPolyline(doc.network, [P0, v(-700, 3000, -600)], S, { startNodeId: pub });
    const r2 = addPolyline(r1.net, [P0, v(-10700, 8000, -300)], S, { startNodeId: pub });
    const pinB = (n: typeof r2.net, id: string) => ({ ...n, nodes: { ...n.nodes, [id]: { ...n.nodes[id], zPin: true } } });
    const net = pinB(pinB(r2.net, r1.nodeIds[1]), r2.nodeIds[1]);
    const out = solveHeights({ ...doc, network: net }, NAHA);
    const drop = out.doc.network.nodes[pub].dropIn!;
    // 遠い方（10m）は標準の勾配 + ドロップ、近い方（5m）はそのドロップの上に割り振る（どちらも高さと勾配が合う）
    expect(out.segSlopes[r1.segmentIds[0]]).toBeCloseTo(DEF, 6);
    expect(-2500 + drop + DEF * 10000).toBeCloseTo(-600, 0);
    expect(-2500 + drop + out.segSlopes[r2.segmentIds[0]] * 5000).toBeCloseTo(-300, 0);
    expect(solveHeights(out.doc, NAHA).doc).toBe(out.doc);
  });

  it('先に決めた経路が公共ますへ急でなく着いた後に、別の経路が急に直接入る: 公共ますの落差を足さず、その管だけマスの外で L で落とす（先の経路の高さは変えない）', () => {
    const { doc, pub } = testSite(-900);
    const P0 = doc.network.nodes[pub].pos;
    // 遠い方（10m・−600 → 公共 −900: 3/100 で急ではない）、近い方（2m・−300 → 急）
    const r1 = addPolyline(doc.network, [P0, v(-700, 3000, -600)], S, { startNodeId: pub });
    const r2 = addPolyline(r1.net, [P0, v(-10700, 5000, -300)], S, { startNodeId: pub });
    const pinB = (n: typeof r2.net, id: string) => ({ ...n, nodes: { ...n.nodes, [id]: { ...n.nodes[id], zPin: true } } });
    const net = pinB(pinB(r2.net, r1.nodeIds[1]), r2.nodeIds[1]);
    const out = solveHeights({ ...doc, network: net }, NAHA);
    // 公共ますに落差は付けない。遠い方は公共ますへそのまま割り振った勾配
    expect(out.doc.network.nodes[pub].dropIn ?? 0).toBe(0);
    expect(-900 + out.segSlopes[r1.segmentIds[0]] * 10000).toBeCloseTo(-600, 0);
    // 近い方は標準の勾配で行き、マスの外で落とす（管ごとのドロップ）
    expect(out.segSlopes[r2.segmentIds[0]]).toBeCloseTo(DEF, 6);
    const drop = out.doc.network.segments[r2.segmentIds[0]].dropEnd!;
    expect(-900 + drop + DEF * 2000).toBeCloseTo(-300, 0);
    expect(solveHeights(out.doc, NAHA).doc).toBe(out.doc);
  });

  it('公共ますが浅くて下りにならないときは、出口を固定せず下流から決める（上り勾配にしない）', () => {
    const h = house(-800);
    const out = solveHeights(h.doc, NAHA);
    expect(z(out.doc, h.X)).toBeGreaterThan(z(out.doc, h.M1));
    expect(z(out.doc, h.M1)).toBeGreaterThan(z(out.doc, h.M2));
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

describe('地面が途中で下がる敷地: 管が地面から出ないよう、下がる所の手前のマスで落とす（2026-11-18 実物の図面 土被り −341mm）', () => {
  /** M1（x=−700）は GL±0、M2（x=−5700）・公共ます は GL−900（CB の段差で下がる） */
  const ground = [{ x: 0, y: 3000, gl: 0 }, { x: -700, y: 3000, gl: 0 }, { x: -5700, y: 3000, gl: -900 }, { x: -10700, y: 3000, gl: -900 }];
  const coverOk = (d: Doc, id: string, fid: string) => {
    const n = d.network.nodes[id];
    const g = groundZAt(d.building, d.site, n.pos);
    // マスへ入る管（落差があれば流入側）の上に土かぶり
    expect(d.fixtures[fid]).toBeTruthy();
    return g - (n.pos.z + (n.dropIn ?? 0) + outerDiameter(100)) - NAHA.cover >= -0.5;
  };
  it('公共ますが深い（急すぎる）とき: 標準の勾配のまま、地面が下がる手前のマス（M1）でも落として、M2 へ入る管にも土かぶり', () => {
    const h = house(-2800);
    const doc = { ...h.doc, site: { ...h.doc.site, groundPoints: ground } };
    const out = solveHeights(doc, NAHA);
    expect(coverOk(out.doc, h.M2, h.m2)).toBe(true);
    expect(coverOk(out.doc, h.M1, h.m1)).toBe(true);
    expect(out.doc.network.nodes[h.M1].dropIn ?? 0).toBeGreaterThan(NAHA.drop);
    // 床下から出る所は KSA の高さのまま・公共ますの管底も変えない
    expect(z(out.doc, h.X)).toBe(KSA_Z);
    expect(z(out.doc, h.pub)).toBe(-2800);
  });
  it('公共ますが無い系統（根は下流端のマス）: 根を地面に合わせて深くし、途中のマスへ入る管にも土かぶり', () => {
    const h = house(-2800);
    // 公共ますを外し、M2 の先（x=−6200、GL−900）に下流端のマスを置く
    const pubFx = h.doc.network.nodes[h.pub].fixtureId!;
    const fixtures = { ...h.doc.fixtures };
    delete fixtures[pubFx];
    const nodes = { ...h.doc.network.nodes, [h.pub]: { ...h.doc.network.nodes[h.pub], fixtureId: undefined, portId: undefined } };
    let doc: Doc = { ...h.doc, fixtures, network: { ...h.doc.network, nodes }, site: { ...h.doc.site, groundPoints: ground } };
    // 置いたときの管底は M2 と同じ（手で入れた値ではない。invertPin なし）
    const down = placeFixture(doc, doc.building.floors[0].id, 'manholeSewage', { x: -6200, y: 3000 }, 0, { invertZ: doc.network.nodes[h.M2].pos.z });
    doc = down.doc;
    const D = portNodes(doc.network, down.fixtureId!)[0].id;
    doc = { ...doc, fixtures: { ...doc.fixtures, [down.fixtureId!]: { ...doc.fixtures[down.fixtureId!], params: { ...doc.fixtures[down.fixtureId!].params, downstream: true } } } };
    // 公共ますだった点の代わりに、M2 → 下流端 の管（公共ますへの管は消す）
    const seg = Object.values(doc.network.segments).find((s) => s.a === h.pub || s.b === h.pub)!;
    const segments = { ...doc.network.segments };
    delete segments[seg.id];
    const nodes2 = { ...doc.network.nodes };
    delete nodes2[h.pub];
    doc = { ...doc, network: addPolyline({ nodes: nodes2, segments }, [doc.network.nodes[h.M2].pos, doc.network.nodes[D].pos], S, { startNodeId: h.M2, endNodeId: D }).net };
    const out = solveHeights(doc, NAHA);
    expect(out.trees[0].root).toBe(D);
    for (const [id, fid] of [[h.M1, h.m1], [h.M2, h.m2], [D, down.fixtureId!]] as const) {
      expect(coverOk(out.doc, id, fid)).toBe(true);
    }
    expect(z(out.doc, h.X)).toBe(KSA_Z);
  });
});
