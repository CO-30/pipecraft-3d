/**
 * 汚水・水・湯をまとめてつなぐ（案）。器具・メーター・給湯器・公共汚水マスを置いた家で 1 回押す →
 * 排水は公共マスまで、給水・給湯はヘッダーで、止水栓・通気弁も → 3D → 元に戻す 1 回で全部戻る。
 */
import { expect, test, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile, show, useTool } from './helpers';
import { supplyHouse } from '../src/model/testSupplyHouse';
import { placeFixture } from '../src/model/fixtures';

const state = (page: Page) => page.evaluate(() => {
  const d = (window as any).__pc.getState().doc;
  const segs = Object.values(d.network.segments) as any[];
  return { segs: segs.length, vents: segs.filter((s) => s.system === 'vent').length, aav: Object.values(d.network.nodes).filter((n: any) => n.fitting?.type === 'aav').length };
});

test('1 回で汚水・給水・給湯・止水栓・通気弁 → 元に戻す 1 回で戻る', async ({ page }) => {
  await freshApp(page);
  await createProject(page, 'まとめて');
  const h = supplyHouse();
  const doc = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1300 }).doc;
  await page.evaluate((d) => { const s = (window as any).__pc.getState(); s.newDoc(d, s.meta); }, doc);
  const before = await state(page);

  await useTool(page, 'fixture');
  await page.getByTestId('auto-connect').click();
  const notice = page.getByTestId('notice');
  await expect(notice).toContainText('公共汚水マス', { timeout: 15000 });
  for (const t of ['給水', '止水栓', '通気弁']) await expect(notice).toContainText(t);
  const after = await state(page);
  expect(after.segs).toBeGreaterThan(before.segs + 10);
  expect(after.aav).toBe(2);
  await page.screenshot({ path: evidence('autoconnect-01-plan') });
  await show(page, isMobile() ? '3D' : '2D+3D');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: evidence('autoconnect-02-3d') });

  await page.getByTestId('undo').click();
  expect(await state(page)).toEqual(before);
});
