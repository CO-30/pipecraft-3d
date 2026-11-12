/**
 * ます表（A4 横）。左に位置図（1 階の壁・排水の管・ますに番号）、右に表
 * （No・種類・大きさ・地盤高・管底高・深さ・下流の管・勾配・次のますまで・備考）。
 * 高さは縦断図と同じ基準。行があふれたら続きのページ（位置図は同じ、見出しを繰り返す）。文字は LabelPlacer で置く。
 */
import type { Doc } from '../model/doc';
import type { ManholeTable } from '../model/manholeTable';
import { around, at, LabelPlacer } from './labelLayout';
import { clipToRect } from './sleeveSheet';
import { dateJa } from './report';
import { fitText, GRAY, INK, RED, type Sheet } from './sheet';

export const MASU_ROWS_PER_PAGE = 24;
const W = 297, H = 210, M = 10;
const PLAN = { x: M, y: 22, w: 105, h: 168 };
const COLS = [
  { k: 'No', w: 12 }, { k: '種類', w: 20 }, { k: '大きさ', w: 12 }, { k: '地盤高', w: 14 }, { k: '管底高', w: 14 }, { k: '深さ', w: 11 },
  { k: '下流の管', w: 20 }, { k: '勾配', w: 15 }, { k: '延長(m)', w: 13 }, { k: '次のます', w: 13 }, { k: '備考', w: 23 },
];
const TX = PLAN.x + PLAN.w + 5, TY = 22, HEAD_H = 6, ROW_H = 6.2;
const DRAIN = '#7c4a1e', BLUE = '#2563eb';

const signed = (mm: number) => (mm > 0 ? `+${mm}` : mm < 0 ? `−${-mm}` : '±0');

/** title: 表題（竣工図なら「ます表（竣工）」）。numbersOnProfile: 縦断図にも NO. を書く様式（注記の言い方） */
export function renderManholeSheets(doc: Doc, table: ManholeTable, pos: Record<string, { x: number; y: number }>, meta: { siteName: string; date: Date; title?: string; numbersOnProfile?: boolean }): Sheet[] {
  const b = doc.building, net = doc.network;
  // 1 階（地下があっても床の高さが 0 にいちばん近い階）
  const f1 = [...b.floors].sort((x, y) => Math.abs(x.elevation) - Math.abs(y.elevation))[0];
  const walls = Object.values(b.walls).filter((w) => w.floorId === f1?.id && b.corners[w.a] && b.corners[w.b]);
  const rows = table.rows.filter((r) => pos[r.nodeId]);
  const pts = [...walls.flatMap((w) => [b.corners[w.a], b.corners[w.b]]), ...rows.map((r) => pos[r.nodeId])];
  if (!pts.length) return [];
  let minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  let minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const grow = (lo: number, hi: number): [number, number] => { const e = Math.max(0, 3000 - (hi - lo)) / 2; return [lo - e, hi + e]; };
  [minX, maxX] = grow(minX, maxX); [minY, maxY] = grow(minY, maxY);
  const pad = 10;
  const k = Math.min(0.1, (PLAN.w - pad * 2) / (maxX - minX), (PLAN.h - pad * 2) / (maxY - minY));
  const ox = PLAN.x + (PLAN.w - (maxX - minX) * k) / 2, oy = PLAN.y + (PLAN.h - (maxY - minY) * k) / 2;
  const X = (x: number) => ox + (x - minX) * k, Y = (y: number) => oy + (maxY - y) * k;
  const scale = Math.round(1 / k / 10) * 10;
  // 表の系統の管だけ（別の系統・遠くの管は描かない）
  const show = new Set(table.segIds);
  const drains = Object.values(net.segments).filter((s) => show.has(s.id) && net.nodes[s.a] && net.nodes[s.b]);

  const pages = Math.max(1, Math.ceil(table.rows.length / MASU_ROWS_PER_PAGE));
  const sheets: Sheet[] = [];
  for (let pg = 0; pg < pages; pg++) {
    const sheet: Sheet = { width: W, height: H, ops: [] };
    const P = new LabelPlacer(sheet, { x1: M - 2, y1: 6, x2: W - M + 2, y2: H - 2 });
    const title = meta.title ?? 'ます表';
    P.place([at(M, 15, { s: pg > 0 ? `${title}（続き）` : title, size: 5, bold: true })]);
    P.place([at(W - M, 15, { s: `${meta.siteName}　作成日: ${dateJa(meta.date)}`, size: 2.8, color: GRAY }, 'end')]);

    // 位置図
    sheet.ops.push({ t: 'rect', x: PLAN.x, y: PLAN.y, w: PLAN.w, h: PLAN.h, stroke: GRAY, lw: 0.2 });
    const PP = new LabelPlacer(sheet, { x1: PLAN.x + 0.5, y1: PLAN.y + 0.5, x2: PLAN.x + PLAN.w - 0.5, y2: PLAN.y + PLAN.h - 0.5 });
    for (const w of walls) {
      const c = b.corners[w.a], d = b.corners[w.b];
      sheet.ops.push({ t: 'line', x1: X(c.x), y1: Y(c.y), x2: X(d.x), y2: Y(d.y), w: w.kind === 'exterior' ? 0.5 : 0.3, color: INK });
      PP.blockSeg(X(c.x), Y(c.y), X(d.x), Y(d.y));
    }
    for (const s of drains) {
      const p = net.nodes[s.a].pos, q = net.nodes[s.b].pos;
      if (Math.hypot(q.x - p.x, q.y - p.y) * k < 0.05) continue;
      // 位置図の枠で切る（表・用紙の外へはみ出さない）
      const c = clipToRect(X(p.x), Y(p.y), X(q.x), Y(q.y), PLAN);
      if (!c) continue;
      sheet.ops.push({ t: 'line', x1: c[0], y1: c[1], x2: c[2], y2: c[3], w: 0.3, color: DRAIN });
      PP.blockSeg(c[0], c[1], c[2], c[3]);
    }
    const R = 1.6;
    for (const r of rows) {
      const p = pos[r.nodeId];
      sheet.ops.push({ t: 'circle', cx: X(p.x), cy: Y(p.y), r: R, stroke: r.existing ? BLUE : RED, fill: '#ffffff', lw: 0.35 });
      PP.block({ x1: X(p.x) - R, y1: Y(p.y) - R, x2: X(p.x) + R, y2: Y(p.y) + R });
    }
    for (const r of rows) {
      const p = pos[r.nodeId];
      PP.place(around(X(p.x), Y(p.y), [{ s: r.no, size: 2.3, color: r.existing ? BLUE : RED, bold: true }], { gap: R + 0.4, leaderColor: r.existing ? BLUE : RED, maxDist: 40 }));
    }
    PP.place([at(PLAN.x + 2, PLAN.y + PLAN.h - 2, { s: `縮尺 約1/${scale}　赤: 新設　青: 既存`, size: 2.4, color: GRAY })]);

    // 表
    const T = new LabelPlacer(sheet, { x1: M - 2, y1: 6, x2: W - M + 2, y2: H - 2 });
    const tw = COLS.reduce((a, c) => a + c.w, 0);
    sheet.ops.push({ t: 'rect', x: TX, y: TY, w: tw, h: HEAD_H, fill: '#f1f5f9', stroke: INK, lw: 0.25 });
    let x = TX;
    for (const c of COLS) { T.place([at(x + c.w / 2, TY + 4.2, { s: c.k, size: 2.6, bold: true }, 'middle')]); x += c.w; }
    const part = table.rows.slice(pg * MASU_ROWS_PER_PAGE, (pg + 1) * MASU_ROWS_PER_PAGE);
    part.forEach((r, i) => {
      const y = TY + HEAD_H + i * ROW_H;
      const note = [r.existing ? '既存' : '', r.drop ? `落差 ${r.drop}` : ''].filter(Boolean).join('・');
      const cells = [r.no, r.kind, r.size, signed(r.gl), signed(r.invert), String(r.depth), r.pipe ?? '—', r.slope ?? '—', r.toNext !== undefined ? (r.toNext / 1000).toFixed(2) : '—', r.next ?? '—', note];
      let cx = TX;
      COLS.forEach((c, ci) => {
        sheet.ops.push({ t: 'rect', x: cx, y, w: c.w, h: ROW_H, stroke: INK, lw: 0.15 });
        const num = (ci >= 3 && ci <= 5) || ci === 8;
        const anchor = ci === 0 ? 'middle' : num ? 'end' : 'start';
        const tx = ci === 0 ? cx + c.w / 2 : num ? cx + c.w - 1 : cx + 1;
        T.place([at(tx, y + ROW_H - 1.9, { s: fitText(cells[ci], 2.4, c.w - 2), size: 2.4, color: ci === 0 ? (r.existing ? BLUE : RED) : INK, bold: ci === 0 }, anchor)]);
        cx += c.w;
      });
    });
    T.place([at(M, H - 8, { s: `高さは mm。${table.datumLabel ?? '高さの基準: 1階の床（FL）±0'}。深さは地盤から流出側の管底まで。${meta.numbersOnProfile ? '番号は排水縦断図の NO. と同じ' : '番号はこの表と位置図の番号'}`, size: 2.4, color: GRAY })]);
    T.place([at(M, H - 4.5, { s: 'ますの位置・深さは配管データからの計算です。現場で確かめてください', size: 2.4, color: GRAY })]);
    sheets.push(sheet);
  }
  return sheets;
}
