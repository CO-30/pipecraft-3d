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
import { alongLine, around, LabelPlacer, type LabelLine } from './labelLayout';

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
  // 文字は「線・記号を全部描いてから」空いている場所に置く（重なり回避。labelLayout.ts）
  const placer = new LabelPlacer(sheet, { x1: box.x, y1: box.y, x2: box.x + box.w, y2: box.y + box.h });
  const lines = iso.lines.map((l) => ({ l, x1: X(l.x1), y1: Y(l.y1), x2: X(l.x2), y2: Y(l.y2), c: lineColor(l) }));
  for (const q of lines) {
    sheet.ops.push({ t: 'line', x1: q.x1, y1: q.y1, x2: q.x2, y2: q.y2, w: 0.5, color: q.c });
    placer.blockSeg(q.x1, q.y1, q.x2, q.y2, q.l.segId);
  }
  const points = iso.points.map((p) => ({ p, x: X(p.x), y: Y(p.y), c: p.existing ? colors.existing : colors.newWork }));
  for (const { p, x, y, c } of points) {
    if (p.isManhole) sheet.ops.push({ t: 'circle', cx: x, cy: y, r: 1.4, stroke: c, fill: '#ffffff', lw: 0.3 });
    else {
      // 記号は器具の種類で選ぶ（ヘッダーは太い横棒）
      const sym = p.type === 'waterHeader' || p.type === 'hotWaterHeader' ? 'header' : (p.type && profile.symbols[p.type]) || 'triangle';
      drawSymbol(sheet, sym, x, y, 1.2, c);
    }
    placer.block({ x1: x - 1.7, y1: y - 1.7, x2: x + 1.7, y2: y + 1.7 });
  }
  // 器具・マスの名前（高さは名前の下の行）。記号のすぐ横が空いていなければ離して引出線
  for (const { p, x, y, c } of points) {
    const label: LabelLine[] = p.isManhole ? [{ s: p.label, size: 2.2, color: c }] : [{ s: p.label, size: 2.2, color: INK }, ...(p.height !== undefined ? [{ s: p.height, size: 2, color: GRAY }] : [])];
    placer.place(around(x, y, label, { gap: 2, prefer: p.isManhole ? [45, 0, -45] : [0, -45, 45], leaderColor: GRAY }));
  }
  // 管種口径×長さ: 長い線から順に、線に沿って書く。文字より短い線は横に出して引出線
  for (const q of [...lines].sort((a, b) => Math.hypot(b.x2 - b.x1, b.y2 - b.y1) - Math.hypot(a.x2 - a.x1, a.y2 - a.y1))) {
    const label: LabelLine = { s: q.l.label, size: 2.2, color: q.c };
    const mx = (q.x1 + q.x2) / 2, my = (q.y1 + q.y2) / 2;
    placer.place([
      ...alongLine(q.x1, q.y1, q.x2, q.y2, label),
      ...around(mx, my, [label], { gap: 2.5, prefer: [-90, 90, -45, 45], leaderAlways: true }).map((c) => ({ ...c, penalty: c.penalty + 100 })),
    ], { ignoreSeg: q.l.segId });
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
