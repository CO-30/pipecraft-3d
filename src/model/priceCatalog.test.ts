import { describe, expect, it } from 'vitest';

describe('排水の管種の初期値（2026-11-14 ユーザー指定: 床下も VU が普通）', () => {
  it('管種を決めていない排水・汚水の管は VU（通気・ドレンは VP のまま）', async () => {
    const { effectiveMaterial } = await import('./priceCatalog');
    expect(effectiveMaterial({ system: 'drain' })).toBe('VU');
    expect(effectiveMaterial({ system: 'sewage' })).toBe('VU');
    expect(effectiveMaterial({ system: 'vent' })).toBe('VP');
    expect(effectiveMaterial({ system: 'sewage', material: 'VP' })).toBe('VP');
  });
});
