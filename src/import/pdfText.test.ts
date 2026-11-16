import { expect, test } from 'vitest';
import { itemsToLines } from './pdfText';

test('pdf.js の文字を行にまとめる（上から、左から。離れた文字の間は空白 2 つ）', () => {
  const items = [
    { str: '眞', x: 200, y: 700, w: 9, h: 9 },
    { str: '〔ﾛ.氏  名〕', x: 40, y: 700.8, w: 60, h: 9 },
    { str: '901-0000', x: 200, y: 680, w: 40, h: 9 },
    { str: '〔ﾊ.郵便番号〕', x: 40, y: 680, w: 60, h: 9 },
    { str: '太郎', x: 209, y: 700, w: 18, h: 9 },
    { str: '  ', x: 300, y: 650, w: 5, h: 9 },
  ];
  expect(itemsToLines(items)).toEqual(['〔ﾛ.氏  名〕  眞太郎', '〔ﾊ.郵便番号〕  901-0000']);
});
