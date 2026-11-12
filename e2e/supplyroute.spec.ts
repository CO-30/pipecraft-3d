/**
 * 給水・給湯を床下でつなぐ（案）。メーター（外）・給湯器（外壁ぎわ）・キッチン・洗面台・トイレの家で、
 * 器具の道具のボタン → 床下のヘッダーで配管が入り、知らせに水理計算の判定 → 1 回の取り消しで戻る。
 */
import { expect, test, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, useTool } from './helpers';
import { supplyHouse } from '../src/model/testSupplyHouse';

const counts = (page: Page) => page.evaluate(() => { const d = (window as any).__pc.getState().doc; return { segs: Object.keys(d.network.segments).length, fx: Object.keys(d.fixtures).length }; });

test.describe('給水・給湯を床下でつなぐ（案）', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('ボタン → ヘッダーと配管が入り、水理計算の判定を知らせる → 1 回で戻る', async ({ page }) => {
    await createProject(page, '給水ルート');
    const house = supplyHouse().doc;
    await page.evaluate((d) => { const s = (window as any).__pc.getState(); s.newDoc(d, s.meta); }, house);
    const before = await counts(page);

    await useTool(page, 'fixture');
    await page.getByTestId('supply-route').click();
    await expect(page.getByTestId('notice')).toContainText('給水');
    await expect(page.getByTestId('notice')).toContainText('水理計算');
    const after = await counts(page);
    expect(after.segs).toBeGreaterThan(before.segs);
    expect(after.fx).toBe(before.fx + 2); // 給水ヘッダー・給湯ヘッダー
    await page.screenshot({ path: evidence('supplyroute-01') });

    await page.getByTestId('undo').click();
    expect(await counts(page)).toEqual(before);
  });
});
