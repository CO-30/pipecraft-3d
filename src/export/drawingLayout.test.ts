/// <reference types="node" />
/**
 * 部材図を読みやすく（2026-11-16 実物: 床下の継手の記号が 1/100 の 1 枚に重なって読めなかった）
 * - 記号（○の中の L・T・A など）は重ならない所に置き、離したときは短い引出線
 * - 記号が混み合う所は、大きい縮尺の「拡大図」のページを足す（全体図には拡大する範囲の枠）
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { addFloor, createBuildingFromDims, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork, type SystemType, type Vec3 } from '../model/network';
import { defaultEstimate } from '../model/estimate';
import { buildDrawing } from './drawing';
import { buildDrawingPdf, layoutMarks, sheetViews, LEAD_MAX } from './drawingPdf';

const colors = Object.fromEntries((['water', 'hotWater', 'drain', 'sewage', 'vent', 'gas', 'refrigerant', 'condensate', 'electric', 'telecom', 'other'] as SystemType[]).map((s) => [s, '#2563eb'])) as Record<SystemType, string>;
const font = () => readFileSync('public/fonts/NotoSansJP-JIS.ttf');

/** 12m×10m の家の一角（1.2m 四方）に、ジグザグの給水管（曲がり 40 か所）が集まる */
function dense(): Doc {
  const b = { ...createBuildingFromDims({ width: 12000, depth: 10000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), foundation: { slabTop: -450 } };
  // ジグザグ（60mm おきに折り返す）
  const path: Vec3[] = [];
  for (let i = 0; i < 20; i++) { const y = 1000 + i * 60; path.push(...(i % 2 ? [{ x: 1400, y, z: -300 }, { x: 1000, y, z: -300 }] : [{ x: 1000, y, z: -300 }, { x: 1400, y, z: -300 }])); }
  const net = addPolyline(emptyNetwork(), path, { system: 'water', diameter: 20, material: 'HIVP' }).net;
  return { building: b, network: net, fixtures: {}, estimate: defaultEstimate() };
}

/** 札（矩形）どうしの重なりの数 */
const overlaps = (cs: { x: number; y: number; w: number; h: number }[]) => {
  let n = 0;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (Math.abs(cs[i].x - cs[j].x) < (cs[i].w + cs[j].w) / 2 && Math.abs(cs[i].y - cs[j].y) < (cs[i].h + cs[j].h) / 2) n++;
  return n;
};

describe('部材図の記号を重ねない', () => {
  it('混み合った記号も重ならない所へ。離したものだけ引出線（長さは上限まで）', () => {
    const anchors = Array.from({ length: 24 }, (_, i) => ({ x: 200 + (i % 6) * 6, y: 200 + Math.floor(i / 6) * 6, w: 10, h: 10 }));
    const out = layoutMarks(anchors, [], { x1: 0, y1: 0, x2: 500, y2: 400 });
    expect(overlaps(out.map((o, i) => ({ ...o, w: anchors[i].w, h: anchors[i].h })))).toBe(0);
    expect(out.every((o, i) => Math.hypot(o.x - anchors[i].x, o.y - anchors[i].y) <= LEAD_MAX * 3)).toBe(true);
    // ばらばらなら動かさない
    const far = layoutMarks([{ x: 10, y: 10, w: 10, h: 10 }, { x: 100, y: 100, w: 10, h: 10 }], [], { x1: 0, y1: 0, x2: 500, y2: 400 });
    expect(far.map((o) => [o.x, o.y, o.moved])).toEqual([[10, 10, false], [100, 100, false]]);
  });

  it('記号が混み合う図は、全体図＋大きい縮尺の拡大図。どの図でも記号は重ならず、引出線は短い', () => {
    const dr = buildDrawing(dense());
    const views = sheetViews(dr.pages[0]);
    expect(views.length).toBeGreaterThan(1);
    const [overview, ...details] = views;
    expect(overview.details.length).toBe(details.length);
    for (const v of details) {
      expect(v.scale).toBeLessThan(overview.scale);
      expect(v.title).toMatch(/拡大/);
      expect(overlaps(v.placed)).toBe(0);
      expect(Math.max(...v.placed.map((c) => c.lead))).toBeLessThanOrEqual(LEAD_MAX);
    }
    // 継手の記号は、全体図か、どれか 1 枚の拡大図に 1 回ずつ
    const fit = dr.pages[0].marks.filter((m) => m.kind !== 'support').length;
    const count = (vs: typeof views) => vs.reduce((s, v) => s + v.placed.reduce((n, q) => n + q.items.length, 0), 0);
    expect(count(views)).toBe(fit);
    expect(overview.dotMarks?.length).toBe(count(details));
  });

  it('PDF: 拡大図のページが増える。記号の少ない図は今までどおり 1 枚', async () => {
    const dense1 = await PDFDocument.load(await buildDrawingPdf(buildDrawing(dense()), { name: 'x', date: new Date(2026, 10, 16) }, colors, font()));
    expect(dense1.getPageCount()).toBeGreaterThan(2);
    const b = addFloor(emptyBuilding(), { height: 3000 }).b;
    const net = addPolyline(emptyNetwork(), [{ x: 0, y: 0, z: -300 }, { x: 3000, y: 0, z: -300 }, { x: 3000, y: 2000, z: -300 }], { system: 'drain', diameter: 75, material: 'VP' }).net;
    const sparse = buildDrawing({ building: b, network: net, fixtures: {}, estimate: defaultEstimate() });
    expect(sheetViews(sparse.pages[0])).toHaveLength(1);
  });
});
