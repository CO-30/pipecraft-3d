import { test, expect } from '@playwright/test';
import { createProject, evidence, freshApp, show, state, strokeMm, touchSession } from './helpers';

test.describe('なぞって描く（外形スケッチ→立体化→寸法入力）', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('2階建てを外周1周なぞって作り、実測寸法を順に入れる', async ({ page }) => {
    const touch = await touchSession(page);
    await createProject(page, '外形スケッチ', { sketch: true, floors: 2 });
    await show(page, '2D');
    await expect(page.getByTestId('tool-building')).toHaveClass(/on/);
    expect(await page.evaluate(() => (window as any).__pc.getState().tool)).toBe('outline');

    // ゆがんだ四角を1周（終点は始点の少し手前）
    await strokeMm(page, [[200, 300], [300, 5900], [8100, 6100], [7900, 100], [600, 200]], touch);
    let s = await state(page);
    expect(s.bld.floors).toHaveLength(2);
    expect(Object.values(s.bld.walls).filter((w) => w.kind === 'exterior')).toHaveLength(8);
    await expect(page.getByTestId('dim-wizard')).toBeVisible();
    await expect(page.locator('[data-testid="wall-dim"][data-unset="1"]')).toHaveCount(4);
    await page.screenshot({ path: evidence('sk-01-sketched') });

    // 上 → 右 を実測で入れると、下・左は自動計算になる
    await page.getByTestId('dim-value').fill('7280');
    await page.getByTestId('dim-next').click();
    await expect(page.getByTestId('dim-step')).toHaveText('2 / 4');
    await page.getByTestId('dim-value').fill('5460');
    await page.getByTestId('dim-next').click();
    await expect(page.getByTestId('dim-auto')).toBeVisible();
    await page.getByTestId('dim-next').click(); // 自動計算の値で確定
    await expect(page.getByTestId('dim-auto')).toBeVisible();
    await page.getByTestId('dim-next').click();
    await expect(page.getByTestId('dim-done')).toBeVisible();

    s = await state(page);
    const lens = await page.evaluate(() => {
      const b = (window as any).__pc.getState().doc.building;
      return Object.values(b.walls).map((w: any) => {
        const A = b.corners[w.a], B = b.corners[w.b];
        return Math.round(Math.hypot(A.x - B.x, A.y - B.y));
      }).sort();
    });
    expect(lens).toEqual([5460, 5460, 5460, 5460, 7280, 7280, 7280, 7280]);
    expect(await page.evaluate(() => Object.values((window as any).__pc.getState().doc.building.walls).every((w: any) => w.lengthSet !== false))).toBe(true);
    await page.screenshot({ path: evidence('sk-02-dims') });

    // 決まっている辺に違う実測 → 形が閉じない警告
    await page.getByTestId('dim-value').fill('7300');
    await page.getByTestId('dim-next').click();
    await expect(page.getByTestId('dim-conflict')).toContainText('20mm');
    await page.screenshot({ path: evidence('sk-03-conflict') });
    await page.getByTestId('dim-close').click();
    await expect(page.getByTestId('dim-wizard')).toHaveCount(0);

    // 3D で 2 階分の外壁
    await show(page, '3D');
    await page.waitForTimeout(800);
    await page.screenshot({ path: evidence('sk-04-3d') });
  });
});
