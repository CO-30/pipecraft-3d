/**
 * 器具を置いたら選択（☝️）に戻り、置いた器具の種類をその場で変えられる（2026-11-13 ユーザー要望）。
 * まちがって別の所をタップしても、器具が増えない。
 */
import { test, expect, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, planToScreen, show, tap, touchSession } from './helpers';

const tapMm = async (page: Page, x: number, y: number, touch: Awaited<ReturnType<typeof touchSession>>) => tap(page, await planToScreen(page, x, y), touch);
const fixtures = (page: Page) => page.evaluate(() => Object.values((window as any).__pc.getState().doc.fixtures) as { id: string; type: string }[]);

test('器具を置くと ☝️ に戻り、種類を変えられる。続けてタップしても増えない', async ({ page }) => {
  await freshApp(page);
  await createProject(page, '器具の置き方', { blank: true });
  await show(page, '2D');
  const touch = await touchSession(page);
  await page.getByTestId('tool-fixture').click();
  await page.getByTestId('fixture-toilet').click();
  await tapMm(page, 2000, 2000, touch);
  await expect(page.getByTestId('tool-select')).toHaveClass(/\bon\b/);
  await expect(page.getByTestId('notice')).toContainText('トイレを置きました');
  expect(await fixtures(page)).toHaveLength(1);

  // 種類を洗面台に変える（同じ所のまま）
  await page.getByTestId('fixture-type-change').selectOption('washbasin');
  expect((await fixtures(page)).map((f) => f.type)).toEqual(['washbasin']);
  await page.screenshot({ path: evidence('placefixture-01-change-type') });

  // まちがって別の所をタップしても増えない
  await tapMm(page, 5000, 4000, touch);
  expect(await fixtures(page)).toHaveLength(1);
});
