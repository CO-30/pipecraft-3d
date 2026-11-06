import { test, expect } from '@playwright/test';

test('本番ビルド: 一度開いたらオフラインでも起動し、現場を作成・保存できる', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByTestId('home')).toBeVisible();
  // Service Worker が有効になるまで待つ（初回はページを制御していないので再読み込み）
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  expect(manifest.display).toBe('standalone');

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('new-project').click();
  await page.getByTestId('np-name').fill('オフライン現場');
  await page.getByTestId('np-create').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('保存済み');
  await page.reload();
  await expect(page.getByText('オフライン現場')).toBeVisible();
  await page.screenshot({ path: 'test-evidence/pc-chrome-p2-04-offline.png' });
  await context.setOffline(false);
});
