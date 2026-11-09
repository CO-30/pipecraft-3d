/**
 * アイソメ図（立面図・展開図）の描画。配管の等角投影を枠に収め（NO SCALE）、
 * 区間に「管種口径×長さ」、器具に名前と高さ、マスに名前を書く。
 * 色: 給水＝赤、給湯＝青、市配水管／公共＝黒（排水は 新設＝赤、既設＝青、公共＝黒）。
 */
import type { IsoModel } from '../model/isometric';
import type { MunicipalityProfile } from '../model/municipality';
import { dateJa } from './report';
import { drawFrame, drawHeaderBlock, drawSymbol, drawTitleBlock, GRAY, INK, paperSize, sheetToSvg, titleWidth, type Sheet } from './sheet';
import type { SheetMeta } from './profileSheet';

export type IsoMeta = SheetMeta & { title: string };
export type Box = { x: number; y: number; w: number; h: number };
const HOT = '#1d4ed8';

/** 枠 box に収まるように縮めて描く。戻り値は使った縮尺（mm/mm） */
export function drawIsometric(sheet: Sheet, iso: IsoModel, profile: MunicipalityProfile, box: Box): number {
  const { bounds } = iso;
  const w = Math.max(1, bounds.maxX - bounds.minX), h = Math.max(1, bounds.maxY - bounds.minY);
  const pad = 14; // ラベルの余白(mm)
  const k = Math.max(0.001, Math.min((box.w - pad * 2) / w, (box.h - pad * 2) / h));
  const ox = box.x + pad + ((box.w - pad * 2) - w * k) / 2, oy = box.y + pad + ((box.h - pad * 2) - h * k) / 2;
  const X = (x: number) => ox + (x - bounds.minX) * k, Y = (y: number) => oy + (y - bounds.minY) * k;
  const colors = profile.colors;
  const lineColor = (l: IsoModel['lines'][number]) => (l.existing ? colors.existing : iso.kind === 'water' && l.system === 'hotWater' ? HOT : colors.newWork);
  for (const l of iso.lines) {
    const c = lineColor(l);
    sheet.ops.push({ t: 'line', x1: X(l.x1), y1: Y(l.y1), x2: X(l.x2), y2: Y(l.y2), w: 0.5, color: c });
    // ラベルは線の中央の少し上
    const mx = (X(l.x1) + X(l.x2)) / 2, my = (Y(l.y1) + Y(l.y2)) / 2;
    const vertical = Math.abs(X(l.x2) - X(l.x1)) < 0.5;
    sheet.ops.push({ t: 'text', x: vertical ? mx + 1.5 : mx, y: vertical ? my : my - 1.2, s: l.label, size: 2.2, anchor: vertical ? 'start' : 'middle', color: c });
  }
  for (const p of iso.points) {
    const x = X(p.x), y = Y(p.y);
    const c = p.existing ? colors.existing : colors.newWork;
    if (p.isManhole) {
      sheet.ops.push({ t: 'circle', cx: x, cy: y, r: 1.4, stroke: c, fill: '#ffffff', lw: 0.3 });
      sheet.ops.push({ t: 'text', x: x + 2, y: y + 4, s: p.label, size: 2.2, color: c });
    } else {
      drawSymbol(sheet, profile.symbols[p.label] ?? 'triangle', x, y, 1.2, c);
      sheet.ops.push({ t: 'text', x: x + 2, y: y - 1, s: p.label, size: 2.2, color: INK });
      if (p.height !== undefined) sheet.ops.push({ t: 'text', x: x + 2, y: y + 2.2, s: p.height, size: 2, color: GRAY });
    }
  }
  return k;
}

function legend(sheet: Sheet, iso: IsoModel, profile: MunicipalityProfile, x: number, y: number) {
  // 図に出ている色だけ
  const hasExisting = iso.lines.some((l) => l.existing) || iso.points.some((p) => p.existing);
  const hasHot = iso.lines.some((l) => l.system === 'hotWater');
  const items: [string, string][] = iso.kind === 'water'
    ? [['給水', profile.colors.newWork] as [string, string], ...(hasHot ? [['給湯', HOT] as [string, string]] : []), ...(hasExisting ? [['既設', profile.colors.existing] as [string, string]] : [])]
    : [['新設', profile.colors.newWork], ...(hasExisting ? [['既設', profile.colors.existing] as [string, string]] : [])];
  sheet.ops.push({ t: 'rect', x, y, w: 40, h: 4 * items.length + 5, lw: 0.3 });
  sheet.ops.push({ t: 'text', x: x + 1, y: y + 3, s: '凡例', size: 2.2, color: GRAY });
  items.forEach(([label, color], i) => {
    const yy = y + 6 + 4 * i;
    sheet.ops.push({ t: 'line', x1: x + 2, y1: yy, x2: x + 12, y2: yy, color, w: 0.5 });
    sheet.ops.push({ t: 'text', x: x + 14, y: yy + 0.9, s: label, size: 2.2 });
  });
  sheet.ops.push({ t: 'text', x, y: y + 4 * items.length + 8.5, s: '※単位はmm 管長はm', size: 2, color: GRAY });
}

/** 1 枚もの（給水の立面図（展開図）など） */
export function renderIsoSheet(iso: IsoModel, profile: MunicipalityProfile, meta: IsoMeta): Sheet {
  const sheet: Sheet = { ...paperSize(profile.paper), ops: [] };
  drawFrame(sheet);
  sheet.ops.push({ t: 'text', x: 25, y: 27, s: meta.title, size: 6, bold: true });
  const headerBottom = drawHeaderBlock(sheet, profile.paper.headerFields, { '縮尺': 'NO SCALE' }, 22);
  if (!profile.paper.headerFields.length) sheet.ops.push({ t: 'text', x: sheet.width - 25, y: 27, s: 'NO SCALE', size: 3, anchor: 'end', color: GRAY });
  const titleH = 7 * profile.paper.titleBlockFields.length + 6;
  const top = Math.max(32, headerBottom + 4);
  drawIsometric(sheet, iso, profile, { x: 25, y: top, w: sheet.width - 50, h: sheet.height - top - titleH - 30 });
  legend(sheet, iso, profile, sheet.width - 10 - titleWidth(sheet.width) - 45, sheet.height - 10 - titleH - 20);
  const values: Record<string, string> = { '工事名': meta.siteName, '申請地': meta.siteName, '図面名': meta.title, '縮尺': 'NO SCALE', '作成日': dateJa(meta.date) };
  drawTitleBlock(sheet, profile.paper.titleBlockFields.map((f) => ({ label: f, value: values[f] ?? '' })));
  return sheet;
}

export const renderIsoSvg = (iso: IsoModel, profile: MunicipalityProfile, meta: IsoMeta): string => sheetToSvg(renderIsoSheet(iso, profile, meta));
export { legend as drawIsoLegend };
