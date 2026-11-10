import { describe, expect, it } from 'vitest';
import { emptyDoc } from '../../state/store';
import { addFloor, addWall, emptyBuilding } from '../building';
import type { Doc } from '../doc';
import { DEFAULT_DROP_DEPTH, dropFixturePipes } from '../dropPipes';
import { FIXTURE_CATALOG, placeFixture, portNodes, validateFixtures } from '../fixtures';
import { segmentsAt, validateNetwork } from '../network';
import { buildFromSheets } from './assemble';
import { guessFixtures, type WallLine } from './fixtureGuess';
import { D, W, planSheet } from './testHouse';

const walls: WallLine[] = [
  { a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 120 },
  { a: { x: 0, y: 0 }, b: { x: 0, y: 3000 }, thickness: 120 },
  { a: { x: 0, y: 3000 }, b: { x: 4000, y: 3000 }, thickness: 120 },
  { a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 }, thickness: 120 },
];

describe('器具の候補（fixtureGuess）', () => {
  it('器具の名前の文字は、その文字の位置に置く', () => {
    const c = guessFixtures([{ x: 4600, y: 1000, s: '立水栓' }, { x: 2000, y: 3300, s: '給湯器' }, { x: 300, y: 2500, s: '壁水栓H1300' }], walls);
    expect(c.map((x) => [x.type, x.x, x.y, x.near])).toEqual([['outdoorFaucet', 4600, 1000, true], ['waterHeater', 2000, 3300, true], ['faucet', 300, 2500, true]]);
    expect(c[0].source).toBe('「立水栓」の文字');
  });
  it('部屋の名前からは、文字にいちばん近い壁ぎわへ、奥を壁に向けて置く', () => {
    const [t] = guessFixtures([{ x: 600, y: 1500, s: 'WC' }], walls);
    // 西の壁（x = 0）: 壁の面（60）+ 奥行 700 の半分
    expect(t).toMatchObject({ type: 'toilet', x: 410, y: 1500, rotation: 90, near: false, source: '「WC」の部屋' });
    const [k] = guessFixtures([{ x: 2000, y: 2600, s: 'ＬＤＫ' }], walls);
    expect(k).toMatchObject({ type: 'kitchen', x: 2000, rotation: 0 });
    expect(k.y).toBe(3000 - 60 - FIXTURE_CATALOG.kitchen.size.d / 2);
    const [s] = guessFixtures([{ x: 2000, y: 400, s: 'UB' }], walls);
    expect(s).toMatchObject({ type: 'bathtub', rotation: 180 });
    const [e] = guessFixtures([{ x: 3500, y: 1500, s: '便所' }], walls);
    expect(e.rotation).toBe(270);
  });
  it('洗面の部屋には洗面台と洗濯機を横に並べる。続けて書かれた文字（「洗面 床目地」）も読む', () => {
    const c = guessFixtures([{ x: 2000, y: 2600, s: '洗面 床目地' }], walls);
    expect(c.map((x) => x.type)).toEqual(['washbasin', 'washer']);
    expect(c[1].x - c[0].x).toBe(1000);
  });
  it('凡例・注記・部屋名でない文字は候補にしない。同じ器具が文字と部屋の両方から出たら文字の方を採る', () => {
    expect(guessFixtures([{ x: 9000, y: 1000, s: '立水栓' }, { x: 2000, y: 1500, s: '洗面化粧台合わせ' }, { x: 2000, y: 1000, s: '展開図参照' }, { x: 1000, y: 1000, s: 'WIC' }, { x: 1500, y: 1500, s: 'ダイソン掃除機想定' }], walls)).toEqual([]);
    const c = guessFixtures([{ x: 600, y: 1500, s: 'トイレ' }, { x: 500, y: 1000, s: '便器' }], walls);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ type: 'toilet', near: true });
  });
  it('「設置予定」の器具は候補にし、「〜用」の付属品は候補にしない', () => {
    const c = guessFixtures([{ x: 2000, y: 3300, s: '給湯器設置予定' }, { x: 4600, y: 500, s: '立水栓(新設予定)' }, { x: 1000, y: 1000, s: '給湯器用コンセント' }, { x: 3000, y: 1000, s: '洗濯機用水栓' }, { x: 1000, y: 2000, s: 'UB(防水パン)' }], walls);
    expect(c.map((x) => x.type)).toEqual(['waterHeater', 'outdoorFaucet']);
  });
  it('同じ器具を指す文字は 1 つにする。離れた同じ名前の部屋は別々に置く', () => {
    expect(guessFixtures([{ x: 500, y: 1000, s: '便器' }, { x: 900, y: 1300, s: 'ウォシュレット' }], walls)).toHaveLength(1);
    const two = guessFixtures([{ x: 600, y: 800, s: 'WC' }, { x: 600, y: 2300, s: 'WC' }, { x: 600, y: 2310, s: 'WC' }], walls);
    expect(two.map((x) => x.type)).toEqual(['toilet', 'toilet']);
    // 部屋の文字から遠い壁へ寄せても、その部屋の「便器」の文字とは同じ器具
    const big = guessFixtures([{ x: 2000, y: 1500, s: 'トイレ' }, { x: 2600, y: 1500, s: '便器' }], walls);
    expect(big).toHaveLength(1);
    expect(big[0].near).toBe(true);
  });
  it('部屋の名前: 寸法の数字付き・続け書き・半角カナも読む。「キッチン」があれば「LDK」からは置かない', () => {
    expect(guessFixtures([{ x: 2000, y: 400, s: 'UB1616' }], walls).map((x) => x.type)).toEqual(['bathtub']);
    expect(guessFixtures([{ x: 2000, y: 400, s: 'UB WC' }], walls).map((x) => x.type)).toEqual(['bathtub', 'toilet']);
    expect(guessFixtures([{ x: 2000, y: 400, s: 'ﾄｲﾚ' }], walls).map((x) => x.type)).toEqual(['toilet']);
    const k = guessFixtures([{ x: 2000, y: 1500, s: 'LDK' }, { x: 2000, y: 2700, s: 'ｷｯﾁﾝ' }], walls);
    expect(k.map((x) => x.source)).toEqual(['「ｷｯﾁﾝ」の部屋']);
    expect(guessFixtures([{ x: 2000, y: 1500, s: 'K' }, { x: 1000, y: 1500, s: 'UT' }], walls)).toEqual([]);
  });
  it('壁の端に近い文字でも、器具は壁の内側に収める（2 つ目は空いている側へ）', () => {
    const [k] = guessFixtures([{ x: 3500, y: 2800, s: 'キッチン' }], walls);
    expect(k.x).toBe(4000 - FIXTURE_CATALOG.kitchen.size.w / 2);
    const c = guessFixtures([{ x: 3800, y: 2850, s: '洗面' }], walls);
    expect(c[0].x).toBe(4000 - 375);
    expect(c[1].x).toBe(2800); // 右は壁の外なので左へ
    expect(c.every((x) => x.x > 0 && x.x < 4000 && x.y > 0 && x.y < 3000)).toBe(true);
  });
  it('壁が無くても文字の位置に置く', () => {
    const c = guessFixtures([{ x: 100, y: 200, s: 'WC' }], []);
    expect(c[0]).toMatchObject({ type: 'toilet', x: 100, y: 200, rotation: 0 });
  });
  it('図面一式から候補が出る（凡例の立水栓は除く）', () => {
    const r = buildFromSheets([{ name: 'a', page: planSheet() }]);
    expect(r.fixtures.map((f) => f.type).sort()).toEqual(['kitchen', 'outdoorFaucet', 'toilet', 'washbasin', 'washer']);
    expect(r.fixtures.every((f) => f.floorId === r.building.floors[0].id)).toBe(true);
    const wc = r.fixtures.find((f) => f.type === 'toilet')!;
    expect(wc.x).toBeGreaterThan(0); expect(wc.x).toBeLessThan(W); expect(wc.y).toBeLessThan(D);
    expect(r.report.found.join()).toContain('器具の候補 5 個');
  });
});

describe('器具の真下に配管を落とす（dropPipes）', () => {
  const base = () => {
    let b = emptyBuilding();
    const f = addFloor(b, { height: 2800 });
    b = addWall(f.b, f.floorId, { x: 0, y: 0 }, { x: 4000, y: 0 }).b;
    let doc: Doc = { ...emptyDoc(), building: b, site: { designGL: -600 } };
    const ids: Record<string, string> = {};
    for (const [type, x] of [['toilet', 1000], ['washbasin', 2000], ['outdoorFaucet', 5000], ['waterHeater', 6000], ['manholeSewage', 7000]] as const) {
      const r = placeFixture(doc, f.floorId, type, { x, y: 1000 });
      doc = r.doc; ids[type] = r.fixtureId!;
    }
    return { doc, ids };
  };
  it('給水・給湯・排水の接続口から床下へ立て管を作る。給湯器・マスは対象外、屋外の水栓は地中へ', () => {
    const { doc, ids } = base();
    const r = dropFixturePipes(doc);
    expect(r).toMatchObject({ pipes: 2 + 3 + 1, fixtures: 3 });
    expect(validateNetwork(r.doc.network)).toEqual([]);
    expect(validateFixtures(r.doc)).toEqual([]);
    const ends = (id: string) => portNodes(r.doc.network, id).map((n) => {
      const [s] = segmentsAt(r.doc.network, n.id);
      const o = r.doc.network.nodes[s.a === n.id ? s.b : s.a];
      return { system: s.system, diameter: s.diameter, dx: o.pos.x - n.pos.x, dy: o.pos.y - n.pos.y, z: o.pos.z };
    });
    expect(ends(ids.toilet).map((e) => [e.system, e.diameter, e.dx, e.dy, e.z]).sort()).toEqual([['sewage', 75, 0, 0, -DEFAULT_DROP_DEPTH], ['water', 13, 0, 0, -DEFAULT_DROP_DEPTH]]);
    expect(ends(ids.outdoorFaucet)[0].z).toBe(-600 - 300);
    for (const id of [ids.waterHeater, ids.manholeSewage]) expect(portNodes(r.doc.network, id).every((n) => segmentsAt(r.doc.network, n.id).length === 0)).toBe(true);
  });
  it('2 階の器具はその階の床下へ。深さは 50〜1000 に収める', () => {
    let b = emptyBuilding();
    b = addFloor(b, { height: 2800 }).b;
    const f2 = addFloor(b, { height: 2800 });
    b = addWall(f2.b, f2.floorId, { x: 0, y: 0 }, { x: 4000, y: 0 }).b;
    const placed = placeFixture({ ...emptyDoc(), building: b }, f2.floorId, 'toilet', { x: 1000, y: 1000 });
    const z = (depth: number) => Object.values(dropFixturePipes(placed.doc, depth).doc.network.nodes).filter((n) => !n.fixtureId).map((n) => n.pos.z);
    expect(z(300)).toEqual([2500, 2500]);
    expect(z(9999)).toEqual([1800, 1800]);
    expect(z(NaN)).toEqual([2500, 2500]);
  });
  it('配管のつながっている接続口には足さない（2 回押しても増えない）。深さ・器具を指定できる', () => {
    const { doc, ids } = base();
    const once = dropFixturePipes(doc, 500, [ids.toilet]);
    expect(once.pipes).toBe(2);
    expect(Object.values(once.doc.network.nodes).filter((n) => !n.fixtureId).every((n) => n.pos.z === -500)).toBe(true);
    const again = dropFixturePipes(once.doc, 500, [ids.toilet]);
    expect(again.pipes).toBe(0);
    expect(again.doc).toBe(once.doc);
    expect(dropFixturePipes(once.doc, 500).pipes).toBe(4);
  });
});
