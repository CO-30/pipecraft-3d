/**
 * 付近見取り図（案内図）。申請画面の「見取図」で住所を探す → 候補から選ぶ → 地図（地理院タイル）に工事場所の印 →
 * タップで印を動かす → 縮尺を変える → PDF → 下水道申請書の 4 面に貼られる。
 * 地理院の住所検索・タイルは route でモックする。
 */
import { expect, test, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile } from './helpers';

async function tile(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d')!;
    x.fillStyle = '#f4f1e8'; x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#ffffff'; x.fillRect(0, 118, 256, 20); x.fillRect(118, 0, 20, 256);
    x.strokeStyle = '#b0a890'; x.lineWidth = 1; x.strokeRect(0.5, 0.5, 255, 255);
    x.fillStyle = '#d9d3c0'; x.fillRect(30, 30, 60, 50); x.fillRect(160, 160, 70, 60);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}
const app = (page: Page) => page.evaluate(() => ((window as any).__pc.getState().doc.site?.application ?? {}) as Record<string, string>);

test.describe('見取図（案内図）', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('住所 → 候補 → 地図に印 → タップで移動 → 縮尺 → PDF → 下水道 4 面', async ({ page }) => {
    const png = await tile(page);
    let tiles = 0;
    await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [
      { geometry: { coordinates: [127.7946, 26.3343] }, properties: { title: '沖縄県沖縄市仲宗根町' } },
      { geometry: { coordinates: [127.8000, 26.3300] }, properties: { title: '沖縄県沖縄市胡屋' } },
    ] }));
    await page.route('**/cyberjapandata.gsi.go.jp/xyz/std/**', (r) => { tiles++; return r.fulfill({ body: png, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }); });

    await createProject(page, '見取図テスト');
    await page.getByTestId('open-shinsei').click();
    await page.getByTestId('shinsei-kind-mitori').click();
    await expect(page.getByTestId('shinsei-error')).toContainText('工事場所が決まっていません');
    await expect(page.getByTestId('shinsei-pdf')).toBeDisabled();
    await expect(page.getByTestId('mitori-privacy')).toContainText('国土地理院');

    await page.getByTestId('mitori-q').fill('沖縄市仲宗根町26-1');
    await page.getByTestId('mitori-search').click();
    await page.getByTestId('mitori-place').selectOption({ label: '沖縄県沖縄市仲宗根町' });
    await expect(page.getByTestId('mitori-chosen')).toContainText('沖縄県沖縄市仲宗根町');
    const preview = page.getByTestId('shinsei-preview');
    await expect(preview.locator('svg image')).toHaveCount(1);
    await expect(preview).toContainText('工事場所: 沖縄県沖縄市仲宗根町'); // 申請の住所が空なら検索した地名
    await expect(preview).toContainText('国土地理院の地理院タイル（標準地図）を加工して作成');
    expect(tiles).toBeGreaterThan(20);
    expect(await app(page)).toMatchObject({ 'mitori.lat': '26.3343', 'mitori.lon': '127.7946', 'mitori.title': '沖縄県沖縄市仲宗根町' });
    await page.screenshot({ path: evidence('mitori-01-map') });

    // 地図の中心より上をタップ → 工事場所が北へ動く（表示倍率に依らない）
    const svg = preview.locator('svg').first();
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * ((40 + 226 * 0.3) / 297));
    await expect.poll(async () => Number((await app(page))['mitori.lat'])).toBeGreaterThan(26.3343);
    expect(Number((await app(page))['mitori.lon'])).toBeCloseTo(127.7946, 3);
    await expect(preview.locator('svg image')).toHaveCount(1);

    await page.getByTestId('mitori-zoom-18').click();
    await expect.poll(async () => (await app(page))['mitori.zoom']).toBe('18');
    await expect(preview.locator('svg image')).toHaveCount(1);
    await expect(page.getByTestId('shinsei-warnings')).toHaveCount(0);
    await page.screenshot({ path: evidence('mitori-02-moved-zoom') });

    if (!isMobile()) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('shinsei-pdf').click()]);
      expect(dl.suggestedFilename()).toMatch(/見取図.*\.pdf$/);
      if (test.info().project.name === 'pc-chrome') await dl.saveAs('test-evidence/pc-chrome-mitori-03.pdf');
    }

    // 下水道の申請書: 4 面に見取図が貼られる（空欄の注意が出ない）
    await page.getByTestId('shinsei-profile').selectOption('okinawa-city');
    await page.getByTestId('shinsei-kind-forms').click();
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('forms-sewer').click()]);
    expect(pdf.suggestedFilename()).toContain('下水道排水設備計画確認申請書.pdf');
    await expect(page.getByTestId('forms-msg')).not.toContainText('4 面の見取図は空欄');
    if (test.info().project.name === 'pc-chrome') await pdf.saveAs('test-evidence/pc-chrome-mitori-04-sewer.pdf');
  });

  test('地図が取れないとき（オフライン）は枠だけの見取図と注意', async ({ page }) => {
    await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.abort());
    await createProject(page, '見取図オフライン');
    await page.evaluate(() => { const s = (window as any).__pc.getState(); s.updateSite({ application: { 'mitori.lat': '26.2', 'mitori.lon': '127.68', 'mitori.title': '那覇市' } }); });
    await page.getByTestId('open-shinsei').click();
    await page.getByTestId('shinsei-kind-mitori').click();
    await expect(page.getByTestId('shinsei-warnings')).toContainText('枠だけの見取図');
    await expect(page.getByTestId('shinsei-preview')).toContainText('地図を取得できませんでした');
    await expect(page.getByTestId('shinsei-pdf')).toBeEnabled();
  });
});
