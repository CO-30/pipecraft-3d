import { describe, expect, it } from 'vitest';
import { setPendingUnderlayFile, takePendingUnderlayFile, underlayFileKind } from './pending';

describe('underlayFileKind', () => {
  it.each([
    ['平面図.pdf', 'application/pdf', 'pdf'],
    ['平面図.PDF', '', 'pdf'],
    ['1階.jww', '', 'jww'],
    ['1階.JWW', 'application/octet-stream', 'jww'],
    ['写真.jpg', 'image/jpeg', 'image'],
    ['IMG_0001', 'image/heic', 'image'],
    ['古い.jwc', '', 'jww'],
    ['図面.dxf', '', 'unsupported'],
  ])('%s → %s', (name, type, kind) => {
    expect(underlayFileKind({ name, type })).toBe(kind);
  });
});

describe('受け渡し', () => {
  it('1回受け取ると空になる', () => {
    const f = new File(['x'], 'a.jww');
    setPendingUnderlayFile(f);
    expect(takePendingUnderlayFile()).toBe(f);
    expect(takePendingUnderlayFile()).toBeNull();
  });
});
