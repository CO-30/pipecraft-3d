import { beforeEach, describe, expect, it } from 'vitest';
import { wallsOnFloor } from '../model/building';
import { pxToWorld } from '../model/underlay';
import type { PxWall } from '../model/planRead/raster';
import { emptyDoc, useStore } from './store';

const s = () => useStore.getState();
beforeEach(() => s().newDoc(emptyDoc(), { id: 'p', name: 'テスト邸', createdAt: 1 }));

const scan = (o: { scaled?: boolean; rotation?: number } = {}) => ({
  floorId: s().activeFloorId, kind: 'pdf' as const, label: 'スキャン', src: 'data:image/png;base64,AAAA', widthPx: 200, heightPx: 100,
  center: { x: 1000, y: 2000 }, mmPerPx: 10, rotation: o.rotation ?? 30, opacity: 0.6, scaled: o.scaled ?? true, paperMmPerPx: 0.2,
});
/** 1000 × 500 の外壁 4 本と、真ん中の内壁（800 のドアの開口） */
const WALLS: PxWall[] = [
  { a: { x: 50, y: 25 }, b: { x: 150, y: 25 }, thickness: 120, kind: 'exterior', openings: [] },
  { a: { x: 150, y: 25 }, b: { x: 150, y: 75 }, thickness: 120, kind: 'exterior', openings: [] },
  { a: { x: 150, y: 75 }, b: { x: 50, y: 75 }, thickness: 120, kind: 'exterior', openings: [] },
  { a: { x: 50, y: 75 }, b: { x: 50, y: 25 }, thickness: 120, kind: 'exterior', openings: [] },
  { a: { x: 100, y: 25 }, b: { x: 100, y: 75 }, thickness: 105, kind: 'interior', openings: [{ offset: 250, width: 800 }] },
];
const floorWalls = () => wallsOnFloor(s().doc.building, s().activeFloorId);

describe('共通ストア: 下敷き（スキャン）から読んだ壁をこの階に入れる', () => {
  it('壁の端は下敷きの位置・回転・縮尺どおり（pxToWorld）。厚さ・外壁/内壁・ドアの開口も入る。元に戻す 1 回で消える', () => {
    s().importSite({ underlay: scan() });
    const id = s().activeUnderlayId!;
    const r = s().readUnderlayWalls(id, WALLS, false);
    // 本数は入れた後のこの階の壁（T でつながる所で分かれた後）。画面の確認の本数と同じ
    expect(r).toEqual({ walls: 7, exterior: 6, openings: 1 });
    const b = s().doc.building;
    const ws = floorWalls();
    // 内壁が上下の外壁の途中に T でつながるので、外壁はそこで 2 本に分かれる（5 本 → 7 本）
    expect(ws).toHaveLength(7);
    const u = s().doc.underlays![id];
    const want = pxToWorld(u, { x: 50, y: 25 });
    expect(Object.values(b.corners).some((c) => Math.hypot(c.x - want.x, c.y - want.y) < 1)).toBe(true);
    const inner = ws.find((w) => w.kind === 'interior')!;
    expect(inner.thickness).toBe(105);
    expect(Object.values(b.openings ?? {}).filter((o) => o.wallId === inner.id && o.type === 'door')).toHaveLength(1);
    s().undo();
    expect(floorWalls()).toHaveLength(0);
  });
  it('この階に壁があるときは、置き換えを選ばなければ何もしない（null）。置き換えなら今の壁を消して入れる', () => {
    s().importSite({ polygon: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }] });
    s().importSite({ underlay: scan() });
    const id = s().activeUnderlayId!;
    expect(s().readUnderlayWalls(id, WALLS, false)).toBeNull();
    expect(floorWalls()).toHaveLength(3);
    expect(s().readUnderlayWalls(id, WALLS, true)).toEqual({ walls: 7, exterior: 6, openings: 1 });
    expect(floorWalls()).toHaveLength(7);
    s().undo();
    expect(floorWalls()).toHaveLength(3);
  });
  it('ロック中の壁（自動 3D で読んだ壁など）がある階は置き換えない（お知らせ）', () => {
    s().importSite({ polygon: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }] });
    s().setWallsLocked(floorWalls().map((w) => w.id), true);
    s().importSite({ underlay: scan() });
    expect(s().readUnderlayWalls(s().activeUnderlayId!, WALLS, true)).toBeNull();
    expect(floorWalls()).toHaveLength(3);
    expect(s().notice).toContain('ロック');
  });
  it('縮尺が決まっていない下敷き・壁が 0 本のときは何もしない', () => {
    s().importSite({ underlay: scan({ scaled: false }) });
    expect(s().readUnderlayWalls(s().activeUnderlayId!, WALLS, false)).toBeNull();
    s().importSite({ underlay: scan() });
    expect(s().readUnderlayWalls(s().activeUnderlayId!, [], false)).toBeNull();
    expect(floorWalls()).toHaveLength(0);
  });
});
