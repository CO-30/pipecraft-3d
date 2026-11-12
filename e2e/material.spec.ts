/**
 * 材料集計表。給水・給湯の床下ルートを入れた家で、申請画面の「材料表」→ 区分・列・計 → 分け方を「階ごと」に → PDF・Excel。
 */
import { expect, test } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile } from './helpers';
import { supplyHouse } from '../src/model/testSupplyHouse';
import { routeSupplies } from '../src/model/supplyRoute';

test('材料表: 屋内・床下・屋外・地中の列 → 階ごと → PDF・Excel', async ({ page }) => {
  await freshApp(page);
  await createProject(page, '材料表テスト');
  const doc = routeSupplies(supplyHouse().doc).doc;
  await page.evaluate((d) => { const s = (window as any).__pc.getState(); s.newDoc(d, s.meta); }, doc);
  await page.getByTestId('open-shinsei').click();
  await page.getByTestId('shinsei-kind-material').click();
  const preview = page.getByTestId('shinsei-preview');
  await expect(preview).toContainText('材料集計表');
  await expect(preview).toContainText('給水・給湯');
  await expect(preview).toContainText('床下');
  await expect(preview).toContainText('器具');
  await page.screenshot({ path: evidence('material-01-place') });
  await page.getByTestId('material-axis').selectOption('floor');
  await expect(preview).toContainText('床下・地中');
  await expect.poll(() => page.evaluate(() => (window as any).__pc.getState().doc.site.application['zairyo.axis'])).toBe('floor');
  if (!isMobile()) {
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('shinsei-pdf').click()]);
    expect(pdf.suggestedFilename()).toMatch(/材料集計表.*\.pdf$/);
    const [xl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('material-xlsx').click()]);
    expect(xl.suggestedFilename()).toMatch(/材料集計表.*\.xlsx$/);
    if (test.info().project.name === 'pc-chrome') { await pdf.saveAs('test-evidence/pc-chrome-material-02.pdf'); await xl.saveAs('test-evidence/pc-chrome-material-03.xlsx'); }
  }
});
