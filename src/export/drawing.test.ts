/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { addFloor, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork, type SystemType } from '../model/network';
import { placeFixture, portNodes } from '../model/fixtures';
import { computeEstimate, defaultEstimate } from '../model/estimate';
import { buildDrawing } from './drawing';
import { buildDrawingPdf, pickScale } from './drawingPdf';

const colors = Object.fromEntries((['water', 'hotWater', 'drain', 'sewage', 'vent', 'gas', 'refrigerant', 'condensate', 'electric', 'telecom', 'other'] as SystemType[]).map((s) => [s, '#2563eb'])) as Record<SystemType, string>;

function sample(): Doc {
  let b = addFloor(emptyBuilding(), { height: 3000 }).b;
  b = addFloor(b, { height: 3000 }).b;
  let d: Doc = { building: b, network: emptyNetwork(), fixtures: {}, estimate: defaultEstimate() };
  const r = placeFixture(d, b.floors[0].id, 'faucet', { x: 1000, y: 1000 });
  d = r.doc;
  const port = portNodes(d.network, r.fixtureId!)[0];
  const p = port.pos;
  // 水栓 → 横 9m（定尺の継ぎ足し2）→ 立ち上がり 2階へ
  const net = addPolyline(d.network, [p, { ...p, x: p.x + 9000 }, { ...p, x: p.x + 9000, z: 4000 }], { system: 'water', diameter: 20, material: 'HIVP' }, { startNodeId: port.id }).net;
  return { ...d, network: net };
}

describe('部材図', () => {
  it('記号の個数が数量表と一致（継手・継ぎ足し・支持金具）', () => {
    const doc = sample();
    const est = computeEstimate(doc);
    const dr = buildDrawing(doc, est);
    const all = dr.pages.flatMap((p) => p.marks);
    const fittingsCount = est.fittings.reduce((a, f) => a + f.count, 0);
    // 縦管の途中の支持金具は両方の階に出ることはない（z で1つの階）
    expect(all.filter((m) => m.kind === 'fitting').length).toBe(fittingsCount);
    const supportCount = est.supports.filter((l) => /^sup\|(saddle|levelBand|tBracket)\|/.test(l.key)).reduce((a, l) => a + l.count, 0);
    expect(all.filter((m) => m.kind === 'support').length).toBe(supportCount);
    expect(supportCount).toBeGreaterThan(0);
    // 1階: 水栓・水栓エルボ（WL）・継ぎ足しソケット2・縦管
    const f1 = dr.pages[0];
    expect(f1.kind).toBe('plan');
    expect(f1.fixtures.map((f) => f.label)).toEqual(['水栓（壁付）']);
    expect(f1.marks.filter((m) => m.code === 'WL')).toHaveLength(1);
    expect(f1.marks.filter((m) => m.code === 'S')).toHaveLength(2);
    expect(f1.risers).toHaveLength(1);
    // 部材一覧に器具・消耗品も
    expect(dr.parts.some((r) => r.group === '器具' && r.name === '水栓（壁付）')).toBe(true);
    expect(dr.parts.some((r) => r.name === 'シールテープ')).toBe(true);
    expect(dr.parts.every((r) => !('amount' in r))).toBe(true);
  });
  it('縮尺は収まる切りのよい値', () => {
    expect(pickScale(10000, 8000, 600, 500)).toBe(50);
    expect(pickScale(30000, 8000, 600, 500)).toBe(150);
  });
  it('PDF を作れる（平面2ページ＋部材一覧）', async () => {
    const doc = sample();
    const bytes = await buildDrawingPdf(buildDrawing(doc), { name: '那覇の現場', date: new Date(2026, 10, 6) }, colors, readFileSync('public/fonts/NotoSansJP-JIS.ttf'));
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
  });
});
