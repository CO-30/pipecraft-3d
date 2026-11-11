import { describe, expect, it } from 'vitest';
import { FIXTURE_CATALOG } from '../model/fixtures';
import { guessFixtures, type WallLine } from '../model/planRead/fixtureGuess';
import { applyLearned, sampleFor, type LearnSample } from './fixtureLearning';

/** 芯で囲んだ部屋（厚さ 120）。door: [辺, a 端からの距離] */
function box(w: number, h: number, door?: ['B' | 'L', number]): WallLine[] {
  return [
    { a: { x: 0, y: 0 }, b: { x: w, y: 0 }, thickness: 120, ...(door?.[0] === 'B' ? { doors: [door[1]] } : {}) },
    { a: { x: 0, y: h }, b: { x: w, y: h }, thickness: 120 },
    { a: { x: 0, y: 0 }, b: { x: 0, y: h }, thickness: 120, ...(door?.[0] === 'L' ? { doors: [door[1]] } : {}) },
    { a: { x: w, y: 0 }, b: { x: w, y: h }, thickness: 120 },
  ];
}
// 浴室 A: 内法 2000×1600、下の壁に出入口。文字は下寄り → 今までの置き方は下の壁沿い（横）
const roomA = box(2120, 1720, ['B', 1500]);
// 浴室 B: 内法 1600×2000（向きの違う別の図面）、左の壁に出入口
const roomB = box(1720, 2120, ['L', 1500]);

describe('直し方を覚えて合わせる（fixtureLearning）', () => {
  it('部屋の名前から出した候補に部屋の情報が付く。位置・向きは今までどおり', () => {
    const [c] = guessFixtures([{ x: 1000, y: 500, s: 'UB1618' }], roomA);
    expect(c).toMatchObject({ type: 'bathtub', rotation: 180, room: { name: 'UB', first: 'B1' } });
    expect(c.y).toBe(60 + FIXTURE_CATALOG.bathtub.size.d / 2);
  });
  it('記録が無ければ候補はそのまま', () => {
    const c = guessFixtures([{ x: 1000, y: 500, s: 'UB' }], roomA);
    expect(applyLearned(c, [])).toEqual(c);
  });
  it('最初の置き場所のまま・当てはまらない所へ動かしたときは記録しない', () => {
    const [c] = guessFixtures([{ x: 1000, y: 500, s: 'UB' }], roomA);
    expect(sampleFor('f1', 'bathtub', c.room!, { x: c.x, y: c.y, rotation: c.rotation }, 1)).toBeNull();
    expect(sampleFor('f1', 'bathtub', c.room!, { x: 1060, y: 860, rotation: 90 }, 1)).toBeNull();
  });
  it('浴槽を左の壁沿い（縦）に直した記録 1 件で、向きの違う別の浴室でも 出入口の横の短い辺 に置く', () => {
    const [a] = guessFixtures([{ x: 1000, y: 500, s: 'UB' }], roomA);
    // 使う人が回して左の壁へ（奥が部屋の内側を向く逆向き = flip）
    const s = sampleFor('f1', 'bathtub', a.room!, { x: 480, y: 840, rotation: 270 }, 1)!;
    expect(s).toMatchObject({ type: 'bathtub', room: 'UB', flip: true, f: { wall: 'short', door: 'beside', pos: 'full', label: false } });
    const [b] = applyLearned(guessFixtures([{ x: 800, y: 600, s: '浴室' }], roomB), [s]);
    // 上の辺（短い・出入口の横・文字から遠い）。flip を反映して 0 + 180
    expect(b).toMatchObject({ x: 860, y: 2060 - 400, rotation: 180, learned: 1, room: { first: 'T0', flip: true } });
  });
  it('同じ部屋の 2 つの器具は同じ置き場所に重ねない', () => {
    const walls = box(2620, 2120, ['B', 2200]);
    const c = guessFixtures([{ x: 1300, y: 1000, s: '洗面' }], walls);
    const want = (id: string, type: 'washbasin' | 'washer'): LearnSample => ({ id, type, room: '洗面', f: { wall: 'long', door: 'opposite', pos: 'farDoor', label: false }, flip: false, at: 1 });
    const [p, q] = applyLearned(c, [want('a', 'washbasin'), want('b', 'washer')]);
    const sz = (t: 'washbasin' | 'washer') => FIXTURE_CATALOG[t].size;
    const half = (t: 'washbasin' | 'washer', r: number) => (r % 180 === 0 ? sz(t).w / 2 : sz(t).d / 2);
    expect([p.rotation, q.rotation]).toEqual([0, 0]); // どちらも上の辺
    expect(Math.abs(p.x - q.x)).toBeGreaterThanOrEqual(half('washbasin', p.rotation) + half('washer', q.rotation));
  });
  it('後に続く記録の無い器具（そのままの位置）と重なる置き場所には、記録のある器具を置かない', () => {
    const walls = box(2620, 2120, ['B', 2200]);
    const c = guessFixtures([{ x: 1300, y: 1000, s: '洗面' }], walls);
    const [basin, washer] = c;
    // 洗面台の記録だけ。洗濯機の今の位置（下の壁ぎわ）に重なる置き場所を望む
    const want = basin.room!.slots.filter((x) => x.side === 'B').sort((p, q) => Math.abs(p.x - washer.x) - Math.abs(q.x - washer.x))[0];
    const out = applyLearned(c, [{ id: 'a', type: 'washbasin', room: '洗面', f: want.f, flip: false, at: 1 }]);
    const r = (t: 'washbasin' | 'washer', x: number, y: number, rot: number) => { const { w, d } = FIXTURE_CATALOG[t].size; const hx = (rot % 180 === 0 ? w : d) / 2, hy = (rot % 180 === 0 ? d : w) / 2; return { x0: x - hx, x1: x + hx, y0: y - hy, y1: y + hy }; };
    const p = r('washbasin', out[0].x, out[0].y, out[0].rotation), q = r('washer', out[1].x, out[1].y, out[1].rotation);
    expect(out[1]).toMatchObject({ x: washer.x, y: washer.y }); // 記録の無い洗濯機はそのまま
    expect(p.x0 < q.x1 - 5 && q.x0 < p.x1 - 5 && p.y0 < q.y1 - 5 && q.y0 < p.y1 - 5).toBe(false);
  });
});
