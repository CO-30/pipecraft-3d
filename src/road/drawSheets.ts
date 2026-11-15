/**
 * 道路の申請の添付図（A4 横）: 占用平面図・横断図と復旧断面図・交通規制図・工程表。
 * 道路の形は工事データに無いので、入力した寸法（幅員・本管の位置・深さ）で描く模式図。
 * 文字は LabelPlacer・spread1D で置き、重なりを出さない。
 */
import { around, at, LabelPlacer, spread1D, textWidth } from '../export/labelLayout';
import { drawFrame, GRAY, INK, RED, type Sheet } from '../export/sheet';
import type { ApplicationValues } from '../forms/types';
import { num, numM } from './fields';
import { renderNoticeForms, renderOccupancyForm, renderTakeoffTable, renderUseForm } from './formSheets';
import { label, titleBlock, wrap, type RoadMeta } from './draw';
import { addDays, roadLayers, roadTakeoffs, schedule, workPeriod, type Takeoff } from './model';

const BLUE = '#1d4ed8', ORANGE = '#ea580c', ZONE = '#fef3c7';
const A4L = (): Sheet => { const s: Sheet = { width: 297, height: 210, ops: [] }; drawFrame(s); return s; };
const m1 = (a: number) => (a / 1000).toFixed(2);
const m2 = (a: number) => (a / 1e6).toFixed(2);
const SCALES = [10, 20, 25, 50, 100, 150, 200, 250, 300, 500, 1000];
const pickScale = (fits: (s: number) => boolean) => SCALES.find(fits) ?? 1000;

function head(s: Sheet, name: string, sub?: string): void {
  s.ops.push({ t: 'text', x: 20, y: 22, s: name, size: 6, bold: true });
  if (sub) label(s, 277, 22, sub, 3, 120, { anchor: 'end', color: GRAY });
}
const note = (s: Sheet, y: number, lines: string[], w = 150) => {
  let cy = y;
  for (const l of lines) for (const w2 of wrap(l, 2.6, w, 2)) { s.ops.push({ t: 'text', x: 20, y: cy, s: w2, size: 2.6, color: GRAY }); cy += 3.8; }
};

// ─── 占用平面図 ───
export function renderRoadPlan(v: ApplicationValues, t: Takeoff[], m: RoadMeta): Sheet {
  const s = A4L();
  const mainAts = t.map((x) => x.length);
  const roadW = (numM(v['road.roadWidth']) ?? 0) * 1000 || Math.max(4000, ...mainAts.map((a) => a + 1000));
  const both = t.length === 2;
  const gapIn = (numM(v['road.gap']) ?? 0) * 1000;
  const gap = both ? (gapIn >= 1000 ? gapIn : 2000) : 0;
  const yard = 2500, span = gap + 6000;
  const extent = Math.max(roadW, ...mainAts.map((a) => a + 500));
  const sc = pickScale((k) => span / k <= 200 && (extent + yard) / k <= 100);
  head(s, '占用平面図', `縮尺 1/${sc}（A4）`);
  const L = 25, R = 272, top = 32;
  const by = top + yard / sc, fy = by + roadW / sc, cx = (L + R) / 2;
  const P = new LabelPlacer(s, { x1: 14, y1: 26, x2: 283, y2: 146 });
  const line = (x1: number, y1: number, x2: number, y2: number, o: { w?: number; color?: string; dash?: boolean } = {}) => { s.ops.push({ t: 'line', x1, y1, x2, y2, ...o }); P.blockSeg(x1, y1, x2, y2); };
  line(L, by, R, by, { w: 0.5 });
  line(L, fy, R, fy, { w: 0.35 });
  P.place([at(L + 1, by - 1.5, { s: '官民境界', size: 2.8, bold: true })]);
  P.place([at(L + 1, by - 6, { s: '宅地', size: 3, color: GRAY }), at(L + 1, by - 10, { s: '宅地', size: 3, color: GRAY })]);
  P.place([at(L + 7, by + 5, { s: `道路${v['road.routeName'] ? `（${v['road.routeName']}）` : ''}`, size: 3, color: GRAY }), at(L + 7, fy - 2.5, { s: `道路${v['road.routeName'] ? `（${v['road.routeName']}）` : ''}`, size: 3, color: GRAY })]);
  // 幅員
  const dx = L + 4;
  line(dx, by, dx, fy, { w: 0.18 });
  line(dx - 1.2, by, dx + 1.2, by, { w: 0.18 }); line(dx - 1.2, fy, dx + 1.2, fy, { w: 0.18 });
  // 幅員の文字は寸法線に沿って縦に。本管の線をまたがないよう、いちばん広い隙間の真ん中に置く
  const ys = [by, ...t.map((x) => by + x.length / sc).filter((y) => y > by && y < fy), fy].sort((a, b) => a - b);
  let gy0 = ys[0], gy1 = ys[1];
  for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > gy1 - gy0) { gy0 = ys[i - 1]; gy1 = ys[i]; }
  P.place([at(dx - 1.2, (gy0 + gy1) / 2, { s: `幅員 ${m1(roadW)}`, size: 2.8 }, 'middle', 0, -90), at(dx + 1.5, (gy0 + gy1) / 2 + 1, { s: `幅員 ${m1(roadW)}`, size: 2.8 })]);
  t.forEach((x, i) => {
    const bx = both ? cx + (i === 0 ? -1 : 1) * gap / 2 / sc : cx;
    const my = by + x.length / sc;
    const isW = x.kind === 'water';
    // 本管（既設・青）
    line(L, my, R, my, { w: 0.5, color: BLUE, dash: !isW });
    P.place([at(R - 14, my - 1.5, { s: `${isW ? '水道本管' : '下水道本管'} ${x.main}`.trim(), size: 2.6, color: BLUE }, 'end'), at(R - 14, my + 4, { s: `${isW ? '水道本管' : '下水道本管'} ${x.main}`.trim(), size: 2.6, color: BLUE }, 'end')]);
    // 掘削の範囲
    const hw = Math.max(x.width / 2 / sc, 0.8);
    if (x.length > 0) s.ops.push({ t: 'rect', x: bx - hw, y: by, w: hw * 2, h: my - by, stroke: GRAY, lw: 0.2, fill: ZONE });
    // 引込管（新設・赤）と宅地側の器具
    const ey = by - (isW ? 900 : 600) / sc;
    line(bx, my, bx, ey, { w: 0.6, color: RED });
    if (isW) { s.ops.push({ t: 'circle', cx: bx, cy: ey - 1.6, r: 1.6, stroke: RED, lw: 0.35 }); P.block({ x1: bx - 2, y1: ey - 3.4, x2: bx + 2, y2: ey + 0.2 }); }
    else { s.ops.push({ t: 'rect', x: bx - 1.6, y: ey - 3.2, w: 3.2, h: 3.2, stroke: RED, lw: 0.35 }); P.block({ x1: bx - 2, y1: ey - 3.4, x2: bx + 2, y2: ey + 0.2 }); }
    const side = isW && both ? -1 : 1;
    P.place(around(bx, ey - 1.6, [{ s: isW ? '水道メーター' : '公共汚水ます', size: 2.6 }, { s: `${x.label} ${x.pipe}`.trim(), size: 2.6, color: RED }], { prefer: side < 0 ? [180, -135, 135] : [0, -45, 45], gap: 2.6 }));
    // 延長の寸法（給水は左、下水は右）
    const ddx = bx + side * (hw + 3.5);
    if (x.length > 0) {
      line(ddx, by, ddx, my, { w: 0.18 });
      line(ddx - 1, by, ddx + 1, by, { w: 0.18 }); line(ddx - 1, my, ddx + 1, my, { w: 0.18 });
      const ty = (by + my) / 2 + 1;
      P.place([at(ddx + side * 1.2, ty, { s: m1(x.length), size: 2.8, bold: true }, side < 0 ? 'end' : 'start'), ...around(ddx, ty, [{ s: m1(x.length), size: 2.8, bold: true }], { prefer: side < 0 ? [180] : [0] })]);
      P.place(around(bx, my - 1.5, [{ s: `掘削 ${m1(x.width)}×${m1(x.length)}`, size: 2.4, color: GRAY }], { prefer: side < 0 ? [135, 180] : [45, 0], gap: 3 }));
    }
  });
  if (both) {
    const xa = cx - gap / 2 / sc, xb = cx + gap / 2 / sc, gy = fy + 6;
    line(xa, gy, xb, gy, { w: 0.18 }); line(xa, gy - 1, xa, gy + 1, { w: 0.18 }); line(xb, gy - 1, xb, gy + 1, { w: 0.18 });
    P.place([at(cx, gy - 1.2, { s: gapIn >= 1000 ? m1(gap) : `${m1(gap)}（仮）`, size: 2.6 }, 'middle'), at(cx, gy + 4, { s: gapIn >= 1000 ? m1(gap) : `${m1(gap)}（仮）`, size: 2.6 }, 'middle')]);
  }
  if (!t.length) P.place([at(cx, (by + fy) / 2, { s: '（給水・下水の取出しが「しない」になっています）', size: 3, color: GRAY }, 'middle')]);
  // 数量の表
  const tx = 20, ty0 = 152, cols = [{ w: 30, h: '物件' }, { w: 30, h: '管種・口径' }, { w: 20, h: '延長 m' }, { w: 26, h: '掘削面積 ㎡' }, { w: 26, h: '復旧面積 ㎡' }];
  const rh = 6.5, W = cols.reduce((a, c) => a + c.w, 0), n = Math.max(1, t.length) + 1;
  s.ops.push({ t: 'rect', x: tx, y: ty0, w: W, h: rh * n, lw: 0.35 });
  for (let r = 1; r < n; r++) s.ops.push({ t: 'line', x1: tx, y1: ty0 + rh * r, x2: tx + W, y2: ty0 + rh * r, w: 0.2 });
  let xx = tx;
  cols.forEach((c, i) => {
    if (i) s.ops.push({ t: 'line', x1: xx, y1: ty0, x2: xx, y2: ty0 + rh * n, w: 0.2 });
    label(s, xx + c.w / 2, ty0 + 4.4, c.h, 2.6, c.w - 2, { anchor: 'middle' });
    t.forEach((x, r) => { const val = [x.label, x.pipe, m1(x.length), m2(x.digArea), m2(x.restoreArea)][i]; label(s, i < 2 ? xx + 1.5 : xx + c.w - 1.5, ty0 + rh * (r + 1) + 4.4, val, 2.8, c.w - 3, { anchor: i < 2 ? 'start' : 'end' }); });
    xx += c.w;
  });
  note(s, ty0 + rh * n + 5, ['赤: 新設（引込管・取付管）　青: 既設の本管（下水は破線）　黄: 掘削の範囲', '※ 入力した寸法による模式図です。長さの単位は m。'], 150);
  titleBlock(s, '占用平面図', m);
  return s;
}

// ─── 横断図・復旧断面図 ───
export function renderRoadSection(v: ApplicationValues, t: Takeoff[], m: RoadMeta): Sheet {
  const s = A4L();
  head(s, '横断図・復旧断面図');
  const roadW = (numM(v['road.roadWidth']) ?? 0) * 1000 || Math.max(4000, ...t.map((x) => x.length + 1000));
  const deep = Math.max(600, ...t.map((x) => x.depth + x.dia + 300));
  const extent = Math.max(roadW, ...t.map((x) => x.length + 500));
  const sc = pickScale((k) => (extent + 1500) / k <= 150 && deep / k <= 90);
  s.ops.push({ t: 'text', x: 20, y: 32, s: `横断図　縮尺 1/${sc}`, size: 3.4, bold: true });
  const P = new LabelPlacer(s, { x1: 14, y1: 26, x2: 172, y2: 150 });
  const yg = 50, x0 = 22 + 1000 / sc, xr = x0 + roadW / sc;
  const ln = (x1: number, y1: number, x2: number, y2: number, o: { w?: number; color?: string; dash?: boolean } = {}) => { s.ops.push({ t: 'line', x1, y1, x2, y2, ...o }); P.blockSeg(x1, y1, x2, y2); };
  ln(22, yg, xr + 4, yg, { w: 0.45 });
  ln(x0, yg - 8, x0, yg + deep / sc + 4, { w: 0.2, dash: true });
  P.place([at(x0 - 1, yg - 9, { s: '官民境界', size: 2.6 }, 'end'), at(x0 + 1, yg - 9, { s: '官民境界', size: 2.6 })]);
  P.place([at(24, yg - 2, { s: '宅地', size: 2.6, color: GRAY })]);
  ln(x0, yg - 4, xr, yg - 4, { w: 0.18 }); ln(xr, yg - 5, xr, yg - 3, { w: 0.18 }); ln(x0, yg - 5, x0, yg - 3, { w: 0.18 });
  P.place([at((x0 + xr) / 2, yg - 5, { s: `幅員 ${m1(roadW)}`, size: 2.8 }, 'middle')]);
  const pave = roadLayers(v, 'final').reduce((a, l) => a + l.t, 0);
  ln(x0, yg + pave / sc, xr, yg + pave / sc, { w: 0.15, color: GRAY, dash: true });
  t.forEach((x) => {
    const isW = x.kind === 'water';
    const pd = yg + x.depth / sc;
    const mx = x0 + x.length / sc, mr = Math.max(1, (num(v[`road.${x.kind}MainDia`]) ?? 100) / 2 / sc);
    s.ops.push({ t: 'circle', cx: mx, cy: pd, r: mr, stroke: BLUE, lw: 0.45 });
    P.block({ x1: mx - mr, y1: pd - mr, x2: mx + mr, y2: pd + mr });
    const rx = x0 - (isW ? 900 : 600) / sc;
    ln(rx, yg, rx, pd, { w: 0.55, color: RED });
    ln(rx, pd, mx - mr, pd, { w: 0.55, color: RED });
    P.place(around(mx, pd, [{ s: `${isW ? '水道本管' : '下水道本管'} ${x.main}`.trim(), size: 2.5, color: BLUE }], { prefer: [45, 0, 90, 135], gap: mr + 1.5 }));
    P.place(around((x0 + mx) / 2, pd, [{ s: `${x.label} ${x.pipe}`.trim(), size: 2.5, color: RED }, { s: `土かぶり ${x.depth ? m1(x.depth) : '（未入力）'}`, size: 2.5 }], { prefer: [90, 45, 135, -90], gap: 2 }));
  });
  if (!t.length) P.place([at(80, 80, { s: '（給水・下水の取出しが「しない」になっています）', size: 3, color: GRAY }, 'middle')]);
  note(s, 160, ['※ 入力した寸法による模式図です。長さの単位は m。破線（灰）は舗装の下端。'], 145);

  // 復旧断面図（仮・本）
  const depth = Math.max(600, ...t.map((x) => x.depth + x.dia));
  const sc2 = pickScale((k) => depth / k <= 52);
  const panel = (ph: 'temp' | 'final', py: number) => {
    const name = ph === 'temp' ? '仮復旧' : '本復旧';
    s.ops.push({ t: 'text', x: 180, y: py, s: `${name}断面図　縮尺 1/${sc2}`, size: 3.4, bold: true });
    const tx = 184, ty = py + 5, tw = Math.max(6, Math.min(40, (t[0]?.width || (numM(v['road.digWidth']) ?? 0.6) * 1000) / sc2));
    const layers = roadLayers(v, ph);
    const pipeD = Math.max(1, ...t.map((x) => x.dia)) / sc2;
    const bottom = ty + depth / sc2 + 4;
    s.ops.push({ t: 'poly', pts: [[tx, ty], [tx, bottom], [tx + tw, bottom], [tx + tw, ty]], color: INK, w: 0.35 });
    let cy = ty;
    const mids: number[] = [], names: string[] = [];
    for (const l of layers) {
      const h = l.t / sc2;
      s.ops.push({ t: 'rect', x: tx, y: cy, w: tw, h, lw: 0.15, fill: '#e5e7eb', stroke: GRAY });
      mids.push(cy + h / 2); names.push(`${l.name} ${l.t}`);
      cy += h;
    }
    mids.push((cy + bottom) / 2); names.push('埋戻し（道路管理者の指定の材料）');
    const pcy = ty + depth / sc2 - pipeD / 2;
    s.ops.push({ t: 'circle', cx: tx + tw / 2, cy: pcy, r: Math.max(0.8, pipeD / 2), stroke: RED, lw: 0.35 });
    const ys = spread1D(mids, 3.4, ty + 1, bottom + 6);
    ys.forEach((y, i) => {
      s.ops.push({ t: 'line', x1: tx + tw, y1: mids[i], x2: tx + tw + 4, y2: y - 0.9, w: 0.12, color: GRAY });
      label(s, tx + tw + 5, y, names[i], 2.5, 280 - (tx + tw + 5));
    });
    const wtxt = `掘削幅 ${m1(t[0]?.width ?? (numM(v['road.digWidth']) ?? 0) * 1000)}　深さ ${m1(depth)}（mm 表示は層の厚さ）`;
    label(s, tx, Math.max(bottom, ys.at(-1) ?? bottom) + 5, wtxt, 2.4, 96, { color: GRAY });
  };
  panel('temp', 32);
  panel('final', 104);
  titleBlock(s, '横断図・復旧断面図', m);
  return s;
}

// ─── 交通規制図 ───
export function renderTrafficPlan(v: ApplicationValues, m: RoadMeta): Sheet {
  const s = A4L();
  const kind = v['road.traffic'] || '片側交互通行';
  const entered = Math.max(0, Math.round(num(v['road.guards']) ?? 0));
  const n = Math.min(6, entered);
  head(s, '交通規制図（保安施設配置図）', '縮尺なし');
  label(s, 20, 31, `規制のしかた: ${kind}　交通誘導員: ${entered} 人${entered > n ? '（図は 6 人まで）' : ''}　作業時間: ${v['road.hours'] || '（未入力）'}`, 3.2, 255);
  const top = 62, bot = 122, mid = 92, L = 20, R = 277;
  s.ops.push({ t: 'line', x1: L, y1: top, x2: R, y2: top, w: 0.5 });
  s.ops.push({ t: 'line', x1: L, y1: bot, x2: R, y2: bot, w: 0.5 });
  if (kind !== '通行止め') s.ops.push({ t: 'line', x1: L, y1: mid, x2: R, y2: mid, w: 0.25, dash: true, color: GRAY });
  s.ops.push({ t: 'text', x: L + 2, y: top - 2, s: '宅地側（官民境界）', size: 2.6, color: GRAY });
  label(s, L + 2, bot + 4.5, `道路${v['road.routeName'] ? `（${v['road.routeName']}）` : ''}`, 2.6, 90, { color: GRAY });
  const cone = (x: number, y: number) => s.ops.push({ t: 'poly', pts: [[x, y - 1.6], [x - 1.2, y + 0.9], [x + 1.2, y + 0.9]], close: true, fill: ORANGE, color: ORANGE, w: 0.4 });
  const sign = (cx: number, y: number, text: string) => {
    const w = textWidth(text, 2.8) + 4;
    s.ops.push({ t: 'rect', x: cx - w / 2, y: y - 4, w, h: 5.6, lw: 0.35, fill: '#ffffff' });
    s.ops.push({ t: 'text', x: cx, y: y, s: text, size: 2.8, anchor: 'middle', bold: true });
  };
  const guard = (x: number, y: number) => {
    s.ops.push({ t: 'circle', cx: x, cy: y, r: 2, stroke: INK, fill: '#bfdbfe', lw: 0.3 });
    s.ops.push({ t: 'text', x, y: y + 5.6, s: '誘導員', size: 2.4, anchor: 'middle' });
  };
  const zone = (x: number, y: number, w: number, h: number) => {
    s.ops.push({ t: 'rect', x, y, w, h, fill: ZONE, stroke: ORANGE, lw: 0.35 });
    s.ops.push({ t: 'text', x: x + w / 2, y: y + h / 2 + 1, s: '作業帯', size: 3, anchor: 'middle', bold: true });
  };
  const guardsAt = (x1: number, x2: number, y: number) => { for (let i = 0; i < n; i++) guard(n === 1 ? (x1 + x2) / 2 : x1 + ((x2 - x1) * i) / (n - 1), y); };
  if (kind === '路肩規制') {
    zone(128, top + 2, 40, 10);
    for (let x = 104; x <= 192; x += 6) cone(x, top + (x < 128 ? 2 + ((x - 104) / 24) * 12 : x > 168 ? 14 - ((x - 168) / 24) * 12 : 14));
    sign(60, 52, '工事中'); sign(95, 52, '路肩規制'); sign(205, 52, '路肩規制'); sign(240, 52, '工事中');
    guardsAt(115, 182, 80);
  } else if (kind === '通行止め') {
    zone(128, top + 4, 40, bot - top - 8);
    for (const bx of [88, 208]) {
      s.ops.push({ t: 'rect', x: bx - 1.5, y: top + 1, w: 3, h: bot - top - 2, fill: '#ffffff', stroke: RED, lw: 0.5 });
      for (let y = top + 4; y < bot - 2; y += 6) s.ops.push({ t: 'line', x1: bx - 1.5, y1: y, x2: bx + 1.5, y2: y + 3, w: 0.4, color: RED });
    }
    sign(60, 52, '通行止'); sign(236, 52, '通行止'); sign(60, 134, '迂回路 →'); sign(236, 134, '← 迂回路');
    guardsAt(76, 220, 100);
  } else {
    zone(128, top + 2, 40, mid - top - 4);
    // 入口と出口はすり付け（斜め）、作業帯の横は車線の境に並べる
    const h = mid - top - 3;
    for (let x = 98; x <= 198; x += 5) cone(x, x < 128 ? top + 2 + ((x - 98) / 30) * h : x > 168 ? mid - 1 - ((x - 168) / 30) * h : mid - 1);
    sign(60, 52, '工事中'); sign(95, 52, '片側交互通行'); sign(205, 52, '片側交互通行'); sign(240, 52, '工事中');
    guardsAt(108, 188, 106);
  }
  // 車の流れ
  const arrow = (x1: number, x2: number, y: number) => {
    s.ops.push({ t: 'line', x1, y1: y, x2, y2: y, w: 0.35, color: GRAY });
    const d = x2 > x1 ? -1 : 1;
    s.ops.push({ t: 'poly', pts: [[x2, y], [x2 + d * 2.4, y - 1.2], [x2 + d * 2.4, y + 1.2]], close: true, fill: GRAY, color: GRAY, w: 0.35 });
  };
  if (kind !== '通行止め') { arrow(30, 52, kind === '路肩規制' ? 82 : 112); arrow(267, 245, 112); }
  // 凡例
  const ly = 152;
  s.ops.push({ t: 'text', x: 20, y: ly, s: '凡例', size: 3, bold: true });
  cone(24, ly + 6); s.ops.push({ t: 'text', x: 28, y: ly + 7, s: 'カラーコーン', size: 2.6 });
  s.ops.push({ t: 'rect', x: 60, y: ly + 3.5, w: 6, h: 4, lw: 0.35, fill: '#ffffff' }); s.ops.push({ t: 'text', x: 68, y: ly + 7, s: '標識・看板', size: 2.6 });
  s.ops.push({ t: 'circle', cx: 98, cy: ly + 5.5, r: 2, stroke: INK, fill: '#bfdbfe', lw: 0.3 }); s.ops.push({ t: 'text', x: 102, y: ly + 7, s: '交通誘導員', size: 2.6 });
  s.ops.push({ t: 'rect', x: 132, y: ly + 3.5, w: 6, h: 4, fill: ZONE, stroke: ORANGE, lw: 0.35 }); s.ops.push({ t: 'text', x: 140, y: ly + 7, s: '作業帯（工事の範囲）', size: 2.6 });
  note(s, ly + 15, ['※ 縮尺なしの配置の例です。標識の位置・数、誘導員の配置は警察署・道路管理者の指示に合わせてください。', '※ 夜間は保安灯を付けます（夜間作業がある場合）。'], 150);
  titleBlock(s, '交通規制図', m);
  return s;
}

// ─── 工程表 ───
export function renderSchedule(v: ApplicationValues, m: RoadMeta): Sheet {
  const s = A4L();
  head(s, '工程表');
  const rows = schedule(v);
  const p = workPeriod(v);
  label(s, 20, 31, `工事の期間: ${p.from ? `${p.from.replace(/-/g, '/')} 〜 ${p.to!.replace(/-/g, '/')}（${p.days}日間）` : '（着工日を入れると棒が入ります）'}`, 3.2, 255);
  const x0 = 20, top = 38, nameW = 52, dayW = 14, hh = 12, rh = 9;
  const lastDay = rows.length && p.from ? Math.round((Date.parse(rows[rows.length - 1].to) - Date.parse(p.from)) / 86400000) + 1 : 0;
  const ndays = Math.max(10, p.days ?? 10, lastDay);
  const gridW = 277 - x0 - nameW - dayW;
  const cw = gridW / ndays, every = Math.max(1, Math.ceil(4.2 / cw));
  const nrows = Math.max(6, rows.length);
  const H = hh + rh * nrows, W = nameW + dayW + gridW;
  s.ops.push({ t: 'rect', x: x0, y: top, w: W, h: H, lw: 0.4 });
  s.ops.push({ t: 'line', x1: x0, y1: top + hh, x2: x0 + W, y2: top + hh, w: 0.4 });
  s.ops.push({ t: 'line', x1: x0 + nameW, y1: top, x2: x0 + nameW, y2: top + H, w: 0.3 });
  s.ops.push({ t: 'line', x1: x0 + nameW + dayW, y1: top, x2: x0 + nameW + dayW, y2: top + H, w: 0.3 });
  s.ops.push({ t: 'line', x1: x0 + nameW + dayW, y1: top + hh / 2, x2: x0 + W, y2: top + hh / 2, w: 0.2 });
  s.ops.push({ t: 'text', x: x0 + nameW / 2, y: top + 7.5, s: '作業', size: 3, anchor: 'middle' });
  s.ops.push({ t: 'text', x: x0 + nameW + dayW / 2, y: top + 7.5, s: '日数', size: 3, anchor: 'middle' });
  const gx = x0 + nameW + dayW;
  let lastMonth = '', monthRight = -Infinity;
  for (let d = 0; d < ndays; d++) {
    const iso = p.from ? addDays(p.from, d) : '';
    const x = gx + d * cw;
    if (d) s.ops.push({ t: 'line', x1: x, y1: top + hh / 2, x2: x, y2: top + H, w: 0.1, color: GRAY });
    if (iso) {
      const mo = `${Number(iso.slice(5, 7))}月`;
      if (mo !== lastMonth && x + 0.8 > monthRight + 1 && x + 0.8 + textWidth(mo, 2.6) < x0 + W - 1) { s.ops.push({ t: 'text', x: x + 0.8, y: top + 4.4, s: mo, size: 2.6 }); lastMonth = mo; monthRight = x + 0.8 + textWidth(mo, 2.6); }
      if (d % every === 0) s.ops.push({ t: 'text', x: x + cw / 2, y: top + hh - 1.8, s: String(Number(iso.slice(8, 10))), size: 2.4, anchor: 'middle' });
    }
  }
  for (let r = 1; r < nrows; r++) s.ops.push({ t: 'line', x1: x0, y1: top + hh + rh * r, x2: x0 + W, y2: top + hh + rh * r, w: 0.2 });
  rows.forEach((row, r) => {
    const y = top + hh + rh * r;
    label(s, x0 + 2, y + 6, row.label, 3, nameW - 4);
    s.ops.push({ t: 'text', x: x0 + nameW + dayW / 2, y: y + 6, s: String(row.days), size: 3, anchor: 'middle' });
    const d0 = Math.round((Date.parse(row.from) - Date.parse(p.from!)) / 86400000);
    s.ops.push({ t: 'rect', x: gx + d0 * cw + 0.3, y: y + 3, w: row.days * cw - 0.6, h: 3, fill: RED, stroke: RED, lw: 0.1 });
  });
  note(s, top + H + 6, ['※ 本復旧は、道路管理者の指示（仮復旧の後しばらく置くなど）で日がずれることがあります。', `※ 作業時間: ${v['road.hours'] || '（未入力）'}`], 150);
  titleBlock(s, '工程表', m);
  return s;
}

/** 一式（位置図を除く 9 枚。私道は 6 枚）: 占用許可申請書・使用許可申請書・平面図・横断図・交通規制図・工程表・内訳調書・着手届・完了届 */
export function roadSheets(v: ApplicationValues, m: RoadMeta): Sheet[] {
  const t = roadTakeoffs(v);
  const drawings = [renderRoadPlan(v, t, m), renderRoadSection(v, t, m), renderTrafficPlan(v, m), renderSchedule(v, m), renderTakeoffTable(t, v, m)];
  // 私道は道路管理者への占用許可・届が無い（所有者の承諾。警察の道路使用許可は要ることがある）
  if (v['road.roadKind'] === '私道') return [renderUseForm(v, m), ...drawings];
  return [renderOccupancyForm(v, t, m), renderUseForm(v, m), ...drawings, ...renderNoticeForms(v, m)];
}

