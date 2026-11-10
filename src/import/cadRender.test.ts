import { describe, expect, it } from 'vitest';
import { fitDrawing, type CadDrawing } from '../model/cadDrawing';
import { drawCad } from './cadRender';

function recorder() {
  const calls: [string, ...unknown[]][] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => { calls.push([k, ...a]); }),
    set: (t, k: string, v) => { t[k] = v; calls.push(['set:' + k, v]); return true; },
  });
  return { ctx: ctx as unknown as Parameters<typeof drawCad>[0], calls };
}
const drawing = (o: Partial<CadDrawing>): CadDrawing => ({ lines: [], texts: [], bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 }, scale: 100, scales: [100], notes: [], empty: false, ...o });

describe('drawCad', () => {
  it('白地に線を描く（上が北になるよう y を反転）', () => {
    const d = drawing({ lines: [{ x1: 0, y1: 0, x2: 100, y2: 50 }] });
    const f = fitDrawing(d, 1000);
    const { ctx, calls } = recorder();
    drawCad(ctx, d, f);
    expect(calls.find((c) => c[0] === 'fillRect')).toEqual(['fillRect', 0, 0, f.widthPx, f.heightPx]);
    const m = calls.find((c) => c[0] === 'moveTo')!, l = calls.find((c) => c[0] === 'lineTo')!;
    expect(l[1] as number).toBeGreaterThan(m[1] as number);
    expect(l[2] as number).toBeLessThan(m[2] as number);
    expect(calls.filter((c) => c[0] === 'stroke')).toHaveLength(1);
  });

  it('文字は高さに合わせた大きさで、角度を付けて描く。小さすぎる文字は描かない', () => {
    const d = drawing({ texts: [
      { x: 10, y: 10, h: 5, w: 5, angle: 90, content: '台所' },
      { x: 10, y: 10, h: 0.01, w: 0.01, angle: 0, content: '極小' },
    ] });
    const f = fitDrawing(d, 1000);
    const { ctx, calls } = recorder();
    drawCad(ctx, d, f);
    const texts = calls.filter((c) => c[0] === 'fillText');
    expect(texts).toHaveLength(1);
    expect(texts[0][1]).toBe('台所');
    expect(calls.find((c) => c[0] === 'rotate')![1]).toBeCloseTo(-Math.PI / 2, 9);
    const font = calls.find((c) => c[0] === 'set:font')![1] as string;
    expect(parseFloat(font)).toBeCloseTo(5 / f.paperMmPerPx, 0);
  });

  it('線が多くても全部描く（区切って描画）', () => {
    const lines = Array.from({ length: 4500 }, (_, i) => ({ x1: 0, y1: 0, x2: i % 100, y2: 10 }));
    const d = drawing({ lines });
    const { ctx, calls } = recorder();
    drawCad(ctx, d, fitDrawing(d, 1000));
    expect(calls.filter((c) => c[0] === 'lineTo')).toHaveLength(4500);
    expect(calls.filter((c) => c[0] === 'stroke')).toHaveLength(3);
  });
});
