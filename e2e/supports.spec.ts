import { test, expect, type Page } from '@playwright/test';
import { createProject, freshApp, planToScreen, show, strokeMm, tap, touchSession, evidence } from './helpers';

const tapMm = async (page: Page, x: number, y: number, touch: Awaited<ReturnType<typeof touchSession>>) => tap(page, await planToScreen(page, x, y), touch);
const nodes = (page: Page) => page.evaluate(() => Object.values((window as any).__pc.getState().doc.network.nodes) as { id: string; pos: { x: number; y: number; z: number } }[]);

test('床上排水: 流末を選んで勾配 → 上流ほど高い。レベルバンド・コンクリートビス・キリが集計され、区間ごとに支持金具を変えられる', async ({ page }) => {
  await freshApp(page);
  await createProject(page, '勾配テスト', { blank: true });
  await show(page, '2D');
  const touch = await touchSession(page);
  await page.getByTestId('tool-pipe').click();
  await page.getByTestId('draw-system').selectOption('drain');
  await strokeMm(page, [[0, 0], [4000, 0]], touch);
  await page.getByTestId('tool-select').click();
  // 流末（西端）を選んで、管径別の標準勾配（φ20 → 1/50）
  await tapMm(page, 0, 0, touch);
  await page.getByTestId('apply-slope').click();
  await expect(page.getByTestId('notice')).toContainText('勾配をつけ');
  const ns = await nodes(page);
  const sorted = [...ns].sort((a, b) => a.pos.x - b.pos.x);
  const west = sorted[0], east = sorted.at(-1)!;
  expect(east.pos.z - west.pos.z).toBeCloseTo(80, 3); // 4000 × 1/50

  // 区間を選ぶ（スマホでは点のパネルで図面が狭くなるため、いったん選択を外してから）
  await page.evaluate(() => (window as any).__pc.getState().select(null));
  await tapMm(page, 2000, 1.6, touch);
  await expect(page.getByTestId('seg-slope')).toContainText('1/50');
  await expect(page.getByTestId('seg-support')).toContainText('自動（レベルバンド）');
  await page.screenshot({ path: evidence('p5-04-slope') });

  await page.getByTestId('open-estimate').click();
  await page.getByTestId('tab-parts').click();
  const t = page.getByTestId('supports-table');
  await expect(t).toContainText('レベルバンド');
  await expect(t.locator('tr', { hasText: 'レベルバンド' })).toContainText('4個'); // 4000 ÷ 1.0m
  await expect(t.locator('tr', { hasText: 'コンクリートビス' })).toContainText('8本');
  await expect(t.locator('tr', { hasText: 'コンクリキリ' })).toContainText('1本');
  await page.getByTestId('close-estimate').click();

  // サドルに変えて木下地にすると、ステンレスビスに
  await expect(page.getByTestId('seg-support')).toBeVisible();
  await page.getByTestId('seg-support').selectOption('saddle');
  await page.getByTestId('seg-substrate').selectOption('wood');
  await page.getByTestId('open-estimate').click();
  await page.getByTestId('tab-parts').click();
  await expect(t).toContainText('サドルバンド');
  await expect(t.locator('tr', { hasText: 'ステンレスビス' })).toContainText('8本');
  await expect(t).not.toContainText('コンクリキリ');
});
