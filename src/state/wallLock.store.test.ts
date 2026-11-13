/** 壁のロック（2026-11-13 ユーザー要望: 図面から読み取った壁は、まちがって位置を変えないように） */
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDoc, useStore, WALL_LOCK_NOTICE } from './store';
import { elevationFromWall } from '../model/elevation';
import { createBuildingFromDims, wallsOnFloor } from '../model/building';

const s = () => useStore.getState();
const b = () => s().doc.building;
const walls = () => wallsOnFloor(b(), b().floors[0].id);

beforeEach(() => {
  s().newDoc({ ...emptyDoc(), building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }) }, { id: 'p', name: 'テスト', createdAt: 1 });
  s().setWallsLocked(walls().map((w) => w.id), true);
});

describe('ロックした壁は動かない', () => {
  it('角・壁のドラッグでは動かず、知らせる', () => {
    const w = walls()[0];
    const before = JSON.stringify(b().corners);
    s().beginDrag(); s().dragCorner(w.a, { x: -500, y: -500 }); s().endDrag();
    s().beginDrag(); s().dragWall(w.id, 300, 300); s().endDrag();
    expect(JSON.stringify(b().corners)).toBe(before);
    expect(s().notice).toMatch(/ロック/);
  });
  it('消せない。長さを入れても変わらない', () => {
    const w = walls()[0];
    s().select({ kind: 'wall', id: w.id });
    s().deleteSelected();
    expect(b().walls[w.id]).toBeDefined();
    const r = s().setOutlineLength(w.id, 9000, 'a', true);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(b().walls[w.id])).toBe(JSON.stringify(walls()[0]));
  });
  it('壁を正面から見て押し込み・張り出しをしても、ロックした壁は変えない', () => {
    const south = walls().find((w) => { const a = b().corners[w.a], c = b().corners[w.b]; return a.y === 0 && c.y === 0; })!;
    const el = elevationFromWall(b(), south.id);
    expect(s().addElevation(el)).toBeNull();
    const before = JSON.stringify(b().walls);
    const id = Object.keys(s().doc.elevations ?? {})[0];
    expect(s().addFromFace(id, 'bump', { u0: 3000, u1: 5000, v0: 100, v1: 2500 }, 910)).toBe(WALL_LOCK_NOTICE);
    expect(JSON.stringify(b().walls)).toBe(before);
  });
  it('厚さ・内外は変えられる', () => {
    const w = walls()[0];
    s().updateWall(w.id, { thickness: 200 });
    expect(b().walls[w.id].thickness).toBe(200);
  });
  it('ロックを外すと動かせる。元に戻すでロックも戻る', () => {
    const w = walls()[0];
    s().setWallsLocked([w.id], false);
    expect(b().walls[w.id].locked).toBeFalsy();
    s().undo();
    expect(b().walls[w.id].locked).toBe(true);
    s().redo();
    // 外した壁とつながる角も、ロックした隣の壁が動くので動かない。両側を外すと動く
    const nb = walls().filter((x) => x.id !== w.id && (x.a === w.a || x.b === w.a)).map((x) => x.id);
    s().setWallsLocked(nb, false);
    s().beginDrag(); s().dragCorner(w.a, { x: -500, y: -500 }); s().endDrag();
    expect(b().corners[w.a]).toMatchObject({ x: -500, y: -500 });
  });
});
