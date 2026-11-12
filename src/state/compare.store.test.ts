import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDoc, useStore } from './store';

const s = () => useStore.getState();
const v = (x: number, y: number) => ({ x, y, z: 300 });

beforeEach(() => s().newDoc(emptyDoc(), { id: 'p', name: '山田邸', createdAt: 1 }));

describe('共通ストア: 版の比較・戻す', () => {
  it('比べる版は画面だけの状態（履歴に入らない）。工事を閉じる・開くと消える', () => {
    s().drawPolyline([v(0, 0), v(2000, 0)]);
    const past = s().past.length;
    s().setCompare({ id: 'v1', name: '申請提出', createdAt: 5, doc: s().doc });
    expect(s().compare?.name).toBe('申請提出');
    expect(s().past.length).toBe(past);
    s().closeProject();
    expect(s().compare).toBeNull();
  });

  it('版に戻すと中身が版のとおりになり、元に戻すで取り消せる', () => {
    s().drawPolyline([v(0, 0), v(2000, 0)]);
    const p = s().toProjectData()!;
    s().drawPolyline([v(0, 1000), v(2000, 1000)]);
    s().placeNoteAt({ x: 5, y: 5 });
    expect(Object.keys(s().doc.network.segments)).toHaveLength(2);
    s().restoreProject(p);
    expect(Object.keys(s().doc.network.segments)).toHaveLength(1);
    expect(s().doc.notes ?? {}).toEqual({});
    expect(s().compare).toBeNull();
    s().undo();
    expect(Object.keys(s().doc.network.segments)).toHaveLength(2);
  });
});
