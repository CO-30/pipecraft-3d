import { describe, expect, test } from 'vitest';
import { createBuildingFromDims } from '../model/building';
import type { Doc } from '../model/doc';
import { emptyNetwork } from '../model/network';
import { placeFixture, type FixtureType } from '../model/fixtures';
import { findTextOutside as outside, findTextOverlaps } from '../export/labelLayout';
import { EMPTY_CONTRACTOR } from './types';
import { fixtureProducts, renderNanbuProductSheets } from './fixtureProducts';

function house(types: FixtureType[]): Doc {
  const building = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  let doc: Doc = { building, network: emptyNetwork(), fixtures: {} };
  types.forEach((t, i) => { doc = placeFixture(doc, building.floors[0].id, t, { x: 500 + i * 600, y: 3000 }).doc; });
  return doc;
}
const FULL: FixtureType[] = ['toilet', 'toilet', 'washbasin', 'kitchen', 'waterHeater', 'shower', 'bathtub', 'washer', 'outdoorFaucet', 'outdoorFaucet', 'waterHeader', 'waterMeter'];

describe('製品一覧表の行は器具とヘッダーから（受理された実物の書き方）', () => {
  test('種類ごとに個数。名前と単位は実物どおり。メーター・マスは出さない', () => {
    const rows = fixtureProducts(house(FULL), {}, {});
    expect(rows.map((r) => `${r.name} ${r.qty}`)).toEqual([
      'PB管継手 ヘッダー6P 1個', '洋風大便器 2台', '洗面化粧台 1台', '流し用混合水栓 1個', '給湯器 1台', 'シャワー水栓 混合水栓 1個', '洗濯用水栓 1個', '散水栓 2個',
    ]);
  });
  test('認証の初期値: 器具は日水協・第三者認証、ヘッダー・水栓類は JIS', () => {
    const rows = fixtureProducts(house(FULL), {}, {});
    const cert = Object.fromEntries(rows.map((r) => [r.name, r.cert]));
    expect(cert['洋風大便器']).toBe('jwwa');
    expect(cert['給湯器']).toBe('jwwa');
    expect(cert['PB管継手 ヘッダー6P']).toBe('jis');
    expect(cert['散水栓']).toBe('jis');
  });
  test('メーカー・認証は 入力 → この端末の覚え → 初期値 の順', () => {
    const rows = fixtureProducts(house(['toilet', 'washbasin']), { 'product.toilet.maker': '(株)テスト' }, { toilet: { maker: '覚えた会社', cert: 'self' }, washbasin: { maker: '洗面の会社' } });
    expect(rows[0]).toMatchObject({ key: 'toilet', maker: '(株)テスト', cert: 'self' });
    expect(rows[1]).toMatchObject({ key: 'washbasin', maker: '洗面の会社', cert: 'jwwa' });
  });
  test('図に無い製品（食洗機・手洗器など）は「追加の行」から', () => {
    const rows = fixtureProducts(house(['toilet']), { 'product.extra': '食洗機／1個／テスト電機\n手洗器, 1個\n\n' }, {});
    expect(rows.slice(1).map((r) => [r.name, r.qty, r.maker, r.cert])).toEqual([['食洗機', '1個', 'テスト電機', 'jwwa'], ['手洗器', '1個', '', 'jwwa']]);
  });
  test('浴槽だけ（シャワーを置いていない）でもシャワー水栓 1 個', () => {
    expect(fixtureProducts(house(['bathtub']), {}, {}).map((r) => r.name)).toEqual(['シャワー水栓 混合水栓']);
  });
});

describe('製品一覧表（南部水道企業団の様式、A4 横）', () => {
  const c = { ...EMPTY_CONTRACTOR, name: 'テスト設備', address: '那覇市テスト1-1', representative: '代表 太郎', chiefEngineer: '主任 花子' };
  test('選んだ認証の欄に ○、見出しと会社', () => {
    const [s] = renderNanbuProductSheets(fixtureProducts(house(FULL), {}, {}), { date: new Date(2026, 10, 16) }, c);
    expect([s.width, s.height]).toEqual([297, 210]);
    const t = s.ops.filter((o) => o.t === 'text').map((o) => (o as { s: string }).s);
    expect(t).toContain('給水装置使用製品一覧表');
    expect(t).toContain('JIS表示品');
    expect(t).toContain('洋風大便器');
    expect(t).toContain('テスト設備');
    expect(t.filter((x) => x === '○').length).toBe(8);
    expect(findTextOverlaps(s)).toEqual([]);
    expect(outside(s)).toEqual([]);
  });
  test('器具 0 個でも 1 枚。17 行なら 2 枚。長い名前でも重なり・はみ出し 0', () => {
    expect(renderNanbuProductSheets([], { date: new Date() }, EMPTY_CONTRACTOR)).toHaveLength(1);
    const many = Array.from({ length: 17 }, (_, i) => ({ key: `x${i}`, name: `とても長い製品の名前の例その${i}（型番 ABC-1234567890）`, qty: '10個', maker: '株式会社とても長いメーカーの名前ホールディングス', cert: 'jis' as const }));
    const sheets = renderNanbuProductSheets(many, { date: new Date() }, { ...c, address: '沖縄県島尻郡南風原町字テスト千二百三十四番地の五 テストビルディング三階', name: '株式会社テスト設備工業所 南部営業所' });
    expect(sheets).toHaveLength(2);
    for (const s of sheets) { expect(findTextOverlaps(s)).toEqual([]); expect(outside(s)).toEqual([]); }
  });
});
