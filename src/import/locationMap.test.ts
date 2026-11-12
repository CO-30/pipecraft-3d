import { describe, expect, test, vi } from 'vitest';
import { MapCache } from './locationMap';
import { orNullAfter } from './site';

const ok = (missing = 0) => Promise.resolve({ missing });

describe('MapCache（見取図の地図の使い回し）', () => {
  test('同じ場所は作り直さない。古いものから捨てて上限を守る（使ったものは新しく扱う）', async () => {
    const c = new MapCache<{ missing: number }>(2);
    const make = vi.fn(() => ok());
    await c.get('a', make); await c.get('b', make); await c.get('a', make);
    expect(make).toHaveBeenCalledTimes(2);
    await c.get('c', make); // b が捨てられる（a は直前に使った）
    expect(c.keys()).toEqual(['a', 'c']);
  });
  test('一部が取れなかった地図・失敗は覚えない（出し直すと取り直す）', async () => {
    const c = new MapCache<{ missing: number }>(4);
    await c.get('p', () => ok(3));
    await expect(c.get('f', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await Promise.resolve();
    expect(c.keys()).toEqual([]);
  });
});

describe('orNullAfter（地図タイルの待ち時間の上限）', () => {
  test('返ってこないタイルは時間切れで null', async () => {
    vi.useFakeTimers();
    const p = orNullAfter(new Promise<string | null>(() => {}), 10000);
    vi.advanceTimersByTime(10001);
    await expect(p).resolves.toBeNull();
    vi.useRealTimers();
  });
  test('間に合えばその値', async () => {
    await expect(orNullAfter(Promise.resolve('img'), 10000)).resolves.toBe('img');
  });
});
