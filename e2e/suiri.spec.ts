/**
 * 給水の水理計算書。直結直圧の家（メーター → 分岐 → キッチン・洗面台・トイレ・給湯器）で、
 * 申請画面の「水理計算書」→ 判定「適当」→ 設計水圧を下げると「不適当」→ 口径の提案で「適当」→ PDF → 図面で 1 回戻すと口径が戻る。
 */
import { expect, test, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile } from './helpers';
import { kawasakiLike } from '../src/model/hydraulics/testSupply';

const diameters = (page: Page) => page.evaluate(() => Object.fromEntries(Object.values((window as any).__pc.getState().doc.network.segments as Record<string, { id: string; diameter: number }>).map((s) => [s.id, s.diameter])));

test.describe('水理計算書', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('判定 → 設計水圧を下げると不適当 → 口径の提案で適当 → PDF → 1 回戻すと口径が戻る', async ({ page }) => {
    await createProject(page, '水理テスト');
    const house = kawasakiLike().doc;
    await page.evaluate((d) => { const s = (window as any).__pc.getState(); s.newDoc(d, s.meta); }, house);
    const before = await diameters(page);

    await page.getByTestId('open-shinsei').click();
    await page.getByTestId('shinsei-kind-suiri').click();
    const verdict = page.getByTestId('suiri-verdict');
    await expect(verdict).toContainText('適当');
    await expect(verdict).not.toContainText('不適当');
    await expect(page.getByTestId('shinsei-preview')).toContainText('給水装置 水理計算書');
    await page.getByTestId('suiri-conditions-open').click();
    await expect(page.getByTestId('suiri-pressure-auto')).toBeVisible();
    await page.screenshot({ path: evidence('suiri-01-ok') });

    await page.getByTestId('suiri-pressure').fill('0.07');
    await page.getByTestId('suiri-pressure').press('Enter');
    await expect(verdict).toContainText('不適当');
    await expect(page.getByTestId('suiri-apply')).toBeVisible();
    await page.screenshot({ path: evidence('suiri-02-ng') });
    await page.getByTestId('suiri-apply').click();
    await expect(verdict).not.toContainText('不適当');
    await expect(verdict).toContainText('適当');
    await expect(page.getByTestId('suiri-apply')).toHaveCount(0);
    const after = await diameters(page);
    expect(Object.keys(after).some((id) => after[id] > before[id])).toBe(true);
    await page.screenshot({ path: evidence('suiri-03-applied') });

    if (!isMobile()) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('shinsei-pdf').click()]);
      expect(dl.suggestedFilename()).toMatch(/水理計算書.*\.pdf$/);
    }

    await page.getByTestId('close-shinsei').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await page.getByTestId('undo').click();
    expect(await diameters(page)).toEqual(before);
  });
});
