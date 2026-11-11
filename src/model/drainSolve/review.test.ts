/** 最終レビューの指摘の再現（直す前に失敗することを確かめる） */
import { describe, expect, it } from 'vitest';
import { placeFixture, portNodes } from '../fixtures';
import { addPolyline, type SegmentAttrs } from '../network';
import { STANDARD_PROFILE } from '../municipality';
import { resolveDrainRules } from '../drainRules';
import { solveHeights } from './heights';
import { solveDrain } from './index';
import { testSite } from './testSite';

const STD = resolveDrainRules(STANDARD_PROFILE);
const S: SegmentAttrs = { system: 'sewage', diameter: 100 };
const v = (x: number, y: number, z: number) => ({ x, y, z });

describe('最終レビューの指摘', () => {
  it('少し斜めの立て管（上端が 2mm ずれた）は立て管のまま。上の階の横管は落ちない', () => {
    const { doc, pub } = testSite();
    const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-700, 3000, -900), v(-700, 3000, 1900), v(-698, 3000, 2000), v(2000, 3000, 2030)], S, { startNodeId: pub });
    const out = solveHeights({ ...doc, network: r.net }, STD);
    expect(out.doc.network.nodes[r.nodeIds[3]].pos.z).toBe(2000);
    expect(out.doc.network.nodes[r.nodeIds[4]].pos.z).toBeGreaterThan(2000);
  });

  it('公共ますが 2 つあっても、根でない方の管底は変えない', () => {
    const { doc: d0, pub, floorId } = testSite(-1200);
    const m = placeFixture(d0, floorId, 'publicRain', { x: -10700, y: 6000 }, 0, { invertZ: -800 });
    const rain = portNodes(m.doc.network, m.fixtureId!)[0].id;
    const r = addPolyline(m.doc.network, [m.doc.network.nodes[pub].pos, v(-5700, 3000, -1000), m.doc.network.nodes[rain].pos], S, { startNodeId: pub, endNodeId: rain });
    const out = solveHeights({ ...m.doc, network: r.net }, STD);
    expect(out.doc.network.nodes[rain].pos.z).toBe(-800);
    expect(out.doc.fixtures[m.fixtureId!].params?.invertZ).toBe(-800);
  });

  it('マスの無い屋外の管を同じ高さで描くと、家から遠い端が下流（根）', () => {
    const { doc } = testSite();
    const d = { ...doc, network: addPolyline(doc.network, [v(-500, 3000, -900), v(-5000, 3000, -900)], S).net };
    const out = solveHeights({ ...d, network: d.network }, STD);
    const zs = Object.values(out.doc.network.nodes).filter((n) => !n.fixtureId).sort((a, b) => a.pos.x - b.pos.x);
    expect(zs[0].pos.z).toBeLessThan(zs[1].pos.z); // x = −5000 が低い
  });

  it('何も変わらなければ同じ doc を返す（履歴が増えない）', () => {
    const { doc, pub } = testSite();
    const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-700, 3000, -900)], S, { startNodeId: pub });
    const once = solveDrain({ ...doc, network: r.net }, STD).doc;
    expect(solveDrain(once, STD).doc).toBe(once);
  });

  it('直し方の関数は、対象が無くなっていれば何もしない', () => {
    const { doc, pub } = testSite();
    const a = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-5700, 3000, -1000)], { system: 'sewage', diameter: 75 }, { startNodeId: pub });
    const b = addPolyline(a.net, [v(-5700, 3000, -1000), v(-700, 3000, -900)], S, { startNodeId: a.nodeIds[1] });
    const r = solveDrain({ ...doc, network: b.net }, STD);
    const fix = r.issues.find((i) => i.kind === 'diameterReverse')!.fixes[0];
    expect(fix.apply(doc)).toBe(doc); // 配管が無い doc（取り消したあと）
  });

  it('性能: 1000 区間の一直線を 300ms 以内に計算・検査する', () => {
    const { doc, pub } = testSite();
    // 公共ますから東へ 10mm ずつ、ジグザグに 1000 点（曲がりの多い長い配管）
    const pts = [doc.network.nodes[pub].pos, ...Array.from({ length: 1000 }, (_, i) => v(-10700 + 10 * (i + 1), 3000 + (i % 2) * 300, -900))];
    const r = addPolyline(doc.network, pts, S, { startNodeId: pub });
    const t0 = performance.now();
    solveDrain({ ...doc, network: r.net }, STD);
    expect(performance.now() - t0).toBeLessThan(300);
  });
});
