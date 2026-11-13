/**
 * 精度の基準（作り物の図面）。正解は図面を描いたときの意図（testHouse.ts のコメント）から作った値。
 * 読み取りを直す PR は、ここの値を下げてはいけない（下げたら落ちる）。上がったら基準を上げる。
 */
import { describe, expect, it } from 'vitest';
import { buildFromSheets } from '../model/planRead/assemble';
import { D, W, elevationSheet, foundationSheet, planSheet, siteSheet } from '../model/planRead/testHouse';
import { evaluate } from './evaluate';
import { readingOf } from './reading';
import { formatScore } from './report';
import { parseTruth } from './truth';

const T = 120;
const truth = parseTruth({
  id: 'synthetic-house',
  kind: 'detached',
  structure: 'wood',
  confirmedBy: 'testHouse.ts の作図',
  confirmedAt: '2026-11-13',
  sheets: [
    { name: '1F', kind: 'plan', scale: 100 },
    { name: 'kiso', kind: 'foundation', scale: 50 },
    { name: 'tachi', kind: 'elevation', scale: 100 },
    { name: 'haichi', kind: 'site', scale: 100 },
  ],
  floors: [{ n: 1, height: 2700 }],
  glToFl: 550,
  walls: [
    { floor: 1, a: { x: 0, y: 0 }, b: { x: W, y: 0 }, thickness: T },
    { floor: 1, a: { x: W, y: 0 }, b: { x: W, y: D }, thickness: T },
    { floor: 1, a: { x: W, y: D }, b: { x: 0, y: D }, thickness: T },
    { floor: 1, a: { x: 0, y: D }, b: { x: 0, y: 0 }, thickness: T },
    { floor: 1, a: { x: 3640, y: 0 }, b: { x: 3640, y: D }, thickness: T },
  ],
  openings: [{ floor: 1, count: 2 }],
  // 器具: 部屋の名前（WC・洗面・LDK）と外の「立水栓」。凡例の立水栓は器具ではない
  fixtures: [
    { floor: 1, type: 'toilet', x: 900, y: 5100 },
    { floor: 1, type: 'washbasin', x: 2700, y: 5100 },
    { floor: 1, type: 'washer', x: 1700, y: 5100 },
    { floor: 1, type: 'kitchen', x: 6900, y: 2500 },
    { floor: 1, type: 'outdoorFaucet', x: W + 700, y: 1000 },
  ],
  site: [
    { type: 'publicSewage', x: -1500, y: D + 600 },
    ...[1000, 3000, 5000, 6500].map((x) => ({ type: 'manholeSewage' as const, x, y: D + 600 })),
    { type: 'manholeRain', x: W + 600, y: 1000 },
    { type: 'manholeRain', x: W + 600, y: 3000 },
    { type: 'outdoorFaucet', x: 1200, y: -600 },
    { type: 'waterMeter', x: -800, y: -800 },
  ],
});

const inputs = () => [
  { name: '1F', page: planSheet() },
  { name: 'kiso', page: foundationSheet() },
  { name: 'tachi', page: elevationSheet() },
  { name: 'haichi', page: siteSheet() },
];

describe('精度の基準（作り物の戸建）', () => {
  const ins = inputs();
  const s = evaluate(readingOf(buildFromSheets(ins), ins), truth);
  it('図面の種類・縮尺はすべて正しい', () => {
    expect(s.sheets).toMatchObject({ kindCorrect: 4, scaleCorrect: 4, wrong: [] });
  });
  it('階高・GL〜床の誤差 0', () => {
    expect(s.floors).toMatchObject({ heightErrorMax: 0, glToFlError: 0 });
  });
  it('壁: 再現率・適合率 99% 以上、厚さの誤差 0、開口の数が合う', () => {
    expect(s.walls.recall).toBeGreaterThanOrEqual(0.99);
    expect(s.walls.precision).toBeGreaterThanOrEqual(0.99);
    expect(s.walls.thicknessError).toBe(0);
    expect(s.openings?.diff).toBe(0);
  });
  it('器具: 全部見つかり余分なし、位置の誤差は最大 100mm 以内', () => {
    expect(s.fixtures).toMatchObject({ recall: 1, precision: 1 });
    expect(s.fixtures.positionMax).toBeLessThanOrEqual(100);
  });
  it('配置図: ます・メーター・立水栓が全部見つかり余分なし、誤差 10mm 以内', () => {
    expect(s.site).toMatchObject({ recall: 1, precision: 1 });
    expect(s.site.positionMax).toBeLessThanOrEqual(10);
  });
  it('結果の表（Markdown）を作れる', () => {
    expect(formatScore(truth, s)).toContain('| 壁 |');
  });
});
