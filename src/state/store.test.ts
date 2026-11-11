import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDoc, findUpstreamBranchPoint, isUnderFloor, useStore } from './store';
import { totalLength, validateNetwork } from '../model/network';
import { createBuildingFromDims, validateBuilding, wallsOnFloor } from '../model/building';
import { validateFixtures } from '../model/fixtures';
import { emptyNetwork } from '../model/network';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const s = () => useStore.getState();
const net = () => s().doc.network;
const bld = () => s().doc.building;

beforeEach(() => s().newDoc(emptyDoc(), { id: 'p', name: 'テスト', createdAt: 1 }));

describe('共通ストア: 配管', () => {
  it('描画→分岐→Undo→Redo', () => {
    s().drawPolyline([v(0, 0), v(4000, 0)]);
    const seg = Object.keys(net().segments)[0];
    s().branch(seg, v(2000, 0), [v(2000, 1000)]);
    expect(totalLength(net())).toBe(5000);
    s().undo();
    expect(totalLength(net())).toBe(4000);
    s().redo();
    expect(totalLength(net())).toBe(5000);
    expect(validateNetwork(net())).toEqual([]);
  });

  it('ドラッグ移動は確定時に履歴1件だけ', () => {
    s().drawPolyline([v(0, 0), v(4000, 0)]);
    const node = Object.keys(net().nodes)[0];
    const before = s().past.length;
    s().beginDrag();
    for (let i = 1; i <= 20; i++) s().dragNode(node, v(-i * 10, 0));
    s().endDrag();
    expect(s().past.length).toBe(before + 1);
    s().undo();
    expect(net().nodes[node].pos.x).toBe(0);
  });

  it('枝管を選んで分岐単位削除すると本管だけ残る', () => {
    s().drawPolyline([v(0, 0), v(4000, 0)]);
    const seg = Object.keys(net().segments)[0];
    s().branch(seg, v(2000, 0), [v(2000, 1000), v(3000, 1000)]);
    s().deleteSelectedBranch();
    expect(totalLength(net())).toBe(4000);
    expect(validateNetwork(net())).toEqual([]);
  });

  it('区間の属性（種類・口径）変更', () => {
    s().drawPolyline([v(0, 0), v(4000, 0)]);
    const seg = Object.keys(net().segments)[0];
    s().updateSegment(seg, { system: 'hotWater', diameter: 25 });
    expect(net().segments[seg]).toMatchObject({ system: 'hotWater', diameter: 25 });
    s().updateSegment(seg, { diameter: 0 });
    expect(net().segments[seg].diameter).toBe(25);
  });
});

describe('枝管ごと削除の対象', () => {
  it('両側に分岐点がある本管区間は曖昧なので対象なし(null)', () => {
    s().drawPolyline([v(0, 0), v(6000, 0)]);
    let seg = Object.keys(net().segments)[0];
    s().branch(seg, v(2000, 0), [v(2000, 1000)]);
    seg = Object.values(net().segments).find((x) => net().nodes[x.b].pos.x === 6000 || net().nodes[x.a].pos.x === 6000)!.id;
    s().branch(seg, v(4000, 0), [v(4000, 1000)]);
    const mid = Object.values(net().segments).find((x) => {
      const xs = [net().nodes[x.a].pos.x, net().nodes[x.b].pos.x].sort((a, b) => a - b);
      return xs[0] === 2000 && xs[1] === 4000;
    })!;
    expect(findUpstreamBranchPoint(net(), mid.id)).toBeNull();
  });
  it('存在しない区間IDでも例外を出さない', () => {
    expect(findUpstreamBranchPoint(net(), 'nope')).toBeNull();
  });
});

describe('共通ストア: 建物', () => {
  beforeEach(() => s().newDoc({ building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), network: emptyNetwork(), fixtures: {} }, { id: 'p', name: 'テスト', createdAt: 1 }));

  it('壁追加・ドア追加・Undo/Redo が配管と同じ履歴で動く', () => {
    s().addWall({ x: 3000, y: 0 }, { x: 3000, y: 6000 });
    const w = s().selection!.id;
    s().addOpening(w, 'door', 1000);
    s().drawPolyline([v(500, 500), v(2500, 500)]);
    expect(Object.keys(bld().openings)).toHaveLength(1);
    s().undo(); // 配管
    s().undo(); // ドア
    expect(Object.keys(bld().openings)).toHaveLength(0);
    expect(Object.keys(net().segments)).toHaveLength(0);
    s().redo();
    expect(Object.keys(bld().openings)).toHaveLength(1);
    expect(validateBuilding(bld())).toEqual([]);
  });

  it('壁ドラッグは開始時の位置を基準に移動し、履歴1件', () => {
    s().addWall({ x: 3000, y: 0 }, { x: 3000, y: 6000 });
    const w = s().selection!.id;
    const before = s().past.length;
    s().beginDrag();
    for (let i = 1; i <= 10; i++) s().dragWall(w, i * 50, 0);
    s().endDrag();
    expect(bld().corners[bld().walls[w].a].x).toBe(3500);
    expect(s().past.length).toBe(before + 1);
  });

  it('階の追加（外壁コピー）と削除、削除後は残る階がアクティブ', () => {
    s().addFloor(true);
    expect(bld().floors).toHaveLength(2);
    expect(wallsOnFloor(bld(), s().activeFloorId)).toHaveLength(4);
    s().deleteFloor(s().activeFloorId);
    expect(bld().floors).toHaveLength(1);
    expect(s().activeFloorId).toBe(bld().floors[0].id);
  });

  it('要素ごとの非表示・半透明', () => {
    const w = Object.keys(bld().walls)[0];
    s().setElementVisibility(w, 'hide');
    expect(s().hiddenIds).toEqual([w]);
    s().setElementVisibility(w, 'ghost');
    expect(s().hiddenIds).toEqual([]);
    expect(s().ghostIds).toEqual([w]);
    s().resetElementVisibility();
    expect(s().ghostIds).toEqual([]);
  });

  it('toProjectData はメタ情報と現在のDocを返す', () => {
    const p = s().toProjectData()!;
    expect(p.name).toBe('テスト');
    expect(p.building).toBe(bld());
  });
});

describe('共通ストア: 部屋の結合・分割（Phase 2）', () => {
  const load = () => s().newDoc({ building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), network: emptyNetwork(), fixtures: {} }, { id: 'p', name: 'x', createdAt: 1 });

  it('壁つきで分割 → 部屋2つ＋内壁1本、Undo 1回で元に戻る', () => {
    load();
    const room = Object.keys(bld().rooms)[0];
    const walls0 = Object.keys(bld().walls).length;
    const past0 = s().past.length;
    s().splitRoomAt(room, { x: 4000, y: 100 }, { x: 4000, y: 5900 }, true);
    expect(Object.keys(bld().rooms)).toHaveLength(2);
    expect(wallsOnFloor(bld(), bld().floors[0].id).filter((w) => w.kind === 'interior')).toHaveLength(1);
    expect(Object.keys(bld().walls).length).toBeGreaterThan(walls0);
    expect(s().past.length).toBe(past0 + 1);
    expect(validateBuilding(bld())).toEqual([]);
    s().undo();
    expect(Object.keys(bld().rooms)).toEqual([room]);
    expect(Object.keys(bld().walls).length).toBe(walls0);
  });

  it('壁なしで分割、部屋に掛からない線は履歴を増やさない', () => {
    load();
    const room = Object.keys(bld().rooms)[0];
    const past0 = s().past.length;
    s().splitRoomAt(room, { x: 0, y: 9000 }, { x: 100, y: 9000 }, false);
    expect(s().past.length).toBe(past0);
    s().splitRoomAt(room, { x: 0, y: 3000 }, { x: 100, y: 3000 }, false);
    expect(Object.keys(bld().rooms)).toHaveLength(2);
    expect(Object.keys(bld().walls)).toHaveLength(4);
  });

  it('結合モード: 選択中の部屋 + 次にタップした部屋 → 1部屋、選択も移る', () => {
    load();
    const room = Object.keys(bld().rooms)[0];
    s().splitRoomAt(room, { x: 0, y: 3000 }, { x: 100, y: 3000 }, false);
    const [a, b] = Object.keys(bld().rooms);
    s().select({ kind: 'room', id: a });
    s().startMerge();
    expect(s().pendingMerge).toBe(a);
    s().mergeRoomWith(b);
    const ids = Object.keys(bld().rooms);
    expect(ids).toHaveLength(1);
    expect(s().selection).toEqual({ kind: 'room', id: ids[0] });
    expect(s().pendingMerge).toBeNull();
  });
});

describe('共通ストア: レビュー対応（Phase 2）', () => {
  it('Undo でドラッグが打ち切られた後の移動は無視され、壁が飛ばない', () => {
    s().newDoc({ building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), network: emptyNetwork(), fixtures: {} }, { id: 'p', name: 'x', createdAt: 1 });
    const w = Object.values(bld().walls)[0];
    s().beginDrag();
    s().dragWall(w.id, 500, 0);
    s().undo(); // ドラッグを確定・終了
    const after = bld();
    s().dragWall(w.id, 1000, 0);
    expect(bld()).toBe(after);
  });

  it('Undo・階の切り替えで結合モードが解除される', () => {
    s().newDoc({ building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), network: emptyNetwork(), fixtures: {} }, { id: 'p', name: 'x', createdAt: 1 });
    const room = Object.values(bld().rooms)[0];
    s().select({ kind: 'room', id: room.id });
    s().startMerge();
    s().setActiveFloor(bld().floors[1].id);
    expect(s().pendingMerge).toBeNull();
    s().select({ kind: 'room', id: room.id });
    s().startMerge();
    s().renameRoom(room.id, '別名');
    s().startMerge();
    s().undo();
    expect(s().pendingMerge).toBeNull();
  });
});

describe('Phase 3: 配管の編集操作（ストア）', () => {
  const twoFloors = () => s().newDoc({ building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 3000, wallThickness: 150, slabThickness: 200 }), network: emptyNetwork(), fixtures: {} }, { id: 'p', name: 'x', createdAt: 1 });
  const segIds = () => Object.keys(net().segments);

  it('cut then undo restores identical network', () => {
    s().drawPolyline([v(0, 0, 100), v(3000, 0, 100)]);
    const before = structuredClone(net());
    const sid = segIds()[0];
    s().select({ kind: 'segment', id: sid, at: v(1000, 0, 100) });
    s().cutSelected();
    expect(segIds()).toHaveLength(2);
    expect(validateNetwork(net())).toEqual([]);
    s().undo();
    expect(net()).toEqual(before);
  });

  it('端点をドラッグして別の配管の端に落とすと結合、履歴は1件', () => {
    s().drawPolyline([v(0, 0, 100), v(1000, 0, 100)]);
    s().drawPolyline([v(1000, 500, 100), v(1000, 2000, 100)]);
    const ends = Object.values(net().nodes);
    const target = ends.find((n) => n.pos.x === 1000 && n.pos.y === 0)!;
    const src = ends.find((n) => n.pos.x === 1000 && n.pos.y === 500)!;
    const h = s().past.length;
    s().beginDrag();
    s().dragNode(src.id, v(1000, 20, 100));
    s().dropNode(src.id, { type: 'node', id: target.id });
    s().endDrag();
    expect(s().past.length).toBe(h + 1);
    expect(Object.keys(net().nodes)).toHaveLength(3);
    expect(net().nodes[target.id].kind).toBe('elbow');
  });

  it('終点を既存区間の途中に描くとチーズでつながる', () => {
    s().drawPolyline([v(0, 0, 100), v(4000, 0, 100)]);
    const main = segIds()[0];
    s().drawPolyline([v(2000, 2000, 100), v(2000, 0, 100)], { endSegId: main });
    expect(Object.values(net().nodes).filter((n) => n.kind === 'tee')).toHaveLength(1);
    expect(validateNetwork(net())).toEqual([]);
  });

  it('立て管「上の階へ」= 上の階の床高 + 描画高さ、上の階へ切り替わる。最上階では何もしない', () => {
    twoFloors();
    const [f1, f2] = bld().floors;
    s().drawPolyline([v(0, 0, 100), v(2000, 0, 100)]);
    const end = Object.values(net().nodes).find((n) => n.pos.x === 2000)!;
    expect(end.floorId).toBe(f1.id);
    s().addRiserFromNode(end.id, 'up');
    const top = net().nodes[(s().selection as { id: string }).id];
    expect(top.pos).toEqual({ x: 2000, y: 0, z: f2.elevation + s().drawHeight });
    expect(top.floorId).toBe(f2.id);
    expect(s().activeFloorId).toBe(f2.id);
    const n = segIds().length;
    s().addRiserFromNode(top.id, 'up');
    expect(segIds()).toHaveLength(n);
  });

  it('1F の階高を変えると立て管の上端と 2F の配管が追従', () => {
    twoFloors();
    const [f1] = bld().floors;
    s().drawPolyline([v(0, 0, 100), v(2000, 0, 100)]);
    const end = Object.values(net().nodes).find((n) => n.pos.x === 2000)!;
    s().addRiserFromNode(end.id, 'up');
    const topId = (s().selection as { id: string }).id;
    const z0 = net().nodes[topId].pos.z;
    s().updateFloor(f1.id, { height: 3500 });
    expect(net().nodes[topId].pos.z).toBe(z0 + 500);
    expect(net().nodes[end.id].pos.z).toBe(100);
    expect(validateNetwork(net())).toEqual([]);
  });

  it('配管全体の複製・高さ変更・削除', () => {
    s().drawPolyline([v(0, 0, 100), v(2000, 0, 100), v(2000, 2000, 100)]);
    const sid = segIds()[0];
    s().duplicateRun(sid);
    expect(segIds()).toHaveLength(4);
    s().setRunHeightDelta(sid, 200);
    expect(Object.values(net().nodes).filter((n) => n.pos.z === 300)).toHaveLength(3);
    s().deleteRun(sid);
    expect(segIds()).toHaveLength(2);
    expect(validateNetwork(net())).toEqual([]);
  });

  it('器具を置いて接続口から配管、回転すると配管の端が追従、削除しても配管は残る', () => {
    s().placeFixtureAt({ x: 1000, y: 1000 });
    const fid = (s().selection as { id: string }).id;
    const water = Object.values(net().nodes).find((n) => n.fixtureId === fid && n.portId === 'water')!;
    s().drawPolyline([water.pos, v(3000, water.pos.y, water.pos.z)], { startNodeId: water.id });
    s().rotateFixture(fid);
    expect(s().doc.fixtures[fid].rotation).toBe(90);
    expect(net().nodes[water.id].pos).toEqual({ x: 700, y: 1150, z: 150 });
    s().select({ kind: 'fixture', id: fid });
    s().deleteSelected();
    expect(s().doc.fixtures[fid]).toBeUndefined();
    expect(segIds()).toHaveLength(1);
    expect(validateNetwork(net())).toEqual([]);
  });

  it('接続口ノードは単独でドラッグできない', () => {
    s().placeFixtureAt({ x: 1000, y: 1000 });
    const fid = (s().selection as { id: string }).id;
    const p = Object.values(net().nodes).find((n) => n.fixtureId === fid)!;
    s().beginDrag();
    s().dragNode(p.id, v(5000, 5000, 0));
    s().endDrag();
    expect(net().nodes[p.id].pos).toEqual(p.pos);
  });

  it('部品削除: エルボを消すと直線、長さ変更', () => {
    s().drawPolyline([v(0, 0, 100), v(3000, 0, 100), v(3000, 4000, 100)]);
    const elbow = Object.values(net().nodes).find((n) => n.kind === 'elbow')!;
    s().select({ kind: 'node', id: elbow.id });
    s().deleteSelectedFitting();
    expect(totalLength(net())).toBe(5000);
    const sid = segIds()[0];
    s().setSegmentLength(sid, 2500);
    expect(totalLength(net())).toBeCloseTo(2500, 6);
  });
});

describe('Phase 3 レビュー対応', () => {
  it('配管全体の高さを上の階まで上げると所属階が付け直され、階高変更に正しく追従', () => {
    s().newDoc({ building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 3000, wallThickness: 150, slabThickness: 200 }), network: emptyNetwork(), fixtures: {} }, { id: 'p', name: 'x', createdAt: 1 });
    const [f1, f2] = bld().floors;
    s().drawPolyline([v(0, 0, 100), v(2000, 0, 100)]);
    const sid = Object.keys(net().segments)[0];
    s().setRunHeightDelta(sid, 3000);
    expect(Object.values(net().nodes).every((n) => n.floorId === f2.id)).toBe(true);
    s().updateFloor(f1.id, { height: 3500 });
    expect(Object.values(net().nodes).every((n) => n.pos.z === 3600)).toBe(true);
  });
  it('cancelDrag はドラッグ開始前に戻し、履歴を増やさない', () => {
    s().drawPolyline([v(0, 0, 100), v(2000, 0, 100)]);
    const before = net();
    const h = s().past.length;
    const id = Object.keys(net().nodes)[0];
    s().beginDrag();
    s().dragNode(id, v(500, 500, 100));
    s().cancelDrag();
    expect(net()).toBe(before);
    expect(s().past.length).toBe(h);
    expect(s().dragBase).toBeNull();
  });
});

describe('共通ストア: 積算', () => {
  it('実測長の入力・削除、余長の上書きは履歴1件ずつで Undo できる', () => {
    s().drawPolyline([v(0, 0), v(3000, 0)]);
    const id = Object.keys(net().segments)[0];
    const h = s().past.length;
    s().setSegmentMeasured(id, 3150);
    expect(net().segments[id].measuredLength).toBe(3150);
    s().setSegmentMeasured(id, 3150); // 変化なしは履歴を増やさない
    expect(s().past.length).toBe(h + 1);
    s().setSegmentExtraRate(id, 0.1);
    expect(net().segments[id].extraRate).toBe(0.1);
    s().setSegmentMeasured(id, undefined);
    expect(net().segments[id].measuredLength).toBeUndefined();
    s().undo();
    expect(net().segments[id].measuredLength).toBe(3150);
    s().setSegmentMeasured(id, -5); // 不正値は無視
    expect(net().segments[id].measuredLength).toBe(3150);
  });

  it('保存形式の範囲外の積算設定・単価・実測長0は受け付けない（保存失敗を防ぐ）', () => {
    s().drawPolyline([v(0, 0), v(3000, 0)]);
    const id = Object.keys(net().segments)[0];
    const h = s().past.length;
    s().updateEstimate({ extraRate: 15 });
    s().updateEstimate({ taxRate: 1.5 });
    s().setPrice('k', { material: -1, labor: 0 });
    s().setPrice('k', { material: Number.NaN, labor: 0 });
    s().setSegmentMeasured(id, 0);
    expect(s().past.length).toBe(h);
    expect(s().toProjectData()!.estimate.extraRate).toBe(0);
  });

  it('部品の確定は接続数と一緒に保存し、undefined で自動に戻る', () => {
    s().drawPolyline([v(0, 0), v(2000, 0), v(2000, 2000)]);
    const mid = Object.values(net().nodes).find((n) => n.kind === 'elbow')!.id;
    s().setNodeFitting(mid, 'none');
    expect(net().nodes[mid].fitting).toEqual({ type: 'none', degree: 2 });
    s().setNodeFitting(mid, undefined);
    expect(net().nodes[mid].fitting).toBeUndefined();
  });

  it('単価・積算設定・その他項目は Doc に入り Undo/Redo・保存の対象', () => {
    s().setPrice('pipe|water||20', { material: 1000, labor: 500 });
    s().updateEstimate({ taxRate: 0.08, client: '○○様' });
    s().addExtraItem();
    const x = s().doc.estimate!.extras[0];
    s().updateExtraItem(x.id, { name: '水圧試験', unitPrice: 5000 });
    expect(s().doc.estimate).toMatchObject({ taxRate: 0.08, client: '○○様', prices: { 'pipe|water||20': { material: 1000 } } });
    expect(s().toProjectData()!.estimate.extras[0]).toMatchObject({ name: '水圧試験', unitPrice: 5000 });
    s().undo();
    expect(s().doc.estimate!.extras[0].name).toBe('その他');
    s().removeExtraItem(x.id);
    expect(s().doc.estimate!.extras).toEqual([]);
    s().setPrice('pipe|water||20', undefined);
    expect(s().doc.estimate!.prices).toEqual({});
  });
});

describe('共通ストア: 種類の違う配管はつながない', () => {
  const sys = (id: string) => net().segments[id].system;
  const nodeAt = (x: number, y: number) => Object.values(net().nodes).find((n) => n.pos.x === x && n.pos.y === y)!.id;
  it('給水の端から排水で描くと、給水として続ける（お知らせあり）', () => {
    s().setDrawAttrs({ system: 'water', diameter: 20 });
    s().drawPolyline([v(0, 0), v(2000, 0)]);
    const end = nodeAt(2000, 0);
    s().setDrawAttrs({ system: 'drain', diameter: 50 });
    s().drawPolyline([v(2000, 0), v(2000, 2000)], { startNodeId: end });
    expect(Object.values(net().segments).every((x) => x.system === 'water')).toBe(true);
    expect(s().notice).toMatch(/排水は給水につなげない/);
  });
  it('排水の線を給水の配管の上で終えても接続しない（分岐を作らない）', () => {
    s().setDrawAttrs({ system: 'water', diameter: 20 });
    s().drawPolyline([v(0, 0), v(4000, 0)]);
    const water = Object.keys(net().segments)[0];
    s().setDrawAttrs({ system: 'drain', diameter: 50 });
    s().drawPolyline([v(2000, 2000), v(2000, 0)], { endSegId: water });
    expect(Object.values(net().nodes).some((n) => n.kind === 'tee')).toBe(false);
    expect(sys(water)).toBe('water');
    expect(s().notice).toMatch(/給水.*つなげません|排水と給水の配管はつなげません/);
    expect(validateNetwork(net())).toEqual([]);
  });
  it('排水の端点を給水の端点・区間へドラッグしても結合しない。汚水・通気は排水とつながる', () => {
    s().setDrawAttrs({ system: 'water', diameter: 20 });
    s().drawPolyline([v(0, 0), v(4000, 0)]);
    const water = Object.keys(net().segments)[0];
    s().setDrawAttrs({ system: 'drain', diameter: 50 });
    s().drawPolyline([v(0, 3000), v(0, 1000)]);
    const drainEnd = nodeAt(0, 1000);
    s().beginDrag();
    s().dragNode(drainEnd, v(2000, 0));
    s().dropNode(drainEnd, { type: 'segment', id: water });
    s().endDrag();
    expect(Object.values(net().nodes).some((n) => n.kind === 'tee')).toBe(false);
    expect(s().notice).toMatch(/つなげません/);
    // 汚水 → 排水 はつながる
    s().setDrawAttrs({ system: 'sewage', diameter: 75 });
    const drainSeg = Object.values(net().segments).find((x) => x.system === 'drain')!.id;
    s().drawPolyline([v(-2000, 2000), v(0, 2000)], { endSegId: drainSeg });
    expect(Object.values(net().nodes).some((n) => n.kind === 'tee')).toBe(true);
  });
  it('器具の接続口: 給水口に排水はつながらず、口から描くと口の種類・口径で描く。立て管も元の種類', () => {
    s().setTool('fixture');
    s().placeFixtureAt({ x: 0, y: 0 });
    const ports = Object.values(net().nodes).filter((n) => n.fixtureId);
    const waterPort = ports.find((n) => n.portId === 'water')!;
    s().setDrawAttrs({ system: 'drain', diameter: 50 });
    s().drawPolyline([v(3000, 3000), { ...waterPort.pos }], { endNodeId: waterPort.id });
    expect(Object.values(net().segments).some((x) => x.a === waterPort.id || x.b === waterPort.id)).toBe(false);
    s().drawPolyline([{ ...waterPort.pos }, { ...waterPort.pos, x: waterPort.pos.x + 1000 }], { startNodeId: waterPort.id });
    const fromPort = Object.values(net().segments).find((x) => x.a === waterPort.id || x.b === waterPort.id)!;
    expect(fromPort).toMatchObject({ system: 'water', diameter: 13 });
    s().addRiserFromNode(waterPort.id, waterPort.pos.z + 1000);
    expect(Object.values(net().segments).filter((x) => x.system === 'drain')).toHaveLength(1);
  });

  it('分岐は元の配管の種類で作り、違う種類の配管には終点をつながない', () => {
    s().setDrawAttrs({ system: 'water', diameter: 20 });
    s().drawPolyline([v(0, 0), v(4000, 0)]);
    const water = Object.keys(net().segments)[0];
    s().setDrawAttrs({ system: 'drain', diameter: 50 });
    s().drawPolyline([v(0, 2000), v(4000, 2000)]);
    const drain = Object.values(net().segments).find((x) => x.system === 'drain')!.id;
    s().branch(water, v(2000, 0), [v(2000, 2000)], { endSegId: drain });
    expect(Object.values(net().nodes).filter((n) => n.kind === 'tee')).toHaveLength(1); // 給水側の分岐だけ
    expect(Object.values(net().segments).filter((x) => x.system === 'water')).toHaveLength(3);
  });
});

describe('共通ストア: 下敷き・写真の開口部', () => {
  const U = (src: string) => ({ floorId: s().activeFloorId, kind: 'image' as const, label: 'x', src, widthPx: 10, heightPx: 10, center: v(0, 0), mmPerPx: 10, rotation: 0, opacity: 0.5, scaled: false });
  it('大きすぎる画像・合計の上限を超える下敷きは追加せず、お知らせを出す（保存失敗を防ぐ）', () => {
    expect(s().addUnderlay(U('data:image/jpeg;base64,' + 'A'.repeat(4_100_000)))).toBe('');
    expect(s().notice).toMatch(/大きすぎ/);
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(2_900_000);
    for (let i = 0; i < 4; i++) expect(s().addUnderlay(U(big))).not.toBe('');
    expect(s().addUnderlay(U(big))).toBe('');
    expect(s().notice).toMatch(/多すぎ/);
    expect(Object.keys(s().doc.underlays!)).toHaveLength(4);
  });
  it('写真から作る開口部: 作れなかったものの番号を返し、作れたものだけ履歴1件で追加', () => {
    s().addWall(v(0, 0), v(5000, 0));
    const wid = Object.keys(s().doc.building.walls)[0];
    const h = s().past.length;
    const r = s().addOpeningsBatch(wid, [
      { type: 'window', offset: 1000, width: 800, height: 900, sill: 900 },
      { type: 'window', offset: 1200, width: 800, height: 900, sill: 900 }, // 重なる
      { type: 'door', offset: 3500, width: 800, height: 2000, sill: 0 },
    ]);
    expect(r).toEqual({ added: 2, failed: 1, failedIdx: [1] });
    expect(s().past.length).toBe(h + 1);
  });
});

describe('表示のプリセット', () => {
  it('配管だけ: 配管は表示、建物と器具は半透明、天井は非表示', () => {
    s().setVisibilityPreset('pipes');
    const v = s().visibility;
    expect(v.pipes).toBe('show');
    expect(v.fixtures).toBe('ghost');
    expect(v.exteriorWall).toBe('ghost');
    expect(v.floor).toBe('ghost');
    expect(v.ceiling).toBe('hide');
  });
  it('設備だけ・建物だけ・すべて', () => {
    s().setVisibilityPreset('fixtures');
    expect(s().visibility.fixtures).toBe('show');
    expect(s().visibility.pipes).toBe('ghost');
    s().setVisibilityPreset('building');
    expect(s().visibility.exteriorWall).toBe('show');
    expect(s().visibility.pipes).toBe('hide');
    expect(s().visibility.fixtures).toBe('hide');
    s().setVisibilityPreset('all');
    expect(Object.entries(s().visibility).filter(([k, m]) => k !== 'ceiling' && m !== 'show')).toEqual([]);
    expect(s().visibility.ceiling).toBe('hide');
  });
});

describe('器具の接続口へつなぐ', () => {
  it('1階のメーター出口から屋上タンク入口へ1回でつながり、Undo で戻る', () => {
    s().addFloor(false);
    const [f1, f2] = bld().floors;
    s().setActiveFloor(f1.id); s().setFixtureType('waterMeter'); s().placeFixtureAt({ x: -1000, y: 3000 });
    s().setActiveFloor(f2.id); s().setFixtureType('roofTank'); s().placeFixtureAt({ x: 4000, y: 3500 });
    const port = (t: string, p: string) => {
      const f = Object.values(s().doc.fixtures).find((x) => x.type === t)!;
      return Object.values(net().nodes).find((n) => n.fixtureId === f.id && n.portId === p)!;
    };
    const from = port('waterMeter', 'out').id, to = port('roofTank', 'in').id;
    const tank = Object.values(s().doc.fixtures).find((x) => x.type === 'roofTank')!.id;
    s().select({ kind: 'fixture', id: tank });
    s().connectToPort(to, from);
    expect(s().selection).toEqual({ kind: 'fixture', id: tank });
    const n = net();
    expect(Object.values(n.segments).some((g) => g.a === from || g.b === from)).toBe(true);
    expect(Object.values(n.segments).some((g) => g.a === to || g.b === to)).toBe(true);
    expect(Object.values(n.segments).every((g) => g.system === 'water' && g.diameter === 20)).toBe(true);
    expect(validateNetwork(n)).toEqual([]);
    s().undo();
    expect(Object.keys(net().segments)).toHaveLength(0);
  });
});

describe('器具の接続口へつなぐ（お知らせ）', () => {
  it('排水をつないだら勾配の設定を案内する', () => {
    s().setFixtureType('washbasin'); s().placeFixtureAt({ x: 1000, y: 1000 });
    s().setFixtureType('washer'); s().placeFixtureAt({ x: 4000, y: 1000 });
    const port = (t: string, p: string) => {
      const f = Object.values(s().doc.fixtures).find((x) => x.type === t)!;
      return Object.values(net().nodes).find((n) => n.fixtureId === f.id && n.portId === p)!.id;
    };
    s().connectToPort(port('washbasin', 'drain'), port('washer', 'drain'));
    expect(Object.keys(net().segments).length).toBeGreaterThan(0);
    expect(s().notice).toContain('勾配');
  });
  it('つなげない相手なら何もせず理由を知らせる', () => {
    s().setFixtureType('washbasin'); s().placeFixtureAt({ x: 1000, y: 1000 });
    const f = Object.values(s().doc.fixtures)[0];
    const ids = Object.values(net().nodes).filter((n) => n.fixtureId === f.id).map((n) => n.id);
    s().connectToPort(ids[0], ids[1]);
    expect(Object.keys(net().segments)).toHaveLength(0);
    expect(s().notice).toBeTruthy();
  });
});

describe('申請図面: 現場設定と勾配固定', () => {
  it('updateSite は履歴に残り、保存データに site が入る', () => {
    const before = s().past.length;
    s().updateSite({ designGL: -450 });
    expect(s().doc.site?.designGL).toBe(-450);
    expect(s().past.length).toBe(before + 1);
    expect(s().toProjectData()?.site).toEqual({ designGL: -450 });
    s().updateSite({ municipalityProfileId: 'standard' });
    expect(s().doc.site).toEqual({ designGL: -450, municipalityProfileId: 'standard' });
  });

  it('setSegmentSlope は 1/n を比率で保存し下流端を下げる。固定中に上流端の高さを変えると下流端が追従', () => {
    s().setDrawAttrs({ system: 'drain', diameter: 100 });
    s().drawPolyline([v(0, 0, 0), v(5000, 0, 0)]);
    const seg = Object.values(net().segments)[0];
    s().setSegmentSlope(seg.id, 50);
    expect(net().segments[seg.id]).toMatchObject({ slope: 0.02, slopeLocked: true });
    expect(net().nodes[seg.b].pos.z).toBeCloseTo(-100, 5);
    s().setNodeHeight(seg.a, 300);
    expect(net().nodes[seg.b].pos.z).toBeCloseTo(200, 5);
    s().setSegmentSlopeLocked(seg.id, false);
    expect(net().segments[seg.id].slopeLocked).toBe(false);
  });

  it('openProject は site を読み、無ければ空', () => {
    const p = s().toProjectData()!;
    s().openProject({ ...p, site: { designGL: -200 } });
    expect(s().doc.site?.designGL).toBe(-200);
    const { site: _x, ...noSite } = p;
    s().openProject(noSite);
    expect(s().doc.site).toEqual({});
  });
});

describe('マス', () => {
  it('updateFixtureParams で管底高を変えると接続口が動き履歴1件', () => {
    s().setFixtureType('manholeSewage');
    s().placeFixtureAt({ x: 1000, y: 1000 });
    const f = Object.values(s().doc.fixtures)[0];
    const port = Object.values(net().nodes).find((n) => n.fixtureId === f.id)!;
    expect(port.pos.z).toBe(-600);
    const before = s().past.length;
    s().updateFixtureParams(f.id, { invertZ: -900, diameter: 350 });
    expect(net().nodes[port.id].pos.z).toBe(-900);
    expect(s().doc.fixtures[f.id].params).toEqual({ invertZ: -900, diameter: 350 });
    expect(s().past.length).toBe(before + 1);
  });
  it('マスにつながる排水区間の下流端はマス側（高さに関係なく）', () => {
    s().setFixtureType('publicSewage');
    s().placeFixtureAt({ x: 5000, y: 0 });
    const f = Object.values(s().doc.fixtures)[0];
    const port = Object.values(net().nodes).find((n) => n.fixtureId === f.id)!;
    s().updateFixtureParams(f.id, { invertZ: 0 });
    s().setDrawAttrs({ system: 'sewage', diameter: 100 });
    s().drawPolyline([v(0, 0, -50), v(5000, 0, 0)], { endNodeId: port.id });
    const seg = Object.values(net().segments)[0];
    const up = seg.a === port.id ? seg.b : seg.a;
    s().setSegmentSlope(seg.id, 100);
    // マス側（下流端）の管底高は固定なので、上流端を 管底高 + 勾配×距離 に上げる
    expect(net().nodes[up].pos.z).toBeCloseTo(50, 5);
    expect(net().segments[seg.id].slopeLocked).toBe(true);
    // マスの管底高を下げると、固定区間の上流端も追従する
    s().updateFixtureParams(f.id, { invertZ: -200 });
    expect(net().nodes[port.id].pos.z).toBe(-200);
    expect(net().nodes[up].pos.z).toBeCloseTo(-150, 5);
    expect(net().segments[seg.id].slopeLocked).toBe(true);
  });
});

describe('マス間の勾配', () => {
  it('両端がマスの区間に勾配をつけると、上流のマスの管底高が 下流の管底高 + 勾配×距離 になる', () => {
    s().updateSite({ designGL: -450 });
    s().setFixtureType('manholeSewage');
    s().placeFixtureAt({ x: 0, y: 0 });
    const m1 = Object.values(s().doc.fixtures).find((f) => f.type === 'manholeSewage')!;
    s().setFixtureType('publicSewage');
    s().placeFixtureAt({ x: 5000, y: 0 });
    const m2 = Object.values(s().doc.fixtures).find((f) => f.type === 'publicSewage')!;
    s().updateFixtureParams(m1.id, { invertZ: -1000 });
    s().updateFixtureParams(m2.id, { invertZ: -1060 });
    const p1 = Object.values(net().nodes).find((n) => n.fixtureId === m1.id)!, p2 = Object.values(net().nodes).find((n) => n.fixtureId === m2.id)!;
    s().setDrawAttrs({ system: 'sewage', diameter: 100 });
    s().drawPolyline([p1.pos, p2.pos], { startNodeId: p1.id, endNodeId: p2.id });
    const seg = Object.values(net().segments)[0];
    const before = s().past.length;
    s().setSegmentSlope(seg.id, 50);
    expect(net().nodes[p1.id].pos.z).toBeCloseTo(-960, 5);
    expect(s().doc.fixtures[m1.id].params?.invertZ).toBeCloseTo(-960, 5);
    expect(net().segments[seg.id]).toMatchObject({ slope: 0.02, slopeLocked: true });
    expect(s().past.length).toBe(before + 1);
    expect(s().notice).toBeNull();
  });
});

describe('設計GL の変更', () => {
  it('GL を変えると、管底高が既定のマスの接続口が追従し、保存データが壊れない（2階に置いたマスも 1階 FL 基準）', () => {
    s().setFixtureType('manholeSewage');
    s().placeFixtureAt({ x: 0, y: 0 });
    const f = Object.values(s().doc.fixtures)[0];
    const port = Object.values(net().nodes).find((n) => n.fixtureId === f.id)!;
    expect(port.pos.z).toBe(-600);
    s().updateSite({ designGL: -300 });
    expect(net().nodes[port.id].pos.z).toBe(-900);
    expect(validateFixtures(s().doc)).toEqual([]);
    // 2 階に置いても GL は 1 階 FL 基準（階高分ずれない）
    s().addFloor(false);
    const f2 = s().doc.building.floors[1];
    s().setActiveFloor(f2.id);
    s().setFixtureType('manholeRain');
    s().placeFixtureAt({ x: 3000, y: 0 });
    const g = Object.values(s().doc.fixtures).find((x) => x.type === 'manholeRain')!;
    const p2 = Object.values(net().nodes).find((n) => n.fixtureId === g.id)!;
    expect(p2.pos.z).toBe(-900);
    expect(validateFixtures(s().doc)).toEqual([]);
  });
});

describe('勾配固定が保てないとき', () => {
  it('固定区間の下流端を手で動かすと固定が外れ、お知らせが出る。勾配設定後の点の移動は連鎖する', () => {
    s().setDrawAttrs({ system: 'drain', diameter: 100 });
    s().drawPolyline([v(0, 0, 0), v(4000, 0, 0), v(7000, 0, 0)]);
    const [s1, s2] = Object.values(net().segments);
    const a = s1.a, b = s1.b, c = s2.b;
    s().setSegmentSlope(s1.id, 100); // b = -40
    s().setSegmentSlope(s2.id, 100); // c = -70
    expect(net().nodes[c].pos.z).toBeCloseTo(-70, 5);
    s().setSegmentSlope(s1.id, 50); // b = -80 → 連鎖で c = -110
    expect(net().nodes[b].pos.z).toBeCloseTo(-80, 5);
    expect(net().nodes[c].pos.z).toBeCloseTo(-110, 5);
    s().clearNotice();
    s().setNodeHeight(b, -50); // 下流端を手で動かす → s1 の固定が外れる、s2 は追従
    expect(net().segments[s1.id].slopeLocked).toBe(false);
    expect(net().nodes[c].pos.z).toBeCloseTo(-80, 5);
    expect(s().notice).toContain('固定を外しました');
    void a;
  });
});

describe('落差桝', () => {
  it('マスに落差を入れると接続口ノードに dropIn が付き、固定勾配の上流端が落差分だけ上がる。0 に戻すと消える', () => {
    const s = () => useStore.getState();
    s().newDoc(emptyDoc(), { id: 'p', name: 't', createdAt: 1 });
    s().updateSite({ designGL: -100 });
    const place = (type: 'manholeSewage' | 'publicSewage', x: number) => { s().setFixtureType(type); s().placeFixtureAt({ x, y: 0 }); return Object.values(s().doc.fixtures).filter((f) => f.type === type).pop()!.id; };
    const port = (fid: string) => Object.values(s().doc.network.nodes).find((n) => n.fixtureId === fid)!;
    const m1 = place('manholeSewage', 0); s().updateFixtureParams(m1, { invertZ: -700 });
    const m2 = place('publicSewage', 5000); s().updateFixtureParams(m2, { invertZ: -900 });
    s().setDrawAttrs({ system: 'sewage', diameter: 100 });
    s().drawPolyline([port(m1).pos, { x: 2500, y: 0, z: -800 }, port(m2).pos], { startNodeId: port(m1).id, endNodeId: port(m2).id });
    const seg = Object.values(s().doc.network.segments).find((g) => g.a === port(m2).id || g.b === port(m2).id)!;
    s().setSegmentSlope(seg.id, 50); // 1/50 で固定: 中間点が公共桝の管底 −900 + 50 = −850
    const mid = s().doc.network.nodes[seg.a === port(m2).id ? seg.b : seg.a];
    expect(mid.pos.z).toBeCloseTo(-850, 1);
    s().updateFixtureParams(m2, { drop: 300 });
    expect(port(m2).dropIn).toBe(300);
    expect(s().doc.fixtures[m2].params?.drop).toBe(300);
    // 流入側の管底は −600 → 固定勾配の上流端は −550
    expect(s().doc.network.nodes[mid.id].pos.z).toBeCloseTo(-550, 1);
    s().updateFixtureParams(m2, { drop: undefined });
    expect(port(m2).dropIn).toBeUndefined();
    expect(s().doc.network.nodes[mid.id].pos.z).toBeCloseTo(-850, 1);
  });
});

describe('共通ストア: 床下', () => {
  const house = () => s().newDoc({ ...emptyDoc(), building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 120, slabThickness: 200 }) }, { id: 'h', name: '家', createdAt: 1 });

  it('「床下」を選ぶと 1 階・床から 300mm 下に描く。階を選び直すと床上に戻る', () => {
    house();
    const [f1, f2] = bld().floors;
    s().setActiveFloor(f2.id);
    s().setUnderFloor(true);
    expect(s()).toMatchObject({ underFloor: true, activeFloorId: f1.id, drawHeight: -300 });
    s().setActiveFloor(f1.id);
    expect(s()).toMatchObject({ underFloor: false, drawHeight: 100 });
  });

  it('床下で器具の接続口から描くと、床下まで下ろしてから描く（取り消しは 1 回）。屋内の給水は PB', () => {
    house();
    s().setFixtureType('washbasin');
    s().placeFixtureAt({ x: 2000, y: 3000 });
    s().setUnderFloor(true);
    const port = Object.values(net().nodes).find((n) => n.fixtureId && n.portId === 'water')!;
    const before = Object.keys(net().segments).length;
    s().drawFromPortDown(port.id, [v(port.pos.x, port.pos.y, -300), v(port.pos.x + 1500, port.pos.y, -300)]);
    expect(validateNetwork(net())).toEqual([]);
    const added = Object.values(net().segments).slice(before);
    expect(added).toHaveLength(2);
    expect(added.every((x) => x.material === 'PB保温5mm')).toBe(true);
    const riser = added.find((x) => net().nodes[x.a].pos.x === net().nodes[x.b].pos.x && net().nodes[x.a].pos.y === net().nodes[x.b].pos.y)!;
    expect([net().nodes[riser.a].pos.z, net().nodes[riser.b].pos.z].sort((a, b) => a - b)).toEqual([-300, port.pos.z]);
    s().undo();
    expect(Object.keys(net().segments)).toHaveLength(before);
  });

  it('管を指定して描けば自動にしない。建物の外へ出る給水は外で HIVP に替わる', () => {
    house();
    s().setUnderFloor(true);
    s().setDrawAttrs({ system: 'water', diameter: 13, material: 'HIVP' });
    s().drawPolyline([v(1000, 1000, -300), v(3000, 1000, -300)]);
    expect(Object.values(net().segments).map((x) => x.material)).toEqual(['HIVP']);
    s().setDrawAttrs({ material: undefined });
    s().drawPolyline([v(1000, 2000, -300), v(-2000, 2000, -300)]);
    expect(Object.values(net().segments).slice(1).map((x) => x.material).sort()).toEqual(['HIVP', 'PB保温5mm']);
  });
});

describe('共通ストア: 床下・管種の細部', () => {
  it('種類を変えると管種は自動に戻る（PB のまま排水を描かない）', () => {
    s().setDrawAttrs({ system: 'water', material: 'PB' });
    s().setDrawAttrs({ system: 'drain' });
    expect(s().drawAttrs.material).toBeUndefined();
  });

  it('床下のまま別の階へ移ったら床下ではない。床上で選んだ床下の高さは階を変えても残す', () => {
    s().newDoc({ ...emptyDoc(), building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 120, slabThickness: 200 }) }, { id: 'h', name: '家', createdAt: 1 });
    s().setUnderFloor(true);
    useStore.setState({ activeFloorId: bld().floors[1].id }); // 立て管を上の階へ、など
    expect(isUnderFloor(s())).toBe(false);
    s().setActiveFloor(bld().floors[0].id);
    s().setDrawHeight(-300);
    s().setActiveFloor(bld().floors[1].id);
    expect(s().drawHeight).toBe(-300);
  });
});

describe('共通ストア: 床下のヘッダー・接続口の口径', () => {
  const house = () => s().newDoc({ ...emptyDoc(), building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 120, slabThickness: 200 }) }, { id: 'h', name: '家', createdAt: 1 });

  it('床下で置いたヘッダーは床下に付き、出口が描く高さ（−300）に来る。床上に戻せる', () => {
    house();
    s().setUnderFloor(true);
    s().setFixtureType('waterHeader');
    s().placeFixtureAt({ x: 2000, y: 2000 });
    const f = Object.values(s().doc.fixtures)[0];
    expect(f.params?.mountZ).toBe(-400);
    const ports = Object.values(net().nodes).filter((n) => n.fixtureId === f.id);
    expect(ports.find((n) => n.portId === 'out1')!.pos.z).toBe(-300);
    expect(ports.find((n) => n.portId === 'in')!.pos.z).toBe(-350);
    s().updateFixtureParams(f.id, { mountZ: undefined });
    expect(Object.values(net().nodes).find((n) => n.fixtureId === f.id && n.portId === 'out1')!.pos.z).toBe(400);
    // 床下でトイレを置くと床の上（知らせる）
    s().setFixtureType('toilet');
    s().placeFixtureAt({ x: 5000, y: 2000 });
    expect(s().notice).toContain('床の上');
  });

  it('接続口・接続口から下ろした立て管の端から描くと、接続口の口径のまま（径違いを作らない）', () => {
    house();
    s().setFixtureType('washbasin');
    s().placeFixtureAt({ x: 2000, y: 3000 });
    s().setUnderFloor(true);
    s().setDrawAttrs({ system: 'water', diameter: 20 });
    const port = Object.values(net().nodes).find((n) => n.fixtureId && n.portId === 'water')!;
    s().drawFromPortDown(port.id, [v(port.pos.x, port.pos.y, -300), v(port.pos.x + 1500, port.pos.y, -300)]);
    expect(Object.values(net().segments).map((x) => x.diameter)).toEqual([13, 13]);
    expect(s().notice).toContain('φ13');
  });
});
