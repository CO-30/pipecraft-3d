import { describe, expect, test } from 'vitest';
import { worldPx } from './geo';
import { GSI_STD_URL, mapTiles, offsetLatLon, readMapSettings, scaleBarMeters, writeMapSettings } from './locationMap';

const OKINAWA = { lat: 26.3344, lon: 127.8056 };

describe('mapTiles', () => {
  test('中心が画像の中央に来て、タイルが画像全体を覆う', () => {
    const z = 17, w = 1100, h = 1360;
    const r = mapTiles(OKINAWA, z, w, h);
    const c = worldPx(OKINAWA, z);
    // どのタイルでも「タイル左上の世界画素 − 画像左上の世界画素」= dx,dy
    for (const t of r.tiles) {
      expect(t.dx).toBeCloseTo(t.x * 256 - (c.x - w / 2), 6);
      expect(t.dy).toBeCloseTo(t.y * 256 - (c.y - h / 2), 6);
      expect(t.url).toBe(GSI_STD_URL.replace('{z}', '17').replace('{x}', String(t.x)).replace('{y}', String(t.y)));
    }
    const minX = Math.min(...r.tiles.map((t) => t.dx)), maxX = Math.max(...r.tiles.map((t) => t.dx + 256));
    const minY = Math.min(...r.tiles.map((t) => t.dy)), maxY = Math.max(...r.tiles.map((t) => t.dy + 256));
    expect(minX).toBeLessThanOrEqual(0); expect(maxX).toBeGreaterThanOrEqual(w);
    expect(minY).toBeLessThanOrEqual(0); expect(maxY).toBeGreaterThanOrEqual(h);
    // 余分なタイルは無い
    expect(r.tiles.every((t) => t.dx < w && t.dx + 256 > 0 && t.dy < h && t.dy + 256 > 0)).toBe(true);
    expect(r.mpp).toBeGreaterThan(1.0); expect(r.mpp).toBeLessThan(1.1); // 北緯 26 度・z17 で約 1.07 m/画素
  });
});

describe('offsetLatLon', () => {
  test('ずれ 0 は同じ点、画素のずれは世界画素のずれに一致', () => {
    const p0 = offsetLatLon(OKINAWA, 17, 0, 0);
    expect(p0.lat).toBeCloseTo(OKINAWA.lat, 9); expect(p0.lon).toBeCloseTo(OKINAWA.lon, 9);
    const p = offsetLatLon(OKINAWA, 17, 120, -80);
    const a = worldPx(OKINAWA, 17), b = worldPx(p, 17);
    expect(b.x - a.x).toBeCloseTo(120, 4); expect(b.y - a.y).toBeCloseTo(-80, 4);
    expect(p.lat).toBeGreaterThan(OKINAWA.lat); // 上（y 負）は北
  });
});

describe('scaleBarMeters', () => {
  test('1・2・5 × 10^n で、用紙の長さが上限以下の最大', () => {
    expect(scaleBarMeters(6.4, 40)).toBe(200); // 200m = 31mm、500m = 78mm は長すぎ
    expect(scaleBarMeters(1, 40)).toBe(20);
    expect(scaleBarMeters(3.2, 30)).toBe(50);
  });
});

describe('mitori 設定', () => {
  test('往復し、不正な値は捨てる', () => {
    const app = writeMapSettings({ other: 'x' }, { lat: 26.3, lon: 127.8, title: '沖縄市仲宗根町', zoom: 18 });
    expect(app.other).toBe('x');
    expect(readMapSettings(app)).toEqual({ lat: 26.3, lon: 127.8, title: '沖縄市仲宗根町', zoom: 18 });
    expect(readMapSettings({ 'mitori.lat': 'abc', 'mitori.lon': '500', 'mitori.zoom': '9' })).toEqual({ zoom: 17 });
    expect(readMapSettings(undefined)).toEqual({ zoom: 17 });
  });
});
