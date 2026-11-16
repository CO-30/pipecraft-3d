/** PDF の文字を行にする（確認申請書などの書類を読むため）。スキャン（画像だけ）の PDF は [] */

export type TextItem = { str: string; x: number; y: number; w: number; h: number };

/** 同じ高さの文字を 1 行に（上から、左から）。離れた文字の間には空白 2 つ（項目と値の区切り） */
export function itemsToLines(items: TextItem[]): string[] {
  const its = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; items: TextItem[] }[] = [];
  for (const it of its) {
    const l = lines.find((L) => Math.abs(L.y - it.y) < Math.max(2, it.h * 0.4));
    if (l) l.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  return lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x);
    let s = '', end = -Infinity;
    for (const it of l.items) { s += (s && it.x - end > it.h * 0.5 ? '  ' : '') + it.str; end = it.x + it.w; }
    return s;
  });
}

/** PDF の全ページの文字を行にする（ページ順） */
export async function pdfTextLines(data: ArrayBuffer): Promise<string[]> {
  const { pdfjsLib } = await import('./pdf');
  const task = pdfjsLib.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  try {
    const out: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      out.push(...itemsToLines(tc.items.flatMap((i) => ('str' in i ? [{ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 8 }] : []))));
      page.cleanup();
    }
    return out;
  } finally { void task.destroy(); }
}
