import { describe, expect, it } from 'vitest';
import { buildFromSheets } from '../model/planRead/assemble';
import { elevationSheet, foundationSheet, planSheet, siteSheet } from '../model/planRead/testHouse';
import { readingOf } from './reading';

const inputs = () => [
  { name: '1F.pdf', page: planSheet() },
  { name: 'kiso.pdf', page: foundationSheet() },
  { name: 'tachi.pdf', page: elevationSheet() },
  { name: 'haichi.pdf', page: siteSheet() },
];

describe('読み取り結果 → 比べる形（readingOf）', () => {
  it('図面ごとの種類・縮尺、階、GL〜床、壁（図面座標 mm）、開口の数、器具、配置図、要確認を取り出す', () => {
    const ins = inputs();
    const r = readingOf(buildFromSheets(ins), ins);
    expect(r.sheets).toEqual([
      { name: '1F.pdf', kind: 'plan', scale: 100 },
      { name: 'kiso.pdf', kind: 'foundation', scale: 50 },
      { name: 'tachi.pdf', kind: 'elevation', scale: 100 },
      { name: 'haichi.pdf', kind: 'site', scale: 100 },
    ]);
    expect(r.floors).toEqual([{ n: 1, height: 2700 }]);
    expect(r.glToFl).toBe(550);
    expect(r.walls.length).toBeGreaterThan(3);
    expect(r.walls.every((w) => w.floor === 1 && w.thickness > 0)).toBe(true);
    expect(r.openings[0].floor).toBe(1);
    expect(r.fixtures.length).toBeGreaterThan(0);
    expect(r.site.some((s) => s.type === 'publicSewage')).toBe(true);
    expect(r.checks.length).toBeGreaterThan(0);
  });
});
