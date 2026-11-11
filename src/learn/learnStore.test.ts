import { describe, expect, it } from 'vitest';
import type { Fixture } from '../model/fixtures';
import { guessFixtures, type WallLine } from '../model/planRead/fixtureGuess';
import { createLearnStore, type KeyValue } from './learnStore';

const walls: WallLine[] = [
  { a: { x: 0, y: 0 }, b: { x: 2120, y: 0 }, thickness: 120, doors: [1500] },
  { a: { x: 0, y: 1720 }, b: { x: 2120, y: 1720 }, thickness: 120 },
  { a: { x: 0, y: 0 }, b: { x: 0, y: 1720 }, thickness: 120 },
  { a: { x: 2120, y: 0 }, b: { x: 2120, y: 1720 }, thickness: 120 },
];
const [tub] = guessFixtures([{ x: 1000, y: 500, s: 'UB' }], walls);

function mem(): KeyValue & { writes: number; m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, writes: 0, getItem: (k) => m.get(k) ?? null, setItem(k, v) { this.writes++; m.set(k, v); }, removeItem: (k) => void m.delete(k) };
}
const fx = (x: number, y: number, rotation: Fixture['rotation']): Record<string, Fixture> => ({ f1: { id: 'f1', floorId: 'F', type: 'bathtub', x, y, rotation } });

describe('直し方の保存と見張り（learnStore）', () => {
  const setup = () => {
    const kv = mem();
    const st = createLearnStore(kv, () => 1000);
    st.watchPlaced('P', [{ id: 'f1', type: 'bathtub', room: tub.room! }]);
    st.onFixtures('P', fx(tub.x, tub.y, tub.rotation));
    return { kv, st };
  };
  it('置いたままなら記録しない。別の置き場所へ動かすと 1 件、もう一度動かしても 1 件（上書き）', () => {
    const { st } = setup();
    expect(st.sampleCount()).toBe(0);
    st.onFixtures('P', fx(480, 840, 270));
    expect(st.loadSamples()).toMatchObject([{ id: 'f1', f: { pos: 'full', door: 'beside' }, flip: true }]);
    st.onFixtures('P', fx(1660, 1260, 0));
    expect(st.loadSamples()).toMatchObject([{ id: 'f1', f: { door: 'opposite' } }]);
  });
  it('最初の位置に戻す・器具を消すと記録を消す。別の工事を開いているときは消さない', () => {
    const { st } = setup();
    st.onFixtures('P', fx(480, 840, 270));
    st.onFixtures('P', fx(tub.x, tub.y, tub.rotation));
    expect(st.sampleCount()).toBe(0);
    st.onFixtures('P', fx(480, 840, 270));
    st.onFixtures('Q', {});
    expect(st.sampleCount()).toBe(1);
    st.onFixtures('P', {});
    expect(st.sampleCount()).toBe(0);
  });
  it('記録が変わらない更新（ドラッグ中など）では書き込まない。別の器具の端末でも読める', () => {
    const { kv, st } = setup();
    st.onFixtures('P', fx(480, 840, 270));
    const n = kv.writes;
    st.onFixtures('P', fx(470, 850, 270));
    st.onFixtures('P', fx(470, 850, 270));
    expect(kv.writes).toBe(n);
    expect(createLearnStore(kv).sampleCount()).toBe(1);
  });
  it('見張っていない器具は記録しない。消すボタンで全部消える', () => {
    const { st } = setup();
    st.onFixtures('P', { g: { id: 'g', floorId: 'F', type: 'bathtub', x: 480, y: 840, rotation: 270 } });
    expect(st.sampleCount()).toBe(0);
    st.onFixtures('P', fx(480, 840, 270));
    st.clearSamples();
    expect(st.sampleCount()).toBe(0);
  });
  it('端末に保存できない環境・壊れたデータでも例外を出さない', () => {
    const bad: KeyValue = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    const st = createLearnStore(bad);
    st.watchPlaced('P', [{ id: 'f1', type: 'bathtub', room: tub.room! }]);
    st.onFixtures('P', fx(480, 840, 270));
    expect(st.sampleCount()).toBe(1); // 今回の間だけは覚えている
    const kv = mem(); kv.m.set('pipecraft3d.fixtureLearn.v1', '{壊れた');
    expect(createLearnStore(kv).sampleCount()).toBe(0);
  });
});
