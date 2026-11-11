/** 水理計算の口径の提案を反映する一括変更（ストア） */
import { describe, expect, it } from 'vitest';
import { useStore } from './store';
import { kawasakiLike } from '../model/hydraulics/testSupply';

const s = () => useStore.getState();

describe('updateSegments', () => {
  it('複数の区間を 1 回で変え、1 回の取り消しで戻る', () => {
    const { doc } = kawasakiLike();
    s().newDoc(doc, { id: 'p', name: 'テスト', createdAt: 1 });
    const [a, b] = Object.keys(s().doc.network.segments);
    const da = s().doc.network.segments[a].diameter, db = s().doc.network.segments[b].diameter;
    s().updateSegments({ [a]: { diameter: 40 }, [b]: { diameter: 50 } });
    expect(s().doc.network.segments[a].diameter).toBe(40);
    expect(s().doc.network.segments[b].diameter).toBe(50);
    s().undo();
    expect(s().doc.network.segments[a].diameter).toBe(da);
    expect(s().doc.network.segments[b].diameter).toBe(db);
  });
  it('口径が 0 以下の変更があれば何もしない。無い区間は無視', () => {
    const { doc } = kawasakiLike();
    s().newDoc(doc, { id: 'p', name: 'テスト', createdAt: 1 });
    const [a] = Object.keys(s().doc.network.segments);
    const before = s().doc;
    s().updateSegments({ [a]: { diameter: 0 } });
    expect(s().doc).toBe(before);
    s().updateSegments({ s_gone: { diameter: 40 } });
    expect(s().doc).toBe(before);
  });
});
