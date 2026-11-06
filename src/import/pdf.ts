/** PDF 図面のページを画像にする（pdf.js を必要な時だけ読み込む） */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { MAX_UNDERLAY_PX } from '../model/underlay';
import type { Raster } from './image';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = { pages: number; render(page: number, maxPx?: number): Promise<Raster>; destroy(): void };

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
      return { src: canvas.toDataURL('image/jpeg', 0.85), widthPx: canvas.width, heightPx: canvas.height };
    },
    destroy: () => void task.destroy(),
  };
}
