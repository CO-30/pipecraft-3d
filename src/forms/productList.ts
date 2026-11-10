/**
 * 給水装置使用製品一覧表（A4 横）。積算の管・部品から行を作る。
 * 様式は申請担当者から入手した PDF（発行元の企業団名は要確認）。15 行で 1 枚、超えたら次の枚。
 */
import { computeEstimate, fittingSpec, pipeSpec } from '../model/estimate';
import type { Doc } from '../model/doc';
import { dateJa } from '../export/report';
import { drawFrame, fitText, GRAY, INK, type Sheet } from '../export/sheet';
import type { Contractor } from './types';

export type ProductRow = { name: string; spec: string; qty: string; maker: string };

const WATER = new Set(['water', 'hotWater']);
const ROWS_PER_PAGE = 15;

/** 給水（給水・給湯）の管と部品を一覧の行にする */
export function productRows(doc: Doc): ProductRow[] {
  const est = computeEstimate(doc);
  const rows: ProductRow[] = [];
  for (const p of est.pipes) if (WATER.has(p.system)) rows.push({ name: p.name, spec: pipeSpec(p), qty: `${(p.usedLength / 1000).toFixed(1)} m`, maker: '' });
  for (const f of est.fittings) if (WATER.has(f.system)) rows.push({ name: f.name, spec: fittingSpec(f), qty: `${f.count} 個`, maker: '' });
  const meter = Object.values(doc.fixtures).find((f) => f.type === 'waterMeter');
  if (meter) rows.push({ name: '水道メーター', spec: '', qty: '1 個', maker: '' });
  return rows;
}

export type ProductListMeta = { siteName: string; date: Date };

export function renderProductListSheets(rows: ProductRow[], meta: ProductListMeta, c: Contractor): Sheet[] {
  const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const sheets: Sheet[] = [];
  for (let pg = 0; pg < pages; pg++) {
    const sheet: Sheet = { width: 297, height: 210, ops: [] };
    drawFrame(sheet);
    const ops = sheet.ops;
    ops.push({ t: 'text', x: 20, y: 24, s: '給水装置使用製品一覧表', size: 5.5, bold: true });
    ops.push({ t: 'text', x: 120, y: 24, s: `工事名：${meta.siteName}`, size: 3.2 });
    ops.push({ t: 'text', x: 277, y: 18, s: '（A4普通紙）', size: 2.4, anchor: 'end', color: GRAY });
    ops.push({ t: 'text', x: 277, y: 24, s: dateJa(meta.date), size: 3, anchor: 'end' });
    if (pages > 1) ops.push({ t: 'text', x: 277, y: 29, s: `${pg + 1} / ${pages}`, size: 2.6, anchor: 'end', color: GRAY });
    // 表
    const cols = [{ w: 10, h: '番号' }, { w: 48, h: '製品名' }, { w: 40, h: '規格' }, { w: 24, h: '個数・延長' }, { w: 40, h: '製品メーカー名' }, { w: 16, h: 'JIS認証' }, { w: 16, h: '自己認証' }, { w: 22, h: '日水協検査及び第三者認証' }, { w: 30, h: '鉛浸出性能基準適合' }, { w: 11, h: '備考' }];
    const x0 = 20, top = 32, headH = 10, rowH = 7.4;
    const totalW = cols.reduce((a, b) => a + b.w, 0);
    ops.push({ t: 'rect', x: x0, y: top, w: totalW, h: headH + rowH * ROWS_PER_PAGE, lw: 0.4 });
    ops.push({ t: 'line', x1: x0, y1: top + headH, x2: x0 + totalW, y2: top + headH, w: 0.4 });
    let x = x0;
    cols.forEach((col, i) => {
      if (i > 0) ops.push({ t: 'line', x1: x, y1: top, x2: x, y2: top + headH + rowH * ROWS_PER_PAGE, w: 0.25 });
      const words = col.h.length > 8 ? [col.h.slice(0, Math.ceil(col.h.length / 2)), col.h.slice(Math.ceil(col.h.length / 2))] : [col.h];
      words.forEach((wd, k) => ops.push({ t: 'text', x: x + col.w / 2, y: top + (words.length === 1 ? 6.5 : 4.5 + 3.4 * k), s: fitText(wd, 2.4, col.w - 1), size: 2.4, anchor: 'middle' }));
      x += col.w;
    });
    for (let r = 0; r < ROWS_PER_PAGE; r++) {
      const y = top + headH + rowH * r;
      if (r > 0) ops.push({ t: 'line', x1: x0, y1: y, x2: x0 + totalW, y2: y, w: 0.2 });
      const row = rows[pg * ROWS_PER_PAGE + r];
      const n = pg * ROWS_PER_PAGE + r + 1;
      ops.push({ t: 'text', x: x0 + cols[0].w / 2, y: y + 5, s: String(n), size: 2.6, anchor: 'middle' });
      let cx = x0 + cols[0].w;
      const cells = row ? [row.name, row.spec, row.qty, row.maker] : [];
      cells.forEach((s, i) => { ops.push({ t: 'text', x: cx + 1.5, y: y + 5, s: fitText(s, 2.6, cols[i + 1].w - 3), size: 2.6 }); cx += cols[i + 1].w; });
      // 鉛浸出性能基準適合: ア 適合する イ 適合しない（丸は提出者が付ける）
      const leadX = x0 + cols.slice(0, 8).reduce((a, b) => a + b.w, 0);
      ops.push({ t: 'text', x: leadX + 2, y: y + 5, s: 'ア 適合する　イ 適合しない', size: 2.2, color: row ? INK : GRAY });
    }
    // 注意書きと工事店
    const ny = top + headH + rowH * ROWS_PER_PAGE + 6;
    ['※ 該当する項目に〇をつけること。', '※ 自己認証及び企業団が指示する場合は認証品として証明できる資料を添付すること。', '※ 令和3年2月1日から給水装置工事申請書に添付すること。'].forEach((s, i) => ops.push({ t: 'text', x: 20, y: ny + 4 * i, s, size: 2.4, color: GRAY }));
    const cx0 = 150;
    ops.push({ t: 'text', x: cx0, y: ny, s: '指定給水装置工事事業者', size: 2.8 });
    ops.push({ t: 'text', x: cx0 + 50, y: ny, s: `住所　${[c.zip ? `〒${c.zip.replace(/^〒/, '')}` : '', c.address].filter(Boolean).join(' ')}`, size: 2.8 });
    ops.push({ t: 'text', x: cx0 + 50, y: ny + 5, s: `称号　${c.name}`, size: 2.8 });
    ops.push({ t: 'text', x: cx0 + 50, y: ny + 10, s: `代表者　${c.representative}`, size: 2.8 });
    ops.push({ t: 'text', x: 277, y: ny + 10, s: '印', size: 2.8, anchor: 'end', color: GRAY });
    ops.push({ t: 'text', x: cx0, y: ny + 17, s: '給水装置工事主任技術者', size: 2.8 });
    ops.push({ t: 'text', x: cx0 + 50, y: ny + 17, s: `氏名　${c.chiefEngineer}`, size: 2.8 });
    ops.push({ t: 'text', x: 277, y: ny + 17, s: '印', size: 2.8, anchor: 'end', color: GRAY });
    sheets.push(sheet);
  }
  return sheets;
}
