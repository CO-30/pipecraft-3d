import { test, expect } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile, planToScreen, show, state, stroke, strokeMm, tap, touchSession } from './helpers';

test.describe('配管（Phase 0 技術検証の回帰）', () => {
  test.beforeEach(async ({ page }) => {
    await freshApp(page);
    await createProject(page, '配管テスト', { blank: true });
    await show(page, '2D');
  });

  test('配管描画（直角補正）→分岐→枝管ごと削除→Undo', async ({ page }) => {
    const touch = await touchSession(page);
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[0, 0], [3000, 120], [3050, 2000]], touch);
    let { net } = await state(page);
    expect(Object.keys(net.segments)).toHaveLength(2);
    expect(Object.values(net.nodes).some((n) => n.kind === 'elbow')).toBe(true);
    const total = Number(await page.getByTestId('total-length').textContent().catch(() => '0'));
    if (!isMobile()) { expect(total).toBeGreaterThan(4800); expect(total).toBeLessThan(5200); }

    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[1500, 0], [1500, -1500]], touch);
    ({ net } = await state(page));
    expect(Object.values(net.nodes).filter((n) => n.kind === 'tee')).toHaveLength(1);
    expect(Object.keys(net.segments)).toHaveLength(4);
    await page.screenshot({ path: evidence('pipe-01-branch') });

    await page.getByTestId('tool-select').click();
    await tap(page, await planToScreen(page, 1500, -700), touch);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '枝管ごと削除' }).click();
    ({ net } = await state(page));
    expect(Object.values(net.nodes).filter((n) => n.kind === 'tee')).toHaveLength(0);
    expect(Object.keys(net.segments)).toHaveLength(2);

    await page.getByTestId('undo').click();
    ({ net } = await state(page));
    expect(Object.values(net.nodes).filter((n) => n.kind === 'tee')).toHaveLength(1);
  });

  test('2Dで点を動かすと3Dに反映、3Dで動かすと2Dに反映（同一データ）', async ({ page }) => {
    const touch = await touchSession(page);
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[0, 0], [4000, 0]], touch);
    let { net } = await state(page);
    const endId = Object.values(net.nodes).find((n) => n.pos.x > 3000)!.id;

    await page.getByTestId('tool-select').click();
    await strokeMm(page, [[4000, 0], [4000, 2000]], touch);
    ({ net } = await state(page));
    expect(net.nodes[endId].pos.y).toBeGreaterThan(1800);

    await show(page, isMobile() ? '3D' : '2D+3D');
    const canvas = page.locator('[data-testid=view3d] canvas');
    await expect(canvas).toBeVisible();
    await page.waitForFunction(() => !!(window as any).__pc3d);
    await page.waitForTimeout(500);
    const box = (await canvas.boundingBox())!;
    const sp = await page.evaluate((id) => (window as any).__pc3d.project(id), endId);
    const from = { x: box.x + sp.x, y: box.y + sp.y };
    const before = net.nodes[endId].pos;
    await stroke(page, [from, { x: from.x - 60, y: from.y + 40 }], touch);
    ({ net } = await state(page));
    const after = net.nodes[endId].pos;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(200);
    expect(after.z).toBe(before.z);
    await page.screenshot({ path: evidence('pipe-02-3d-move') });

    await show(page, '2D');
    const cb = (await page.locator(`[data-node="${endId}"]`).boundingBox())!;
    const expected = await planToScreen(page, after.x, after.y);
    expect(Math.abs(cb.x + cb.width / 2 - expected.x)).toBeLessThan(2);
    expect(Math.abs(cb.y + cb.height / 2 - expected.y)).toBeLessThan(2);
  });

  test('2本指ピンチは拡大縮小のみで配管を描かない（スマホ）', async ({ page }) => {
    test.skip(!isMobile(), 'タッチ端末のみ');
    const touch = (await touchSession(page))!;
    await page.getByTestId('tool-pipe').click();
    const c = await planToScreen(page, 2000, 0);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x - 40, y: c.y, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x - 40, y: c.y, id: 1 }, { x: c.x + 40, y: c.y, id: 2 }] });
    for (let k = 1; k <= 10; k++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x - 40 - k * 6, y: c.y, id: 1 }, { x: c.x + 40 + k * 6, y: c.y, id: 2 }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(Object.keys((await state(page)).net.segments)).toHaveLength(0);
  });
});
