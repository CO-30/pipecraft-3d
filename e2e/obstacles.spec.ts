import { test, expect, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, planToScreen, show, stroke, tap, touchSession } from './helpers';

const full = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);
const elevToScreen = (page: Page, u: number, v: number) => page.evaluate(async ([u, v]) => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  let prev = '';
  for (let i = 0; i < 30; i++) {
    await frame(); await frame();
    const p = (window as any).__elev.toScreen(u, v);
    const k = `${Math.round(p.x)},${Math.round(p.y)}`;
    if (k === prev) return p;
    prev = k;
  }
  return (window as any).__elev.toScreen(u, v);
}, [u, v] as const) as Promise<{ x: number; y: number }>;

test('梁にぶつかる配管を A 下をくぐる で回し、積算に「梁かわし 4」。別の配管は C 貫通で要確認', async ({ page }) => {
  await freshApp(page);
  await createProject(page, 'ぶつかりテスト', { floors: 2 });
  await show(page, '2D');
  const touch = await touchSession(page);
  await page.getByTestId('tool-select').click();
  await tap(page, await planToScreen(page, 4000, 0), touch);
  await page.getByTestId('wall-face').click();
  // 梁（1階の天井付近、u 1000〜5000、下がり 600）
  const pts = [];
  for (const [u, v] of [[1000, 2100], [5000, 2100], [5000, 2700], [1000, 2700], [1000, 2120]] as const) pts.push(await elevToScreen(page, u, v));
  await stroke(page, pts, touch);
  await page.getByTestId('build-beam').click();
  await page.getByTestId('build-ok').click();
  await page.getByTestId('elev-close').click();

  // 天井付近（床から 2400）に、梁を横切る給水管を2本（設定は共通ストアで）
  await page.evaluate(() => {
    const s = (window as any).__pc.getState();
    s.setDrawAttrs({ material: 'HIVP' }); // 塩ビ管（エルボで梁をかわす）。屋内の「自動」は PB（曲げ配管）になる
    s.drawPolyline([{ x: 2000, y: 2000, z: 2400 }, { x: 2000, y: -1000, z: 2400 }]);
    s.drawPolyline([{ x: 4000, y: 2000, z: 2400 }, { x: 4000, y: -1000, z: 2400 }]);
  });
  await expect(page.getByTestId('notice')).toContainText('梁にぶつかっています');

  await page.getByTestId('tool-select').click();
  await tap(page, await planToScreen(page, 2000, 1200), touch);
  await expect(page.getByTestId('avoid-panel')).toBeVisible();
  await page.screenshot({ path: evidence('ob-01-hit') });
  await page.getByTestId('avoid-square').click();
  let doc = await full(page);
  expect(Object.values(doc.network.nodes as Record<string, any>).filter((n) => n.avoid === 'beam')).toHaveLength(4);

  await tap(page, await planToScreen(page, 4000, 1200), touch);
  await page.getByTestId('avoid-sleeve').click();
  doc = await full(page);
  expect(Object.values(doc.network.segments as Record<string, any>).filter((s) => s.penetrations?.length)).toHaveLength(1);

  await page.getByTestId('open-estimate').click();
  await page.getByTestId('tab-parts').click();
  await expect(page.getByTestId('fitting-note').filter({ hasText: '梁かわし 4' })).toHaveCount(1);
  await expect(page.getByTestId('sleeve-note')).toBeVisible();
  await page.screenshot({ path: evidence('ob-02-parts') });
  await page.getByTestId('tab-issues').click();
  await expect(page.getByText('貫通（スリーブ）').first()).toBeVisible();
  await page.getByTestId('close-estimate').click();
  await show(page, '3D');
  await page.waitForTimeout(800);
  await page.screenshot({ path: evidence('ob-03-3d') });
});
