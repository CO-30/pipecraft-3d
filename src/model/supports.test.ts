/** 支持金具・ビス・勾配の手計算テスト */
import { describe, expect, it } from 'vitest';
import { addPolyline, branchFromSegment, emptyNetwork, validateNetwork, type Network, type SegmentAttrs } from './network';
import { addFloor, emptyBuilding } from './building';
import { computeEstimate, defaultEstimate, type EstimateSettings } from './estimate';
import { applySlope, actualSlope, defaultSlope, slopeEnough, slopeLabel } from './slope';
import { defaultSupportSettings } from './supports';

const v = (x: number, y: number, z = 100) => ({ x, y, z });
const W: SegmentAttrs = { system: 'water', diameter: 20 };
const D50: SegmentAttrs = { system: 'drain', diameter: 50 };
const bld = addFloor(emptyBuilding(), { height: 2900 }).b;
const est = (net: Network, s: Partial<EstimateSettings> = {}) => computeEstimate({ building: bld, network: net, fixtures: {}, estimate: { ...defaultEstimate(), ...s } });
const sup = (e: ReturnType<typeof est>, key: string) => e.supports.find((l) => l.key === key);

describe('支持金具・ビス', () => {
  it('給水φ20 直線3000mm: サドル 3個（1.0m間隔）、コンクリートビス 6本、コンクリキリ 1本、参考単価で 477+138+979 円', () => {
    const { net } = addPolyline(emptyNetwork(), [v(0, 0), v(3000, 0)], W);
    const e = est(net);
    expect(sup(e, 'sup|saddle|20')).toMatchObject({ count: 3, materialAmount: 477, priceSource: 'catalog' });
    expect(sup(e, 'sup|screwConcrete')).toMatchObject({ count: 6, materialAmount: 138 });
    expect(sup(e, 'sup|bit')).toMatchObject({ count: 1, materialAmount: 979 });
    expect(sup(e, 'sup|screwWood')).toBeUndefined();
  });

  it('エルボで区切られた区間ごとに数える: 3000+2000 → 3+2 = 5個。継手なしで続く10000mm → 10個', () => {
    expect(sup(est(addPolyline(emptyNetwork(), [v(0, 0), v(3000, 0), v(3000, 2000)], W).net), 'sup|saddle|20')!.count).toBe(5);
    expect(sup(est(addPolyline(emptyNetwork(), [v(0, 0), v(4000, 0), v(10000, 0)], W).net), 'sup|saddle|20')!.count).toBe(10);
    // 短い区間でも最低1個
    expect(sup(est(addPolyline(emptyNetwork(), [v(0, 0), v(300, 0)], W).net), 'sup|saddle|20')!.count).toBe(1);
  });

  it('床上排水（床から0〜400mm）はレベルバンド（単価は未設定→要確認）、天井の排水φ100 は 2.0m間隔のサドル', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0, 100), v(2500, 0, 100)], D50);
    const e = est(r.net);
    expect(sup(e, 'sup|levelBand|50')).toMatchObject({ count: 3, priceSource: 'none' });
    expect(e.issues.some((i) => i.target.id === 'sup|levelBand|50')).toBe(true);
    const c = addPolyline(emptyNetwork(), [v(0, 0, 2600), v(5000, 0, 2600)], { system: 'drain', diameter: 100 });
    expect(sup(est(c.net), 'sup|saddle|100')!.count).toBe(3);
  });

  it('配線・「支持しない」は数えない。木下地はステンレスビス、ビス本数・キリの消耗は設定どおり', () => {
    expect(est(addPolyline(emptyNetwork(), [v(0, 0), v(3000, 0)], { system: 'electric', diameter: 2 }).net).supports).toEqual([]);
    const r = addPolyline(emptyNetwork(), [v(0, 0), v(3000, 0)], W);
    const id = r.segmentIds[0];
    const none = { ...r.net, segments: { [id]: { ...r.net.segments[id], support: 'none' as const } } };
    expect(est(none).supports).toEqual([]);
    const wood = { ...r.net, segments: { [id]: { ...r.net.segments[id], substrate: 'wood' as const } } };
    const e = est(wood);
    expect(sup(e, 'sup|screwWood')).toMatchObject({ count: 6, materialAmount: 108 });
    expect(sup(e, 'sup|bit')).toBeUndefined();
    const e2 = est(r.net, { supports: { ...defaultSupportSettings(), screwsPerSupport: 1, holesPerBit: 2 } });
    expect([sup(e2, 'sup|screwConcrete')!.count, sup(e2, 'sup|bit')!.count]).toEqual([3, 2]);
    expect(est(r.net, { supports: { ...defaultSupportSettings(), enabled: false } }).supports).toEqual([]);
  });

  it('見積の材料行に入り、合計に反映される', () => {
    const { net } = addPolyline(emptyNetwork(), [v(0, 0), v(3000, 0)], W);
    const e = est(net);
    const supAmount = e.lines.filter((l) => l.priceKey?.startsWith('sup|')).reduce((a, l) => a + l.amount, 0);
    expect(supAmount).toBe(477 + 138 + 979);
    expect(e.materialTotal).toBe(2010 + supAmount); // HIVP φ20 1本 + 支持金具
  });
});

describe('排水の勾配', () => {
  it('管径別の最小勾配: 50→1/50、75・100→1/100、125→1/150、150→1/200', () => {
    expect([50, 75, 100, 125, 150].map((d) => slopeLabel(defaultSlope(d)))).toEqual(['1/50', '1/100', '1/100', '1/150', '1/200']);
  });

  it('流末を基準に上流ほど高く: φ50 4000+3000mm（自動 1/50）→ 80mm・140mm 上がる。一直線の点は継手なしのまま', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0), v(2000, 0), v(4000, 0), v(4000, 3000)], D50);
    const [o, m, c, e] = r.nodeIds;
    const res = applySlope(r.net, o, 'auto')!;
    expect(res.nodes).toBe(3);
    const z = (id: string) => res.net.nodes[id].pos.z;
    expect([z(o), z(m), z(c), z(e)]).toEqual([100, 140, 180, 240]);
    expect(res.net.nodes[m].kind).toBe('joint');
    expect(Object.values(res.net.segments).every((s) => s.slope === 1 / 50)).toBe(true);
    expect(actualSlope(res.net, res.net.segments[r.segmentIds[0]])).toBeCloseTo(1 / 50, 6);
    expect(validateNetwork(res.net)).toEqual([]);
  });

  it('分岐した枝も流末から遠いほど高い。指定の勾配 1/100 でも', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0), v(4000, 0)], D50);
    const b = branchFromSegment(r.net, r.segmentIds[0], v(2000, 0), [v(2000, 1000)]);
    const res = applySlope(b.net, r.nodeIds[0], 1 / 100)!;
    const tip = Object.values(res.net.nodes).find((n) => n.pos.x === 2000 && n.pos.y === 1000)!;
    expect(tip.pos.z).toBeCloseTo(100 + 30, 6); // 2000 + 1000mm × 1/100
    expect(res.net.nodes[r.nodeIds[1]].pos.z).toBeCloseTo(140, 6);
  });

  it('横管の途中の点は流末にできない（V字になるため）。丸め誤差で「勾配不足」と判定しない', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0), v(2000, 0), v(4000, 0)], D50);
    expect(applySlope(r.net, r.nodeIds[1], 'auto')).toBeNull();
    const p = addPolyline(emptyNetwork(), [v(0, 0), v(1234, 0)], { system: 'drain', diameter: 100 });
    const res = applySlope(p.net, p.nodeIds[0], 1 / 100)!;
    const seg = res.net.segments[p.segmentIds[0]];
    expect(res.net.nodes[p.nodeIds[1]].pos.z).toBe(112.3); // 12.34 → 0.1mm に丸め
    expect(slopeEnough(res.net, seg, 1 / 100)).toBe(true);
  });

  it('ループでは高さを決めた区間だけに設計勾配を記録し、急な斜め管は立て管として扱う', () => {
    // O(0,0)→A(10000,0) と O→B(0,3000)→A の回り道（6m 未満ではないので O-A 直行が最短）
    let net = addPolyline(emptyNetwork(), [v(0, 0), v(3000, 0)], D50).net;
    const O = Object.values(net.nodes).find((n) => n.pos.x === 0)!.id;
    const res = applySlope(net, O, 1 / 50)!;
    expect(res.segments).toBe(1);
    // 急な斜め管（平面1000・高さ2000）は高さを変えない
    net = addPolyline(emptyNetwork(), [v(0, 0, 100), v(2000, 0, 100), v(3000, 0, 2100)], D50).net;
    const s0 = Object.values(net.nodes).find((n) => n.pos.x === 0)!.id;
    const r2 = applySlope(net, s0, 1 / 50)!;
    const top = Object.values(r2.net.nodes).find((n) => n.pos.x === 3000)!;
    expect(top.pos.z).toBe(2100);
  });

  it('給水など排水以外の配管・立て管は動かさない', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0), v(2000, 0), v(2000, 0, 2000)], D50); // 横管＋立て管
    const res = applySlope(r.net, r.nodeIds[0], 'auto')!;
    expect(res.net.nodes[r.nodeIds[1]].pos.z).toBe(140);
    expect(res.net.nodes[r.nodeIds[2]].pos.z).toBe(2000);
    const w = addPolyline(emptyNetwork(), [v(0, 0), v(2000, 0)], W);
    expect(applySlope(w.net, w.nodeIds[0], 'auto')).toBeNull();
  });
});
