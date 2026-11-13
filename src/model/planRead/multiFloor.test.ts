/**
 * 複数階の建物の図面一式（2026-11-13 ユーザー: 4 階建ての共同住宅の図面 60 枚が読めない）。
 * 表題欄の図面名で種類を決める・「2～4階平面図」を 2・3・4 階に使う・R 階は階にしない・
 * 「1:100」でなく通り芯の間隔と寸法の数字で縮尺を確かめる・立面図/断面図の RFL で最上階の高さ
 */
import { describe, expect, it } from 'vitest';
import { wallsOnFloor } from '../building';
import { buildFromSheets } from './assemble';
import { readHeights } from './heights';
import { classifySheet, floorsOfTitle, planRank, readGrid, scaleFromGridDims, sheetScale, titleBlockName, type PText } from './sheet';
import { planSheet } from './testHouse';
import type { VectorPage } from './sheet';

const t = (s: string, x: number, y: number, h = 8): PText => ({ x, y, h, s });
/** 表題欄（右下）に「図面名称 ○○」 */
const titled = (name: string, extra: PText[] = []): PText[] => [t('図面名称', 780, 774, 7.6), t(name, 840, 774, 11), ...extra];

describe('表題欄の図面名で種類と階を決める', () => {
  it('図面名称の右の文字を読む', () => {
    expect(titleBlockName(titled('2~4階平面図'))).toBe('2~4階平面図');
    expect(titleBlockName([t('図面名称', 100, 100), t('図面番号', 300, 100), t('A-10', 330, 100)])).toBeNull();
  });
  it('図面リスト（各図面の名前が並ぶ）・仕様書・日影図・建具 KEY PLAN は平面図にしない', () => {
    expect(classifySheet(titled('図面リスト', [t('1階平面図', 200, 300, 12), t('2~4階平面図', 200, 330, 12)])).kind).toBe('other');
    expect(classifySheet(titled('特記仕様書(1)', [t('各室の平面図、展開図', 200, 300, 14)])).kind).toBe('other');
    expect(classifySheet(titled('日影図(1)')).kind).toBe('other');
    expect(classifySheet(titled('1階建具KEY PLAN')).kind).toBe('other');
    expect(classifySheet(titled('配置図・案内図・建築概要')).kind).toBe('site');
    expect(classifySheet(titled('断面図(1)')).kind).toBe('section');
    expect(classifySheet(titled('断面詳細図(1)')).kind).toBe('detail');
  });
  it('「2～4階平面図」は 2・3・4 階、「R階平面図」は屋上（階にしない）。図の中の大きい「1階平面図」より表題欄', () => {
    expect(classifySheet(titled('2～4階平面図', [t('1階平面図', 100, 100, 20)]))).toMatchObject({ kind: 'plan', floors: [2, 3, 4], floor: 2, roof: false });
    expect(classifySheet(titled('R階平面図'))).toMatchObject({ kind: 'plan', floors: [], roof: true });
    expect(floorsOfTitle('3F平面図').floors).toEqual([3]);
    expect(floorsOfTitle('1階平面詳細図').floors).toEqual([1]);
    expect(floorsOfTitle('木造2階建て住宅 1階平面図').floors).toEqual([1]);
    expect(floorsOfTitle('RC造 1階平面図').roof).toBe(false);
    expect(floorsOfTitle('RF平面図').roof).toBe(true);
    expect(floorsOfTitle('屋上平面図').roof).toBe(true);
    expect(floorsOfTitle('1階・2階平面図').floors).toEqual([1, 2]);
    for (const x of ['Rプラン1階平面図', '1階平面図(RF階段)', 'PHOTO']) expect(floorsOfTitle(x).roof).toBe(false);
  });
  it('同じ階の平面図が複数あれば、平面図 → 平面詳細図 → 階段・部分の順', () => {
    expect(planRank('1階平面図')).toBeLessThan(planRank('1階平面詳細図'));
    expect(planRank('1階平面詳細図')).toBeLessThan(planRank('1階階段平面図'));
  });
});

describe('縮尺: 通り芯の間隔と寸法の数字', () => {
  it('RC の通り芯（8,500・6,000・8,500）でも 1/100 が分かる。詳細の「S=1/20」に引っぱられない', () => {
    const k = 72 / 25.4 / 100; // 1mm → pt（1/100）
    const xs = [0, 8500, 14500, 23000].map((v, i) => t(`X${i + 1}`, 100 + v * k, 50));
    const ys = [0, 7500].map((v, i) => t(`Y${i + 1}`, 50, 500 - v * k));
    const texts = [...xs, ...ys, t('8,500', 100 + 4250 * k, 40), t('6,000', 100 + 11500 * k, 40), t('7,500', 40, 500 - 3750 * k), t('S=1/20', 900, 600)];
    const grid = readGrid(texts)!;
    expect(scaleFromGridDims(texts, grid)).toBe(100);
    expect(sheetScale(texts, grid)?.scale).toBe(100);
  });
  it('木造の図面: 「S=1/50」の文字で通り芯の間隔に合う寸法があれば、文字の縮尺のまま', () => {
    const k = 72 / 25.4 / 50;
    const xs = [0, 910, 1820, 3640].map((v, i) => t(`X${i + 1}`, 100 + v * k, 50));
    const ys = [0, 1820].map((v, i) => t(`Y${i + 1}`, 50, 500 - v * k));
    // 半分の縮尺（1/100）でも合ってしまう数字（1,820・3,640）が並ぶ
    const texts = [...xs, ...ys, t('910', 120, 40), t('1,820', 140, 40), t('3,640', 160, 40), t('S=1/50', 900, 600)];
    expect(sheetScale(texts, readGrid(texts)!)?.scale).toBe(50);
  });
});

describe('高さ: RFL（屋上の床）で最上階の高さ', () => {
  it('1FL〜4FL・RFL の文字の間隔から各階の高さ', () => {
    const k = 72 / 25.4 / 200; // 1/200
    const y = (mm: number) => 700 - mm * k;
    const texts = [t('GL', 150, y(0)), t('1FL', 150, y(550)), t('2FL', 150, y(3650)), t('3FL', 150, y(6500)), t('4FL', 150, y(9350)), t('RFL', 150, y(12100)),
      t('3,100', 300, y(2000)), t('2,850', 300, y(5000)), t('2,750', 300, y(10000))];
    const h = readHeights(texts, 25.4 / 72 * 200);
    expect([...h.floorToFloor]).toEqual([[1, 3100], [2, 2850], [3, 2850], [4, 2750]]);
    expect(h.glToFl).toBeCloseTo(550, -1);
    expect(h.topFloor).toBe(4);
  });
  it('RFL と軒高があっても、軒高は最上階の床から', () => {
    const k = 72 / 25.4 / 100;
    const y = (mm: number) => 700 - mm * k;
    const h = readHeights([t('GL', 150, y(0)), t('1FL', 150, y(500)), t('2FL', 150, y(3500)), t('RFL', 150, y(6400)), t('軒高', 150, y(6600))], 25.4 / 72 * 100);
    expect(h.topFloor).toBe(2);
    expect(h.topToEaves).toBeCloseTo(3100, -1);
  });
});

describe('図面一式から複数階の建物', () => {
  /** 平面図の線はそのまま、表題欄の図面名だけ替えたページ */
  const sheet = (name: string): VectorPage => { const p = planSheet({ title: false }); return { ...p, texts: [...p.texts, ...titled(name)] }; };
  it('1階平面図 + 2～4階平面図 + R階平面図 + 図面リスト → 1〜4 階。2〜4 階は同じ平面図の壁', () => {
    const r = buildFromSheets([
      { name: 'list', page: { ...sheet('図面リスト'), texts: [...titled('図面リスト'), t('1階平面図', 200, 300, 14)] } },
      { name: '1f', page: sheet('1階平面図') },
      { name: '2-4f', page: sheet('2～4階平面図') },
      { name: 'rf', page: sheet('R階平面図') },
    ]);
    expect(r.building.floors.map((f) => f.name)).toEqual(['1階', '2階', '3階', '4階']);
    const n = r.building.floors.map((f) => wallsOnFloor(r.building, f.id).length);
    expect(n[0]).toBeGreaterThan(0);
    expect(n[1]).toBe(n[2]);
    expect(n[2]).toBe(n[3]);
    expect(r.report.sheets.find((s) => s.name === 'list')).toMatchObject({ kind: 'other', used: false });
    expect(r.report.sheets.find((s) => s.name === 'rf')?.note).toMatch(/屋上/);
  });
});
