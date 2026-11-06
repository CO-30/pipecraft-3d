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

/** 立面に四角をなぞる */
async function rect(page: Page, u0: number, v0: number, u1: number, v1: number, touch: Parameters<typeof stroke>[2]) {
  const pts = [];
  for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0 + 20]] as const) pts.push(await elevToScreen(page, u, v));
  await stroke(page, pts, touch);
}

test('壁を正面に向けて 窓・軒・外階段・2階の押し込み を描く', async ({ page }) => {
  await freshApp(page);
  await createProject(page, '部材テスト', { floors: 2 });
  await show(page, '2D');
  const touch = await touchSession(page);
  await page.getByTestId('tool-select').click();
  await tap(page, await planToScreen(page, 4000, 0), touch);
  await page.getByTestId('wall-face').click();
  await expect(page.getByTestId('elev-view')).toBeVisible();
  await expect(page.getByTestId('elev-draw-build')).toHaveClass(/on/);

  // 窓
  await rect(page, 1000, 900, 2000, 2000, touch);
  await expect(page.getByTestId('elev-build-panel')).toBeVisible();
  await page.getByTestId('build-window').click();
  await expect(page.getByTestId('elev-msg')).toContainText('窓を作りました');

  // 軒（上端の帯 → 出幅 600）
  await rect(page, 200, 5500, 7800, 5800, touch);
  await page.getByTestId('build-eave').click();
  await expect(page.getByTestId('build-size')).toHaveValue('600');
  await page.getByTestId('build-ok').click();
  await expect(page.getByTestId('elev-msg')).toContainText('軒・庇を作りました');

  // 外階段（斜め線）
  await stroke(page, [await elevToScreen(page, 7600, 0), await elevToScreen(page, 4000, 2900)], touch);
  await page.getByTestId('build-stair').click();
  await expect(page.getByTestId('elev-msg')).toContainText('階段を作りました');

  // 2階だけ 910 押し込む
  await rect(page, 0, 3000, 8000, 5400, touch);
  await page.getByTestId('build-setback').click();
  await page.getByTestId('build-size').fill('910');
  await page.getByTestId('build-ok').click();
  await expect(page.getByTestId('elev-msg')).toContainText('押し込みを作りました');
  await page.screenshot({ path: evidence('mb-01-face') });

  const doc = await full(page);
  const ms = Object.values(doc.building.members as Record<string, any>);
  expect(ms.map((m) => m.kind).sort()).toEqual(['eave', 'stair']);
  expect(Object.values(doc.building.openings as Record<string, any>).map((o) => o.type)).toEqual(['window']);
  const f2 = doc.building.floors[1].id;
  const ys2 = Object.values(doc.building.corners as Record<string, any>).filter((c) => c.floorId === f2).map((c) => c.y);
  expect(Math.min(...ys2)).toBe(910);

  // 平面図で軒を選んで出幅を変える
  await page.getByTestId('elev-close').click();
  await page.getByRole('button', { name: '2階', exact: true }).first().click().catch(() => {});
  await show(page, '3D');
  await page.waitForTimeout(800);
  await page.screenshot({ path: evidence('mb-02-3d') });
});
