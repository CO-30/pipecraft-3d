import { describe, expect, test } from 'vitest';
import { createBuildingFromDims, type Building } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork, type Network } from '../model/network';
import { sleeveSchedule } from '../model/sleeves';
import { findTextOverlaps } from './labelLayout';
import { renderSleeveSheets, SLEEVE_ROWS_PER_PAGE } from './sleeveSheet';
import type { Op } from './sheet';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const house = (): Building => ({ ...createBuildingFromDims({ width: 9100, depth: 7280, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), foundation: { slabTop: -450 } });
const meta = { siteName: 'テスト工事', date: new Date(2026, 10, 12) };
const texts = (ops: Op[]) => ops.filter((o): o is Extract<Op, { t: 'text' }> => o.t === 'text').map((o) => o.s);

/** 外周から床下へ入る給水 n 本（y を 300 ずつ）＋ 2 階への立て管 2 本 */
function site(n: number): Doc {
  let net: Network = emptyNetwork();
  const step = Math.min(300, 6800 / Math.max(1, n));
  for (let i = 0; i < n; i++) net = addPolyline(net, [v(-800, 300 + i * step, -300), v(800, 300 + i * step, -300)], { system: i % 2 ? 'hotWater' : 'water', diameter: 20, material: 'HIVP' }).net;
  net = addPolyline(net, [v(3000, 3000, 1000), v(3000, 3000, 4000)], { system: 'sewage', diameter: 100, material: 'VU' }).net;
  net = addPolyline(net, [v(3400, 3000, 1000), v(3400, 3000, 4000)], { system: 'water', diameter: 20, material: 'HIVP' }).net;
  return { building: house(), network: net, fixtures: {} };
}

describe('スリーブ表の用紙', () => {
  test('階ごとに A4 横 1 枚。位置図の番号と表の番号が一致し、文字が重ならない', () => {
    const doc = site(12);
    const rows = sleeveSchedule(doc);
    const { sheets, collisions } = renderSleeveSheets(doc, rows, meta);
    expect(sheets).toHaveLength(2); // 1 階（基礎の外周 12）と 2 階（床 2）
    expect([sheets[0].width, sheets[0].height]).toEqual([297, 210]);
    expect(collisions).toBe(0);
    for (const sh of sheets) expect(findTextOverlaps(sh)).toEqual([]);
    const t1 = texts(sheets[0].ops);
    expect(t1.some((s) => s.startsWith('スリーブ表'))).toBe(true);
    for (const r of rows.filter((x) => x.floorId === doc.building.floors[0].id)) expect(t1.filter((s) => s === String(r.no)).length).toBe(2); // 位置図と表
    expect(t1).toContain('基礎（外周）');
    expect(texts(sheets[1].ops)).toContain('φ150'); // VU100 → φ150
  });
  test('行があふれたら同じ階の続きのページ（見出しを繰り返す）', () => {
    const doc = site(SLEEVE_ROWS_PER_PAGE + 3);
    const rows = sleeveSchedule(doc);
    const { sheets } = renderSleeveSheets(doc, rows, meta);
    expect(sheets).toHaveLength(3);
    expect(texts(sheets[1].ops).some((s) => s.includes('（続き）'))).toBe(true);
    expect(texts(sheets[1].ops)).toContain('スリーブ');
    for (const sh of sheets) expect(findTextOverlaps(sh)).toEqual([]);
  });
  test('壁の無い階の立て管だけでも位置図が建物の大きさで、縮尺がまともで、表に位置の列', () => {
    const doc = site(0);
    const f2 = doc.building.floors[1].id;
    doc.building = { ...doc.building, walls: Object.fromEntries(Object.entries(doc.building.walls).filter(([, w]) => w.floorId !== f2)) };
    const rows = sleeveSchedule(doc);
    const { sheets } = renderSleeveSheets(doc, rows, meta);
    const t = texts(sheets.at(-1)!.ops);
    const sc = t.find((s) => s.startsWith('縮尺'))!;
    expect(Number(/1\/(\d+)/.exec(sc)![1])).toBeGreaterThanOrEqual(10);
    expect(t).toContain('位置 X,Y(m)');
  });
  test('建物から遠くへ延びる配管も位置図の枠の中だけに描く', () => {
    const doc = site(2);
    doc.network = addPolyline(doc.network, [v(4000, 3000, -300), v(4000, -20000, -300)], { system: 'sewage', diameter: 100, material: 'VU' }).net;
    const { sheets } = renderSleeveSheets(doc, sleeveSchedule(doc), meta);
    for (const o of sheets[0].ops) if (o.t === 'line' && o.color && o.color !== '#1f2328') {
      for (const y of [o.y1, o.y2]) expect(y).toBeLessThanOrEqual(22 + 168 + 0.01);
    }
  });
  test('スリーブが無ければ用紙なし', () => {
    expect(renderSleeveSheets(site(0), [], meta).sheets).toEqual([]);
  });
});
