import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDoc, useStore } from './store';
import { addFloor, emptyBuilding, validateBuilding, wallLength } from '../model/building';
import { outlineLoop, unconfirmedWallCount } from '../model/sketch';

const s = () => useStore.getState();
const bld = () => s().doc.building;
const rect = [{ x: 0, y: 0 }, { x: 0, y: 6000 }, { x: 8000, y: 6000 }, { x: 8000, y: 0 }, { x: 0, y: 50 }];

beforeEach(() => {
  let b = emptyBuilding();
  b = addFloor(b, { height: 2800 }).b;
  b = addFloor(b, { height: 2800 }).b;
  s().newDoc({ ...emptyDoc(), building: b }, { id: 'p', name: 'テスト', createdAt: 1 });
});

describe('共通ストア: なぞって描く', () => {
  it('外形をなぞると 2 階分の外壁ができ、寸法入力が開く。Undo 1回で消える', () => {
    expect(s().sketchOutline(rect, 50)).toBe(true);
    expect(Object.keys(bld().walls)).toHaveLength(8);
    expect(unconfirmedWallCount(bld())).toBe(8);
    expect(validateBuilding(bld())).toEqual([]);
    expect(s().dimWizard).toEqual({ floorId: bld().floors[0].id, index: 0 });
    expect(s().selection?.kind).toBe('wall');
    s().undo();
    expect(Object.keys(bld().walls)).toHaveLength(0);
    expect(s().dimWizard).toBeNull(); // 外壁が無くなったら寸法入力も閉じる
  });
  it('外壁がある階ではなぞっても上書きしない', () => {
    s().sketchOutline(rect, 50);
    expect(s().sketchOutline(rect, 50)).toBe(false);
    expect(s().notice).toMatch(/もう外壁/);
  });
  it('寸法を入れると全階まとめて変わり、Undo で戻る', () => {
    s().sketchOutline(rect, 50);
    const f1 = bld().floors[0].id;
    const top = outlineLoop(bld(), f1)!.walls[0];
    const r = s().setOutlineLength(top, 7280, 'a');
    expect(r.ok).toBe(true);
    for (const f of bld().floors) expect(Math.round(wallLength(bld(), outlineLoop(bld(), f.id)!.walls[0]))).toBe(7280);
    s().setDimIndex(1);
    expect(s().dimWizard?.index).toBe(1);
    s().undo();
    expect(Math.round(wallLength(bld(), top))).toBe(8000);
  });
});
