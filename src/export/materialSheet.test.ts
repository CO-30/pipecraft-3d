import { describe, expect, test } from 'vitest';
import { createBuildingFromDims } from '../model/building';
import type { Doc } from '../model/doc';
import { placeFixture } from '../model/fixtures';
import { materialSummary } from '../model/materialSummary';
import { addPolyline, emptyNetwork } from '../model/network';
import { findTextOverlaps } from './labelLayout';
import { MATERIAL_ROWS_PER_PAGE, renderMaterialSheets } from './materialSheet';
import type { Op } from './sheet';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const meta = { siteName: '新垣邸 新築工事に伴う給排水衛生設備工事', date: new Date(2026, 10, 12) };
const texts = (ops: Op[]) => ops.filter((o): o is Extract<Op, { t: 'text' }> => o.t === 'text').map((o) => o.s);

/** 管種・口径を n 種類 */
function site(n: number): Doc {
  let doc: Doc = { building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), network: emptyNetwork(), fixtures: {}, site: { designGL: -300 } };
  const mats = ['HIVP', 'HTVP', 'PB', 'VP', 'VU', 'SGP-VB'];
  const dias = [13, 20, 25, 30, 40, 50, 65, 75, 100];
  let net = emptyNetwork();
  for (let i = 0; i < n; i++) net = addPolyline(net, [v(500, 300 + i * 120, -400 + (i % 3) * 1500), v(2500 + i * 50, 300 + i * 120, -400 + (i % 3) * 1500)], { system: i % 2 ? 'sewage' : 'water', diameter: dias[i % dias.length], material: mats[Math.floor(i / dias.length) % mats.length] }).net;
  doc = { ...doc, network: net };
  for (const t of ['toilet', 'washbasin', 'kitchen'] as const) doc = placeFixture(doc, doc.building.floors[0].id, t, { x: 4000, y: 3000 }).doc;
  return doc;
}

describe('材料集計表の用紙', () => {
  test('A4 縦。区分の見出し・列（分け方）・計。文字が重ならない', () => {
    const doc = site(6);
    for (const axis of ['place', 'floor', 'status'] as const) {
      const sheets = renderMaterialSheets(materialSummary(doc, axis), meta);
      expect(sheets).toHaveLength(1);
      expect([sheets[0].width, sheets[0].height]).toEqual([210, 297]);
      for (const sh of sheets) expect(findTextOverlaps(sh)).toEqual([]);
      const t = texts(sheets[0].ops);
      expect(t).toContain('材料集計表');
      expect(t).toContain('計');
      expect(t).toContain('給水・給湯');
      expect(t).toContain('器具');
    }
    expect(texts(renderMaterialSheets(materialSummary(doc, 'place'), meta)[0].ops)).toContain('屋内');
  });
  test('行があふれたら続きのページ（見出しを繰り返す）', () => {
    const doc = site(MATERIAL_ROWS_PER_PAGE + 10);
    const sheets = renderMaterialSheets(materialSummary(doc, 'place'), meta);
    expect(sheets.length).toBeGreaterThanOrEqual(2);
    expect(texts(sheets[1].ops).some((s) => s.includes('（続き）'))).toBe(true);
    expect(texts(sheets[1].ops)).toContain('品名');
    for (const sh of sheets) expect(findTextOverlaps(sh)).toEqual([]);
  });
  test('階が多い（9 階）と A4 横になり、仕様の列が細くなりすぎず、文字が重ならない', () => {
    let b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 9, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    let net = emptyNetwork();
    b.floors.forEach((f, i) => { net = addPolyline(net, [v(500, 500 + i * 300, f.elevation + 300), v(3000, 500 + i * 300, f.elevation + 300)], { system: i % 2 ? 'hotWater' : 'water', diameter: 20, material: 'HIVP' }).net; });
    net = addPolyline(net, [v(500, 5500, -400), v(3000, 5500, -400)], { system: 'water', diameter: 20, material: 'HIVP' }).net; // 床下
    const doc: Doc = { building: b, network: net, fixtures: {} };
    const sheets = renderMaterialSheets(materialSummary(doc, 'floor'), meta);
    expect([sheets[0].width, sheets[0].height]).toEqual([297, 210]);
    for (const sh of sheets) expect(findTextOverlaps(sh)).toEqual([]);
    const t = texts(sheets[0].ops);
    expect(t).toContain('床下・地中');
    expect(t.some((x) => x === 'HIVP φ20')).toBe(true);
    void b;
  });
  test('材料が無ければ用紙なし', () => {
    const doc: Doc = { building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), network: emptyNetwork(), fixtures: {} };
    expect(renderMaterialSheets(materialSummary(doc, 'place'), meta)).toEqual([]);
  });
});

describe('材料集計表の Excel', () => {
  test('見出し・区分・数値（m は小数 2 桁）・計', async () => {
    const { materialXlsx } = await import('./materialSheet');
    const ExcelJS = (await import('exceljs')).default;
    const doc = site(4);
    const sum = materialSummary(doc, 'place');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await materialXlsx(sum, meta)).buffer as ArrayBuffer);
    const ws = wb.getWorksheet('材料集計表')!;
    const vals = ws.getSheetValues().filter(Boolean).map((r) => (r as unknown[]).slice(1));
    expect(vals.some((r) => r[0] === '品名' && r.includes('計') && r.includes('屋内'))).toBe(true);
    expect(vals.some((r) => r[0] === '給水・給湯')).toBe(true);
    const pipe = vals.find((r) => r[0] === '給水管')!;
    expect(typeof pipe[pipe.length - 2]).toBe('number');
  });
});
