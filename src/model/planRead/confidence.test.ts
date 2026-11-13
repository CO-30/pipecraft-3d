import { describe, expect, it } from 'vitest';
import { buildFromSheets } from './assemble';
import { checkItems, fixtureSure } from './confidence';
import { planSheet } from './testHouse';

describe('確からしさ（要確認の一覧）', () => {
  it('読めなかった（低）→ 推定・目安（中）→ お知らせ の順に並べ、数を数える', () => {
    const r = checkItems({ sheets: [], found: [], check: ['a', 'b', 'c', 'd'], levels: ['info', 'mid', 'low'] });
    expect(r.items.map((i) => [i.text, i.level])).toEqual([['c', 'low'], ['b', 'mid'], ['d', 'mid'], ['a', 'info']]);
    expect(r.count).toEqual({ low: 1, mid: 2, info: 1 });
  });
  it('平面図だけ読んだとき: 基礎伏図・立面図が無いのは「低」、壁のロックはお知らせ', () => {
    const { report } = buildFromSheets([{ name: 'p', page: planSheet() }]);
    const r = checkItems(report);
    expect(r.items.find((i) => i.text.includes('基礎伏図が無い'))?.level).toBe('low');
    expect(r.items.find((i) => i.text.includes('ロックしています'))?.level).toBe('info');
    expect(r.items.find((i) => i.text.includes('立面図が無い'))?.level).toBe('mid');
    expect(report.levels).toHaveLength(report.check.length);
  });
  it('器具の位置: 器具の名前の文字のそば = 確か、部屋の名前から = 大まか', () => {
    expect(fixtureSure({ near: true })).toBe(true);
    expect(fixtureSure({ near: false })).toBe(false);
  });
});
