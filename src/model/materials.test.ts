import { describe, expect, it } from 'vitest';
import { createBuildingFromDims, emptyBuilding } from './building';
import { addPolyline, emptyNetwork, segmentLength, validateNetwork, type Network, type SegmentAttrs } from './network';
import { assignAutoMaterials, buildingOutline, drawingMaterial, isPB, materialFamily, TRANSITION_OUT } from './materials';
import { analyzeFittings, PB_BEND_REASON } from './fittings';
import { catalogFittingPrice, catalogPipePrice, pbRollLength } from './priceCatalog';
import { computeEstimate, defaultEstimate, defaultSaleUnit } from './estimate';
import { emptyDoc } from '../state/store';

const b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 120, slabThickness: 200 });
const draw = (pts: [number, number, number][], attrs: SegmentAttrs, net: Network = emptyNetwork()) =>
  addPolyline(net, pts.map(([x, y, z]) => ({ x, y, z })), attrs);
const mats = (net: Network) => Object.values(net.segments).map((s) => s.material);

describe('管種の自動（屋内 PB・屋外 HIVP/HTVP）', () => {
  it('建物の中（床下を含む）の給水は PB 保温5mm、給湯は PB 保温10mm', () => {
    const w = draw([[1000, 1000, -300], [3000, 1000, -300], [3000, 4000, -300]], { system: 'water', diameter: 13 });
    expect(mats(assignAutoMaterials(w.net, b, w.segmentIds))).toEqual(['PB保温5mm', 'PB保温5mm']);
    const h = draw([[1000, 1000, -300], [3000, 1000, -300]], { system: 'hotWater', diameter: 13 });
    expect(mats(assignAutoMaterials(h.net, b, h.segmentIds))).toEqual(['PB保温10mm']);
  });

  it('建物の外は HIVP（給湯は HTVP）', () => {
    const w = draw([[-2000, 1000, -300], [-1000, 1000, -300]], { system: 'water', diameter: 20 });
    expect(mats(assignAutoMaterials(w.net, b, w.segmentIds))).toEqual(['HIVP']);
    const h = draw([[-2000, 1000, -300], [-1000, 1000, -300]], { system: 'hotWater', diameter: 13 });
    expect(mats(assignAutoMaterials(h.net, b, h.segmentIds))).toEqual(['HTVP']);
  });

  it('外周をまたぐ配管は外壁の芯から外へ 300mm の所で分け、内を PB・外を HIVP にする（つなぎ目は HIVP変換継手）', () => {
    const w = draw([[2000, 1000, -300], [-2000, 1000, -300]], { system: 'water', diameter: 13 });
    const net = assignAutoMaterials(w.net, b, w.segmentIds);
    expect(validateNetwork(net)).toEqual([]);
    const segs = Object.values(net.segments);
    expect(segs).toHaveLength(2);
    const pb = segs.find((s) => isPB(s.material))!, hi = segs.find((s) => s.material === 'HIVP')!;
    expect(Math.round(segmentLength(net, pb.id))).toBe(2000 + TRANSITION_OUT);
    expect(Math.round(segmentLength(net, hi.id))).toBe(2000 - TRANSITION_OUT);
    const joint = analyzeFittings(net).find((f) => f.auto === 'hivpAdapter');
    expect(joint).toMatchObject({ size: '13×13', needsConfirm: false });
    expect(joint!.main.id).toBe(pb.id);
  });

  it('壁ぎわ（壁から 250mm）の端から外へ出る配管も、内側の端を含む方を PB にする', () => {
    const w = draw([[250, 1000, -300], [-2000, 1000, -300]], { system: 'water', diameter: 13 });
    const net = assignAutoMaterials(w.net, b, w.segmentIds);
    const pb = Object.values(net.segments).find((x) => isPB(x.material))!;
    expect(Math.round(segmentLength(net, pb.id))).toBe(250 + TRANSITION_OUT);
    expect(Object.values(net.segments).map((x) => x.material).sort()).toEqual(['HIVP', 'PB保温5mm']);
  });

  it('外がわずかなら分けない。管種を指定した配管・排水・建物の無い現場はそのまま', () => {
    const s = draw([[2000, 1000, -300], [-30, 1000, -300]], { system: 'water', diameter: 13 });
    const n1 = assignAutoMaterials(s.net, b, s.segmentIds);
    expect(mats(n1)).toEqual(['PB保温5mm']);
    const m = draw([[1000, 1000, -300], [3000, 1000, -300]], { system: 'water', diameter: 13, material: 'HIVP' });
    expect(mats(assignAutoMaterials(m.net, b, m.segmentIds))).toEqual(['HIVP']);
    const d = draw([[1000, 1000, -300], [3000, 1000, -300]], { system: 'drain', diameter: 50 });
    expect(mats(assignAutoMaterials(d.net, b, d.segmentIds))).toEqual([undefined]);
    const w = draw([[1000, 1000, -300], [3000, 1000, -300]], { system: 'water', diameter: 13 });
    expect(mats(assignAutoMaterials(w.net, emptyBuilding(), w.segmentIds))).toEqual([undefined]);
  });

  it('外壁が 1 周つながっていなくても、壁に囲まれた所は建物の中', () => {
    const open = { ...b, walls: Object.fromEntries(Object.entries(b.walls).map(([id, w], i) => [id, i === 0 ? { ...w, kind: 'interior' as const } : w])) };
    const ol = buildingOutline(open, open.floors[0].id)!;
    expect(ol.inside({ x: 4000, y: 3000 })).toBe(true);
    expect(ol.inside({ x: -500, y: 3000 })).toBe(false);
  });

  it('図面には PB とだけ書く。保温違いは同じ管の系列', () => {
    expect(drawingMaterial('PB保温10mm')).toBe('PB');
    expect(drawingMaterial('HIVP')).toBe('HIVP');
    expect(materialFamily('PB保温5mm')).toBe(materialFamily('PB'));
  });
});

describe('プッシュマスターの継手', () => {
  it('曲げに要る直線（接線長 = 曲げ半径 × tan(角度/2)）が両側に取れなければエルボ。短い区間の両端の曲げは足し合わせる', () => {
    // 13J（R170）: 90° は 170mm ずつ。間の区間 300mm に曲げが 2 つ（170 + 170 = 340 > 300）→ 片方は曲げ、片方はエルボ
    const z = draw([[0, 0, 0], [1000, 0, 0], [1000, 300, 0], [2000, 300, 0]], { system: 'water', diameter: 13, material: 'PB' });
    const fz = analyzeFittings(z.net);
    expect([fz.find((x) => x.nodeId === z.nodeIds[1])?.auto, fz.find((x) => x.nodeId === z.nodeIds[2])?.auto].sort()).toEqual(['elbow90', 'none']);
    // 間が 150mm なら 1 つ分（170）も取れないので両方エルボ
    const zz = draw([[0, 0, 0], [1000, 0, 0], [1000, 150, 0], [2000, 150, 0]], { system: 'water', diameter: 13, material: 'PB' });
    const fzz = analyzeFittings(zz.net);
    expect([fzz.find((x) => x.nodeId === zz.nodeIds[1])?.auto, fzz.find((x) => x.nodeId === zz.nodeIds[2])?.auto]).toEqual(['elbow90', 'elbow90']);
    // 間が 400mm なら両方曲げられる
    const w = draw([[0, 0, 0], [1000, 0, 0], [1000, 400, 0], [2000, 400, 0]], { system: 'water', diameter: 13, material: 'PB' });
    const fw = analyzeFittings(w.net);
    expect([fw.find((x) => x.nodeId === w.nodeIds[1])?.auto, fw.find((x) => x.nodeId === w.nodeIds[2])?.auto]).toEqual(['none', 'none']);
    // 45° は 170 × tan(22.5°) ≒ 70mm で足りる
    const d = draw([[0, 0, 0], [100, 0, 0], [180, 80, 0]], { system: 'water', diameter: 13, material: 'PB' });
    expect(analyzeFittings(d.net).find((x) => x.nodeId === d.nodeIds[1])?.auto).toBe('none');
  });

  it('PB の曲がりは曲げ配管（継手なし）、異径の曲がり・分岐は継手', () => {
    const r = draw([[0, 0, 0], [1000, 0, 0], [1000, 1000, 0]], { system: 'water', diameter: 13, material: 'PB保温5mm' });
    const f = analyzeFittings(r.net).find((x) => x.nodeId === r.nodeIds[1])!;
    expect(f).toMatchObject({ auto: 'none', needsConfirm: false });
    expect(f.reason).toContain(PB_BEND_REASON);
    // 角に 3 本目をつなぐとチーズ（PB でも分岐は継手）
    const tee = addPolyline(r.net, [{ x: 1000, y: 0, z: 0 }, { x: 1800, y: 0, z: 0 }], { system: 'water', diameter: 13, material: 'PB' }, { startNodeId: r.nodeIds[1] });
    expect(analyzeFittings(tee.net).find((x) => x.nodeId === r.nodeIds[1])).toMatchObject({ auto: 'tee' });
    // 口径の違う曲がりは異径エルボ
    const red = draw([[0, 0, 0], [1000, 0, 0]], { system: 'water', diameter: 20, material: 'PB' });
    const red2 = addPolyline(red.net, [{ x: 1000, y: 0, z: 0 }, { x: 1000, y: 900, z: 0 }], { system: 'water', diameter: 13, material: 'PB' }, { startNodeId: red.nodeIds[1] });
    expect(analyzeFittings(red2.net).find((x) => x.nodeId === red.nodeIds[1])).toMatchObject({ auto: 'elbow90', size: '20×13' });
    // 25J は最小曲げ半径 680mm: 直線が 1000mm あれば曲げ、600mm しかなければエルボ
    const big = draw([[0, 0, 0], [1000, 0, 0], [1000, 1000, 0]], { system: 'water', diameter: 25, material: 'PB' });
    expect(analyzeFittings(big.net).find((x) => x.nodeId === big.nodeIds[1])).toMatchObject({ auto: 'none' });
    const tight = draw([[0, 0, 0], [600, 0, 0], [600, 1000, 0]], { system: 'water', diameter: 25, material: 'PB' });
    expect(analyzeFittings(tight.net).find((x) => x.nodeId === tight.nodeIds[1])).toMatchObject({ auto: 'elbow90' });
  });

  it('PB の継手・管の参考価格（2024年10月改定カタログ）', () => {
    const pb = { system: 'water' as const, material: 'PB保温5mm' };
    expect(catalogFittingPrice('tee', pb, '13')).toBe(1790);
    expect(catalogFittingPrice('tee', pb, '20×13')).toBe(3840);
    expect(catalogFittingPrice('faucetElbow', pb, '13')).toBe(3070);
    expect(catalogFittingPrice('hivpAdapter', pb, '13×20')).toBe(2560);
    expect(catalogFittingPrice('elbow45', pb, '13')).toBeUndefined();
    // 保温5mm 13J は 30m 巻 810円/m、裸管 13J は 60m 巻 440円/m、25J 裸管は 30m 巻
    expect(defaultSaleUnit({ ...pb, diameter: 13 })).toEqual({ kind: 'roll', length: 30000 });
    expect(catalogPipePrice({ ...pb, diameter: 13 }, { kind: 'roll', length: 30000 })).toBe(24300);
    expect(catalogPipePrice({ ...pb, diameter: 13 }, { kind: 'perLength', step: 1000 })).toBe(810);
    expect(pbRollLength('PB', 13)).toBe(60000);
    expect(pbRollLength('PB', 25)).toBe(30000);
    expect(catalogPipePrice({ system: 'water', material: 'PB', diameter: 13 }, { kind: 'roll', length: 60000 })).toBe(26400);
    expect(catalogPipePrice({ system: 'water', material: 'PB', diameter: 13 }, { kind: 'straight', length: 3000 })).toBe(1170);
    // 塩ビは従来どおり定尺 4m のときだけ
    expect(catalogPipePrice({ system: 'water', material: 'HIVP', diameter: 13 })).toBe(1220);
    expect(catalogPipePrice({ system: 'water', material: 'HIVP', diameter: 13 }, { kind: 'roll', length: 30000 })).toBeUndefined();
  });

  it('見積: PB は巻で数え、つなぎ目の HIVP変換継手を数える。保温違いの継手は 1 行', () => {
    const w = draw([[2000, 1000, -300], [-2000, 1000, -300]], { system: 'water', diameter: 13 });
    const net = assignAutoMaterials(w.net, b, w.segmentIds);
    const est = computeEstimate({ ...emptyDoc(), building: b, network: net, estimate: defaultEstimate() });
    const pbLine = est.pipes.find((p) => isPB(p.material))!;
    expect(pbLine).toMatchObject({ orderQty: 1, orderUnit: '巻', priceSource: 'catalog' });
    expect(pbLine.price?.material).toBe(24300);
    const adapter = est.fittings.find((f) => f.type === 'hivpAdapter')!;
    expect(adapter).toMatchObject({ count: 1, material: 'PB', size: '13×13', priceSource: 'catalog' });
    expect(adapter.price?.material).toBe(2500);
  });
});
