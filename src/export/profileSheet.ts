/**
 * 排水縦断図の描画。上段に GL 線・管底線・マスの記号、下段に自治体プロファイルの行順で表。
 * 横は累加距離を hScale で、縦は高さを vScale で用紙 mm に換算する。図が用紙に収まらないときは横の縮尺を上げる。
 */
import type { ProfileModel } from '../model/profileDrawing';
import type { IsoModel } from '../model/isometric';
import { drawIsometric } from './isoSheet';
import { dateJa } from './report';
import { SCALES } from './drawingPdf';
import { around, at, later, LabelPlacer, spread1D, textWidth, type Cand, type LabelLine } from './labelLayout';
import { drawFrame, drawHeaderBlock, drawSymbol, drawTitleBlock, fitText, GRAY, INK, paperSize, sheetToSvg, titleWidth, WARN, type Sheet } from './sheet';

export type SheetMeta = { siteName: string; date: Date };

const M = 15; // 枠内の余白
const LABEL_W = 26; // 表の行ラベルの幅
const ROW_H = 11;
/** 桝の名前を図の上に縦書きする高さ(mm) */
const ABOVE_H = 48;

/** 数値表示（m 小数3位 / mm 整数）。decimals は m のときの小数桁 */
export const fmtLen = (mm: number, unit: 'm' | 'mm', decimals: 2 | 3 = 3) => (unit === 'mm' ? String(Math.round(mm)) : (Math.round(mm) / 1000).toFixed(decimals));
/** 符号付きの mm（(±0) (−600) のように） */
const fmtDiff = (mm: number) => (mm === 0 ? '±0' : `${mm < 0 ? '−' : '+'}${Math.abs(mm)}`);

/** 図が収まる横縮尺（1/N）。プロファイルの hScale 以上で、SCALES から最小のもの */
export function pickHScale(totalMm: number, areaW: number, base: number): number {
  for (const n of [base, ...SCALES.filter((x) => x > base)]) if (totalMm / n <= areaW) return n;
  return SCALES[SCALES.length - 1];
}

/** iso: 排水のアイソメ図（プロファイルの drainageIsometric が true のとき、縦断図の上に描く） */
export function renderProfileSheet(model: ProfileModel, meta: SheetMeta, iso?: IsoModel): Sheet {
  const { profile } = model;
  const pt = profile.profileTable;
  const sheet: Sheet = { ...paperSize(profile.paper), ops: [] };
  drawFrame(sheet);
  const unit = pt.unit ?? 'm';
  const above = pt.manholeLabel === 'above';
  const left = 10 + M + LABEL_W, right = sheet.width - 10 - M;
  const rows = pt.rows;
  const tableH = ROW_H * rows.length;
  const titleH = 7 * profile.paper.titleBlockFields.length + 6;
  const tableTop = sheet.height - 10 - M - tableH - Math.max(titleH, 0) - 4;
  // 桝の名前を図の上に縦書きするときは、その分の高さ（ABOVE_H）を空ける
  const withIso = !!iso && pt.drainageIsometric && iso.lines.length > 0;
  const headerBottom = drawHeaderBlock(sheet, profile.paper.headerFields, { '縮尺': 'NO SCALE' }, 10 + M - 2);
  const headTop = Math.max(10 + M + 12, headerBottom + 3);
  const graphBottom = tableTop - 8;
  // 上半分に排水のアイソメ図（沖縄市の「立面図（展開図）」）: 縦断図の領域の 40% を使い、桝名の高さと重ねない
  let graphTop = headTop + (above ? ABOVE_H : 0);
  if (withIso) {
    const isoTop = headTop - 4;
    const isoH = Math.max(30, Math.round((graphBottom - isoTop - (above ? ABOVE_H : 0) - 30) * 0.45));
    sheet.ops.push({ t: 'text', x: sheet.width - 10 - M, y: profile.paper.headerFields.length ? headerBottom + 4 : 10 + M + 2, s: '立面図（展開図）NO SCALE', size: 3, anchor: 'end', color: GRAY });
    drawIsometric(sheet, iso!, profile, { x: 10 + M, y: isoTop, w: sheet.width - 20 - 2 * M, h: isoH });
    graphTop = isoTop + isoH + 4 + (above ? ABOVE_H : 0);
  }

  // 見出し
  sheet.ops.push({ t: 'text', x: 10 + M, y: 10 + M + 2, s: model.title, size: 6, bold: true });
  // 自治体名は見出しの下（右上の受付欄と重ねない）
  sheet.ops.push({ t: 'text', x: 10 + M, y: 10 + M + 6.5, s: `（${profile.name}）`, size: 3, color: GRAY });

  const total = model.nodes.length ? model.nodes[model.nodes.length - 1].cumDistance : 0;
  const areaW = right - left - 10;
  const hScale = pickHScale(total, areaW, pt.hScale);
  const vScale = pt.vScale;
  // 下流端を左に描く様式（沖縄市）は x を鏡にする
  const mirror = pt.downstreamSide === 'left';
  const X = (mm: number) => left + 5 + (mirror ? total - mm : mm) / hScale;
  /** 上流側の列のずれ（落差桝の 2 列）: 上流は通常左、鏡なら右 */
  const upSide = mirror ? 1 : -1;

  // 基準線 DL: 最小の管底高を 1m 単位で切り下げ
  const minZ = Math.min(...model.nodes.map((n) => Math.min(n.invertLevel, n.groundLevel)), 0);
  const maxZ = Math.max(...model.nodes.map((n) => Math.max(n.invertLevel, n.groundLevel)), 0);
  const DL = Math.floor(minZ / 1000) * 1000 - 200;
  const availH = graphBottom - graphTop - 10;
  // 縦の縮尺はプロファイルの値。収まらなければ上げる
  const vS = (maxZ - DL) / vScale > availH ? pickHScale(maxZ - DL, availH, vScale) : vScale;
  const Y = (z: number) => graphBottom - (z - DL) / vS;

  // 表の列の位置: 点が近すぎて数字が重なるときは、列だけを最小限ずらして引出線でつなぐ（図の位置は実寸のまま）
  const hasManholeRow = rows.some((r) => r.key === 'manhole');
  /** 表の「マス」行に書く 2 行（名前 / 径・深さ） */
  const mhLines = (n: ProfileModel['nodes'][number]) => (n.manhole ? [n.manhole.label, `φ${n.manhole.diameter} 深${fmtLen(n.manhole.depth, unit)}`] : []);
  // 列の幅: 数字だけなら 3.4mm、落差桝は 2 列ぶん。「マス」行がある様式は桝名が入る幅（端の桝は内側へ寄せて書くので 2 倍）
  const slots = model.nodes.map((n, i) => {
    const base = n.invertIn !== undefined ? 7.4 : 3.4;
    if (!n.manhole || !hasManholeRow) return base;
    const w = Math.min(26, Math.max(...mhLines(n).map((t) => textWidth(t, 2.3))) + 2);
    const end = model.nodes.length > 1 && (i === 0 || i === model.nodes.length - 1);
    return Math.max(base, end ? w * 2 : w);
  });
  const colLo = left + 3, colHi = right - 4;
  const colX = spread1D(model.nodes.map((n) => X(n.cumDistance)), slots, colLo, colHi);
  // 入りきらずに詰めたときの縮み具合（桝名の切り詰めに使う）
  const slotSum = slots.reduce((a, b) => a + b, 0) - (slots[0] + slots[slots.length - 1]) / 2;
  const slotScale = slotSum > colHi - colLo ? (colHi - colLo) / slotSum : 1;
  /** 空いている場所を探して置く文字（区間の管種・勾配、桝名、注記）。線と記号を描き終えてから置く */
  const floats: Cand[][] = [];

  // DL 線とラベル
  sheet.ops.push({ t: 'line', x1: left, y1: graphBottom, x2: right, y2: graphBottom, color: GRAY });
  sheet.ops.push({ t: 'text', x: left - 1, y: graphBottom + 1, s: `DL ${fmtLen(DL, unit)}`, size: 2.6, anchor: 'end', color: GRAY });
  const warnSeg = new Set(model.warnings.filter((w) => w.segId).map((w) => w.segId));
  const warnNode = new Set(model.warnings.filter((w) => w.nodeId).map((w) => w.nodeId));
  // 色分け（申請書の指示）: 新設・増設＝赤、既設＝青、公共＝黒。警告は橙
  const colors = profile.colors;
  const segColor = (s: { segId: string; existing?: boolean }) => (warnSeg.has(s.segId) ? WARN : s.existing ? colors.existing : colors.newWork);
  // 器具の無い点（曲がり・分岐）は、つながる区間がすべて既設なら既設
  const nodeExisting = (i: number) => {
    const n = model.nodes[i];
    if (n.manhole) return !!n.existing;
    const adj = [model.segments[i - 1], model.segments[i]].filter(Boolean);
    return adj.length > 0 && adj.every((s) => s.existing);
  };
  const nodeColor = (i: number) => {
    const n = model.nodes[i];
    return warnNode.has(n.nodeId) ? WARN : nodeExisting(i) ? colors.existing : colors.newWork;
  };

  // GL 線
  if (model.nodes.length) {
    sheet.ops.push({ t: 'poly', pts: model.nodes.map((n) => [X(n.cumDistance), Y(n.groundLevel)]), w: 0.3, color: INK });
    const leftmost = mirror ? model.nodes[model.nodes.length - 1] : model.nodes[0];
    sheet.ops.push({ t: 'text', x: X(leftmost.cumDistance) - 4, y: Y(leftmost.groundLevel) - 1, s: `GL${model.tentativeGL ? '（仮）' : ''}`, size: 2.6, anchor: 'end' });
    // 管底線（区間ごと。警告は赤）
    for (let i = 0; i < model.segments.length; i++) {
      const a = model.nodes[i], b = model.nodes[i + 1], s = model.segments[i];
      const c = segColor(s);
      // 下流端 b が落差桝なら流入側の管底に着く
      const zb = b.invertIn ?? b.invertLevel;
      sheet.ops.push({ t: 'line', x1: X(a.cumDistance), y1: Y(a.invertLevel), x2: X(b.cumDistance), y2: Y(zb), w: 0.6, color: c });
      // 区間の上に 管種口径・勾配（沖縄市の様式では 管種口径／勾配／長さ を 3 行で下に）
      const mx = (X(a.cumDistance) + X(b.cumDistance)) / 2, my = (Y(a.invertLevel) + Y(zb)) / 2;
      if (above) {
        // 管種口径／勾配／長さ を 3 行（表に重ならないよう線の上）。桝名とぶつかるときは管の下へ出して引出線
        const top = Math.min(Y(a.groundLevel), Y(b.groundLevel)) - 1.5;
        const block: LabelLine[] = [s.pipeSpec, s.slopeText, fmtLen(s.distance, unit, pt.lengthDecimals)].map((t) => ({ s: t, size: 2.6, color: c }));
        floats.push([
          { texts: block.map((l, k) => ({ t: 'text' as const, x: mx, y: top - 7 + 3.5 * k, s: l.s, size: 2.6, anchor: 'middle' as const, color: c })), penalty: 0 },
          ...around(mx, top + 1, block, { gap: 3, prefer: [-90, -60, -120, -30, -150, 0, 180], leaderAlways: true }).map(later(10)),
        ]);
      } else {
        const l: LabelLine = { s: `${s.pipeSpec} ${s.slopeText}`, size: 2.6, color: c };
        floats.push([at(mx, my - 2, l, 'middle'), at(mx, my + 3.8, l, 'middle', 1), ...around(mx, my, [l], { gap: 2, prefer: [-90, 90, -60, -120], leaderAlways: true }).map(later(10))]);
      }
    }
    // 図の上の桝名（縦書き）: 桝が近いときは名前だけ横へずらす
    const mhIdx = model.nodes.map((n, i) => (n.manhole ? i : -1)).filter((i) => i >= 0);
    const nameXs = spread1D(mhIdx.map((i) => X(model.nodes[i].cumDistance)), 6.6, left - 2, right - 2);
    const nameX = new Map(mhIdx.map((i, k) => [i, nameXs[k]]));
    // 各点: 縦の引出線、マスの記号
    model.nodes.forEach((n, i) => {
      const x = X(n.cumDistance);
      const cx = colX[i];
      if (Math.abs(cx - x) < 0.05) sheet.ops.push({ t: 'line', x1: x, y1: Y(n.groundLevel), x2: x, y2: tableTop, color: GRAY, w: 0.15, dash: true });
      else {
        // 表の列をずらした点: 図の下で折れて列へつなぐ
        sheet.ops.push({ t: 'line', x1: x, y1: Y(n.groundLevel), x2: x, y2: tableTop - 7.5, color: GRAY, w: 0.15, dash: true });
        sheet.ops.push({ t: 'line', x1: x, y1: tableTop - 7.5, x2: cx, y2: tableTop - 6, color: GRAY, w: 0.15 }, { t: 'line', x1: cx, y1: tableTop - 6, x2: cx, y2: tableTop, color: GRAY, w: 0.15, dash: true });
      }
      if (n.manhole) {
        // マス: GL から管底までの箱と記号
        const hw = Math.max(1.5, n.manhole.diameter / hScale / 2);
        const c = nodeColor(i);
        sheet.ops.push({ t: 'rect', x: x - hw, y: Y(n.groundLevel), w: hw * 2, h: Math.max(0.5, Y(n.invertLevel) - Y(n.groundLevel)), stroke: c, fill: '#ffffff', lw: 0.3 });
        // 落差桝: 流入側の管底から流出側の管底へ落ちる線
        if (n.invertIn !== undefined) sheet.ops.push({ t: 'line', x1: x + upSide * hw, y1: Y(n.invertIn), x2: x + upSide * hw, y2: Y(n.invertLevel), w: 0.6, color: c });
        drawSymbol(sheet, n.manhole.symbol, x, Y(n.groundLevel) - 4, 2.2, c);
        // 深さ: 落差桝は H530-830（流入側-流出側）
        const depthText = n.manhole.depthIn !== undefined ? `H${Math.round(n.manhole.depthIn)}-${Math.round(n.manhole.depth)}` : `H${Math.round(n.manhole.depth)}`;
        if (above) {
          // 「NO.1小口径桝 φ150 H410」を縦書きで図の上に、GL の差を (−600) のように
          const diff = n.glDiff !== undefined ? ` (${fmtDiff(n.glDiff)})` : '';
          // 2 列に分けて縦書き（名前 / 径・深さ・GL差）。各列は ABOVE_H−8 に収める
          const nx = nameX.get(i) ?? x, moved = Math.abs(nx - x) > 0.05;
          const by = Y(n.groundLevel) - (moved ? 9.5 : 7);
          if (moved) sheet.ops.push({ t: 'line', x1: x, y1: Y(n.groundLevel) - 6.3, x2: nx, y2: by + 0.5, w: 0.12, color: GRAY });
          const room = ABOVE_H - 8 - (moved ? 2.5 : 0);
          sheet.ops.push({ t: 'text', x: nx - 1.6, y: by, s: fitText(n.manhole.name, 2.4, room), size: 2.4, anchor: 'start', rotate: -90 });
          sheet.ops.push({ t: 'text', x: nx + 1.6, y: by, s: fitText(`φ${n.manhole.diameter} ${depthText}${diff}`, 2.4, room), size: 2.4, anchor: 'start', rotate: -90 });
        } else {
          // 桝名: 真上が空いていなければ 1 段ずつ上げ、それでもだめなら横へ出して引出線
          const l: LabelLine = { s: n.manhole.label, size: 2.4 };
          const gy = Y(n.groundLevel);
          floats.push([at(x, gy - 7.5, l, 'middle'), at(x, gy - 10.7, l, 'middle', 1), at(x, gy - 13.9, l, 'middle', 2), at(x, gy - 17.1, l, 'middle', 3), ...around(x, gy - 6.4, [l], { gap: 1.5, prefer: [-90, -45, -135], leaderAlways: true, leaderColor: GRAY }).map(later(10))]);
        }
        if (n.note) {
          const l: LabelLine = { s: n.note, size: 2.4, color: GRAY };
          const y0 = Y(n.groundLevel) - (above ? ABOVE_H - 1 : 10.5);
          floats.push([at(x, y0, l, 'middle'), at(x, y0 - 3.2, l, 'middle', 1), at(x, y0 - 6.4, l, 'middle', 2), ...around(x, Y(n.groundLevel) - 6.4, [l], { gap: 2, prefer: [-90, -45, -135], leaderAlways: true }).map(later(10))]);
        }
      } else {
        if (n.note) {
          const l: LabelLine = { s: n.note, size: 2.4, color: GRAY };
          const iy = Y(n.invertLevel);
          floats.push([at(x, iy - 3, l, 'middle'), at(x, iy + 4.6, l, 'middle', 1), ...around(x, iy, [l], { gap: 2, prefer: [-90, 90, -45, 45], leaderAlways: true }).map(later(10))]);
        }
        sheet.ops.push({ t: 'circle', cx: x, cy: Y(n.invertLevel), r: 0.8, fill: nodeColor(i), stroke: nodeColor(i) });
      }
      if (!above) {
        // 点の番号: 列が詰まっているときは縦書き
        const no = `No.${i + 1}`;
        const gapTo = Math.min(i > 0 ? Math.abs(cx - colX[i - 1]) : Infinity, i + 1 < colX.length ? Math.abs(colX[i + 1] - cx) : Infinity);
        if (gapTo < textWidth(no, 2.4) + 0.8) sheet.ops.push({ t: 'text', x: cx - 0.6, y: tableTop - 0.8, s: no, size: 2.4, anchor: 'start', color: GRAY, rotate: -90 });
        else sheet.ops.push({ t: 'text', x: cx, y: tableTop - 1.5, s: no, size: 2.4, anchor: 'middle', color: GRAY });
      }
    });
    // 沖縄市の様式: 縮尺の矢印（S=1/200）
    if (above) {
      const ax = right - 12, ay = graphBottom;
      sheet.ops.push({ t: 'line', x1: ax, y1: ay, x2: ax - 14, y2: ay, color: INK }, { t: 'line', x1: ax, y1: ay, x2: ax, y2: ay - 14, color: INK });
      sheet.ops.push({ t: 'text', x: ax - 7, y: ay + 3.5, s: `S=1/${hScale}`, size: 2.4, anchor: 'middle' });
      sheet.ops.push({ t: 'text', x: ax + 1.2, y: ay - 7, s: `S=1/${vS}`, size: 2.4, anchor: 'middle', rotate: -90 });
    }
  }

  // 文字を置く（管・GL・桝・記号を避ける）
  if (floats.length) {
    const placer = new LabelPlacer(sheet, { x1: 11, y1: headTop - 6, x2: sheet.width - 11, y2: graphBottom - 0.4 });
    for (let i = 0; i < model.segments.length; i++) {
      const a = model.nodes[i], b = model.nodes[i + 1];
      placer.blockSeg(X(a.cumDistance), Y(a.invertLevel), X(b.cumDistance), Y(b.invertIn ?? b.invertLevel), `s${i}`);
      placer.blockSeg(X(a.cumDistance), Y(a.groundLevel), X(b.cumDistance), Y(b.groundLevel));
    }
    model.nodes.forEach((n) => {
      const x = X(n.cumDistance);
      placer.blockSeg(x, Y(n.groundLevel), x, graphBottom);
      if (n.manhole) {
        const hw = Math.max(1.5, n.manhole.diameter / hScale / 2);
        placer.block({ x1: x - hw, y1: Y(n.groundLevel), x2: x + hw, y2: Y(n.invertLevel) });
        placer.block({ x1: x - 2.4, y1: Y(n.groundLevel) - 6.4, x2: x + 2.4, y2: Y(n.groundLevel) - 1.6 });
      }
    });
    // 図の上に桝名を書く様式では、GL から下（管・桝の帯）には文字を置かない
    if (above && model.nodes.length) {
      const xs = model.nodes.map((n) => X(n.cumDistance));
      placer.block({ x1: Math.min(...xs) - 1, y1: Math.min(...model.nodes.map((n) => Y(n.groundLevel))) - 0.2, x2: Math.max(...xs) + 1, y2: graphBottom });
    }
    floats.forEach((c, i) => placer.place(c, { ignoreSeg: i < model.segments.length ? `s${i}` : undefined }));
  }

  // 下段の表
  const tableRight = model.nodes.length ? Math.max(X(total) + 5, Math.max(...colX) + 5, left + 40) : right;
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
        const x = (colX[i] + colX[i + 1]) / 2;
        const bad = warnSeg.has(s.segId) && (r.key === 'slope');
        const text = r.key === 'distance' ? fmtLen(s.distance, unit, pt.lengthDecimals) : r.key === 'slope' ? s.slopeText : s.pipeSpec;
        // 列が狭いときは縦書き
        if (textWidth(text, 2.6) <= Math.abs(colX[i + 1] - colX[i]) - 1) sheet.ops.push({ t: 'text', x, y: y + ROW_H / 2 + 1, s: text, size: 2.6, anchor: 'middle', color: bad ? WARN : INK });
        else sheet.ops.push({ t: 'text', x: x + 0.9, y: y + ROW_H / 2, s: fitText(text, 2.4, ROW_H - 1.5), size: 2.4, anchor: 'middle', color: bad ? WARN : INK, rotate: -90 });
      });
    } else {
      model.nodes.forEach((n, i) => {
        const x = colX[i];
        const bad = r.key === 'cover' && warnNode.has(n.nodeId);
        if (r.key === 'manhole') {
          if (!n.manhole) return;
          // 横書き 2 行（列幅は隣の点までの距離）
          const first = i === 0, last = i === model.nodes.length - 1;
          const prev = first ? x : colX[i - 1], next = last ? x : colX[i + 1];
          // 端の点は内側へ寄せて書く（1 点だけなら中央）
          // 端の点は内側へ寄せる。鏡像（下流端が左）なら向きも反転
          const anchor = first && !last ? (mirror ? 'end' : 'start') : last && !first ? (mirror ? 'start' : 'end') : 'middle';
          // 幅: 隣の点までの距離と、列をずらして確保した幅の大きいほう
          const byNeighbor = (anchor === 'middle' ? Math.min(Math.abs(x - prev), Math.abs(next - x)) : anchor === 'start' ? Math.abs(next - x) : Math.abs(x - prev)) - 2;
          const w = Math.max(8, byNeighbor, (anchor === 'middle' ? slots[i] : slots[i] / 2) * slotScale - 1.2);
          const tx = anchor === 'start' ? x + 1 : anchor === 'end' ? x - 1 : x;
          const [l1, l2] = mhLines(n);
          sheet.ops.push({ t: 'text', x: tx, y: y + 4, s: fitText(l1, 2.3, w), size: 2.3, anchor });
          sheet.ops.push({ t: 'text', x: tx, y: y + 8, s: fitText(l2, 2.3, w), size: 2.3, anchor });
          return;
        }
        let text = '';
        if (r.key === 'cumDistance') text = fmtLen(n.cumDistance, unit, pt.lengthDecimals);
        else if (r.key === 'groundLevel') text = fmtLen(n.groundLevel, unit);
        else if (r.key === 'invertLevel') text = fmtLen(n.invertLevel, unit);
        else if (r.key === 'cover') text = fmtLen(n.cover, unit);
        // 落差桝: 管底高・土被りは流入側（上流側の列）と流出側の 2 列
        const inText = r.key === 'invertLevel' && n.invertIn !== undefined ? fmtLen(n.invertIn, unit) : r.key === 'cover' && n.coverIn !== undefined ? fmtLen(n.coverIn, unit) : undefined;
        if (inText !== undefined) {
          sheet.ops.push({ t: 'text', x: x + 0.9 + upSide * 2.2, y: y + ROW_H / 2, s: inText, size: 2.4, anchor: 'middle', color: bad ? WARN : INK, rotate: -90 });
          sheet.ops.push({ t: 'text', x: x + 0.9 - upSide * 2.2, y: y + ROW_H / 2, s: text, size: 2.4, anchor: 'middle', color: bad ? WARN : INK, rotate: -90 });
          return;
        }
        // 縦書き（-90°、行の中央）で列幅を節約
        sheet.ops.push({ t: 'text', x: x + 0.9, y: y + ROW_H / 2, s: text, size: 2.4, anchor: 'middle', color: bad ? WARN : INK, rotate: -90 });
      });
    }
  });

  // 欄外: 警告・要確認（表題欄の左）
  // 「⚠」は PDF のフォント（NotoSansJP-JIS）に無いので「※」を使う
  const notes: { s: string; color: string }[] = [];
  for (const w of model.warnings) notes.push({ s: `※ ${w.message}`, color: w.kind === 'tentativeGL' ? GRAY : WARN });
  if (profile.unverified.length) notes.push({ s: `要確認: ${profile.unverified.join('、')}（自治体の手引きで確認してください）`, color: GRAY });
  if (model.datumLabel) notes.unshift({ s: `※ ${model.datumLabel}。単位は ${pt.unit}、管長は m`, color: GRAY });
  const noteX = 10 + M, noteW = sheet.width - 10 - titleWidth(sheet.width) - 10 - noteX - 5;
  const noteY0 = sheet.height - 10 - titleH;
  // 凡例は警告の上に 1 行（件数の上限に数えない）
  sheet.ops.push({ t: 'text', x: noteX, y: noteY0, s: fitText('凡例: 赤＝新設・増設　青＝既設　黒＝公共下水道　橙＝警告', 2.4, noteW), size: 2.4, color: GRAY });
  const MAX_NOTES = 8;
  const shown = notes.length > MAX_NOTES ? notes.slice(0, MAX_NOTES - 1) : notes;
  shown.forEach((n, i) => sheet.ops.push({ t: 'text', x: noteX, y: noteY0 + 3.5 * (i + 1), s: fitText(n.s, 2.6, noteW), size: 2.6, color: n.color }));
  if (notes.length > MAX_NOTES) sheet.ops.push({ t: 'text', x: noteX, y: noteY0 + 3.5 * MAX_NOTES, s: `他 ${notes.length - shown.length} 件（画面の警告一覧を確認してください）`, size: 2.6, color: WARN });

  // アイソメ図の凡例は欄外の「凡例:」の行で足りる（箱の凡例は表や表題欄と重なるので描かない）
  // 表題欄
  const values: Record<string, string> = {
    '工事名': meta.siteName, '図面名': model.title, '縮尺': `H 1/${hScale} V 1/${vS}`, '作成日': dateJa(meta.date),
  };
  drawTitleBlock(sheet, profile.paper.titleBlockFields.map((f) => ({ label: f, value: values[f] ?? '' })));
  return sheet;
}

export const renderProfileSvg = (model: ProfileModel, meta: SheetMeta, iso?: IsoModel): string => sheetToSvg(renderProfileSheet(model, meta, iso));
