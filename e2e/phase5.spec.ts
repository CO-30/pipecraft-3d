import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';
import { createProject, evidence, freshApp, isMobile, planToScreen, show, state, tap, touchSession, useTool } from './helpers';

const tapMm = async (page: Page, x: number, y: number, touch: Awaited<ReturnType<typeof touchSession>>) => tap(page, await planToScreen(page, x, y), touch);
const full = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);

/** ブラウザのキャンバスでテスト画像を作る（格子模様） */
async function makeImage(page: Page, w: number, h: number, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<Buffer> {
  const b64 = await page.evaluate(([w, h, type]) => {
    const c = document.createElement('canvas');
    c.width = w as number; c.height = h as number;
    const x = c.getContext('2d')!;
    x.fillStyle = '#e2e8f0'; x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = '#0f172a'; x.lineWidth = 4;
    for (let i = 0; i <= c.width; i += 50) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, c.height); x.stroke(); }
    for (let i = 0; i <= c.height; i += 50) { x.beginPath(); x.moveTo(0, i); x.lineTo(c.width, i); x.stroke(); }
    return c.toDataURL(type as string).split(',')[1];
  }, [w, h, type] as const);
  return Buffer.from(b64, 'base64');
}

test.describe('Phase 5 図面読み込み・実用化', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('画像の下敷き → 2点で縮尺 → ドラッグで移動 → Undo', async ({ page }) => {
    await createProject(page, '下敷きテスト', { blank: true });
    await show(page, '2D');
    const touch = await touchSession(page);
    await useTool(page, 'underlay');
    await page.getByTestId('ul-image-file').setInputFiles({ name: '図面.png', mimeType: 'image/png', buffer: await makeImage(page, 400, 300) });
    await expect(page.locator('[data-underlay]')).toHaveCount(1);
    await expect(page.getByTestId('ul-status')).toContainText('縮尺未確定');
    let doc = await full(page);
    const u0 = Object.values(doc.underlays)[0] as any;
    expect(u0.mmPerPx).toBe(25); // 長辺 400px → 10m

    // 下敷き上の 2点（今の縮尺で 2000mm）を 4000mm と指定 → 縮尺2倍
    await page.getByTestId('ul-scale').click();
    await tapMm(page, u0.center.x - 1000, u0.center.y, touch);
    await tapMm(page, u0.center.x + 1000, u0.center.y, touch);
    await page.getByTestId('ul-scale-mm').fill('4000');
    await page.getByTestId('ul-scale-apply').click();
    doc = await full(page);
    const u1 = Object.values(doc.underlays)[0] as any;
    expect(u1.scaled).toBe(true);
    expect(u1.mmPerPx).toBeGreaterThan(48);
    expect(u1.mmPerPx).toBeLessThan(52);
    await expect(page.getByTestId('ul-status')).toContainText('縮尺: 1px');

    // ドラッグで移動（履歴1件）
    const from = await planToScreen(page, u1.center.x, u1.center.y);
    const to = await planToScreen(page, u1.center.x + 1000, u1.center.y);
    if (touch) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
      for (let k = 1; k <= 8; k++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * k) / 8, y: from.y, id: 1 }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
    }
    doc = await full(page);
    const u2 = Object.values(doc.underlays)[0] as any;
    expect(Math.abs(u2.center.x - u1.center.x - 1000)).toBeLessThan(80);
    await page.screenshot({ path: evidence('p5-01-underlay') });
    await page.getByTestId('undo').click();
    doc = await full(page);
    expect((Object.values(doc.underlays)[0] as any).center.x).toBeCloseTo(u1.center.x, 3);
  });

  test('PDF図面（2ページ）からページを選んで下敷きにする', async ({ page }) => {
    test.skip(isMobile(), 'ファイル選択の操作は PC で確認（スマホでも同じ部品）');
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 2; i++) { const p = pdf.addPage([842, 595]); p.drawRectangle({ x: 50, y: 50, width: 700, height: 450, borderColor: rgb(0, 0, 0), borderWidth: 3 }); }
    await createProject(page, 'PDFテスト', { blank: true });
    await show(page, '2D');
    await useTool(page, 'underlay');
    await page.getByTestId('ul-pdf-file').setInputFiles({ name: '平面図.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
    await expect(page.getByTestId('pdf-pages')).toContainText('2ページ');
    await page.getByTestId('pdf-pages').getByRole('button', { name: 'このページを取り込む' }).click();
    await expect(page.locator('[data-underlay]')).toHaveCount(1);
    const doc = await full(page);
    const u = Object.values(doc.underlays)[0] as any;
    expect(u.kind).toBe('pdf');
    expect(u.widthPx).toBeGreaterThan(u.heightPx);
  });

  test('住所検索 → 航空写真（地理院）＋建物外形（OSM）を取り込み、外壁4面と出典表示', async ({ page }) => {
    const tile = await makeImage(page, 256, 256, 'image/jpeg');
    const d = 0.0001;
    await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [{ geometry: { coordinates: [127.68, 26.2] }, properties: { title: '沖縄県那覇市テスト' } }] }));
    await page.route('**/overpass-api.de/**', (r) => r.fulfill({ json: { elements: [{ type: 'way', id: 9, tags: { building: 'house' }, geometry: [
      { lat: 26.19996, lon: 127.67995 }, { lat: 26.19996, lon: 127.67995 + d }, { lat: 26.19996 + d * 0.8, lon: 127.67995 + d }, { lat: 26.19996 + d * 0.8, lon: 127.67995 }, { lat: 26.19996, lon: 127.67995 }] }] } }));
    await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.fulfill({ body: tile, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' } }));

    await createProject(page, '航空写真テスト', { blank: true });
    await show(page, '2D');
    await useTool(page, 'underlay');
    await page.getByTestId('ul-site').click();
    await page.getByTestId('site-q').fill('那覇市テスト1-1');
    await page.getByTestId('site-search').click();
    await expect(page.getByTestId('site-chosen')).toContainText('沖縄県那覇市テスト');
    await expect(page.getByTestId('site-fp')).toContainText('検索地点の建物');
    await page.getByTestId('site-eave').fill('450');
    await page.getByTestId('site-import').click();
    await expect(page.getByTestId('site-dialog')).toBeHidden();
    const { bld } = await state(page);
    const walls = Object.values(bld.walls);
    expect(walls).toHaveLength(4);
    expect(walls.every((w) => w.kind === 'exterior')).toBe(true);
    const doc = await full(page);
    const u = Object.values(doc.underlays)[0] as any;
    expect(u).toMatchObject({ kind: 'aerial', scaled: true });
    expect(u.mmPerPx).toBeGreaterThan(500);
    await expect(page.getByTestId('attribution')).toContainText('国土地理院');
    await expect(page.getByTestId('attribution')).toContainText('OpenStreetMap');
    await page.screenshot({ path: evidence('p5-02-aerial') });
  });

  test('現場写真から窓を作る（四隅→正面補正→四角でなぞる）', async ({ page }) => {
    await createProject(page, '写真テスト');
    await show(page, '2D');
    const touch = await touchSession(page);
    const doc0 = await full(page);
    const before = Object.keys(doc0.building.openings).length;
    // 南の外壁（y=0）を選ぶ
    const south = Object.values(doc0.building.walls as Record<string, any>).find((w) => doc0.building.corners[w.a].y === 0 && doc0.building.corners[w.b].y === 0)!;
    const ax = doc0.building.corners[south.a].x, bx = doc0.building.corners[south.b].x;
    await page.getByTestId('tool-select').click();
    await tapMm(page, (ax + bx) / 2, 0, touch);
    await page.getByTestId('wall-photo').click();
    await page.getByTestId('wp-file').setInputFiles({ name: '外壁.jpg', mimeType: 'image/jpeg', buffer: await makeImage(page, 800, 600, 'image/jpeg') });
    await expect(page.getByTestId('wp-photo')).toBeVisible();
    await page.getByTestId('wp-rectify').click();
    const face = page.getByTestId('wp-face');
    await expect(face).toBeVisible();
    const box = (await face.boundingBox())!;
    // 正面画像の中央付近・腰の高さに窓をなぞる
    const p0 = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.3 }, p1 = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.6 };
    if (touch) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p0, id: 1 }] });
      for (let k = 1; k <= 6; k++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p0.x + ((p1.x - p0.x) * k) / 6, y: p0.y + ((p1.y - p0.y) * k) / 6, id: 1 }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 6 }); await page.mouse.up();
    }
    await expect(page.getByTestId('wp-box')).toHaveCount(1);
    await page.screenshot({ path: evidence('p5-03-wall-photo') });
    await page.getByTestId('wp-create').click();
    await expect(page.getByTestId('wall-photo-dialog')).toBeHidden();
    const doc1 = await full(page);
    const added = Object.values(doc1.building.openings as Record<string, any>).filter((o) => !doc0.building.openings[o.id]);
    expect(Object.keys(doc1.building.openings).length).toBe(before + 1);
    expect(added[0]).toMatchObject({ type: 'window', wallId: south.id });
    expect(added[0].sill).toBeGreaterThan(500);
  });

  test('全現場の一括バックアップを書き出せる', async ({ page }) => {
    test.skip(isMobile(), 'ダウンロードは PC で確認');
    await createProject(page, '一括1', { blank: true });
    await page.getByTestId('back-home').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup-all').click()]);
    expect(dl.suggestedFilename()).toMatch(/全現場.*\.json$/);
  });
});
