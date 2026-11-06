/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { addPolyline, emptyNetwork } from '../model/network';
import { emptyBuilding } from '../model/building';
import { defaultEstimate, pipeKey } from '../model/estimate';
import { buildReport } from './report';
import { buildPdf } from './pdf';
import { buildExcel } from './excel';

const A = { system: 'water' as const, diameter: 20, material: 'VP' };
function sampleReport(segments = 1) {
  let net = emptyNetwork();
  for (let i = 0; i < segments; i++) net = addPolyline(net, [{ x: 0, y: i * 1000, z: 100 }, { x: 3000, y: i * 1000, z: 100 }, { x: 3000, y: i * 1000 + 500, z: 100 }], { ...A, diameter: 13 + i }).net;
  const estimate = {
    ...defaultEstimate(), client: '沖縄 太郎', title: '給水管更新工事', issuer: '○○設備\n那覇市', note: '有効期限 30日',
    prices: { [pipeKey(A)]: { material: 1000, labor: 500 } },
    extras: [{ id: 'x', name: '水圧試験', quantity: 1, unit: '式', unitPrice: 15000 }],
  };
  return buildReport({ building: emptyBuilding(), network: net, fixtures: {}, estimate }, { name: '那覇の現場🚰', address: '那覇市泉崎', date: new Date(2026, 10, 6) });
}
const font = () => readFileSync('public/fonts/NotoSansJP-JIS.ttf');

describe('出力', () => {
  it('report: 見積の行・合計・数量表が積算結果と一致', () => {
    const r = sampleReport();
    expect(r.totals.at(-1)).toEqual(['合計', r.est.total]);
    expect(r.tables[0].rows).toHaveLength(1);
    expect(r.tables[0].rows[0][2]).toBe(3.5); // 3000+500mm
    expect(r.tables[1].rows[0][0]).toBe('90°エルボ');
  });

  it('PDF: 日本語（フォント外の文字を含む）で生成でき、見積書＋数量表のページがある', async () => {
    const bytes = await buildPdf(sampleReport(), font());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getTitle()).toContain('見積書');
    expect(bytes.length).toBeLessThan(2_000_000);
  });

  it('PDF: 行が多いと改ページする', async () => {
    const bytes = await buildPdf(sampleReport(60), font());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(3);
  }, 20000);

  it('Excel: 5シート、見積金額・数量表の値を読み戻せる', async () => {
    const r = sampleReport();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildExcel(r)).buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['見積書', '数量表', '部品一覧', '区間明細', '要確認']);
    const q = wb.getWorksheet('見積書')!;
    let total: unknown;
    q.eachRow((row) => { if (row.getCell(1).value === '御見積金額（税込）') total = row.getCell(6).value; });
    expect(total).toBe(r.est.total);
    expect(wb.getWorksheet('数量表')!.getRow(2).getCell(3).value).toBe(3.5);
    expect(wb.getWorksheet('区間明細')!.rowCount).toBe(3);
  });
});
