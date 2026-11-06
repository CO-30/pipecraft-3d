/**
 * 積算の手計算テストケース（設計書 第14章「積算」）。
 * 期待値はすべてコメントの手計算と一致させている。
 */
import { describe, expect, it } from 'vitest';
import { addPolyline, branchFromSegment, emptyNetwork, type Network, type SegmentAttrs } from './network';
import { computeEstimate, defaultEstimate, fittingKey, pipeKey, type EstimateSettings } from './estimate';
import { analyzeFittings } from './fittings';
import { defaultSupportSettings } from './supports';
import { emptyBuilding } from './building';

const v = (x: number, y: number, z = 100) => ({ x, y, z });
const W20: SegmentAttrs = { system: 'water', diameter: 20, material: 'VP' };
const W13: SegmentAttrs = { system: 'water', diameter: 13, material: 'VP' };
const E: SegmentAttrs = { system: 'electric', diameter: 2, material: 'VVF' };

// 支持金具・ビスは supports.test.ts で検証するため、ここでは集計しない
const est = (net: Network, s: Partial<EstimateSettings> = {}) =>
  computeEstimate({ building: emptyBuilding(), network: net, fixtures: {}, estimate: { ...defaultEstimate(), supports: { ...defaultSupportSettings(), enabled: false }, ...s } });
const line = (net: Network, pts: ReturnType<typeof v>[], a = W20) => addPolyline(net, pts, a);
const fitCount = (e: ReturnType<typeof est>, type: string) => e.fittings.filter((f) => f.type === type).reduce((a, f) => a + f.count, 0);

describe('長さ・販売単位', () => {
  it('直線 3000mm: 定尺4m → 1本、施工 3.0m、部品なし', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(3000, 0)]);
    const e = est(net);
    expect(e.pipes).toHaveLength(1);
    expect(e.pipes[0]).toMatchObject({ usedLength: 3000, needLength: 3000, orderQty: 1, orderUnit: '本', laborQty: 3, fieldCount: 0, modelCount: 1 });
    expect(e.fittings).toEqual([]);
  });

  it('折れ曲がり 3000+2000: 90°エルボ1個、5000mm → 2本、継ぎ足しソケットなし（エルボで区切られる）', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(3000, 0), v(3000, 2000)]);
    const e = est(net);
    expect(e.pipes[0].usedLength).toBe(5000);
    expect(e.pipes[0].orderQty).toBe(2);
    expect(fitCount(e, 'elbow90')).toBe(1);
    expect(fitCount(e, 'socket')).toBe(0);
  });

  it('一直線 10000mm（途中に点あり）: 3本、継ぎ足しソケット 3−1=2個', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(4000, 0), v(10000, 0)]);
    const e = est(net);
    expect(e.pipes[0].orderQty).toBe(3);
    const sockets = e.fittings.find((f) => f.type === 'socket')!;
    expect(sockets.count).toBe(2);
    expect(sockets.stockJoints).toBe(2);
  });

  it('ちょうど定尺の倍数は切り上げない（8000mm → 2本）。誤差を含む実測合計でも 2本', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(8000, 0)]);
    expect(est(net).pipes[0].orderQty).toBe(2);
    const r = line(emptyNetwork(), [v(0, 0), v(2000, 0), v(4000, 0), v(6000, 0)]);
    const segs = { ...r.net.segments };
    for (const id of r.segmentIds) segs[id] = { ...segs[id], measuredLength: 8000 / 3 };
    const e = est({ ...r.net, segments: segs });
    expect(e.pipes[0].usedLength).toBeCloseTo(8000, 6);
    expect(e.pipes[0].orderQty).toBe(2);
  });

  it('複数階（立て管）: 2000 + 2900（縦）+ 1000 = 5900mm、90°エルボ2個、2本', () => {
    const { net } = line(emptyNetwork(), [v(0, 0, 100), v(2000, 0, 100), v(2000, 0, 3000), v(3000, 0, 3000)]);
    const e = est(net);
    expect(e.pipes[0].usedLength).toBe(5900);
    expect(e.pipes[0].orderQty).toBe(2);
    expect(fitCount(e, 'elbow90')).toBe(2);
  });

  it('電気配線: 1m単位、12345mm × 余長5% = 12962.25mm → 13m、施工 12.3m。曲がりに部品なし', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(10000, 0), v(10000, 2345)], E);
    const key = pipeKey(E);
    const e = est(net, { extraRate: 0.05, prices: { [key]: { material: 120, labor: 80 } } });
    const p = e.pipes[0];
    expect(p.needLength).toBeCloseTo(12962.25, 6);
    expect(p).toMatchObject({ orderQty: 13, orderUnit: 'm', laborQty: 12.3, materialAmount: 1560, laborAmount: 984 });
    expect(e.fittings).toEqual([]);
  });

  it('巻: 50m巻 で必要長 120000mm → 3巻', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(120000, 0)], E);
    const e = est(net, { prices: { [pipeKey(E)]: { material: 5000, labor: 0, saleUnit: { kind: 'roll', length: 50000 } } } });
    expect(e.pipes[0]).toMatchObject({ orderQty: 3, orderUnit: '巻', materialAmount: 15000 });
  });
});

describe('実測長・余長', () => {
  const withMeasured = (m: number, extra?: number) => {
    const r = line(emptyNetwork(), [v(0, 0), v(3000, 0)]);
    const id = r.segmentIds[0];
    return { net: { ...r.net, segments: { [id]: { ...r.net.segments[id], measuredLength: m, extraRate: extra } } }, id };
  };

  it('実測長があれば実測長を使い、方式は field。差 200mm（10%=300mm 未満）は警告しない', () => {
    const { net, id } = withMeasured(3200);
    const e = est(net);
    expect(e.measures[id]).toMatchObject({ method: 'field', usedLength: 3200, modelLength: 3000, diff: 200 });
    expect(e.measures[id].warning).toBeUndefined();
    expect(e.pipes[0]).toMatchObject({ usedLength: 3200, fieldCount: 1, laborQty: 3.2 });
    expect(e.issues.filter((i) => i.kind === 'lengthDiff')).toEqual([]);
  });

  it('差 500mm（> max(100, 300)）は警告', () => {
    const { net, id } = withMeasured(3500);
    const e = est(net);
    expect(e.measures[id].warning).toMatch(/500mm/);
    expect(e.issues.some((i) => i.kind === 'lengthDiff' && i.target.id === id)).toBe(true);
  });

  it('余長10%: 3700mm → 4070mm → 2本。区間ごとに余長0%に上書きすると 1本', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(3700, 0)]);
    const e = est(net, { extraRate: 0.1 });
    expect(e.pipes[0].needLength).toBeCloseTo(4070, 6);
    expect(e.pipes[0].orderQty).toBe(2);
    expect(e.pipes[0].laborQty).toBe(3.7); // 施工数量は余長を含まない
    const { net: n2 } = withMeasured(3700, 0);
    expect(est(n2, { extraRate: 0.1 }).pipes[0].orderQty).toBe(1);
  });
});

describe('継手', () => {
  it('分岐（直角・口径違い）: 径違いチーズ 20×13 が1個、材料行は φ20 4000mm と φ13 1500mm', () => {
    const r = line(emptyNetwork(), [v(0, 0), v(4000, 0)]);
    const b = branchFromSegment(r.net, r.segmentIds[0], v(2000, 0), [v(2000, 1500)], W13);
    const e = est(b.net);
    const tee = e.fittings.find((f) => f.type === 'tee')!;
    expect(tee).toMatchObject({ count: 1, size: '20×13', name: '径違いチーズ' });
    expect(e.pipes.map((p) => [p.diameter, p.usedLength])).toEqual([[13, 1500], [20, 4000]]);
    expect(fitCount(e, 'socket')).toBe(0); // チーズで区切られ 2000mm×2
  });

  it('枝が本管より太いチーズも「太い方×細い方」で同じ単価キー（レビュー指摘）', () => {
    const r = line(emptyNetwork(), [v(0, 0), v(4000, 0)], W13);
    const b = branchFromSegment(r.net, r.segmentIds[0], v(2000, 0), [v(2000, 1500)], W20);
    expect(est(b.net).fittings.find((f) => f.type === 'tee')!.size).toBe('20×13');
  });

  it('分岐点を「なし」に確定しても、定尺の継ぎ足しは枝ごとに数える（レビュー指摘）', () => {
    const r = line(emptyNetwork(), [v(0, 0), v(6000, 0)]);
    const b = branchFromSegment(r.net, r.segmentIds[0], v(3000, 0), [v(3000, 3000)]);
    const net = { ...b.net, nodes: { ...b.net.nodes, [b.teeId]: { ...b.net.nodes[b.teeId], fitting: { type: 'none', degree: 3 } } } };
    expect(fitCount(est(net), 'socket')).toBe(0); // 3000mm ×3本 → 継ぎ足しなし（まとめると 9000mm→2個と誤る）
  });

  it('45°の分岐は Y管', () => {
    const r = line(emptyNetwork(), [v(0, 0), v(4000, 0)]);
    const b = branchFromSegment(r.net, r.segmentIds[0], v(2000, 0), [v(3000, 1000)]);
    expect(fitCount(est(b.net), 'wye')).toBe(1);
  });

  it('一直線で口径が変わる点は径違いソケット', () => {
    const r = line(emptyNetwork(), [v(0, 0), v(2000, 0)]);
    const end = r.nodeIds[1];
    const r2 = addPolyline(r.net, [v(2000, 0), v(3000, 0)], W13, { startNodeId: end });
    const e = est(r2.net);
    expect(e.fittings.find((f) => f.type === 'reducer')).toMatchObject({ count: 1, size: '20×13' });
  });

  it('30°の曲がりは要確認。ユーザーが45°エルボに確定すると要確認が消える。接続が変わると確定は無効', () => {
    const r = line(emptyNetwork(), [v(0, 0), v(2000, 0), v(2000 + 1732, 1000)]);
    const mid = r.nodeIds[1];
    let e = est(r.net);
    expect(e.issues.some((i) => i.kind === 'confirmFitting' && i.target.id === mid)).toBe(true);
    const confirmed = { ...r.net, nodes: { ...r.net.nodes, [mid]: { ...r.net.nodes[mid], fitting: { type: 'elbow45', degree: 2 } } } };
    e = est(confirmed);
    expect(e.issues.some((i) => i.kind === 'confirmFitting')).toBe(false);
    expect(fitCount(e, 'elbow45')).toBe(1);
    // 同じ点から枝を追加（次数3）→ 確定は無効、要確認に戻る
    const seg = Object.values(confirmed.segments).find((s) => s.a === mid || s.b === mid)!;
    const grown = addPolyline(confirmed, [v(2000, 0), v(2000, -1500)], W20, { startNodeId: mid });
    void seg;
    const f = analyzeFittings(grown.net).find((x) => x.nodeId === mid)!;
    expect(f).toMatchObject({ stale: true, needsConfirm: true, confirmed: false });
  });

  it('「なし」も確定できる（ソケット不要の曲げ配管など）', () => {
    const r = line(emptyNetwork(), [v(0, 0), v(2000, 0), v(2000, 2000)]);
    const mid = r.nodeIds[1];
    const net = { ...r.net, nodes: { ...r.net.nodes, [mid]: { ...r.net.nodes[mid], fitting: { type: 'none', degree: 2 } } } };
    expect(est(net).fittings).toEqual([]);
  });

  it('電気配線の分岐はジョイントボックス', () => {
    const r = line(emptyNetwork(), [v(0, 0), v(4000, 0)], E);
    const b = branchFromSegment(r.net, r.segmentIds[0], v(2000, 0), [v(2000, 1500)], E);
    const e = est(b.net);
    expect(e.fittings.map((f) => [f.type, f.count])).toEqual([['junctionBox', 1]]);
  });

  it('器具の接続口は器具接続継手、バルブはバルブ', () => {
    const r = line(emptyNetwork(), [v(0, 0), v(2000, 0), v(4000, 0)]);
    const [n0, n1] = r.nodeIds;
    const net = { ...r.net, nodes: { ...r.net.nodes,
      [n0]: { ...r.net.nodes[n0], kind: 'fixture' as const, fixedKind: true, fixtureId: 'f1', portId: 'p' },
      [n1]: { ...r.net.nodes[n1], kind: 'valve' as const, fixedKind: true } } };
    const e = est(net);
    expect(fitCount(e, 'adapter')).toBe(1);
    expect(fitCount(e, 'valve')).toBe(1);
  });
});

describe('金額', () => {
  it('材料費・施工費・その他・諸経費10%・消費税（切り捨て）', () => {
    // 3000mm φ20: 材料 1本×1000 = 1000、施工 3.0m×500 = 1500、その他 333 → 2833
    // 諸経費 2833×10% = 283.3 → 283、小計 3116、税 floor(311.6) = 311、合計 3427
    const { net } = line(emptyNetwork(), [v(0, 0), v(3000, 0)]);
    const e = est(net, {
      prices: { [pipeKey(W20)]: { material: 1000, labor: 500 } },
      extras: [{ id: 'x', name: '水圧試験', quantity: 1, unit: '式', unitPrice: 333 }],
      overhead: { mode: 'rate', value: 0.1 },
    });
    expect([e.materialTotal, e.laborTotal, e.extrasTotal, e.overhead, e.subtotal, e.tax, e.total]).toEqual([1000, 1500, 333, 283, 3116, 311, 3427]);
    expect(e.lines.reduce((a, l) => a + l.amount, 0) + e.overhead).toBe(e.subtotal);
  });

  it('行ごとに円未満を四捨五入（1.5m × 333円 = 499.5 → 500）、諸経費を金額で指定', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(1500, 0)]);
    const e = est(net, { prices: { [pipeKey(W20)]: { material: 0, labor: 333 } }, overhead: { mode: 'amount', value: 1000 }, taxRate: 0.08 });
    expect(e.laborTotal).toBe(500);
    expect(e.overhead).toBe(1000);
    expect(e.tax).toBe(120); // 1500 × 8%
    expect(e.total).toBe(1620);
  });

  it('継手の単価（材料＋取付）が見積行に入る', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(3000, 0), v(3000, 2000)]);
    const k = fittingKey('elbow90', W20, '20');
    const e = est(net, { prices: { [k]: { material: 150, labor: 200 } } });
    expect(e.lines.filter((l) => l.priceKey === k).map((l) => [l.section, l.quantity, l.amount])).toEqual([['material', 1, 150], ['labor', 1, 200]]);
  });

  it('単価未登録の行は警告', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(3000, 0)]);
    expect(est(net).issues.filter((i) => i.kind === 'noPrice')).toHaveLength(1);
  });
});

describe('メーカー参考単価（初期値）', () => {
  const W: SegmentAttrs = { system: 'water', diameter: 20 };
  it('材質未指定の給水φ20 は HIVP の参考単価（2,010円/本・エルボ166円）、施工単価は未登録として警告', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(3000, 0), v(3000, 2000)], W);
    const e = est(net);
    expect(e.pipes[0]).toMatchObject({ material: 'HIVP', priceSource: 'catalog', orderQty: 2, materialAmount: 4020 });
    expect(e.fittings[0]).toMatchObject({ type: 'elbow90', priceSource: 'catalog', materialAmount: 166 });
    expect(e.materialTotal).toBe(4186);
    expect(e.issues.filter((i) => i.kind === 'noPrice').every((i) => /施工単価/.test(i.message))).toBe(true);
  });
  it('現場で入力した単価が優先。販売単位を変えると参考単価は使わない', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(3000, 0)], W);
    const k = pipeKey(W);
    expect(est(net, { prices: { [k]: { material: 1500, labor: 300 } } }).pipes[0]).toMatchObject({ priceSource: 'user', materialAmount: 1500 });
    expect(est(net, { prices: { [k]: { material: 0, labor: 0, saleUnit: { kind: 'perLength', step: 1000 } } } }).pipes[0].priceSource).toBe('user');
  });
  it('参考単価のない口径・配線・径違い継手は単価なし', () => {
    const { net } = line(emptyNetwork(), [v(0, 0), v(3000, 0)], { system: 'hotWater', diameter: 50 });
    expect(est(net).pipes[0].priceSource).toBe('none');
    const r = line(emptyNetwork(), [v(0, 0), v(4000, 0)], W);
    const b = branchFromSegment(r.net, r.segmentIds[0], v(2000, 0), [v(2000, 1500)], { system: 'water', diameter: 13 });
    expect(est(b.net).fittings.find((f) => f.type === 'tee')!.priceSource).toBe('none');
  });
});
