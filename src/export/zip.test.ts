import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { zipStore } from './zip';

const enc = (s: string) => new TextEncoder().encode(s);

describe('zipStore（まとめて ZIP）', () => {
  it('日本語のファイル名と中身がそのまま取り出せる', async () => {
    const big = new Uint8Array(70_000).map((_, i) => (i * 31) & 255);
    const bytes = zipStore([{ name: '眞境名邸_給水申請書類一式.pdf', bytes: enc('PDF-1') }, { name: '申請図面一式.pdf', bytes: big }], new Date(2026, 10, 18, 9, 30));
    const z = await JSZip.loadAsync(bytes);
    expect(Object.keys(z.files)).toEqual(['眞境名邸_給水申請書類一式.pdf', '申請図面一式.pdf']);
    expect(await z.file('眞境名邸_給水申請書類一式.pdf')!.async('string')).toBe('PDF-1');
    expect(await z.file('申請図面一式.pdf')!.async('uint8array')).toEqual(big);
    expect(z.file('申請図面一式.pdf')!.date.getFullYear()).toBe(2026);
  });

  it('同じ名前は (2) を付けて両方残す。空の一覧でも壊れない', async () => {
    const z = await JSZip.loadAsync(zipStore([{ name: 'a.pdf', bytes: enc('1') }, { name: 'a.pdf', bytes: enc('2') }, { name: 'a.pdf', bytes: enc('3') }]));
    expect(Object.keys(z.files)).toEqual(['a.pdf', 'a (2).pdf', 'a (3).pdf']);
    expect(await z.file('a (2).pdf')!.async('string')).toBe('2');
    expect(Object.keys((await JSZip.loadAsync(zipStore([]))).files)).toEqual([]);
  });
});
