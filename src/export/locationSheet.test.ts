import { describe, expect, test } from 'vitest';
import { GSI_STD_CREDIT, scaleBarMeters } from '../model/locationMap';
import { findTextOverlaps, textWidth } from './labelLayout';
import { MAP_FRAME, MAP_PX, renderLocationSheet } from './locationSheet';
import type { Op } from './sheet';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const map = { href: PNG, wPx: MAP_PX.w, hPx: MAP_PX.h, mpp: 1.07 };
const base = { siteName: '新垣邸 新築工事', address: '沖縄県沖縄市仲宗根町1-1', date: new Date(2026, 10, 12) };
const texts = (ops: Op[]) => ops.filter((o): o is Extract<Op, { t: 'text' }> => o.t === 'text').map((o) => o.s);

describe('見取図（案内図）の作図', () => {
  test('A4 縦。地図が枠いっぱいに入り、工事場所の印が枠の中心にある', () => {
    const sh = renderLocationSheet({ ...base, map });
    expect([sh.width, sh.height]).toEqual([210, 297]);
    const img = sh.ops.find((o) => o.t === 'image');
    expect(img).toMatchObject({ x: MAP_FRAME.x, y: MAP_FRAME.y, w: MAP_FRAME.w, h: MAP_FRAME.h, href: PNG });
    const cx = MAP_FRAME.x + MAP_FRAME.w / 2, cy = MAP_FRAME.y + MAP_FRAME.h / 2;
    expect(sh.ops.some((o) => o.t === 'circle' && o.cx === cx && o.cy === cy && o.fill)).toBe(true);
    expect(texts(sh.ops)).toEqual(expect.arrayContaining(['見取図（案内図）', '工事場所', 'N', GSI_STD_CREDIT]));
    expect(texts(sh.ops).some((s) => s.includes('沖縄県沖縄市仲宗根町1-1'))).toBe(true);
    expect(MAP_PX.w / MAP_PX.h).toBeCloseTo(MAP_FRAME.w / MAP_FRAME.h, 2);
  });

  test('目盛りの長さは地図の縮尺どおり', () => {
    const sh = renderLocationSheet({ ...base, map });
    const mPerMm = (map.mpp * map.wPx) / MAP_FRAME.w;
    const m = scaleBarMeters(mPerMm, 40);
    expect(texts(sh.ops)).toContain(`${m}m`);
    const bar = sh.ops.find((o) => o.t === 'line' && o.w === 0.8);
    expect(bar && bar.t === 'line' ? bar.x2 - bar.x1 : 0).toBeCloseTo(m / mPerMm, 3);
  });

  test('地図が無いときは枠と手描きの案内', () => {
    const sh = renderLocationSheet({ ...base, map: null });
    expect(sh.ops.some((o) => o.t === 'image')).toBe(false);
    expect(texts(sh.ops).some((s) => s.includes('地図を取得できませんでした'))).toBe(true);
    expect(texts(sh.ops)).not.toContain(GSI_STD_CREDIT);
  });

  test('長い住所・現場名でも用紙からはみ出さず、文字が重ならない', () => {
    const long = { siteName: 'ＰｉｐｅＣｒａｆｔ共同住宅新築工事に伴う給排水衛生設備工事（第二期）その１', address: '沖縄県中頭郡北中城村字安谷屋一丁目二番三号 アパートメント北中城グランドヒルズ 第二棟 二〇三号室', date: base.date };
    for (const m of [map, null]) {
      const sh = renderLocationSheet({ ...long, map: m });
      expect(findTextOverlaps(sh)).toEqual([]);
      for (const o of sh.ops) if (o.t === 'text' && !o.rotate) {
        const w = textWidth(o.s, o.size), x1 = o.anchor === 'middle' ? o.x - w / 2 : o.anchor === 'end' ? o.x - w : o.x;
        expect(x1).toBeGreaterThanOrEqual(9.99); expect(x1 + w).toBeLessThanOrEqual(200.01);
      }
    }
  });
});
