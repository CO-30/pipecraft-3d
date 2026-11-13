import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { MAX_TEXT_PAGES } from './pdfVector';
import { readPlanInputs } from './planSet';

describe('図面一式の PDF を読む（readPlanInputs）', () => {
  it(`${MAX_TEXT_PAGES} ページを超える分は読まず、読まなかったページを知らせる（黙って捨てない）`, async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < MAX_TEXT_PAGES + 2; i++) doc.addPage([200, 200]);
    const b = await doc.save();
    const r = await readPlanInputs([{ name: '一式.pdf', data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }], pdfjs);
    expect(r.unread).toEqual([`一式.pdf の p${MAX_TEXT_PAGES + 1}〜p${MAX_TEXT_PAGES + 2}（2 ページ）`]);
  }, 60_000);
});
