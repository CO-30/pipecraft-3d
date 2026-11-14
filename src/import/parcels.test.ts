import { PbfWriter } from 'pbf';
import { describe, expect, it } from 'vitest';
import { decodeTile } from './parcels';

/** ベクトルタイル（MVT）を 1 層・多角形 1 つで作る（地番の属性付き） */
function mvt(ring: [number, number][], chiban: string): Uint8Array {
  const w = new PbfWriter();
  w.writeMessage(3, (_: unknown, pw: PbfWriter) => {
    pw.writeVarintField(15, 2);
    pw.writeStringField(1, 'fude');
    pw.writeMessage(2, (__: unknown, fw: PbfWriter) => {
      fw.writePackedVarint(2, [0, 0]);
      fw.writeVarintField(3, 3);
      const zz = (n: number) => (n << 1) ^ (n >> 31);
      const g: number[] = [(1 & 7) | (1 << 3), zz(ring[0][0]), zz(ring[0][1]), (2 & 7) | ((ring.length - 1) << 3)];
      for (let i = 1; i < ring.length; i++) g.push(zz(ring[i][0] - ring[i - 1][0]), zz(ring[i][1] - ring[i - 1][1]));
      g.push(7 | (1 << 3));
      fw.writePackedVarint(4, g);
    }, null);
    pw.writeStringField(3, '地番');
    pw.writeMessage(4, (___: unknown, vw: PbfWriter) => vw.writeStringField(1, chiban), null);
    pw.writeVarintField(5, 4096);
  }, null);
  return w.finish();
}

describe('地番図のタイルを読む（decodeTile）', () => {
  it('層ごとに extent と、多角形の点・地番の属性', () => {
    const [l] = decodeTile(mvt([[10, 10], [110, 10], [110, 60]], '123-4'));
    expect(l.extent).toBe(4096);
    expect(l.features).toHaveLength(1);
    expect(l.features[0].type).toBe(3);
    expect(l.features[0].props).toEqual({ 地番: '123-4' });
    expect(l.features[0].rings[0].slice(0, 3)).toEqual([{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 60 }]);
  });
});
