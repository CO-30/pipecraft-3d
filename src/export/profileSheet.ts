/**
 * 排水縦断図の描画。上段に GL 線・管底線・マスの記号、下段に自治体プロファイルの行順で表。
 * 横は累加距離を hScale で、縦は高さを vScale で用紙 mm に換算する。図が用紙に収まらないときは横の縮尺を上げる。
 */
import type { ProfileModel } from '../model/profileDrawing';
import { dateJa } from './report';
import { SCALES } from './drawingPdf';
import { drawFrame, drawSymbol, drawTitleBlock, fitText, GRAY, INK, paperSize, RED, sheetToSvg, TITLE_W, type Sheet } from './sheet';

export type SheetMeta = { siteName: string; date: Date };

const M = 15; // 枠内の余白
const LABEL_W = 26; // 表の行ラベルの幅
const ROW_H = 11;

/** 数値表示（m 小数3位 / mm 整数） */
export const fmtLen = (mm: number, unit: 'm' | 'mm') => (unit === 'mm' ? String(Math.round(mm)) : (Math.round(mm) / 1000).toFixed(3));

/** 図が収まる横縮尺（1/N）。プロファイルの hScale 以上で、SCALES から最小のもの */
export function pickHScale(totalMm: number, areaW: number, base: number): number {
  for (const n of [base, ...SCALES.filter((x) => x > base)]) if (totalMm / n <= areaW) return n;
  return SCALES[SCALES.length - 1];
}

export function renderProfileSheet(model: ProfileModel, meta: SheetMeta): Sheet {
  const { profile } = model;
  const pt = profile.profileTable;
  const sheet: Sheet = { ...paperSize(profile.paper), ops: [] };
  drawFrame(sheet);
  const unit = pt.unit ?? 'm';
  const left = 10 + M + LABEL_W, right = sheet.width - 10 - M;
  const rows = pt.rows;
  const tableH = ROW_H * rows.length;
  const titleH = 7 * profile.paper.titleBlockFields.length + 6;
  const tableTop = sheet.height - 10 - M - tableH - Math.max(titleH, 0) - 4;
  const graphTop = 10 + M + 12;
  const graphBottom = tableTop - 8;

  // 見出し
  sheet.ops.push({ t: 'text', x: 10 + M, y: 10 + M + 2, s: model.title, size: 6, bold: true });
  sheet.ops.push({ t: 'text', x: 10 + M + 60, y: 10 + M + 2, s: `（${profile.name}）`, size: 3, color: GRAY });

  const total = model.nodes.length ? model.nodes[model.nodes.length - 1].cumDistance : 0;
  const areaW = right - left - 10;
  const hScale = pickHScale(total, areaW, pt.hScale);
  const vScale = pt.vScale;
  const X = (mm: number) => left + 5 + mm / hScale;

  // 基準線 DL: 最小の管底高を 1m 単位で切り下げ
  const minZ = Math.min(...model.nodes.map((n) => Math.min(n.invertLevel, n.groundLevel)), 0);
  const maxZ = Math.max(...model.nodes.map((n) => Math.max(n.invertLevel, n.groundLevel)), 0);
  const DL = Math.floor(minZ / 1000) * 1000 - 200;
  const availH = graphBottom - graphTop - 10;
  // 縦の縮尺はプロファイルの値。収まらなければ上げる
  const vS = (maxZ - DL) / vScale > availH ? pickHScale(maxZ - DL, availH, vScale) : vScale;
  const Y = (z: number) => graphBottom - (z - DL) / vS;

  // DL 線とラベル
  sheet.ops.push({ t: 'line', x1: left, y1: graphBottom, x2: right, y2: graphBottom, color: GRAY });
  sheet.ops.push({ t: 'text', x: left - 1, y: graphBottom + 1, s: `DL ${fmtLen(DL, unit)}`, size: 2.6, anchor: 'end', color: GRAY });
  const warnSeg = new Set(model.warnings.filter((w) => w.segId).map((w) => w.segId));
  const warnNode = new Set(model.warnings.filter((w) => w.nodeId).map((w) => w.nodeId));

  // GL 線
  if (model.nodes.length) {
    sheet.ops.push({ t: 'poly', pts: model.nodes.map((n) => [X(n.cumDistance), Y(n.groundLevel)]), w: 0.3, color: INK });
    sheet.ops.push({ t: 'text', x: X(model.nodes[0].cumDistance) - 4, y: Y(model.nodes[0].groundLevel) - 1, s: `GL${model.tentativeGL ? '（仮）' : ''}`, size: 2.6, anchor: 'end' });
    // 管底線（区間ごと。警告は赤）
    for (let i = 0; i < model.segments.length; i++) {
      const a = model.nodes[i], b = model.nodes[i + 1], s = model.segments[i];
      const bad = warnSeg.has(s.segId);
      sheet.ops.push({ t: 'line', x1: X(a.cumDistance), y1: Y(a.invertLevel), x2: X(b.cumDistance), y2: Y(b.invertLevel), w: 0.6, color: bad ? RED : INK });
      // 区間の上に 管種口径・勾配
      const mx = (X(a.cumDistance) + X(b.cumDistance)) / 2, my = (Y(a.invertLevel) + Y(b.invertLevel)) / 2;
      sheet.ops.push({ t: 'text', x: mx, y: my - 2, s: `${s.pipeSpec} ${s.slopeText}`, size: 2.6, anchor: 'middle', color: bad ? RED : INK });
    }
    // 各点: 縦の引出線、マスの記号
    model.nodes.forEach((n, i) => {
      const x = X(n.cumDistance);
      sheet.ops.push({ t: 'line', x1: x, y1: Y(n.groundLevel), x2: x, y2: tableTop, color: GRAY, w: 0.15, dash: true });
      if (n.manhole) {
        // マス: GL から管底までの箱と記号
        const hw = Math.max(1.5, n.manhole.diameter / hScale / 2);
        sheet.ops.push({ t: 'rect', x: x - hw, y: Y(n.groundLevel), w: hw * 2, h: Math.max(0.5, Y(n.invertLevel) - Y(n.groundLevel)), stroke: warnNode.has(n.nodeId) ? RED : INK, fill: '#fff', lw: 0.3 });
        drawSymbol(sheet, n.manhole.symbol, x, Y(n.groundLevel) - 4, 2.2, warnNode.has(n.nodeId) ? RED : INK);
        sheet.ops.push({ t: 'text', x, y: Y(n.groundLevel) - 7.5, s: n.manhole.label, size: 2.4, anchor: 'middle' });
      } else {
        sheet.ops.push({ t: 'circle', cx: x, cy: Y(n.invertLevel), r: 0.8, fill: warnNode.has(n.nodeId) ? RED : INK, stroke: warnNode.has(n.nodeId) ? RED : INK });
      }
      sheet.ops.push({ t: 'text', x, y: tableTop - 1.5, s: `No.${i + 1}`, size: 2.4, anchor: 'middle', color: GRAY });
    });
  }

  // 下段の表
  const tableRight = model.nodes.length ? Math.max(X(total) + 5, left + 40) : right;
  sheet.ops.push({ t: 'rect', x: left - LABEL_W, y: tableTop, w: tableRight - (left - LABEL_W), h: tableH, lw: 0.4 });
  sheet.ops.push({ t: 'line', x1: left, y1: tableTop, x2: left, y2: tableTop + tableH, w: 0.4 });
  rows.forEach((r, ri) => {
    const y = tableTop + ROW_H * ri;
    if (ri > 0) sheet.ops.push({ t: 'line', x1: left - LABEL_W, y1: y, x2: tableRight, y2: y });
    const label = r.key === 'groundLevel' && model.tentativeGL ? `${r.label}（仮）` : r.label;
    sheet.ops.push({ t: 'text', x: left - LABEL_W + 1.5, y: y + ROW_H / 2 + 1, s: fitText(label + (['distance', 'cumDistance', 'groundLevel', 'invertLevel', 'cover'].includes(r.key) ? `(${unit})` : ''), 2.6, LABEL_W - 2), size: 2.6 });
    const segRow = r.key === 'distance' || r.key === 'slope' || r.key === 'pipeSpec';
    if (segRow) {
      model.segments.forEach((s, i) => {
        const a = model.nodes[i], b = model.nodes[i + 1];
        const x = (X(a.cumDistance) + X(b.cumDistance)) / 2;
        const bad = warnSeg.has(s.segId) && (r.key === 'slope');
        const text = r.key === 'distance' ? fmtLen(s.distance, unit) : r.key === 'slope' ? s.slopeText : s.pipeSpec;
        sheet.ops.push({ t: 'text', x, y: y + ROW_H / 2 + 1, s: text, size: 2.6, anchor: 'middle', color: bad ? RED : INK });
      });
    } else {
      model.nodes.forEach((n, i) => {
        const x = X(n.cumDistance);
        const bad = r.key === 'cover' && warnNode.has(n.nodeId);
        if (r.key === 'manhole') {
          if (!n.manhole) return;
          // 横書き 2 行（列幅は隣の点までの距離）
          const first = i === 0, last = i === model.nodes.length - 1;
          const prev = first ? x : X(model.nodes[i - 1].cumDistance), next = last ? x : X(model.nodes[i + 1].cumDistance);
          // 端の点は内側へ寄せて書く（1 点だけなら中央）
          const anchor = first && !last ? 'start' : last && !first ? 'end' : 'middle';
          const w = Math.max(8, (anchor === 'middle' ? Math.min(x - prev, next - x) : anchor === 'start' ? next - x : x - prev) - 2);
          const tx = anchor === 'start' ? x + 1 : anchor === 'end' ? x - 1 : x;
          sheet.ops.push({ t: 'text', x: tx, y: y + 4, s: fitText(n.manhole.label, 2.3, w), size: 2.3, anchor });
          sheet.ops.push({ t: 'text', x: tx, y: y + 8, s: fitText(`φ${n.manhole.diameter} 深${fmtLen(n.manhole.depth, unit)}`, 2.3, w), size: 2.3, anchor });
          return;
        }
        let text = '';
        if (r.key === 'cumDistance') text = fmtLen(n.cumDistance, unit);
        else if (r.key === 'groundLevel') text = fmtLen(n.groundLevel, unit);
        else if (r.key === 'invertLevel') text = fmtLen(n.invertLevel, unit);
        else if (r.key === 'cover') text = fmtLen(n.cover, unit);
        // 縦書き（-90°、行の中央）で列幅を節約
        sheet.ops.push({ t: 'text', x: x + 0.9, y: y + ROW_H / 2, s: text, size: 2.4, anchor: 'middle', color: bad ? RED : INK, rotate: -90 });
      });
    }
  });

  // 欄外: 警告・要確認（表題欄の左）
  const notes: { s: string; color: string }[] = [];
  for (const w of model.warnings) notes.push({ s: `⚠ ${w.message}`, color: w.kind === 'tentativeGL' ? GRAY : RED });
  if (profile.unverified.length) notes.push({ s: `要確認: ${profile.unverified.join('、')}（自治体の手引きで確認してください）`, color: GRAY });
  const noteX = 10 + M, noteW = sheet.width - 10 - TITLE_W - 10 - noteX - 5;
  const noteY0 = sheet.height - 10 - titleH;
  notes.slice(0, 8).forEach((n, i) => sheet.ops.push({ t: 'text', x: noteX, y: noteY0 + 3.5 * (i + 1), s: fitText(n.s, 2.6, noteW), size: 2.6, color: n.color }));

  // 表題欄
  const values: Record<string, string> = {
    '工事名': meta.siteName, '図面名': model.title, '縮尺': `H 1/${hScale} V 1/${vS}`, '作成日': dateJa(meta.date),
  };
  drawTitleBlock(sheet, profile.paper.titleBlockFields.map((f) => ({ label: f, value: values[f] ?? '' })));
  return sheet;
}

export const renderProfileSvg = (model: ProfileModel, meta: SheetMeta): string => sheetToSvg(renderProfileSheet(model, meta));
