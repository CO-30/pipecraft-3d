/**
 * 材料集計表（A4 縦）。区分（給水・給湯／排水・通気／その他／器具）ごとに、品名・仕様・分け方の列・計・単位。
 * 行があふれたら続きのページ（表の見出しと区分の見出しを繰り返す）。文字は LabelPlacer、セルの中は fitText。
 */
import { MAT_AXIS_LABEL, type MatItem, type MatSummary } from '../model/materialSummary';
import { at, LabelPlacer, textWidth } from './labelLayout';
import { dateJa } from './report';
import { fitText, GRAY, INK, type Sheet } from './sheet';

/** A4 縦の 1 ページの行数（A4 横は用紙の高さから決める） */
export const MATERIAL_ROWS_PER_PAGE = 40;
const M = 12;
/** 列の最小・最大の幅（mm） */
const NAME_MIN = 30, SPEC_MIN = 36, SPEC_MAX = 48, COL_MIN = 12, COL_MAX = 18, UNIT_W = 9, TOTAL_W = 16;
const TOP = 34, ROW_H = 5.6, SIZE = 2.6;

const fmt = (it: MatItem, n: number | undefined) => (!n ? '' : it.unit === 'm' ? n.toFixed(2) : String(Math.round(n)));

type Line = { kind: 'section'; title: string; cont: boolean } | { kind: 'item'; it: MatItem };

export function renderMaterialSheets(sum: MatSummary, meta: { siteName: string; date: Date }): Sheet[] {
  if (!sum.sections.length) return [];
  // 列: 品名・仕様・分け方の列・計・単位。A4 縦に入らない列の数（階が多い）なら A4 横
  const nCols = sum.columns.length;
  const fixed = NAME_MIN + SPEC_MIN + UNIT_W + TOTAL_W;
  const landscape = fixed + COL_MIN * nCols > 210 - M * 2;
  const W = landscape ? 297 : 210, H = landscape ? 210 : 297;
  const avail = W - M * 2;
  const colW = Math.max(COL_MIN, Math.min(COL_MAX, (avail - fixed) / Math.max(1, nCols)));
  const rest = avail - UNIT_W - TOTAL_W - colW * nCols;
  const specW = Math.max(SPEC_MIN, Math.min(SPEC_MAX, rest * 0.5));
  const nameW = rest - specW;
  const rowsPerPage = landscape ? Math.floor((H - TOP - 16) / ROW_H) - 1 : MATERIAL_ROWS_PER_PAGE;
  const cols = [
    { k: '品名', w: nameW, align: 'start' as const }, { k: '仕様', w: specW, align: 'start' as const },
    ...sum.columns.map((c) => ({ k: c.label, w: colW, align: 'end' as const })),
    { k: '計', w: TOTAL_W, align: 'end' as const }, { k: '単位', w: UNIT_W, align: 'middle' as const },
  ];

  // ページに分ける（区分の見出しはページの最後に残さない）
  const lines: Line[] = sum.sections.flatMap((s) => [{ kind: 'section' as const, title: s.title, cont: false }, ...s.items.map((it) => ({ kind: 'item' as const, it }))]);
  const pages: Line[][] = [];
  let cur: Line[] = [], section = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === 'section') section = l.title;
    const full = cur.length >= rowsPerPage || (l.kind === 'section' && cur.length >= rowsPerPage - 1);
    if (full) { pages.push(cur); cur = l.kind === 'item' ? [{ kind: 'section', title: section, cont: true }] : []; }
    cur.push(l);
  }
  if (cur.length) pages.push(cur);

  return pages.map((rows, pg) => {
    const sheet: Sheet = { width: W, height: H, ops: [] };
    const P = new LabelPlacer(sheet, { x1: M - 2, y1: 6, x2: W - M + 2, y2: H - 4 });
    P.place([at(M, 18, { s: '材料集計表', size: 5.5, bold: true })]);
    if (pages.length > 1) P.place([at(W - M, 18, { s: `${pg + 1} / ${pages.length}${pg > 0 ? '（続き）' : ''}`, size: 2.8, color: GRAY }, 'end')]);
    P.place([at(M, 25, { s: fitText(`工事名: ${meta.siteName}`, 3, 120), size: 3 })]);
    P.place([at(W - M, 25, { s: `作成日: ${dateJa(meta.date)}`, size: 3, color: GRAY }, 'end')]);
    P.place([at(M, 30, { s: `分け方: ${MAT_AXIS_LABEL[sum.axis]}　長さは使用長（実測があれば実測）`, size: 2.5, color: GRAY })]);
    // 表の見出し
    let x = M;
    for (const c of cols) {
      sheet.ops.push({ t: 'rect', x, y: TOP, w: c.w, h: ROW_H, fill: '#f1f5f9', stroke: INK, lw: 0.25 });
      // 細い列の見出しは、入るまで字を小さくする（1.8 まで。それでも長ければ … で切る）
      let hs = SIZE;
      while (hs > 1.8 && textWidth(c.k, hs) > c.w - 1) hs -= 0.1;
      P.place([at(x + c.w / 2, TOP + ROW_H - 1.7, { s: fitText(c.k, hs, c.w - 1), size: hs, bold: true }, 'middle')]);
      x += c.w;
    }
    rows.forEach((l, i) => {
      const y = TOP + ROW_H * (i + 1);
      if (l.kind === 'section') {
        sheet.ops.push({ t: 'rect', x: M, y, w: W - M * 2, h: ROW_H, fill: '#e0f2fe', stroke: INK, lw: 0.2 });
        P.place([at(M + 1.5, y + ROW_H - 1.7, { s: `${l.title}${l.cont ? '（続き）' : ''}`, size: SIZE, bold: true })]);
        return;
      }
      const it = l.it;
      const cells = [it.name, it.spec, ...sum.columns.map((c) => fmt(it, it.qty[c.key])), fmt(it, it.total), it.unit];
      let cx = M;
      cols.forEach((c, ci) => {
        sheet.ops.push({ t: 'rect', x: cx, y, w: c.w, h: ROW_H, stroke: INK, lw: 0.15 });
        const s = fitText(cells[ci], SIZE, c.w - 2);
        if (s) P.place([at(c.align === 'start' ? cx + 1 : c.align === 'end' ? cx + c.w - 1 : cx + c.w / 2, y + ROW_H - 1.7, { s, size: SIZE, bold: ci === cols.length - 2 }, c.align)]);
        cx += c.w;
      });
    });
    P.place([at(M, H - 8, { s: '数量は配管データからの集計です。継手は自動で判定した数（要確認の点を含む）。発注は余長・定尺を見込んでください', size: 2.3, color: GRAY })]);
    return sheet;
  });
}

/** Excel（発注・転記用）。列は用紙と同じ。数値は数値のまま（m は小数 2 桁の書式） */
export async function materialXlsx(sum: MatSummary, meta: { siteName: string; date: Date }): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PipeCraft 3D';
  const ws = wb.addWorksheet('材料集計表');
  ws.columns = [{ width: 24 }, { width: 26 }, ...sum.columns.map(() => ({ width: 11 })), { width: 11 }, { width: 6 }];
  ws.addRow(['材料集計表']).font = { size: 16, bold: true };
  ws.addRow([`工事名: ${meta.siteName}`]);
  ws.addRow([`作成日: ${dateJa(meta.date)}`, `分け方: ${MAT_AXIS_LABEL[sum.axis]}`]);
  ws.addRow([]);
  const head = ws.addRow(['品名', '仕様', ...sum.columns.map((c) => c.label), '計', '単位']);
  head.font = { bold: true };
  for (const s of sum.sections) {
    const sec = ws.addRow([s.title]);
    sec.font = { bold: true };
    for (const it of s.items) {
      const r = ws.addRow([it.name, it.spec, ...sum.columns.map((c) => (it.qty[c.key] ? round(it, it.qty[c.key]) : null)), round(it, it.total), it.unit]);
      const fmtStr = it.unit === 'm' ? '0.00' : '0';
      for (let k = 3; k <= sum.columns.length + 3; k++) r.getCell(k).numFmt = fmtStr;
    }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const round = (it: MatItem, n: number) => (it.unit === 'm' ? Math.round(n * 100) / 100 : Math.round(n));
