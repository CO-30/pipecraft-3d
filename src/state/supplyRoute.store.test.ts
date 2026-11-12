/** 給水・給湯を床下でつなぐ（案）のストア操作 */
import { describe, expect, it } from 'vitest';
import { useStore } from './store';
import { supplyHouse } from '../model/testSupplyHouse';

const s = () => useStore.getState();

describe('routeSupplies', () => {
  it('つないで知らせ（本数・ヘッダー・水理計算の判定）、1 回の取り消しで戻る', () => {
    s().newDoc(supplyHouse().doc, { id: 'p', name: 'テスト', createdAt: 1 });
    const segs = Object.keys(s().doc.network.segments), fx = Object.keys(s().doc.fixtures);
    expect(s().routeSupplies()).toBeGreaterThan(0);
    expect(s().notice).toContain('給水');
    expect(s().notice).toContain('ヘッダー');
    expect(s().notice).toMatch(/水理計算: (適当|不適当)/);
    s().undo();
    expect(Object.keys(s().doc.network.segments)).toEqual(segs);
    expect(Object.keys(s().doc.fixtures)).toEqual(fx);
  });
  it('メーターが無ければ知らせて何もしない', () => {
    s().newDoc(supplyHouse({ meter: false }).doc, { id: 'p', name: 'テスト', createdAt: 1 });
    const doc = s().doc;
    expect(s().routeSupplies()).toBe(0);
    expect(s().notice).toContain('水道メーター');
    expect(s().doc).toBe(doc);
  });
  it('もう一度押すと「つなぐものがない」と知らせる', () => {
    s().newDoc(supplyHouse().doc, { id: 'p', name: 'テスト', createdAt: 1 });
    s().routeSupplies();
    const doc = s().doc;
    expect(s().routeSupplies()).toBe(0);
    expect(s().notice).toContain('つなぐ給水・給湯がありません');
    expect(s().doc).toBe(doc);
  });
});
