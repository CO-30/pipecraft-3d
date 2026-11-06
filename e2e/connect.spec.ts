import { test, expect, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, planToScreen, show, state, tap, touchSession } from './helpers';

const tapMm = async (page: Page, x: number, y: number, touch: Awaited<ReturnType<typeof touchSession>>) => tap(page, await planToScreen(page, x, y), touch);
const tees = async (page: Page) => Object.values((await state(page)).net.nodes).filter((n) => n.kind === 'tee').length;

test('はみ出した配管の端を選んで「近くの配管につなぐ」→ 分岐。区間の「端を外す」で元どおり離れる', async ({ page }) => {
  await freshApp(page);
  await createProject(page, '接続かんたん', { blank: true });
  await show(page, '2D');
  const touch = await touchSession(page);
  // 南北の給水管（描画の操作は他のテストで確認済み。ここでは接続の操作を確認する）
  await page.evaluate(() => (window as any).__pc.getState().drawPolyline([{ x: 2000, y: -1000, z: 100 }, { x: 2000, y: 2000, z: 100 }]));
  // 南北の管を 150mm はみ出して止まった配管（画面の例。描いた時に自動でつながらなかった状態）
  await page.evaluate(() => (window as any).__pc.getState().drawPolyline([{ x: 0, y: 300, z: 100 }, { x: 2150, y: 300, z: 100 }]));
  expect(Object.keys((await state(page)).net.segments)).toHaveLength(2);
  expect(await tees(page)).toBe(0);

  await page.getByTestId('tool-select').click();
  const end = Object.values((await state(page)).net.nodes).sort((a, b) => b.pos.x - a.pos.x).find((n) => Math.abs(n.pos.y - 300) < 60)!;
  await tapMm(page, end.pos.x, end.pos.y, touch);
  await expect(page.getByTestId('connect-preview')).toBeVisible();
  await expect(page.getByTestId('connect-near')).toContainText('分岐でつなぐ');
  await page.screenshot({ path: evidence('p6-01-connect-near') });
  await page.getByTestId('connect-near').click();
  expect(await tees(page)).toBe(1);

  // 枝の区間を選んで、東側（分岐点）の端を外す
  await tapMm(page, 1000, 300, touch);
  await page.getByTestId('detach-end-b').or(page.getByTestId('detach-end-a')).first().click();
  expect(await tees(page)).toBe(0);
  // Undo で分岐に戻る
  await page.getByTestId('undo').click();
  expect(await tees(page)).toBe(1);
});
