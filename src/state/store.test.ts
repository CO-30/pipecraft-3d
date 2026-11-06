import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDoc, findUpstreamBranchPoint, useStore } from './store';
import { totalLength, validateNetwork } from '../model/network';
import { createBuildingFromDims, validateBuilding, wallsOnFloor } from '../model/building';
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
