/** 排水の検査と直し方の候補 */
import { describe, expect, it } from 'vitest';
import type { Doc } from '../doc';
import { placeFixture, portNodes } from '../fixtures';
import { addPolyline, type SegmentAttrs } from '../network';
import { BUILTIN_PROFILES } from '../municipality';
import { resolveDrainRules, type DrainRuleSet } from '../drainRules';
import { solveHeights } from './heights';
import { checkDrain } from './checks';
import { testSite } from './testSite';

const rule = (id: string) => resolveDrainRules(BUILTIN_PROFILES.find((p) => p.id === id)!);
const NAHA = rule('naha');
const S: SegmentAttrs = { system: 'sewage', diameter: 100 };
const v = (x: number, y: number, z: number) => ({ x, y, z });

const run = (doc: Doc, rules: DrainRuleSet = NAHA) => { const r = solveHeights(doc, rules); return { ...r, issues: checkDrain(r.doc, rules, r.trees) }; };
const kinds = (doc: Doc, rules: DrainRuleSet = NAHA) => run(doc, rules).issues.map((i) => i.kind).filter((k) => k !== 'unverifiedRule');
/** 公共ますから西の外へ 10m（上端 B を固定 zB） */
function pinned(pubZ: number, zB: number) {
  const { doc, pub } = testSite(pubZ);
  const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-700, 3000, zB)], S, { startNodeId: pub });
  const B = r.nodeIds[1];
  return { doc: { ...doc, network: { ...r.net, nodes: { ...r.net.nodes, [B]: { ...r.net.nodes[B], zPin: true } } } }, seg: r.segmentIds[0], B };
}
/** 1 つ目の検査の 1 つ目の直し方を当てて計算し直す */
const fixFirst = (doc: Doc, kind: string) => {
  const r = run(doc);
  const issue = r.issues.find((i) => i.kind === kind)!;
  return issue.fixes[0].apply(r.doc);
};

describe('排水の検査（checkDrain）', () => {
  it('問題が無ければ検査は空（那覇市は 要確認 だけ）', () => {
    const { doc, pub } = testSite();
    const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-700, 3000, -900)], S, { startNodeId: pub });
    const out = run({ ...doc, network: r.net });
    expect(out.issues.map((i) => i.kind)).toEqual(['unverifiedRule']);
    expect(out.issues[0].message).toContain('桝の深さの上限');
  });

  it('勾配が足りない（両端固定）→ minSlope。「高さの固定を外す」で消える', () => {
    const { doc } = pinned(-700, -690);
    expect(kinds(doc)).toContain('minSlope');
    expect(kinds(fixFirst(doc, 'minSlope'))).not.toContain('minSlope');
  });

  it('急すぎる所は自動でドロップにするので maxSlope は出ない。手で固定した急な勾配 → maxSlope。固定を外すと消える。下流がマスなら落差ますの候補', () => {
    expect(kinds(pinned(-2500, -600).doc)).not.toContain('maxSlope');
    const p = pinned(-2500, -600);
    const { zPin: _z, ...free } = p.doc.network.nodes[p.B];
    const doc = { ...p.doc, network: { nodes: { ...p.doc.network.nodes, [p.B]: free }, segments: { ...p.doc.network.segments, [p.seg]: { ...p.doc.network.segments[p.seg], slope: 0.19, slopePin: true } } } };
    expect(kinds(doc)).toContain('maxSlope');
    expect(kinds(fixFirst(doc, 'maxSlope'))).not.toContain('maxSlope');
    // 下流がマス: 公共ます → マス（5m）→ 固定点（5m 上流、マスより 1000 高い）
    const { doc: d0, pub, floorId } = testSite(-2500);
    const m = placeFixture(d0, floorId, 'manholeSewage', { x: -5700, y: 3000 });
    const mh = portNodes(m.doc.network, m.fixtureId!)[0].id;
    const a = addPolyline(m.doc.network, [m.doc.network.nodes[pub].pos, m.doc.network.nodes[mh].pos], S, { startNodeId: pub, endNodeId: mh });
    const b = addPolyline(a.net, [m.doc.network.nodes[mh].pos, v(-700, 3000, -1200)], S, { startNodeId: mh });
    const B = b.nodeIds[1];
    const doc2 = { ...m.doc, network: { ...b.net, nodes: { ...b.net.nodes, [B]: { ...b.net.nodes[B], zPin: true } } } };
    // 下流がマスなら、そのマスが自動でドロップ（落差ます）になり、急な勾配は出ない
    const r2 = run(doc2);
    expect(r2.issues.map((i) => i.kind)).not.toContain('maxSlope');
    expect(r2.doc.network.nodes[mh].dropIn).toBeGreaterThan(500);
  });

  it('土かぶりが足りない（公共ますが浅い）→ cover と「勾配を緩める」', () => {
    const { doc, pub } = testSite(-850);
    const r = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-700, 3000, -900)], S, { startNodeId: pub });
    const d = { ...doc, network: r.net };
    expect(kinds(d)).toContain('cover');
    const fixed = fixFirst(d, 'cover');
    expect(fixed.network.segments[r.segmentIds[0]]).toMatchObject({ slope: 0.02, slopePin: true });
  });

  it('下流が細い → diameterReverse。「管径を上げる」で消える', () => {
    const { doc, pub } = testSite();
    const a = addPolyline(doc.network, [doc.network.nodes[pub].pos, v(-5700, 3000, -1000)], { system: 'sewage', diameter: 75 }, { startNodeId: pub });
    const b = addPolyline(a.net, [v(-5700, 3000, -1000), v(-700, 3000, -900)], S, { startNodeId: a.nodeIds[1] });
    const d = { ...doc, network: b.net };
    expect(kinds(d)).toContain('diameterReverse');
    const fixed = fixFirst(d, 'diameterReverse');
    expect(fixed.network.segments[a.segmentIds[0]].diameter).toBe(100);
    expect(kinds(fixed)).not.toContain('diameterReverse');
  });

  it('輪・公共ます無し・宜野湾市（未確認）', () => {
    const { doc: d0, floorId } = testSite();
    const m = placeFixture(d0, floorId, 'manholeSewage', { x: -5700, y: 3000 });
    const mh = portNodes(m.doc.network, m.fixtureId!)[0].id;
    const a = addPolyline(m.doc.network, [m.doc.network.nodes[mh].pos, v(-5700, 6000, -900), v(-3000, 6000, -900), v(-3000, 3000, -900)], S, { startNodeId: mh });
    const loop = addPolyline(a.net, [v(-3000, 3000, -900), m.doc.network.nodes[mh].pos], S, { startNodeId: a.nodeIds.at(-1), endNodeId: mh });
    const d = { ...m.doc, network: loop.net };
    expect(kinds(d)).toEqual(expect.arrayContaining(['loop', 'noPublic']));
    const g = run(d, rule('ginowan')).issues.find((i) => i.kind === 'unverifiedRule')!;
    expect(g.message).toContain('宜野湾市：未確認（宜野湾市上下水道局 下水道施設課 098-892-4156）');
  });
});
