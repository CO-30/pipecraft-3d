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
  beforeEach(() => s().newDoc({ building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), network: emptyNetwork() }, { id: 'p', name: 'テスト', createdAt: 1 }));

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
