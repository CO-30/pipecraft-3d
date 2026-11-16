/**
 * スキャンした図面（画像だけの PDF）から壁を読み取る: 下敷きに取り込む → 図面の縮尺 1/50 → 🧱 壁を読み取る。
 * 図面は作り物（9100 × 6370 の外壁を二重線で描き、真ん中に内壁、赤い手書きの線）。
 */
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createProject, evidence, freshApp, show, useTool } from './helpers';

const full = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);

/** A3 横を 2400px にした画像（1/50 なら 1px = 8.75mm）に、二重線の壁を描いた「スキャン」 */
async function scanPdf(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const W = 2400, H = 1697, MM = 8.75, o = Math.round(60 / MM);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d')!;
    x.fillStyle = '#f4f4f0'; x.fillRect(0, 0, W, H);
    const wall = (x1: number, y1: number, x2: number, y2: number, color = '#111') => {
      x.fillStyle = color;
      if (y1 === y2) { x.fillRect(x1 - o, y1 - o, x2 - x1 + 2 * o, 2); x.fillRect(x1 - o, y1 + o, x2 - x1 + 2 * o, 2); }
      else { x.fillRect(x1 - o, y1 - o, 2, y2 - y1 + 2 * o); x.fillRect(x1 + o, y1 - o, 2, y2 - y1 + 2 * o); }
    };
    const X0 = 600, Y0 = 400, w = Math.round(9100 / MM), h = Math.round(6370 / MM), mx = X0 + Math.round(4550 / MM);
    wall(X0, Y0, X0 + w, Y0); wall(X0, Y0 + h, X0 + w, Y0 + h); wall(X0, Y0, X0, Y0 + h); wall(X0 + w, Y0, X0 + w, Y0 + h);
    wall(mx, Y0, mx, Y0 + h);
    wall(500, 1400, 1800, 1400, '#d22'); // 赤い手書き（読まない）
    x.fillStyle = '#111'; x.font = '24px sans-serif'; x.fillText('1階平面図 S=1/50（スキャン）', 1700, 1600);
    return c.toDataURL('image/png').split(',')[1];
  });
  const pdf = await PDFDocument.create();
  const img = await pdf.embedPng(Buffer.from(b64, 'base64'));
  const p = pdf.addPage([1190.55, 841.89]);
  p.drawImage(img, { x: 0, y: 0, width: 1190.55, height: 841.89 });
  return Buffer.from(await pdf.save());
}

test.describe('スキャン図面から壁を読み取る', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('下敷き → 縮尺 1/50 → 🧱 壁を読み取る → 外壁 4 本と内壁。もう一度は置き換えの確認', async ({ page }) => {
    await createProject(page, 'スキャンテスト', { blank: true });
    await show(page, '2D');
    await useTool(page, 'underlay');
    await page.getByTestId('ul-pdf-file').setInputFiles({ name: 'スキャン.pdf', mimeType: 'application/pdf', buffer: await scanPdf(page) });
    await expect(page.locator('[data-underlay]')).toHaveCount(1);
    // 縮尺が仮のうちはボタンを出さず案内
    await expect(page.getByTestId('ul-walls-hint')).toBeVisible();
    await expect(page.getByTestId('ul-read-walls')).toHaveCount(0);
    await page.getByTestId('ul-paper-scale').selectOption('50');
    await page.getByTestId('ul-read-walls').click();
    await expect(page.getByTestId('ul-note')).toContainText('壁を');
    await expect(page.getByTestId('ul-note')).toContainText('外壁 4');
    const doc = await full(page);
    const walls = Object.values(doc.building.walls) as { kind: string; thickness: number }[];
    expect(walls.filter((w) => w.kind === 'exterior').length).toBeGreaterThanOrEqual(4);
    expect(walls.some((w) => w.kind === 'interior')).toBe(true);
    for (const w of walls) expect(Math.abs(w.thickness - 120)).toBeLessThan(35);
    await page.screenshot({ path: evidence('scanwalls-01') });

    // 2 回目: 壁があるので確認 → やめる（変わらない）→ 置き換える
    const n = walls.length;
    await page.getByTestId('ul-read-walls').click();
    await expect(page.getByTestId('ul-walls')).toContainText(`この階の壁 ${n} 本を消して`);
    await page.getByTestId('ul-walls-cancel').click();
    expect(Object.keys((await full(page)).building.walls)).toHaveLength(n);
    await page.getByTestId('ul-read-walls').click();
    await page.getByTestId('ul-walls-replace').click();
    await expect(page.getByTestId('ul-note')).toContainText('外壁 4');
    expect(Object.keys((await full(page)).building.walls)).toHaveLength(n);
  });
});
