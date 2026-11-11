import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { evidence } from './helpers';

const PT_MM = 25.4 / 72;
const PITCH = 910, W = 8 * PITCH, D = 6 * PITCH;
type Fx = { id: string; type: string; x: number; y: number; rotation: number };

/**
 * 作り物の 1 階平面図（1/100）: 外壁の中の左下に浴室（内法 2000×1600、芯 0〜2120 × 0〜1720）。
 * 浴室の上の壁に出入口（x 1300〜1700）。「UB1618」の文字は下寄り → 今までの置き方は下の壁沿い（横）
 */
async function plan(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([1191, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const k = PT_MM * 100, ox = 250, oy = 200;
  const X = (x: number) => ox + x / k, Y = (y: number) => oy + y / k;
  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.5) => page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: w });
  const text = (x: number, y: number, s: string, size = 8) => page.drawText(s, { x: X(x) - font.widthOfTextAtSize(s, size) / 2, y: Y(y) - size / 2, size, font });
  const wall = (x1: number, y1: number, x2: number, y2: number, t = 120) => {
    const h = t / 2;
    if (y1 === y2) { line(x1, y1 - h, x2, y1 - h); line(x1, y1 + h, x2, y1 + h); } else { line(x1 - h, y1, x1 - h, y2); line(x1 + h, y1, x1 + h, y2); }
  };
  for (let i = 0; i < 9; i++) { text(i * PITCH, -1500, `X${i + 1}`); line(i * PITCH, -1200, i * PITCH, D + 1200, 0.1); }
  for (let j = 0; j < 7; j++) { text(-1500, j * PITCH, `Y${j + 1}`); line(-1200, j * PITCH, W + 1200, j * PITCH, 0.1); }
  for (let i = 0; i < 300; i++) line(W + 3000 + (i % 30) * 40, i * 20, W + 3600 + (i % 30) * 40, i * 20, 0.1);
  wall(0, 0, W, 0); wall(0, D, W, D); wall(0, 0, 0, D); wall(W, 0, W, D);
  wall(2120, 0, 2120, 1720); wall(0, 1720, 1300, 1720); wall(1700, 1720, 2120, 1720);
  line(1300, 1720, 1700, 1720, 0.1); // 浴室の出入口
  text(3000, -2600, 'S:1/100', 12);
  text(1000, 500, 'UB1618');
  return Buffer.from(await doc.save());
}

async function readPlan(page: Page, name: string, pdf: Buffer) {
  await page.getByTestId('new-project').click();
  await page.getByTestId('np-name').fill(name);
  await page.getByTestId('np-mode-auto').click();
  await page.getByTestId('np-files').setInputFiles([{ name: '1階平面図.pdf', mimeType: 'application/pdf', buffer: pdf }]);
  await page.getByTestId('np-create').click();
  await expect(page.getByTestId('import-report')).toBeVisible();
}
const tub = async (page: Page) => (Object.values(await page.evaluate(() => (window as any).__pc.getState().doc.fixtures)) as Fx[]).find((f) => f.type === 'bathtub')!;

test('浴槽の向きを直すと端末が覚え、次に図面を読んだときその向き・壁に置く。消すと元に戻る', async ({ page }) => {
  await page.goto('/');
  const pdf = await plan();
  await readPlan(page, '覚える 1', pdf);
  await expect(page.getByTestId('ir-fixtures')).toContainText('浴槽');
  await expect(page.getByTestId('ir-fixtures')).toContainText('位置は大まか');
  await expect(page.getByTestId('ir-forget')).toHaveCount(0);
  await page.getByTestId('ir-ok').click();
  const t0 = await tub(page);
  expect(t0.rotation % 180).toBe(0); // 下の壁沿い（横）

  // 使う人の直し方: 回して左の壁沿い（縦）へ
  await page.evaluate((id) => {
    const s = (window as any).__pc.getState();
    s.rotateFixture(id);
    s.beginDrag(); s.dragFixture(id, { x: 470, y: 850 }); s.endDrag();
  }, t0.id);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pipecraft3d.fixtureLearn.v1') ?? '[]').length)).toBe(1);

  // 一覧へ戻って、同じ図面でもう一度
  await page.getByTestId('back-home').click();
  await readPlan(page, '覚える 2', pdf);
  await expect(page.getByTestId('ir-fixtures')).toContainText('これまでの直し方 1 件に合わせた位置');
  await page.screenshot({ path: evidence('fixturelearn-report') });
  await page.getByTestId('ir-ok').click();
  const t1 = await tub(page);
  expect(t1.rotation % 180).toBe(90);
  expect(Math.abs(t1.x - 460)).toBeLessThan(40);
  expect(Math.abs(t1.y - 860)).toBeLessThan(40);

  // 覚えた直し方を消すと、今までの置き方に戻る
  await page.getByTestId('back-home').click();
  await readPlan(page, '覚える 3', pdf);
  await page.getByTestId('ir-forget').click();
  await expect(page.getByTestId('ir-fixtures')).toContainText('位置は大まか');
  await expect(page.getByTestId('ir-forget')).toHaveCount(0);
  await page.getByTestId('ir-ok').click();
  expect((await tub(page)).rotation % 180).toBe(0);
});
