/**
 * 「図面から自動で3Dにする」: 選んだ PDF（平面図・基礎伏図・立面図…）を読み、建物と下敷きを作る。
 * 読み取りは端末の中だけで行う（通信しない）。
 */
import type { Building } from '../model/building';
import { newId } from '../model/id';
import { MAX_UNDERLAYS_TOTAL, type Underlay } from '../model/underlay';
import { buildFromSheets, PlanReadError, type ImportReport, type PlacedCandidate, type SheetInput, type SiteResult } from '../model/planRead/assemble';
import { toWorldX, toWorldY } from '../model/planRead/sheet';
import { openPdf } from './pdf';
import { readVectorPages } from './pdfVector';

export type PlanSetImport = { building: Building; designGL?: number; underlays: Record<string, Underlay>; fixtures: PlacedCandidate[]; report: ImportReport; site?: SiteResult };
/** 一度に読む枚数の上限（ページ数の合計） */
export const MAX_PLAN_PAGES = 40;

const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

export async function importPlanSet(files: File[]): Promise<PlanSetImport> {
  const inputs: SheetInput[] = [];
  const source: { data: ArrayBuffer; page: number }[] = [];
  const failed: string[] = [], skipped: string[] = [];
  for (const f of files) {
    try {
      const data = await f.arrayBuffer();
      const room = MAX_PLAN_PAGES - inputs.length;
      if (room <= 0) { skipped.push(f.name); continue; }
      const pages = await readVectorPages(data, undefined, room);
      pages.forEach((page, i) => {
        inputs.push({ name: pages.length > 1 ? `${baseName(f.name)} p${i + 1}` : baseName(f.name), page });
        source.push({ data, page: i + 1 });
      });
    } catch {
      failed.push(f.name);
    }
  }
  if (!inputs.length) throw new PlanReadError(failed.length ? `PDF を開けませんでした（${failed.join('、')}）。PDF のファイルを選んでください` : '図面の PDF を選んでください');
  const r = buildFromSheets(inputs);
  const report: ImportReport = { ...r.report, check: [...r.report.check, ...failed.map((n) => `${n} は PDF として開けなかったので使っていません`), ...(skipped.length ? [`一度に読めるのは ${MAX_PLAN_PAGES} ページまでです。${skipped.join('、')} は読んでいません`] : [])] };

  // 読み取った平面図を下に敷く（読み違いを見比べて直せるように、器具の位置も見えるように）
  const underlays: Record<string, Underlay> = {};
  let total = 0;
  for (const p of r.plans) {
    try {
      const doc = await openPdf(source[p.index].data.slice(0));
      try {
        const raster = await doc.render(source[p.index].page);
        if (total + raster.src.length > MAX_UNDERLAYS_TOTAL) throw new Error('too big');
        total += raster.src.length;
        const { widthPt, heightPt } = inputs[p.index].page;
        const id = newId('u');
        underlays[id] = {
          id, floorId: p.floorId, kind: 'pdf', label: `${inputs[p.index].name}（1/${p.scale}）`,
          src: raster.src, widthPx: raster.widthPx, heightPx: raster.heightPx,
          center: { x: toWorldX(p.toWorld, widthPt / 2), y: toWorldY(p.toWorld, heightPt / 2) },
          mmPerPx: (p.toWorld.k * widthPt) / raster.widthPx, rotation: 0, opacity: p.site ? 0.3 : 0.5, scaled: true, paperMmPerPx: raster.paperMmPerPx,
        };
      } finally {
        doc.destroy();
      }
    } catch {
      report.check.push(`${inputs[p.index].name} を下に敷けませんでした（壁は読み取れています）`);
    }
  }
  return { building: r.building, designGL: r.designGL, underlays, fixtures: r.fixtures, report, ...(r.site ? { site: r.site } : {}) };
}
