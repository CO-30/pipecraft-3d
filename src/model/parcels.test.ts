import { describe, expect, it } from 'vitest';
import { toLocalMm, worldPx } from './geo';
import { parcelLabel, parcelsFromTile, parcelTiles, PARCEL_ZOOM, type TileFeature } from './parcels';

const origin = { lat: 26.2124, lon: 127.6809 }; // 那覇市の辺り

/** 緯度経度 → タイル z/x/y の中の座標（extent 4096） */
function inTile(p: { lat: number; lon: number }, z: number) {
  const w = worldPx(p, z);
  const x = Math.floor(w.x / 256), y = Math.floor(w.y / 256);
  return { tile: { z, x, y, extent: 4096 }, px: { x: ((w.x / 256) - x) * 4096, y: ((w.y / 256) - y) * 4096 } };
}

describe('地番図のタイル（登記所備付地図）', () => {
  it('地点の周り sizeM 四方を覆うタイル（z は地番図のいちばん細かい段）', () => {
    const t = parcelTiles(origin, 120);
    expect(t.length).toBeGreaterThanOrEqual(1);
    expect(t.length).toBeLessThanOrEqual(4);
    expect(t.every((k) => k.z === PARCEL_ZOOM)).toBe(true);
    const c = inTile(origin, PARCEL_ZOOM).tile;
    expect(t.some((k) => k.x === c.x && k.y === c.y)).toBe(true);
  });

  it('タイルの中の座標 → 地点を原点にした図面の座標(mm)。1m 以内の誤差', () => {
    const p = { lat: origin.lat + 0.0002, lon: origin.lon + 0.0003 };
    const { tile, px } = inTile(p, PARCEL_ZOOM);
    const [parcel] = parcelsFromTile([{ type: 3, rings: [[px, { x: px.x + 10, y: px.y }, { x: px.x, y: px.y + 10 }]], props: {} }], tile, origin);
    const want = toLocalMm(origin, p);
    expect(Math.hypot(parcel.rings[0][0].x - want.x, parcel.rings[0][0].y - want.y)).toBeLessThan(1000);
    // 北が +y（タイルは下が +y なので反転）
    expect(parcel.rings[0][2].y).toBeLessThan(parcel.rings[0][0].y);
  });

  it('多角形でないもの（点・線）は使わない。地番は属性から', () => {
    const { tile } = inTile(origin, PARCEL_ZOOM);
    const f: TileFeature[] = [
      { type: 1, rings: [[{ x: 1, y: 1 }]], props: { 地番: '1' } },
      { type: 3, rings: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]], props: { 地番: '123-4', 大字名: '泉崎' } },
    ];
    const r = parcelsFromTile(f, tile, origin);
    expect(r).toHaveLength(1);
    expect(r[0].label).toBe('123-4');
  });

  it('地番の属性名がデータによって違っても拾う（地番・chiban・筆界未定地は付けない）', () => {
    expect(parcelLabel({ 地番: '45-2' })).toBe('45-2');
    expect(parcelLabel({ chiban: '7' })).toBe('7');
    expect(parcelLabel({ 'properties.地番': '9-1' })).toBe('9-1');
    expect(parcelLabel({ 地番: '筆界未定地' })).toBeUndefined();
    expect(parcelLabel({ 座標系: '公共座標15系' })).toBeUndefined();
  });

  it('タイルの端で切られた辺（本当の境界ではない）は「描かない」印を付ける', () => {
    const { tile } = inTile(origin, PARCEL_ZOOM);
    const ring = [{ x: 4000, y: 100 }, { x: 4096 + 64, y: 100 }, { x: 4096 + 64, y: 300 }, { x: 4000, y: 300 }];
    const [p] = parcelsFromTile([{ type: 3, rings: [ring], props: {} }], tile, origin);
    // 辺 0: 中→外へ（描く）、辺 1: タイルの外の縦線（描かない）、辺 2: 外→中（描く）、辺 3: 中の縦線（描く）
    expect(p.hidden[0]).toEqual([false, true, false, false]);
  });
});
