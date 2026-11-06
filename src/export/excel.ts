/**
 * 見積書・数量表の Excel（.xlsx）。シート: 見積書 / 数量表 / 部品一覧 / 区間明細 / 要確認。
 * 金額は値で出力（数量表と同じ数値。式の再計算で丸めが変わらないようにする）。
 */
import ExcelJS from 'exceljs';
import { dateJa, DISCLAIMER, type Report, type Table } from './report';

const YEN = '"¥"#,##0';
const YEN_PRICE = '"¥"#,##0.##';
const NUM = '#,##0.###';
const thin = { style: 'thin' as const, color: { argb: 'FFBFC4CC' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

function addTable(ws: ExcelJS.Worksheet, t: Pick<Table, 'head' | 'rows' | 'numeric'>, money: boolean[] = []) {
  const head = ws.addRow(t.head);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F8' } }; c.border = border; });
  for (const r of t.rows) {
    const row = ws.addRow(r);
    row.eachCell({ includeEmpty: true }, (c, i) => {
      c.border = border;
      if (typeof c.value === 'number') c.numFmt = money[i - 1] ? (Number.isInteger(c.value) ? YEN : YEN_PRICE) : NUM;
    });
  }
}

function sheet(wb: ExcelJS.Workbook, name: string, widths: number[]) {
  const ws = wb.addWorksheet(name, { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = widths.map((width) => ({ width }));
  return ws;
}

export async function buildExcel(r: Report): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PipeCraft 3D';
  wb.created = r.meta.date;
  const s = r.settings;

  const q = sheet(wb, '見積書', [28, 26, 10, 7, 14, 16]);
  q.addRow(['御見積書']).font = { size: 18, bold: true };
  q.addRow([]);
  q.addRow([`${s.client ?? ''} 様`]).font = { size: 13 };
  q.addRow(['工事名', s.title || r.meta.name]);
  q.addRow(['現場名', r.meta.name]);
  if (r.meta.address) q.addRow(['住所', r.meta.address]);
  q.addRow(['作成日', dateJa(r.meta.date)]);
  if (s.issuer) q.addRow(['発行者', s.issuer.replace(/\n/g, ' ')]);
  const tot = q.addRow(['御見積金額（税込）', '', '', '', '', r.est.total]);
  tot.font = { size: 13, bold: true };
  tot.getCell(6).numFmt = YEN;
  q.addRow([]);
  for (const sec of r.quote) {
    q.addRow([`■ ${sec.section}`]).font = { bold: true };
    addTable(q, { head: ['項目', '仕様', '数量', '単位', '単価', '金額'], rows: sec.rows, numeric: [] }, [false, false, false, false, true, true]);
    q.addRow([]);
  }
  for (const [k, v] of r.totals) {
    const row = q.addRow(['', '', '', '', k, v]);
    row.getCell(6).numFmt = YEN;
    if (k === '合計') row.font = { bold: true };
  }
  if (s.note) { q.addRow([]); q.addRow(['備考', s.note]); }
  q.addRow([]);
  q.addRow([DISCLAIMER]).font = { size: 9, color: { argb: 'FF6B7280' } };

  const [quant, fits] = r.tables;
  addTable(sheet(wb, '数量表', [12, 18, 12, 16, 13, 12, 12, 13]), quant);
  addTable(sheet(wb, '部品一覧', [22, 30, 8, 36]), fits);
  addTable(sheet(wb, '区間明細', [6, 8, 16, 13, 13, 13, 16, 8, 50]), r.segments);
  addTable(sheet(wb, '要確認', [16, 80]), r.issues);

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
