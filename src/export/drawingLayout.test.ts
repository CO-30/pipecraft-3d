/// <reference types="node" />
/**
 * 部材図を 1 枚で見やすく（2026-11-16 ユーザー:「記号を工夫して一枚にまとめつつ、ごちゃごちゃせずに見やすく」）
 * - エルボは配管の曲がりそのものなので記号なし。配管の途中の部品は配管の上に小さな形（チーズ ●・ソケット ‖・径違い ▶・バルブ ⋈）
 * - 器具の口・縦管の上下など部品が集まる所は番号の札 1 つ。中身は右の「接続部の一覧」
 * - 番号の札は重ならない所に置き、離したものは短い引出線
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { addFloor, createBuildingFromDims, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork, type SystemType, type Vec3 } from '../model/network';
import { defaultEstimate } from '../model/estimate';
import { placeFixture, portNodes } from '../model/fixtures';
import { buildDrawing } from './drawing';
import { buildDrawingPdf, layoutMarks, sheetPlan, LEAD_MAX } from './drawingPdf';

const colors = Object.fromEntries((['water', 'hotWater', 'drain', 'sewage', 'vent', 'gas', 'refrigerant', 'condensate', 'electric', 'telecom', 'other'] as SystemType[]).map((s) => [s, '#2563eb'])) as Record<SystemType, string>;
const font = () => readFileSync('public/fonts/NotoSansJP-JIS.ttf');

/** 12m×10m の家の一角に、ジグザグの給水管（60mm おきに折り返す。曲がり 38 か所） */
function zigzag(): Doc {
  const b = { ...createBuildingFromDims({ width: 12000, depth: 10000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), foundation: { slabTop: -450 } };
  const path: Vec3[] = [];
  for (let i = 0; i < 20; i++) { const y = 1000 + i * 60; path.push(...(i % 2 ? [{ x: 1400, y, z: -300 }, { x: 1000, y, z: -300 }] : [{ x: 1000, y, z: -300 }, { x: 1400, y, z: -300 }])); }
  const net = addPolyline(emptyNetwork(), path, { system: 'water', diameter: 20, material: 'HIVP' }).net;
  return { building: b, network: net, fixtures: {}, estimate: defaultEstimate() };
}

/** 水栓をいくつも並べ、それぞれ床下から立ち上げる（口ごとに WL・L・A などが集まる） */
function faucets(nf: number): Doc {
  const b = { ...createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), foundation: { slabTop: -450 } };
  let d: Doc = { building: b, network: emptyNetwork(), fixtures: {}, estimate: defaultEstimate() };
  for (let i = 0; i < nf; i++) {
    const r = placeFixture(d, b.floors[0].id, 'faucet', { x: 1000 + i * 350, y: 3000 });
    d = r.doc;
    const port = portNodes(d.network, r.fixtureId!)[0];
    d = { ...d, network: addPolyline(d.network, [port.pos, { ...port.pos, z: -300 }, { x: port.pos.x, y: 1000, z: -300 }], { system: 'water', diameter: 13, material: 'HIVP' }, { startNodeId: port.id }).net };
  }
  return d;
}

const overlaps = (cs: { x: number; y: number; w: number; h: number }[]) => {
  let n = 0;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (Math.abs(cs[i].x - cs[j].x) < (cs[i].w + cs[j].w) / 2 && Math.abs(cs[i].y - cs[j].y) < (cs[i].h + cs[j].h) / 2) n++;
  return n;
};

describe('部材図を 1 枚で見やすく', () => {
  it('混み合った札も重ならない所へ。ばらばらなら動かさない', () => {
    const anchors = Array.from({ length: 24 }, (_, i) => ({ x: 200 + (i % 6) * 6, y: 200 + Math.floor(i / 6) * 6, w: 10, h: 10 }));
    const out = layoutMarks(anchors, [], { x1: 0, y1: 0, x2: 500, y2: 400 });
    expect(overlaps(out.map((o, i) => ({ ...o, w: anchors[i].w, h: anchors[i].h })))).toBe(0);
    const far = layoutMarks([{ x: 10, y: 10, w: 10, h: 10 }, { x: 100, y: 100, w: 10, h: 10 }], [], { x1: 0, y1: 0, x2: 500, y2: 400 });
    expect(far.map((o) => [o.x, o.y, o.moved])).toEqual([[10, 10, false], [100, 100, false]]);
  });

  it('エルボは記号なし（曲がり 38 か所の図でも札は 0）。個数は数える', () => {
    const page = buildDrawing(zigzag()).pages[0];
    const plan = sheetPlan(page);
    expect(plan.spots).toHaveLength(0);
    expect(plan.glyphs.filter((g) => g.kind === 'elbow')).toHaveLength(page.marks.filter((m) => m.code === 'L').length);
    expect(plan.glyphs.length).toBeGreaterThan(30);
  });

  it('器具の口に集まる部品は番号の札 1 つ（中身は一覧）。札は重ならず、引出線は短い。どの部品も 1 回ずつ', () => {
    const page = buildDrawing(faucets(8)).pages[0];
    const plan = sheetPlan(page);
    expect(plan.spots.length).toBe(8);
    for (const sp of plan.spots) { expect(sp.label).toBe('水栓（壁付）'); expect(sp.codes).toMatch(/WL/); }
    expect(plan.spots.map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(overlaps(plan.tags.map((t) => ({ ...t, w: 9.8, h: 9.8 })))).toBe(0);
    expect(Math.max(...plan.tags.map((t) => t.lead))).toBeLessThanOrEqual(LEAD_MAX);
    const fit = page.marks.filter((m) => m.kind !== 'support').length;
    expect(plan.glyphs.length + plan.spots.reduce((s, sp) => s + sp.marks.length, 0)).toBe(fit);
  });

  it('PDF はいつも 1 つの図に 1 枚（＋部材一覧）', async () => {
    for (const doc of [zigzag(), faucets(12)]) {
      const pdf = await PDFDocument.load(await buildDrawingPdf(buildDrawing(doc), { name: 'x', date: new Date(2026, 10, 16) }, colors, font()));
      expect(pdf.getPageCount()).toBe(2);
    }
    const b = addFloor(emptyBuilding(), { height: 3000 }).b;
    const net = addPolyline(emptyNetwork(), [{ x: 0, y: 0, z: -300 }, { x: 3000, y: 0, z: -300 }, { x: 3000, y: 2000, z: -300 }], { system: 'drain', diameter: 75, material: 'VP' }).net;
    expect(sheetPlan(buildDrawing({ building: b, network: net, fixtures: {}, estimate: defaultEstimate() }).pages[0]).spots).toHaveLength(0);
  });
});
