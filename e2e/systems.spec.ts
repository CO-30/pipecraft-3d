import { test, expect } from '@playwright/test';
import { createProject, freshApp, show, state, strokeMm, touchSession } from './helpers';

test('給水の配管の上で排水の線を終えても分岐しない（お知らせが出る）', async ({ page }) => {
  await freshApp(page);
  await createProject(page, '種類テスト', { blank: true });
  await show(page, '2D');
  const touch = await touchSession(page);
  await page.getByTestId('tool-pipe').click();
  await page.getByTestId('draw-system').selectOption('water');
  await strokeMm(page, [[0, 0], [4000, 0]], touch);
  await page.getByTestId('tool-pipe').click();
  await page.getByTestId('draw-system').selectOption('drain');
  await strokeMm(page, [[2000, 3000], [2000, 0]], touch);
  await expect(page.getByTestId('notice')).toContainText('つなげません');
  const { net } = await state(page);
  expect(Object.values(net.nodes).filter((n) => n.kind === 'tee')).toHaveLength(0);
  expect(Object.keys(net.segments)).toHaveLength(2);
});
