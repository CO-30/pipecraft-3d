/**
 * 床下のポリブテン管（柔らかい管）は、横の排水管の上を角度をもって横切るときは、またいで通す（干渉にしない）。
 * 平行に重なる・立て管を貫く・排水管の下をくぐる所は今までどおり干渉（2026-11-16 実物で要確認に出ていた）
 */
import { describe, expect, it } from 'vitest';
import { findPipeClashes } from './clash';
import { addPolyline, emptyNetwork, type Vec3 } from './network';
import type { Doc } from './doc';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const docOf = (pb: Vec3[], drain: Vec3[]): Doc => {
  const a = addPolyline(emptyNetwork(), drain, { system: 'drain', diameter: 50 });
  const b = addPolyline(a.net, pb, { system: 'water', diameter: 13, material: 'PB保温5mm' });
  return { network: b.net } as Doc;
};

describe('PB と排水管の交差', () => {
  it('PB が排水管の上を直角に横切る → 干渉にしない（またいで通す）', () => {
    expect(findPipeClashes(docOf([v(-1000, 0, -300), v(1000, 0, -300)], [v(0, -1000, -320), v(0, 1000, -340)]))).toEqual([]);
  });
  it('PB が排水管の下をくぐる・平行に重なる・立て管を貫く → 干渉', () => {
    expect(findPipeClashes(docOf([v(-1000, 0, -340), v(1000, 0, -340)], [v(0, -1000, -320), v(0, 1000, -320)]))).toHaveLength(1);
    expect(findPipeClashes(docOf([v(-1000, 10, -300), v(1000, 10, -300)], [v(-1000, 0, -310), v(1000, 0, -310)]))).toHaveLength(1);
    expect(findPipeClashes(docOf([v(-1000, 0, -300), v(1000, 0, -300)], [v(0, 0, 0), v(0, 0, -480)]))).toHaveLength(1);
  });
});

describe('PB の立て管が横の排水管の上で止まる', () => {
  it('上で止まって横へ曲がる → 干渉にしない。排水管を貫いて下まで行く → 干渉', () => {
    expect(findPipeClashes(docOf([v(0, 0, 400), v(0, 0, -300)], [v(-1000, 0, -320), v(1000, 0, -330)]))).toEqual([]);
    expect(findPipeClashes(docOf([v(0, 0, 400), v(0, 0, -450)], [v(-1000, 0, -320), v(1000, 0, -330)]))).toHaveLength(1);
  });
});
