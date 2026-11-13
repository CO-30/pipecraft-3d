/**
 * 「図面から自動で3Dにする」: 選んだ PDF（平面図・基礎伏図・立面図…）を読み、建物と下敷きを作る。
 * 読み取りは端末の中だけで行う（通信しない）。
 */
import type { Building } from '../model/building';
import { newId } from '../model/id';
import { MAX_UNDERLAYS_TOTAL, type Underlay } from '../model/underlay';
import { buildFromSheets, PlanReadError, type ImportReport, type PlacedCandidate, type SheetInput, type SiteResult } from '../model/planRead/assemble';
import { classifySheet, toWorldX, toWorldY } from '../model/planRead/sheet';
import { openPdf } from './pdf';
import { readVectorPages } from './pdfVector';

export type PlanSetImport = { building: Building; designGL?: number; underlays: Record<string, Underlay>; fixtures: PlacedCandidate[]; report: ImportReport; site?: SiteResult };
/** 一度に読む枚数の上限（ページ数の合計） */
export const MAX_PLAN_PAGES = 40;

const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

/** PDF の中身（名前とバイト列）→ 読み取りに渡す図面。精度の測定（src/bench）でも同じ読み方をするため分けてある。lib: pdf.js（Node で使うとき） */
export async function readPlanInputs(files: { name: string; data: ArrayBuffer }[], lib?: unknown) {
  const inputs: SheetInput[] = [];
  const source: { data: ArrayBuffer; page: number }[] = [];
  const failed: string[] = [], skipped: string[] = [], textOnly: string[] = [];
  for (const f of files) {
    try {
      const data = f.data;
      const room = MAX_PLAN_PAGES - inputs.length;
      if (room <= 0) { skipped.push(f.name); continue; }
      // 図面一式の PDF: 平面図・基礎伏図・立面図・断面図・配置図だけ線を読む（図面リスト・仕様書・日影図などは文字だけ）
      const pages = await readVectorPages(data, lib, room, (texts) => ['plan', 'foundation', 'elevation', 'section', 'site', 'unknown'].includes(classifySheet(texts, f.name).kind));
      const off = pages.map((p, i) => (p.skipped ? i + 1 : 0)).filter(Boolean);
      if (off.length) textOnly.push(`${f.name} の ${off.length} ページ（p${off.join('・')}）`);
      pages.forEach((page, i) => {
        if (page.skipped) return; // 線を読まなかったページ（図面リスト・仕様書・日影図など）は渡さない
        inputs.push({ name: pages.length > 1 ? `${baseName(f.name)} p${i + 1}` : baseName(f.name), page });
        source.push({ data, page: i + 1 });
      });
    } catch {
      failed.push(f.name);
    }
  }
  return { inputs, source, failed, skipped, textOnly };
}

export async function importPlanSet(files: File[]): Promise<PlanSetImport> {
  const read: { name: string; data: ArrayBuffer }[] = [];
  const unreadable: string[] = [];
  for (const f of files) {
    try { read.push({ name: f.name, data: await f.arrayBuffer() }); } catch { unreadable.push(f.name); }
  }
  const { inputs, source, failed: notPdf, skipped, textOnly } = await readPlanInputs(read);
  const failed = [...unreadable, ...notPdf];
  if (!inputs.length) throw new PlanReadError(failed.length ? `PDF を開けませんでした（${failed.join('、')}）。PDF のファイルを選んでください` : '図面の PDF を選んでください');
  const r = buildFromSheets(inputs);
  const report: ImportReport = { ...r.report, check: [...r.report.check, ...failed.map((n) => `${n} は PDF として開けなかったので使っていません`), ...(skipped.length ? [`一度に読めるのは ${MAX_PLAN_PAGES} ページまでです。${skipped.join('、')} は読んでいません`] : []),
    ...(textOnly.length ? [`図面リスト・仕様書・日影図・展開図など、壁を読まない図面は飛ばしました: ${textOnly.join('、')}`] : [])] };

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
