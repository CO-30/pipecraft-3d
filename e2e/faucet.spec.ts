import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createProject, evidence, freshApp, planToScreen, show, strokeMm, tap, touchSession } from './helpers';

const tapMm = async (page: Page, x: number, y: number, touch: Awaited<ReturnType<typeof touchSession>>) => tap(page, await planToScreen(page, x, y), touch);
const doc = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);

test('水栓を置いて給水管をつなぐ → ネジ継手・シールテープ・接着剤が積算に入り、部材図PDFを保存', async ({ page }) => {
  await freshApp(page);
  await createProject(page, '水栓テスト', { blank: true });
  await show(page, '2D');
  const touch = await touchSession(page);
  await page.getByTestId('tool-fixture').click();
  await page.getByTestId('fixture-faucet').click();
  await tapMm(page, 2000, 2000, touch);
  let d = await doc(page);
  const port = Object.values(d.network.nodes as Record<string, any>).find((n) => n.portId === 'water')!;
  await page.getByTestId('tool-pipe').click();
  await strokeMm(page, [[port.pos.x, port.pos.y], [port.pos.x, 4000], [4500, 4000]], touch);
  d = await doc(page);
  expect(Object.values(d.network.segments as Record<string, any>).some((s) => s.a === port.id || s.b === port.id)).toBe(true);

  await page.getByTestId('open-estimate').click();
  await page.getByTestId('tab-parts').click();
  await expect(page.getByTestId('parts-table')).toContainText('給水栓用エルボ（ネジ）');
  await expect(page.getByTestId('consumables-table')).toContainText('シールテープ');
  await expect(page.getByTestId('consumables-table')).toContainText('塩ビ管用接着剤（HI用）');
  await page.screenshot({ path: evidence('fc-01-parts') });
  await page.getByTestId('tab-quote').click();
  await expect(page.getByTestId('quote-table')).toContainText('シールテープ');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-drawing').click()]);
  expect(dl.suggestedFilename()).toMatch(/^水栓テスト_部材図_\d{8}\.pdf$/);
  expect(readFileSync(await dl.path()).subarray(0, 5).toString()).toBe('%PDF-');
});
