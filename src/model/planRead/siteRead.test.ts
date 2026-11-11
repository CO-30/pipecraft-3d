import { describe, expect, it } from 'vitest';
import { alignSite, readSite } from './siteRead';
import { D, W, siteSheet } from './testHouse';
import { PT_TO_MM } from './sheet';

const k = PT_TO_MM * 100;
/** 平面図の外壁（芯・厚さ 120） */
const ref = [
  { a: { x: 0, y: 0 }, b: { x: W, y: 0 }, t: 120 }, { a: { x: W, y: 0 }, b: { x: W, y: D }, t: 120 },
  { a: { x: 0, y: D }, b: { x: W, y: D }, t: 120 }, { a: { x: 0, y: 0 }, b: { x: 0, y: D }, t: 120 },
];

describe('配置図（siteRead）', () => {
  it('凡例から記号の大きさを測り、汚水公共桝・汚水桝・雨水桝・水道メーター・敷地の高さ・BM を読む（凡例そのものは数えない）', () => {
    const r = readSite(siteSheet());
    expect(r.legend).toMatchObject({ publicSewer: expect.closeTo(200 / k, 1), sewer: expect.closeTo(150 / k, 1) });
    expect(r.items.filter((x) => x.type === 'publicSewage')).toHaveLength(1);
    expect(r.items.filter((x) => x.type === 'manholeSewage')).toHaveLength(3);
    expect(r.items.filter((x) => x.type === 'manholeRain')).toHaveLength(1);
    expect(r.items.filter((x) => x.type === 'waterMeter')).toHaveLength(1);
    expect(r.levels.map((l) => l.gl).sort((a, b) => a - b)).toEqual([-950, -500, 0, 300]);
    expect(r.bm).toBe(550);
  });
  it('通り芯が無くても、外壁と線の重なりで平面図の位置に合わせる', () => {
    const page = siteSheet();
    const t = alignSite(page, k, ref)!;
    expect(t).not.toBeNull();
    const r = readSite(page);
    const world = (p: { x: number; y: number }) => ({ x: (p.x - t.ox) * t.k, y: (t.oy - p.y) * t.k });
    const pub = world(r.items.find((x) => x.type === 'publicSewage')!.p);
    expect(pub.x).toBeCloseTo(-1500, -1.5);
    expect(pub.y).toBeCloseTo(D + 600, -1.5);
    // 家の線と重ならない向き・ずれた位置では合わせない
    expect(alignSite(page, k, [{ a: { x: 0, y: 0 }, b: { x: 50000, y: 0 }, t: 120 }])).toBeNull();
  });
});
