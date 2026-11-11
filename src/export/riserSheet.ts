/**
 * 給水立面図（系統図）の描画。単線。本線を左、分岐は左から順に横へずらす簡易配置。
 * 縦は vScale で高さを用紙 mm に、横は列ごとに一定幅。階ごとの水平線（FL）と階名を描く。
 */
import type { RiserEdge, RiserModel, RiserNode } from '../model/riser';
import { riserNodes } from '../model/riser';
import { drawingMaterial } from '../model/materials';
import { dateJa } from './report';
import { SCALES } from './drawingPdf';
import { drawFrame, drawSymbol, drawTitleBlock, GRAY, INK, paperSize, sheetToSvg, titleWidth, type Sheet } from './sheet';
import type { SheetMeta } from './profileSheet';
import { around, at, later, LabelPlacer, type Cand, type LabelLine } from './labelLayout';

const M = 15;
const COL_W = 30; // 列の間隔(mm)
const HOT = '#c2410c';

export function renderRiserSheet(model: RiserModel, meta: SheetMeta): Sheet {
  const { profile } = model;
  const sheet: Sheet = { ...paperSize(profile.paper), ops: [] };
  drawFrame(sheet);
  sheet.ops.push({ t: 'text', x: 10 + M, y: 10 + M + 2, s: model.title, size: 6, bold: true });
  sheet.ops.push({ t: 'text', x: 10 + M + 60, y: 10 + M + 2, s: `（${profile.name}）`, size: 3, color: GRAY });

  const nodes = riserNodes(model.root);
  const titleH = 7 * profile.paper.titleBlockFields.length + 6;
  const top = 10 + M + 14, bottom = sheet.height - 10 - titleH - 8;
  const left = 10 + M + 20, right = sheet.width - 10 - M - titleWidth(sheet.width);
  const zs = nodes.map((n) => n.z).concat(model.floors.map((f) => f.z));
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const span = Math.max(1000, maxZ - minZ + 600);
  let vS = profile.profileTable.vScale;
  if (span / vS > bottom - top) vS = [vS, ...SCALES.filter((x) => x > vS)].find((n) => span / n <= bottom - top) ?? SCALES[SCALES.length - 1];
  const Y = (z: number) => bottom - (z - minZ + 300) / vS;
  let colW = COL_W;
  if (left + model.columns * colW > right) colW = Math.max(12, (right - left) / model.columns);
  const X = (col: number) => left + col * colW + 5;

  // 階の線
  if (profile.riser.showFloorLines) {
    for (const f of model.floors) {
      sheet.ops.push({ t: 'line', x1: left - 15, y1: Y(f.z), x2: Math.min(right, X(model.columns) + 10), y2: Y(f.z), color: GRAY, dash: true });
      sheet.ops.push({ t: 'text', x: left - 16, y: Y(f.z) + 1, s: `${f.name} FL`, size: 2.6, anchor: 'end', color: GRAY });
    }
  }

  // 文字は線と記号を全部描いてから、空いている場所に置く（重なり回避。labelLayout.ts）
  const segs: [number, number, number, number, string][] = [];
  const dia: { cands: Cand[]; id: string }[] = [];
  let edgeNo = 0;
  const drawEdge = (from: RiserNode, e: RiserEdge) => {
    const to = e.to;
    const color = e.system === 'hotWater' ? HOT : INK;
    const id = `e${edgeNo++}`;
    const x0 = X(from.x), y0 = Y(from.z), x1 = X(to.x), y1 = Y(to.z);
    // 横引き → 立ち上がり の L 字（同じ列なら縦線だけ、同じ高さなら横線だけ）
    const pts: [number, number][] = x0 === x1 || y0 === y1 ? [[x0, y0], [x1, y1]] : [[x0, y0], [x1, y0], [x1, y1]];
    sheet.ops.push({ t: 'poly', pts, w: 0.5, color });
    for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], id]);
    // 口径ラベル: 立ち上がり（列ごとに固有）があればそこに、無ければ横引きの中央に。短すぎる区間には書かない
    const l: LabelLine = { s: `φ${e.diameter}${e.material ? ` ${drawingMaterial(e.material)}` : ''}`, size: 2.4, color };
    const side = profile.riser.diameterLabelPos === 'side';
    const cands: Cand[] = [];
    if (Math.abs(y1 - y0) > 4) {
      // 立ち上がりの中央 → 上寄り・下寄り → 反対側
      const R = (y: number, p: number) => at(x1 + 1.5, y + 1, l, 'start', p), L = (y: number, p: number) => at(x1 - 1.5, y + 1, l, 'end', p);
      const [A, B] = side ? [R, L] : [L, R];
      const my = (y0 + y1) / 2, q = (y1 - y0) / 4;
      cands.push(A(my, 0), A(my - q, 1), A(my + q, 2), B(my, 3), B(my - q, 4), B(my + q, 5));
    }
    if (Math.abs(x1 - x0) > 8) {
      // 横引きのラベルは線の下（器具名は線の上に書くので重ならない）
      const mx = (x0 + x1) / 2;
      cands.push(at(mx, y0 + 3.5, l, 'middle', 6), at(mx, y0 - 1.2, l, 'middle', 7));
    }
    if (cands.length) dia.push({ id, cands: [...cands, ...around(x1, (y0 + y1) / 2, [l], { gap: 2.5, leaderAlways: true, leaderColor: GRAY }).map(later(20))] });
  };
  const symbols: { x: number; y: number; r: number }[] = [];
  const names: Cand[][] = [];
  const drawNode = (n: RiserNode) => {
    const x = X(n.x), y = Y(n.z);
    if (n.fixture) {
      drawSymbol(sheet, n.fixture.symbol, x, y, 2);
      symbols.push({ x, y, r: 2.4 });
      const block: LabelLine[] = [{ s: n.fixture.label, size: 2.4 }, { s: n.heightLabel, size: 2.2, color: GRAY }];
      names.push([
        { texts: [{ t: 'text', x: x + 3, y: y - 2.2, s: block[0].s, size: 2.4 }, { t: 'text', x: x + 3, y: y + 1.2, s: block[1].s, size: 2.2, color: GRAY }], penalty: 0 },
        ...around(x, y, block, { gap: 3, prefer: [-45, 45, -90, 90, 180], leaderColor: GRAY }).map(later(1)),
      ]);
    } else if (n.valve) {
      drawSymbol(sheet, 'valve', x, y, 1.6);
      symbols.push({ x, y, r: 2 });
      const l: LabelLine = { s: `止水栓 ${n.heightLabel}`, size: 2.2, color: GRAY };
      names.push([at(x + 3, y + 1, l), ...around(x, y, [l], { gap: 2.6, prefer: [-45, 45, 180] }).map(later(1))]);
    } else if (n.children.length !== 1) {
      sheet.ops.push({ t: 'circle', cx: x, cy: y, r: 0.6, fill: INK });
    }
  };
  const walk = (n: RiserNode) => { for (const e of n.children) { drawEdge(n, e); walk(e.to); } };
  walk(model.root);
  for (const n of nodes) drawNode(n);
  const placer = new LabelPlacer(sheet, { x1: 11, y1: top - 8, x2: sheet.width - 11, y2: sheet.height - 10 - titleH });
  for (const [x1, y1, x2, y2, id] of segs) placer.blockSeg(x1, y1, x2, y2, id);
  // 階の線（破線）にも文字を重ねない
  if (profile.riser.showFloorLines) for (const f of model.floors) placer.blockSeg(left - 15, Y(f.z), Math.min(right, X(model.columns) + 10), Y(f.z));
  for (const q of symbols) placer.block({ x1: q.x - q.r, y1: q.y - q.r, x2: q.x + q.r, y2: q.y + q.r });
  // 器具名 → 口径の順（器具名は記号のそばを優先）
  for (const c of names) placer.place(c);
  for (const d of dia) placer.place(d.cands, { ignoreSeg: d.id });

  // 凡例・警告
  const noteX = 10 + M, noteY = sheet.height - 10 - titleH + 3;
  sheet.ops.push({ t: 'text', x: noteX, y: noteY, s: '凡例: ― 給水  ― 給湯（橙）  高さは ' + (profile.riser.heightLabel === 'GL+' ? '設計GL' : 'その階の床') + ' 基準（mm）', size: 2.6, color: GRAY });
  model.warnings.forEach((w, i) => sheet.ops.push({ t: 'text', x: noteX, y: noteY + 3.5 * (i + 1), s: `※ ${w}`, size: 2.6, color: '#d91e18' }));
  if (profile.unverified.length) sheet.ops.push({ t: 'text', x: noteX, y: noteY + 3.5 * (model.warnings.length + 1), s: `要確認: ${profile.unverified.join('、')}`, size: 2.6, color: GRAY });

  const values: Record<string, string> = { '工事名': meta.siteName, '図面名': model.title, '縮尺': `V 1/${vS}`, '作成日': dateJa(meta.date) };
  drawTitleBlock(sheet, profile.paper.titleBlockFields.map((f) => ({ label: f, value: values[f] ?? '' })));
  return sheet;
}

export const renderRiserSvg = (model: RiserModel, meta: SheetMeta): string => sheetToSvg(renderRiserSheet(model, meta));
