/** PDF 図面のページを画像にする（pdf.js を必要な時だけ読み込む） */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { MAX_UNDERLAY_PX, detectDrawingScale, paperMmPerPx } from '../model/underlay';
import { toRaster, type Raster } from './image';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
/** worker を設定済みの pdf.js（線を読む pdfVector でも同じものを使う） */
export const pdfjsLib = pdfjs;

/** paperMmPerPx: 画像 1px が紙の何 mm か。scaleHint: 図面の文字から読めた縮尺（1/n の n） */
export type PdfRaster = Raster & { paperMmPerPx: number; scaleHint?: number };
export type PdfDoc = { pages: number; render(page: number, maxPx?: number): Promise<PdfRaster>; destroy(): void };

export async function openPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  return {
    pages: doc.numPages,
    async render(n, maxPx = MAX_UNDERLAY_PX) {
      const page = await doc.getPage(n);
      const v1 = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, maxPx / Math.max(v1.width, v1.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      // 保存の上限に合わせて縮むことがあるので、できあがった画像の大きさで紙の寸法を割る
      const r = toRaster(canvas);
      // v1 の大きさは UserUnit を掛けた後のポイント数（pdf.js の viewport が掛けている）
      const paper = paperMmPerPx(Math.max(v1.width, v1.height), Math.max(r.widthPx, r.heightPx));
      let scaleHint: number | undefined;
      try {
        const text = await page.getTextContent();
        scaleHint = detectDrawingScale(text.items.map((i) => ('str' in i ? i.str : '')));
      } catch { /* 文字を読めない PDF（スキャン等）は仮の縮尺で置く */ }
      return { ...r, paperMmPerPx: paper, scaleHint };
    },
    destroy: () => void task.destroy(),
  };
}
