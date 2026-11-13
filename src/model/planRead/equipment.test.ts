import { describe, expect, it } from 'vitest';
import { equipmentQuantities, isEquipmentSheet, parsePipeLabel, readEquipment } from './equipment';
import type { PText } from './sheet';

const t = (s: string, x = 0, y = 0): PText => ({ x, y, h: 4, s });

describe('設備図（申請図）の配管の表示を読む', () => {
  it('「管種 口径×長さ(m)」と、長さの無い「管種 口径」', () => {
    expect(parsePipeLabel('PB13×7.1')).toEqual({ material: 'PB', diameter: 13, length: 7.1 });
    expect(parsePipeLabel('VU100×7.8')).toEqual({ material: 'VU', diameter: 100, length: 7.8 });
    expect(parsePipeLabel('HI20×2.6')).toEqual({ material: 'HI', diameter: 20, length: 2.6 });
    expect(parsePipeLabel('ＶＵ５０')).toEqual({ material: 'VU', diameter: 50 });
    expect(parsePipeLabel('100VU')).toEqual({ material: 'VU', diameter: 100 });
    expect(parsePipeLabel('HIVP 20 x 3.5')).toEqual({ material: 'HIVP', diameter: 20, length: 3.5 });
  });
  it('配管の表示でないもの（市の配水管 DIP、寸法、口径だけの φ150）は読まない', () => {
    for (const s of ['DIPφ75', '7,280', 'φ150', '75×20', 'GL+650', 'H410', 'S=1/200']) expect(parsePipeLabel(s)).toBeNull();
  });
  it('同じ所に重ねて書かれた同じ文字（太字の重ね書き）は 1 つ。違う所の同じ表示は別の管', () => {
    const r = readEquipment([t('PB13×7.0', 10, 10), t('PB13×7.0', 10.6, 10.4), t('PB13×7.0', 200, 50), t('HI20×2.6', 50, 50)]);
    expect(r.pipes).toHaveLength(3);
    expect(r.totals).toEqual([
      { material: 'PB', diameter: 13, length: 14, labels: 2, nearby: 0 },
      { material: 'HI', diameter: 20, length: 2.6, labels: 1, nearby: 0 },
    ]);
  });
  it('長さが別の文字で横に書かれた表示（「VU75」と「1.5」）は、いちばん近い数字（15pt 以内・1 つの数字は 1 回）を長さにする', () => {
    const r = readEquipment([t('VU75', 100, 100), t('1.5', 92, 100), t('VU50', 300, 100), t('0.4', 305, 101), t('0.6', 309, 101), t('VU100', 600, 600), t('2.0', 700, 600)]);
    expect(r.totals).toEqual([
      { material: 'VU', diameter: 75, length: 1.5, labels: 1, nearby: 1 },
      { material: 'VU', diameter: 50, length: 0.4, labels: 1, nearby: 1 },
    ]);
    expect(r.pipes.filter((p) => p.length === undefined)).toHaveLength(1);
  });
  it('ます（「NO.1小口径桝」「新設公共枡」）・器具・部品（止水栓・量水器・ヘッダー・通気弁）を数える', () => {
    const r = readEquipment([
      t('NO.1小口径桝', 1, 1), t('NO.2小口径桝', 50, 1), t('NO.2小口径桝', 50.5, 1), t('新設公共枡', 90, 1),
      t('トイレ', 1, 100), t('トイレ', 60, 100), t('洗面器', 9, 9), t('流し台', 9, 30), t('散水栓', 9, 60),
      t('止水栓20mm', 300, 1), t('量水器20mm(壁埋込型)', 300, 20), t('給水ヘッダー6P', 300, 40), t('通気弁', 300, 60), t('通気弁', 330, 60),
    ]);
    expect(r.manholes).toEqual({ small: 2, public: 1 });
    expect(r.fixtures).toEqual({ toilet: 2, washbasin: 1, kitchen: 1, outdoorFaucet: 1 });
    expect(r.parts).toEqual([
      { name: '止水栓', size: 20, count: 1 },
      { name: '量水器', size: 20, count: 1 },
      { name: '給水ヘッダー', size: 6, count: 1 },
      { name: '通気弁', size: 0, count: 2 },
    ]);
  });
  it('長さ付きの配管の表示が 3 つ以上ある図面を設備図とみる', () => {
    expect(isEquipmentSheet([t('PB13×7.1', 1), t('PB13×5.2', 50), t('HI20×2.6', 90)])).toBe(true);
    expect(isEquipmentSheet([t('VU100'), t('トイレ')])).toBe(false);
  });
  it('数量（正解の形）: 管は管種・口径ごとの m、ます・部品は個数', () => {
    const q = equipmentQuantities(readEquipment([t('PB13×7.1', 1), t('PB13×2.9', 50), t('NO.1小口径桝', 9), t('止水栓20mm', 70)]));
    expect(q).toEqual([
      { name: 'PB', spec: 'φ13', unit: 'm', qty: 10 },
      { name: '小口径桝', spec: '', unit: '個', qty: 1 },
      { name: '止水栓', spec: 'φ20', unit: '個', qty: 1 },
    ]);
  });
});

describe('配置図が無いとき、平面図（申請図）の文字から メーター・公共ます・ます を置く', () => {
  it('「量水器」「新設公共枡」「NO.1小口径桝」の文字の位置（図面の範囲の外の凡例は除く）', async () => {
    const { buildFromSheets } = await import('./assemble');
    const { planSheet, sketch, text, W, D } = await import('./testHouse');
    const pg = planSheet();
    const s = sketch(100);
    text(s, -1200, -800, '量水器20mm(壁埋込型)'); text(s, -1500, D + 900, '新設公共枡'); text(s, 1000, D + 700, 'NO.1小口径桝'); text(s, W + 30000, 0, '量水器');
    const r = buildFromSheets([{ name: 'p', page: { ...pg, texts: [...pg.texts, ...s.texts] } }]);
    const want: [string, number, number][] = [['waterMeter', -1200, -800], ['publicSewage', -1500, D + 900], ['manholeSewage', 1000, D + 700]];
    expect(r.site?.items.map((i) => i.type)).toEqual(want.map((w) => w[0]));
    r.site!.items.forEach((i, k) => expect(Math.hypot(i.x - want[k][1], i.y - want[k][2])).toBeLessThan(100));
    expect(r.report.check.some((c) => c.includes('文字の位置'))).toBe(true);
  });
});
