/**
 * 竣工図モード。排水の現場（トイレ → マス 3 つ → 6m → 公共桝）で、申請画面の「竣工図にする」→ 表題と印 →
 * 実測長の一覧で 6m の区間に 6.5m を入れる → 縦断図の延長が 6.500 → PDF → やめると申請図に戻る。
 */
import { expect, test, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile } from './helpers';
import { drainHouse } from '../src/model/testDrainHouse';

const app = (page: Page) => page.evaluate(() => ((window as any).__pc.getState().doc.site?.application ?? {}) as Record<string, string>);

test.describe('竣工図', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('竣工図にする → 実測長を入れる → 延長が実測 → PDF → やめると戻る', async ({ page }) => {
    await createProject(page, '竣工テスト');
    const { doc } = drainHouse();
    await page.evaluate((d) => { const s = (window as any).__pc.getState(); s.newDoc(d, s.meta); }, doc);
    await page.getByTestId('open-shinsei').click();
    const preview = page.getByTestId('shinsei-preview');
    await expect(preview).toContainText('排水設備 縦断図');
    await expect(preview).not.toContainText('竣 工 図');

    await page.getByTestId('asbuilt-on').check();
    await expect(preview).toContainText('排水設備 竣工縦断図');
    await expect(preview).toContainText('竣 工 図');
    expect((await app(page))['shunko.date']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByTestId('shinsei-warnings')).toContainText('実測長が未入力の区間が');
    const before = Number(await page.getByTestId('asbuilt-unmeasured').textContent());
    expect(before).toBeGreaterThan(0);

    // 公共桝へ 6m の区間（一覧の最後）に 6500mm
    const inputs = page.locator('[data-testid^="asbuilt-len-"]');
    const last = inputs.last();
    const segId = (await last.getAttribute('data-testid'))!.replace('asbuilt-len-', '');
    await last.fill('6500');
    await last.press('Enter');
    await expect.poll(() => page.evaluate((id) => (window as any).__pc.getState().doc.network.segments[id].measuredLength, segId)).toBe(6500);
    await expect(page.getByTestId('asbuilt-unmeasured')).toHaveText(String(before - 1));
    await expect(preview).toContainText('6.500');
    // 一覧は区間の番号とマスで見分けられる
    await expect(page.getByTestId('asbuilt-list')).toContainText('区間');
    await expect(page.getByTestId('asbuilt-list')).toContainText('→');
    // m のつもりで 6.5 と入れる → 図面とかけ離れていると注意（単位は mm）
    const first = inputs.first();
    await first.fill('6.5'); await first.press('Enter');
    await expect(page.getByTestId('shinsei-warnings')).toContainText('大きく違います（単位は mm）');
    await first.fill(''); await first.press('Enter');
    await expect(page.getByTestId('shinsei-warnings')).not.toContainText('大きく違います');
    // 全部入れても一覧は閉じない
    const n = await inputs.count();
    for (let i = 0; i < n; i++) { const el = inputs.nth(i); if ((await el.inputValue()) === '') { await el.fill('350'); await el.press('Enter'); } }
    await expect(page.getByTestId('asbuilt-unmeasured')).toHaveText('0');
    await expect(page.getByTestId('asbuilt-list')).toHaveAttribute('open', '');
    await page.getByTestId('asbuilt-date').fill('2026-11-30');
    await expect(preview).toContainText('竣工 2026年11月30日');
    await page.screenshot({ path: evidence('asbuilt-01-profile') });

    // 沖縄市の様式（縦断図に排水の展開図が載る）: 一覧の未入力の欄の数 = 未入力の数
    await page.getByTestId('shinsei-profile').selectOption('okinawa-city');
    await expect(preview).toContainText('VU100×6.5'); // 展開図の長さも実測
    const empty = await inputs.evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).value === '').length);
    await expect(page.getByTestId('asbuilt-unmeasured')).toHaveText(String(empty));
    await page.getByTestId('shinsei-profile').selectOption('standard');

    if (!isMobile()) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('shinsei-pdf').click()]);
      expect(dl.suggestedFilename()).toMatch(/竣工縦断図.*\.pdf$/);
      if (test.info().project.name === 'pc-chrome') await dl.saveAs('test-evidence/pc-chrome-asbuilt-02.pdf');
    }

    // 竣工図でも、ふだんの注意（この端末に無い自治体プロファイル）は出る
    await page.evaluate(() => (window as any).__pc.getState().updateSite({ municipalityProfileId: 'user-missing' }));
    await expect(page.getByTestId('shinsei-warnings')).toContainText('この端末に見つからない');
    await page.evaluate(() => (window as any).__pc.getState().updateSite({ municipalityProfileId: 'standard' }));

    // やめると申請図に戻る（実測長は残る）
    await page.getByTestId('asbuilt-on').uncheck();
    await expect(preview).toContainText('排水設備 縦断図');
    await expect(preview).not.toContainText('竣 工 図');
    await expect(preview).not.toContainText('6.500');
    expect(await page.evaluate((id) => (window as any).__pc.getState().doc.network.segments[id].measuredLength, segId)).toBe(6500);
  });
});
