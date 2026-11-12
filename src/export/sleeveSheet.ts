/**
 * スリーブ表（A4 横、階ごと）。左に階の位置図（壁・部材・配管、スリーブの位置に番号の丸）、右に表（No・部位・管・スリーブ・高さ）。
 * 行があふれたら同じ階の続きのページ（位置図は同じ、表の見出しを繰り返す）。番号の札は LabelPlacer で置く。
 */
import type { Doc } from '../model/doc';
import { SYSTEM_LABEL } from '../model/estimate';
import { membersOf } from '../model/members';
import type { SystemType } from '../model/network';
import { SLEEVE_RULE, type SleeveRow } from '../model/sleeves';
import { around, at, LabelPlacer } from './labelLayout';
import { dateJa } from './report';
import { fitText, GRAY, INK, RED, type Sheet } from './sheet';

export const SLEEVE_ROWS_PER_PAGE = 30;
const W = 297, H = 210, M = 10;
const PLAN = { x: M, y: 22, w: 173, h: 168 };
const COLS = [{ k: 'No', w: 8 }, { k: '部位', w: 20 }, { k: '管', w: 34 }, { k: 'スリーブ', w: 16 }, { k: '高さ', w: 19 }];
const TX = 188, TY = 22, HEAD_H = 6, ROW_H = 5.4;
const SYS_COLOR: Partial<Record<SystemType, string>> = { water: '#2563eb', hotWater: '#dc2626', drain: '#7c4a1e', sewage: '#7c4a1e', vent: '#16a34a' };

const flText = (z: number) => (z >= 0 ? `FL+${z}` : `FL${z}`);

export function renderSleeveSheets(doc: Doc, rows: SleeveRow[], meta: { siteName: string; date: Date }): { sheets: Sheet[]; collisions: number } {
  const b = doc.building, net = doc.network;
  const floors = [...b.floors].sort((x, y) => x.elevation - y.elevation);
  const sheets: Sheet[] = [];
  let collisions = 0;
  floors.forEach((f, fi) => {
    const fr = rows.filter((r) => r.floorId === f.id);
    if (!fr.length) return;
    // この階の高さの範囲（1 階は床下・地中を含む）
    const zLo = fi === 0 ? -Infinity : f.elevation - f.slabThickness, zHi = floors[fi + 1] ? floors[fi + 1].elevation : Infinity;
    const walls = Object.values(b.walls).filter((w) => w.floorId === f.id && b.corners[w.a] && b.corners[w.b]);
    const segs = Object.values(net.segments).filter((s) => {
      const p = net.nodes[s.a]?.pos, q = net.nodes[s.b]?.pos;
      return p && q && Math.max(p.z, q.z) >= zLo && Math.min(p.z, q.z) < zHi;
    });
    // 位置図の縮尺: 壁とスリーブの点が枠に収まるように（北が上、図面の y は上向き）
    const pts = [...walls.flatMap((w) => [b.corners[w.a], b.corners[w.b]]), ...fr.map((r) => r.point)];
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    const pad = 12;
    const k = Math.min((PLAN.w - pad * 2) / Math.max(1, maxX - minX), (PLAN.h - pad * 2) / Math.max(1, maxY - minY));
    const ox = PLAN.x + (PLAN.w - (maxX - minX) * k) / 2, oy = PLAN.y + (PLAN.h - (maxY - minY) * k) / 2;
    const X = (x: number) => ox + (x - minX) * k, Y = (y: number) => oy + (maxY - y) * k;
    const scale = Math.round(1 / k / 10) * 10;

    const pages = Math.ceil(fr.length / SLEEVE_ROWS_PER_PAGE);
    for (let pg = 0; pg < pages; pg++) {
      const sheet: Sheet = { width: W, height: H, ops: [] };
      const P = new LabelPlacer(sheet, { x1: M - 2, y1: 6, x2: W - M + 2, y2: H - 2 });
      P.place([at(M, 15, { s: `スリーブ表 ${f.name}${pg > 0 ? '（続き）' : ''}`, size: 5, bold: true })]);
      P.place([at(W - M, 15, { s: `${meta.siteName}　作成日: ${dateJa(meta.date)}`, size: 2.8, color: GRAY }, 'end')]);
      sheet.ops.push({ t: 'rect', x: PLAN.x, y: PLAN.y, w: PLAN.w, h: PLAN.h, stroke: GRAY, lw: 0.2 });
      // 位置図の札は位置図の枠の中だけに置く（表へはみ出さない）
      const PP = new LabelPlacer(sheet, { x1: PLAN.x + 0.5, y1: PLAN.y + 0.5, x2: PLAN.x + PLAN.w - 0.5, y2: PLAN.y + PLAN.h - 0.5 });
      // 壁・部材・配管
      for (const w of walls) {
        const c = b.corners[w.a], d = b.corners[w.b];
        sheet.ops.push({ t: 'line', x1: X(c.x), y1: Y(c.y), x2: X(d.x), y2: Y(d.y), w: w.kind === 'exterior' ? 0.5 : 0.3, color: INK });
        PP.blockSeg(X(c.x), Y(c.y), X(d.x), Y(d.y));
      }
      for (const m of membersOf(b).filter((x) => x.floorId === f.id && (x.kind === 'footing' || x.kind === 'beam'))) {
        sheet.ops.push({ t: 'line', x1: X(m.a.x), y1: Y(m.a.y), x2: X(m.b.x), y2: Y(m.b.y), w: 0.25, color: GRAY, dash: true });
      }
      for (const s of segs) {
        const p = net.nodes[s.a].pos, q = net.nodes[s.b].pos;
        if (Math.hypot(q.x - p.x, q.y - p.y) * k < 0.05) continue; // 立て管は点
        sheet.ops.push({ t: 'line', x1: X(p.x), y1: Y(p.y), x2: X(q.x), y2: Y(q.y), w: 0.25, color: SYS_COLOR[s.system] ?? GRAY });
        PP.blockSeg(X(p.x), Y(p.y), X(q.x), Y(q.y));
      }
      // 番号の丸（全部の行。どのページでも位置図は同じ）
      const R = 1.4;
      for (const r of fr) {
        sheet.ops.push({ t: 'circle', cx: X(r.point.x), cy: Y(r.point.y), r: R, stroke: RED, fill: '#ffffff', lw: 0.35 });
        PP.block({ x1: X(r.point.x) - R, y1: Y(r.point.y) - R, x2: X(r.point.x) + R, y2: Y(r.point.y) + R });
      }
      for (const r of fr) {
        PP.place(around(X(r.point.x), Y(r.point.y), [{ s: String(r.no), size: 2.3, color: RED, bold: true }], { gap: R + 0.4, leaderColor: RED, maxDist: 40 }));
      }
      PP.place([at(PLAN.x + 2, PLAN.y + PLAN.h - 2, { s: `縮尺 約1/${scale}　○数字: 表の No.`, size: 2.4, color: GRAY })]);

      // 表（位置図の札を置いたあとの文字を障害物として、新しく置く）
      const T = new LabelPlacer(sheet, { x1: M - 2, y1: 6, x2: W - M + 2, y2: H - 2 });
      let x = TX;
      sheet.ops.push({ t: 'rect', x: TX, y: TY, w: COLS.reduce((a, c) => a + c.w, 0), h: HEAD_H, fill: '#f1f5f9', stroke: INK, lw: 0.25 });
      for (const c of COLS) { T.place([at(x + c.w / 2, TY + 4.2, { s: c.k, size: 2.6, bold: true }, 'middle')]); x += c.w; }
      const part = fr.slice(pg * SLEEVE_ROWS_PER_PAGE, (pg + 1) * SLEEVE_ROWS_PER_PAGE);
      part.forEach((r, i) => {
        const y = TY + HEAD_H + i * ROW_H;
        const cells = [String(r.no), r.partLabel, `${SYSTEM_LABEL[r.system]} ${r.material}φ${r.diameter}`, `φ${r.sleeve}`, flText(r.flz)];
        let cx = TX;
        COLS.forEach((c, ci) => {
          sheet.ops.push({ t: 'rect', x: cx, y, w: c.w, h: ROW_H, stroke: INK, lw: 0.15 });
          T.place([at(ci === 0 ? cx + c.w / 2 : cx + 1, y + ROW_H - 1.6, { s: fitText(cells[ci], 2.4, c.w - 2), size: 2.4, color: ci === 0 ? RED : INK, bold: ci === 0 }, ci === 0 ? 'middle' : 'start')]);
          cx += c.w;
        });
      });
      T.place([at(M, H - 8, { s: SLEEVE_RULE, size: 2.4, color: GRAY })]);
      T.place([at(M, H - 4.5, { s: '位置は配管データの座標から。現場で寸法を確かめてから墨出ししてください', size: 2.4, color: GRAY })]);
      collisions += P.collisions + PP.collisions + T.collisions;
      sheets.push(sheet);
    }
  });
  return { sheets, collisions };
}
