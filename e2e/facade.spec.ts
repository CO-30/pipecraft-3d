import { test, expect, type Page } from '@playwright/test';
import { evidence, freshApp, isMobile, show, stroke, touchSession } from './helpers';

const full = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);
const elevToScreen = (page: Page, u: number, v: number) => page.evaluate(async ([u, v]) => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  let prev = '';
  for (let i = 0; i < 30; i++) {
    await frame(); await frame();
    const p = (window as any).__elev.toScreen(u, v);
    const k = `${Math.round(p.x)},${Math.round(p.y)}`;
    if (k === prev) return p;
    prev = k;
  }
  return (window as any).__elev.toScreen(u, v);
}, [u, v] as const) as Promise<{ x: number; y: number }>;

/** 斜めから撮った外壁の代わり: 青い背景に、ゆがんだ赤い四角（基準の四角＝窓など） */
const QUAD = [{ x: 300, y: 200 }, { x: 560, y: 230 }, { x: 580, y: 520 }, { x: 280, y: 540 }];
async function makePhoto(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate((q) => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 700;
    const x = c.getContext('2d')!;
    x.fillStyle = '#0000ff'; x.fillRect(0, 0, 900, 700);
    x.fillStyle = '#ff0000'; x.beginPath(); q.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.fill();
    return c.toDataURL('image/jpeg', 0.95).split(',')[1];
  }, QUAD);
  return Buffer.from(b64, 'base64');
}

/** 写真の画素 → 画面座標（補正画面の SVG） */
const photoToScreen = (page: Page, p: { x: number; y: number }) => page.getByTestId('wp-photo').evaluate((svg, p) => {
  const s = svg as SVGSVGElement;
  const pt = s.createSVGPoint(); pt.x = p.x; pt.y = p.y;
  const r = pt.matrixTransform(s.getScreenCTM()!);
  return { x: r.x, y: r.y };
}, p);

/** 補正した画像の画素の色（立面の mm で指定） */
const sample = (page: Page, src: string, u: number, v: number, W: number, H: number) => page.evaluate(async ([src, u, v, W, H]) => {
  const img = new Image(); img.src = src as string; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d')!; x.drawImage(img, 0, 0);
  const px = Math.floor(((u as number) / (W as number)) * img.width), py = Math.floor((((H as number) - (v as number)) / (H as number)) * img.height);
  return Array.from(x.getImageData(px, py, 1, 1).data.slice(0, 3));
}, [src, u, v, W, H] as const);

const near = (a: number[], b: number[], tol = 45) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('外壁の写真から測る: 壁の一部（基準の四角）で補正 → 縦管をなぞって長さ → 3Dの壁に写真', async ({ page }) => {
  await freshApp(page);
  // 新しい工事の作り方「外壁の写真から測る」（4階・階高2900）
  await page.getByTestId('new-project').click();
  await page.getByTestId('np-name').fill('写真で測る');
  await page.getByTestId('np-mode-facade').click();
  await page.getByTestId('np-floors').fill('4');
  await page.getByTestId('np-create').click();
  // 作成直後に立面の作成画面が開く。高さの初期値 = 4階 × 2900
  await expect(page.getByTestId('elev-dialog')).toBeVisible();
  await expect(page.getByTestId('el-height')).toHaveValue('11600');
  await page.getByTestId('el-width').fill('10000');

  await page.getByTestId('wp-file').setInputFiles({ name: '外壁.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page) });
  await expect(page.getByTestId('wp-photo')).toBeVisible();
  // 壁の端が写っていない → 壁の一部（窓など大きさの分かる四角）で合わせる
  await page.getByTestId('wp-mode-partial').click();
  await page.getByTestId('wp-ref-width').fill('4000');
  await page.getByTestId('wp-ref-height').fill('3000');
  await page.getByTestId('wp-ref-left').fill('2000');
  await page.getByTestId('wp-ref-bottom').fill('3000');
  const touch = await touchSession(page);
  for (let i = 0; i < 4; i++) {
    const dot = page.getByTestId(`wp-corner-${i}`).locator('circle').nth(1);
    // 目標の位置と印の両方が画面に入るように（写真の下側の角はダイアログを下へ送らないと見えない）
    await dot.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    const from = await dot.boundingBox();
    const to = await photoToScreen(page, QUAD[i]);
    await stroke(page, [{ x: from!.x + from!.width / 2, y: from!.y + from!.height / 2 }, to], touch);
  }
  const placed = await page.evaluate(() => [0, 1, 2, 3].map((i) => { const c = document.querySelector(`[data-testid="wp-corner-${i}"] circle`)!; return { x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')) }; }));
  for (let i = 0; i < 4; i++) { expect(Math.abs(placed[i].x - QUAD[i].x)).toBeLessThan(4); expect(Math.abs(placed[i].y - QUAD[i].y)).toBeLessThan(4); }
  await page.screenshot({ path: evidence('fp-01-corners') });
  // はみ出す四角はエラー
  await page.getByTestId('wp-ref-left').fill('7000');
  await page.getByTestId('wp-rectify').click();
  await expect(page.getByRole('alert')).toContainText('はみ出しています');
  await page.getByTestId('wp-ref-left').fill('2000');
  await page.getByTestId('wp-rectify').click();
  await expect(page.getByTestId('el-face')).toBeVisible();
  await page.screenshot({ path: evidence('fp-02-rectified') });
  await page.getByTestId('el-create').click();
  await expect(page.getByTestId('elev-view')).toBeVisible();

  const doc = await full(page);
  const el = Object.values(doc.elevations as Record<string, any>)[0];
  expect(el.width).toBe(10000);
  expect(el.height).toBe(11600);
  // 基準の四角の中 = 赤、四角の左（写真の中）= 青、写真の外 = 灰色
  expect(near(await sample(page, el.photo.src, 4000, 4500, 10000, 11600), [255, 0, 0])).toBe(true);
  expect(near(await sample(page, el.photo.src, 1000, 4500, 10000, 11600), [0, 0, 255])).toBe(true);
  expect(near(await sample(page, el.photo.src, 300, 100, 10000, 11600), [226, 232, 240], 20)).toBe(true);
  // 基準の四角（2000..6000 × 3000..6000）の各辺の 150mm 内側は赤、150mm 外側は青 → 四角がそのまま長方形に戻っている
  for (const [u, v] of [[2150, 4500], [5850, 4500], [4000, 3150], [4000, 5850]]) expect(near(await sample(page, el.photo.src, u, v, 10000, 11600), [255, 0, 0])).toBe(true);
  for (const [u, v] of [[1850, 4500], [6150, 4500], [4000, 2850], [4000, 6150]]) expect(near(await sample(page, el.photo.src, u, v, 10000, 11600), [0, 0, 255])).toBe(true);

  // 屋上近くから地面近くまで縦管をなぞる。なぞっている間は「約 ○m」
  const a = await elevToScreen(page, 7000, 11000), b = await elevToScreen(page, 7000, 500);
  if (!isMobile()) {
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(a.x, a.y + ((b.y - a.y) * k) / 20);
    await expect(page.getByTestId('elev-stroke-len')).toContainText('約 5.');
    await page.screenshot({ path: evidence('fp-03-live-length') });
    for (let k = 11; k <= 20; k++) await page.mouse.move(a.x, a.y + ((b.y - a.y) * k) / 20);
    await page.mouse.up();
  } else {
    await stroke(page, [a, b], touch);
  }
  await expect(page.getByTestId('elev-stroke-len')).toHaveCount(0);
  await expect(page.getByTestId('elev-total')).toContainText('10.5m');
  await page.screenshot({ path: evidence('fp-04-total') });

  // 3D: 外壁に写真が貼られている
  await page.getByTestId('elev-close').click();
  await show(page, '3D');
  await expect.poll(() => page.evaluate(() => (window as any).__pc3d?.facadePhotos?.() ?? []), { timeout: 15000 })
    .toEqual([expect.objectContaining({ imageWidth: expect.any(Number) })]);
  await expect.poll(() => page.evaluate(() => (window as any).__pc3d.facadePhotos()[0].imageWidth)).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: evidence('fp-05-3d') });
  // 外壁を非表示にすると写真も消える
  await page.evaluate(() => (window as any).__pc.getState().setVisibility('exteriorWall', 'hide'));
  await expect.poll(() => page.evaluate(() => (window as any).__pc3d.facadePhotos().length)).toBe(0);
});
