import { describe, expect, test } from 'vitest';
import { closeOutline, type OSeg } from './closeOutline';

const s = (ax: number, ay: number, bx: number, by: number): OSeg => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } });
/** 2026-11-16 の実物（木造平屋）の 1 階平面図から読んだ外壁: 窓・出入口の所で切れていて 1 周つながっていない */
const EXT: OSeg[] = [
  s(2502, 3186, 2502, 9100), s(1365, 910, 3867, 910), s(3867, 910, 8416, 910), s(0, -74, 0, 3186),
  s(11147, -930, 11147, 1820), s(11147, 1820, 11147, 2731), s(0, 3186, 2502, 3186), s(10160, -930, 11147, -930),
  s(2502, 9100, 4500, 9100), s(4500, 9100, 12057, 9100), s(8416, 1820, 9326, 1820), s(9326, 1820, 11147, 1820),
  s(12057, 3641, 12057, 4549), s(12057, 4549, 12359, 4549), s(12057, 4549, 12057, 6200), s(12057, 6200, 12057, 9100), s(12057, 6200, 12359, 6200),
];
/** 同じ工事の基礎伏図の立上り（一部） */
const FOOT: OSeg[] = [
  s(2502, 7279, 10160, 7279), s(2502, 9098, 12056, 9098), s(8416, -909, 8416, 5824), s(1367, 910, 8416, 910), s(2502, 3239, 2502, 9098),
  s(12056, 3640, 12056, 9098), s(11146, -909, 11146, 3640), s(-1, -1, -1, 3185), s(9325, 3640, 12056, 3640), s(8416, -909, 11146, -909),
  s(1367, -1, 1367, 2328), s(8416, 1821, 9856, 1821), s(-1, 3185, 1439, 3185), s(-1, -1, 1367, -1), s(10615, 1821, 11146, 1821),
];

/** 外周が 1 つの閉じた輪になっているか（各点の次数 2・つながっている） */
function isLoop(segs: OSeg[]): boolean {
  const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
  const adj = new Map<string, string[]>();
  for (const g of segs) { adj.set(key(g.a), [...(adj.get(key(g.a)) ?? []), key(g.b)]); adj.set(key(g.b), [...(adj.get(key(g.b)) ?? []), key(g.a)]); }
  if ([...adj.values()].some((v) => v.length !== 2)) return false;
  const start = [...adj.keys()][0];
  const seen = new Set([start]);
  const st = [start];
  while (st.length) for (const o of adj.get(st.pop()!)!) if (!seen.has(o)) { seen.add(o); st.push(o); }
  return seen.size === adj.size;
}

describe('外壁の輪を閉じる（窓・出入口の切れ目）', () => {
  test('実物: 基礎の立上りに沿ってつなぎ、いちばん外側の 1 周にする。行き止まりの短い壁は外周から外す', () => {
    const r = closeOutline(EXT, FOOT)!;
    expect(r).not.toBeNull();
    const kept = EXT.filter((_, i) => !r.demote.includes(i));
    expect(isLoop([...kept, ...r.add])).toBe(true);
    // 南東の張り出し（x 8416〜11147・y −930〜910）を含む外側の輪
    const xs = r.add.flatMap((g) => [g.a, g.b]);
    expect(xs).toContainEqual({ x: 8416, y: -930 });
    expect(xs).toContainEqual({ x: 1365, y: -74 });
    expect(xs).toContainEqual({ x: 11147, y: 3641 });
    // 出窓の小さな出っぱり・内側の壁は外す（消さずに内壁にする）
    expect(r.demote.map((i) => EXT[i])).toEqual(expect.arrayContaining([s(12057, 4549, 12359, 4549), s(12057, 6200, 12359, 6200), s(8416, 1820, 9326, 1820), s(9326, 1820, 11147, 1820)]));
  });

  test('もう閉じている外周は何もしない', () => {
    const box = [s(0, 0, 8000, 0), s(8000, 0, 8000, 6000), s(8000, 6000, 0, 6000), s(0, 6000, 0, 0)];
    expect(closeOutline(box, [])).toEqual({ add: [], demote: [] });
  });

  test('基礎伏図が無ければ、同じ線上の切れ目（窓・出入口の幅）だけをつなぐ', () => {
    const gap = [s(0, 0, 3000, 0), s(4600, 0, 8000, 0), s(8000, 0, 8000, 6000), s(8000, 6000, 0, 6000), s(0, 6000, 0, 0)];
    const r = closeOutline(gap, [])!;
    expect(r.add).toEqual([s(3000, 0, 4600, 0)]);
    // 斜めにずれた大きな切れ目は、基礎が無いと決められない
    const far = [s(0, 0, 3000, 0), s(8000, 2000, 8000, 6000), s(8000, 6000, 0, 6000), s(0, 6000, 0, 0)];
    expect(closeOutline(far, [])).toBeNull();
  });
});

describe('外壁の輪を閉じる（ほかの形）', () => {
  test('L 字の家で入り隅の窓が 2 か所切れている → 基礎に沿ってつなぐ', () => {
    // L 字: (0,0)-(8000,0)-(8000,4000)-(4000,4000)-(4000,8000)-(0,8000)。入り隅の 2 辺に窓の切れ目
    const ext = [s(0, 0, 8000, 0), s(8000, 0, 8000, 4000), s(8000, 4000, 6500, 4000), s(5000, 4000, 4000, 4000), s(4000, 4000, 4000, 5000), s(4000, 6500, 4000, 8000), s(4000, 8000, 0, 8000), s(0, 8000, 0, 0)];
    const foot = [s(0, 0, 8000, 0), s(8000, 0, 8000, 4000), s(8000, 4000, 4000, 4000), s(4000, 4000, 4000, 8000), s(4000, 8000, 0, 8000), s(0, 8000, 0, 0)];
    const r = closeOutline(ext, foot)!;
    expect(isLoop([...ext.filter((_, i) => !r.demote.includes(i)), ...r.add])).toBe(true);
    expect(r.add).toEqual(expect.arrayContaining([s(5000, 4000, 6500, 4000), s(4000, 5000, 4000, 6500)]));
    expect(r.demote).toEqual([]);
  });
});
