/**
 * 給水装置 水理計算書（A4 縦、1〜n 枚）。計算結果（SupplyCalc）をそのまま用紙にする。
 * 1 枚目: 条件・給水用具・系統図。続けて区間の表（ページをまたぐときは見出しを繰り返す）・末端ごとの所要水頭・判定・注記。
 * 文字は PDF の字形（JIS X 0208）にある文字だけを使う（ダッシュは ASCII の - ）。
 */
import { MAIN_POINT, type CalcRow, type SupplyCalc } from '../model/hydraulics/calc';
import { MPA_HEAD } from '../model/hydraulics/formulas';
import { dateJa } from './report';
import { DISCLAIMER, drawFrame, drawSymbol, GRAY, INK, RED, WARN, type Sheet } from './sheet';
import { around, at, LabelPlacer, later, textWidth, type Cand, type LabelLine } from './labelLayout';
import type { SheetMeta } from './profileSheet';

const PW = 210, PH = 297, L = 15, R = 195, BOTTOM = 284;
const f2 = (v: number) => v.toFixed(2);
const f1 = (v: number) => v.toFixed(1);

type Col = { title: string; w: number; align: 'start' | 'end' };
const SECTION_COLS: Col[] = [
  { title: '区間・器具', w: 40, align: 'start' }, { title: '流量 L/min', w: 15, align: 'end' }, { title: '口径', w: 10, align: 'end' },
  { title: '流速 m/s', w: 14, align: 'end' }, { title: '動水勾配‰', w: 17, align: 'end' }, { title: '延長 m', w: 14, align: 'end' },
  { title: '換算長 m', w: 14, align: 'end' }, { title: '損失水頭 m', w: 18, align: 'end' }, { title: '立上り m', w: 16, align: 'end' },
  { title: '所要水頭 m', w: 18, align: 'end' },
];
const OUTLET_COLS: Col[] = [
  { title: '記号', w: 14, align: 'start' }, { title: '給水用具', w: 62, align: 'start' }, { title: '口径', w: 18, align: 'end' },
  { title: '使用水量 L/min', w: 30, align: 'end' }, { title: '同時使用', w: 24, align: 'end' },
];

export function renderSuiriSheets(calc: SupplyCalc, meta: SheetMeta): Sheet[] {
  const sheets: Sheet[] = [];
  let sh!: Sheet;
  let y = 0;
  const text = (x: number, yy: number, s: string, size: number, o: { color?: string; anchor?: 'start' | 'middle' | 'end'; bold?: boolean; maxW?: number } = {}) => {
    let str = s, sz = size;
    if (o.maxW !== undefined) {
      const w = textWidth(str, sz);
      if (w > o.maxW) sz = Math.max(1.8, (sz * o.maxW) / w);
      while (str.length > 1 && textWidth(str, sz) > o.maxW) str = str.slice(0, -2) + '…';
    }
    sh.ops.push({ t: 'text', x, y: yy, s: str, size: sz, ...(o.color ? { color: o.color } : {}), ...(o.anchor ? { anchor: o.anchor } : {}), ...(o.bold ? { bold: true } : {}) });
    return textWidth(str, sz);
  };
  const newPage = (cont: boolean) => {
    sh = { width: PW, height: PH, ops: [] };
    drawFrame(sh);
    sheets.push(sh);
    text(L, 22, cont ? '給水装置 水理計算書（続き）' : '給水装置 水理計算書', 5.5, { bold: true });
    text(L, 28.5, `工事名: ${meta.siteName}    作成日: ${dateJa(meta.date)}${calc.rules.city ? `    ${calc.rules.city}` : ''}`, 3, { color: GRAY, maxW: 150 });
    sh.ops.push({ t: 'text', x: PW / 2, y: PH - 4, s: DISCLAIMER, size: 2.2, anchor: 'middle', color: GRAY });
    y = 35;
  };
  const need = (h: number, onBreak?: () => void) => { if (y + h > BOTTOM) { newPage(true); onBreak?.(); } };
  const heading = (s: string) => { need(12); text(L, y + 3.6, s, 3.4, { bold: true }); y += 6; };

  /** 表: 見出し → 行。ページをまたぐと見出しを繰り返す */
  const table = (cols: Col[], rows: { cells: string[]; color?: string }[], rowH = 5) => {
    const header = () => {
      let x = L;
      sh.ops.push({ t: 'line', x1: L, y1: y, x2: R, y2: y, w: 0.3 });
      for (const c of cols) { text(c.align === 'end' ? x + c.w - 1 : x + 1, y + rowH - 1.6, c.title, 2.3, { color: GRAY, anchor: c.align, maxW: c.w - 2 }); x += c.w; }
      y += rowH;
      sh.ops.push({ t: 'line', x1: L, y1: y, x2: R, y2: y, w: 0.2 });
    };
    need(rowH * 2);
    header();
    for (const r of rows) {
      need(rowH, header);
      let x = L;
      r.cells.forEach((s, i) => { const c = cols[i]; text(c.align === 'end' ? x + c.w - 1 : x + 1, y + rowH - 1.5, s, 2.6, { color: r.color, anchor: c.align, maxW: c.w - 2 }); x += c.w; });
      y += rowH;
      sh.ops.push({ t: 'line', x1: L, y1: y, x2: R, y2: y, w: 0.1, color: GRAY });
    }
    y += 3;
  };

  newPage(false);

  // 1) 条件
  heading('1. 計算の条件');
  const pressureUnverified = calc.unverified.some((u) => u.startsWith('設計水圧'));
  const usedCount = calc.outlets.filter((o) => o.used).length;
  const lines: { s: string; tail?: string }[] = [
    { s: '給水方式: 直結直圧式    計算方法: 給水装置工事技術指針の方式（ウエストン公式、同時使用率を考慮した給水用具数）' },
    { s: `設計水圧: ${calc.pressure}MPa（${f2(calc.available)}m）`, ...(pressureUnverified ? { tail: '（要確認）' } : {}) },
    { s: `余裕水頭: ${f2(calc.margin)}m    配水管の高さ: メーターの ${f2(calc.rows.find((r) => r.label.startsWith('引込管'))?.rise ?? 0)}m 下    管の延長: 実長 × ${calc.rules.lengthFactor.v}（ソケット等の損失を含む）` },
    { s: `給水用具数: ${calc.totalOutlets} 栓 → 同時に使う給水用具数: ${usedCount === calc.simultaneous ? `${usedCount} 栓` : `${usedCount} 栓（表の値 ${calc.simultaneous} 栓）`}    計画使用水量: ${f1(calc.plannedFlow)} L/min` },
    { s: '使用水量・同時使用の数・直管換算長: 給水装置工事技術指針と各市の計算例の一般的な値' },
  ];
  for (const l of lines) {
    const w = text(L + 2, y + 3.2, l.s, 2.8, { maxW: R - L - 4 - (l.tail ? 20 : 0) });
    if (l.tail) text(L + 2 + w + 1, y + 3.2, l.tail, 2.8, { color: WARN });
    y += 4.8;
  }
  y += 2;

  // 2) 給水用具
  heading('2. 給水用具');
  table(OUTLET_COLS, calc.outlets.map((o) => ({ cells: [o.letter, o.label, `${o.dia}`, f1(o.flow), o.used ? '使用' : '不使用'], ...(o.used ? {} : { color: GRAY }) })));

  // 3) 系統図
  drawDiagram(calc, () => sh, (h) => { need(h + 8); const top = y; y += h + 4; return top; }, heading);

  // 4) 区間の表
  heading('4. 損失水頭の計算');
  const rowCells = (r: CalcRow) => [r.label, f1(r.flow), `${r.diameter}`, f2(r.velocity), r.gradient.toFixed(0), r.kind === 'pipe' ? f2(r.length) : '', r.equiv ? f2(r.equiv) : '', f2(r.loss), r.rise ? f2(r.rise) : '', f2(r.head)];
  table(SECTION_COLS, calc.rows.map((r) => ({ cells: rowCells(r), ...(r.over ? { color: RED } : r.critical ? {} : { color: GRAY }) })));
  need(5);
  text(L + 2, y + 2.5, '灰色の行: 合計に入らない道筋（いちばん所要水頭の大きい末端だけを合計する）。赤: 流速が上限を超える区間', 2.3, { color: GRAY, maxW: R - L - 4 });
  y += 6;

  // 5) 判定
  heading('5. 所要水頭と判定');
  const crit = calc.outlets.find((o) => o.fixtureId === calc.criticalFixtureId)!;
  for (const o of calc.outlets.filter((x) => x.used)) {
    need(5);
    text(L + 2, y + 3.2, `${o.letter} ${o.label} までの所要水頭: ${f2(o.pathHead)}m${o === crit ? '（最大）' : ''}`, 2.8, { maxW: R - L - 4 });
    y += 4.8;
  }
  const service = calc.total - crit.pathHead;
  const okP = calc.required <= calc.available + 1e-9;
  const over = calc.rows.some((r) => r.over);
  const results = [
    `全所要水頭 = ${crit.letter} までの ${f2(crit.pathHead)}m ＋ 引込（${calc.letters[calc.tree.rootNodeId]}-${calc.letters[MAIN_POINT]}）${f2(service)}m ＝ ${f2(calc.total)}m`,
    `余裕水頭 ${f2(calc.margin)}m を加えて ${f2(calc.required)}m（${(calc.required / MPA_HEAD).toFixed(3)}MPa） ${okP ? '≦' : '＞'} 設計水圧 ${calc.pressure}MPa（${f2(calc.available)}m）`,
  ];
  for (const s of results) { need(5); text(L + 2, y + 3.2, s, 2.8, { maxW: R - L - 4 }); y += 4.8; }
  need(9);
  const verdict = calc.outOfScope ? `判定: 対象外（参考）（${calc.outOfScope}。直結直圧として計算した参考の値）`
    : calc.ok ? '判定: 適当（この口径で給水できる）' : `判定: 不適当（${[!okP ? '水圧が足りない' : '', over ? '流速が上限を超える' : ''].filter(Boolean).join('・')}）`;
  text(L + 2, y + 5, verdict, 4, { bold: true, color: calc.outOfScope ? WARN : calc.ok ? INK : RED, maxW: R - L - 4 });
  y += 9;

  // 6) 注記
  const notes: { s: string; color: string }[] = [
    ...calc.unverified.map((u) => ({ s: `要確認: ${u}`, color: WARN })),
    ...calc.warnings.map((w) => ({ s: `※ ${w}`, color: GRAY })),
    ...calc.rules.notes.map((n) => ({ s: `${calc.rules.city ?? ''}の規程: ${n.text}`, color: GRAY })),
  ];
  for (const n of notes) { need(4.5); text(L + 2, y + 3, n.s, 2.4, { color: n.color, maxW: R - L - 4 }); y += 4.2; }

  sheets.forEach((s, i) => s.ops.push({ t: 'text', x: R, y: 22, s: `${i + 1} / ${sheets.length}`, size: 2.8, anchor: 'end', color: GRAY }));
  return sheets;
}

/** 3) 系統図: 深さ優先。1 本目の子は同じ段の右、2 本目からは下の段。点の記号と「口径-延長」を LabelPlacer で置く */
function drawDiagram(calc: SupplyCalc, cur: () => Sheet, reserve: (h: number) => number, heading: (s: string) => void) {
  const t = calc.tree;
  const pos = new Map<string, { col: number; row: number }>();
  let maxRow = 0, maxCol = 0;
  const kids = (id: string) => t.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.from === id);
  const lay = (id: string, col: number, row: number) => {
    pos.set(id, { col, row });
    maxCol = Math.max(maxCol, col); maxRow = Math.max(maxRow, row);
    kids(id).forEach(({ e }, k) => lay(e.to, col + 1, k === 0 ? row : maxRow + 1));
  };
  pos.set(MAIN_POINT, { col: 0, row: 0 });
  lay(t.rootNodeId, 1, 0);
  const rows = maxRow + 1;
  const h = Math.min(150, Math.max(32, rows * 7 + 10));
  heading('3. 系統図（記号、口径-延長 m）');
  const top = reserve(h);
  const sh = cur();
  const x0 = L + 8, dx = Math.min(26, (R - L - 40) / Math.max(1, maxCol));
  const dy = Math.min(7, (h - 14) / Math.max(1, rows - 1));
  const X = (c: number) => x0 + c * dx, Y = (r: number) => top + 7 + r * dy;
  sh.ops.push({ t: 'rect', x: L, y: top, w: R - L, h, stroke: GRAY, lw: 0.2 });
  const segs: [number, number, number, number][] = [];
  const line = (x1: number, y1: number, x2: number, y2: number) => { sh.ops.push({ t: 'line', x1, y1, x2, y2, w: 0.35 }); segs.push([x1, y1, x2, y2]); };
  const edgeLabels: { x: number; y: number; s: string }[] = [];
  const P = (id: string) => { const p = pos.get(id)!; return { x: X(p.col), y: Y(p.row) }; };
  // 引込
  const m = P(MAIN_POINT), r0 = P(t.rootNodeId);
  line(m.x, m.y, r0.x, r0.y);
  const svcLen = calc.rows.find((r) => r.label.startsWith('引込管'));
  edgeLabels.push({ x: (m.x + r0.x) / 2, y: m.y, s: `${t.service.diameter}-${f1((svcLen?.length ?? 0) / calc.rules.lengthFactor.v)}` });
  for (const e of t.edges) {
    const a = P(e.from), b = P(e.to);
    if (Math.abs(a.y - b.y) > 1e-6) line(a.x, a.y, a.x, b.y);
    line(a.x, b.y, b.x, b.y);
    edgeLabels.push({ x: (a.x + b.x) / 2, y: b.y, s: `${e.diameter}-${f1(e.length / 1000)}` });
  }
  const placer = new LabelPlacer(sh, { x1: L + 1, y1: top + 1, x2: R - 1, y2: top + h - 1 });
  for (const [x1, y1, x2, y2] of segs) placer.blockSeg(x1, y1, x2, y2);
  const outletOf = new Map(calc.outlets.map((o) => [calc.tree.outlets.find((x) => x.fixtureId === o.fixtureId)!.nodeId, o]));
  const pointLabels: { x: number; y: number; s: string; color?: string }[] = [];
  for (const [id] of pos) {
    const p = P(id);
    const o = outletOf.get(id);
    if (id === t.rootNodeId) { drawSymbol(sh, 'meter', p.x, p.y, 1.6); placer.block({ x1: p.x - 1.8, y1: p.y - 1.8, x2: p.x + 1.8, y2: p.y + 1.8 }); }
    else { sh.ops.push({ t: 'circle', cx: p.x, cy: p.y, r: 0.8, stroke: INK, fill: o || id !== MAIN_POINT ? INK : '#ffffff', lw: 0.3 }); placer.block({ x1: p.x - 1, y1: p.y - 1, x2: p.x + 1, y2: p.y + 1 }); }
    const label = o ? `${o.letter} ${o.label}` : id === t.rootNodeId ? `${calc.letters[id]} メーター` : id === MAIN_POINT ? `${calc.letters[id]} 配水管` : calc.letters[id];
    pointLabels.push({ x: p.x, y: p.y, s: label, ...(o && !o.used ? { color: GRAY } : {}) });
  }
  const pointCands = (q: { x: number; y: number; s: string; color?: string }): Cand[] => {
    const l: LabelLine = { s: q.s, size: 2.3, color: q.color };
    return [at(q.x + 1.4, q.y - 1.3, l, 'start', 0), at(q.x - 1.4, q.y - 1.3, l, 'end', 1), at(q.x + 1.4, q.y + 3.3, l, 'start', 2), at(q.x - 1.4, q.y + 3.3, l, 'end', 3), ...around(q.x, q.y, [l], { gap: 1.5, leaderColor: GRAY, maxDist: 30 }).map(later(10))];
  };
  const edgeCands = (q: { x: number; y: number; s: string }): Cand[] => {
    const l: LabelLine = { s: q.s, size: 2.1, color: GRAY };
    return [at(q.x, q.y - 0.9, l, 'middle', 0), at(q.x, q.y + 2.9, l, 'middle', 1), ...around(q.x, q.y, [l], { gap: 1.2, leaderColor: GRAY, maxDist: 30 }).map(later(10))];
  };
  for (const q of pointLabels) placer.place(pointCands(q));
  for (const q of edgeLabels) placer.place(edgeCands(q));
}
