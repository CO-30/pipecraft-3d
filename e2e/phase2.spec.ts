import { test, expect, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile, planToScreen, show, state, stroke, strokeMm, tap, touchSession } from './helpers';

type Corner = { id: string; x: number; y: number };
const full = (page: Page) => page.evaluate(() => {
  const s = (window as any).__pc.getState();
  return { corners: s.doc.building.corners as Record<string, Corner>, walls: s.doc.building.walls as Record<string, { id: string; a: string; b: string }>, rooms: s.doc.building.rooms as Record<string, { id: string; name: string }>, past: s.past.length as number, selection: s.selection };
});
/** 東側の外壁（x=8000 の2角を結ぶ壁） */
const eastWall = (d: Awaited<ReturnType<typeof full>>) =>
  Object.values(d.walls).find((w) => d.corners[w.a].x === 8000 && d.corners[w.b].x === 8000)!;

async function on3D(page: Page, x: number, y: number, z: number) {
  const canvas = page.locator('[data-testid=view3d] canvas');
  const box = (await canvas.boundingBox())!;
  const sp = await page.evaluate(([x, y, z]) => (window as any).__pc3d.projectPoint(x, y, z), [x, y, z] as const);
  return { x: box.x + sp.x, y: box.y + sp.y };
}

test.describe('Phase 2 2D・3D編集連動', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('部屋を壁つきで分割→結合（2D）', async ({ page }) => {
    const touch = await touchSession(page);
    await createProject(page, '分割テスト');
    await show(page, '2D');
    // 部屋をタップして選択 → 分割ボタン
    await page.getByTestId('tool-select').click();
    await tap(page, await planToScreen(page, 2000, 3000), touch);
    await page.getByRole('button', { name: '✂ 分割' }).click();
    await strokeMm(page, [[4000, 500], [4000, 5500]], touch);
    let d = await full(page);
    expect(Object.keys(d.rooms)).toHaveLength(2);
    expect(Object.keys(d.walls)).toHaveLength(7); // 外壁4 → 南北が分割されて6 + 内壁1
    await page.screenshot({ path: evidence('p2-01-split') });

    // 結合: 片方の部屋を選択 → 結合 → もう片方をタップ
    await page.getByTestId('tool-select').click();
    await tap(page, await planToScreen(page, 2000, 3000), touch);
    await page.getByTestId('merge-room').click();
    await tap(page, await planToScreen(page, 6000, 3000), touch);
    d = await full(page);
    expect(Object.keys(d.rooms)).toHaveLength(1);
    expect(d.selection?.kind).toBe('room');
  });

  test('3Dで選択した壁をドラッグ→2Dにも反映、角ハンドルで壁長変更、タップだけでは履歴が増えない', async ({ page }) => {
    const touch = await touchSession(page);
    await createProject(page, '3D編集');
    await show(page, isMobile() ? '3D' : '2D+3D');
    await expect(page.locator('[data-testid=view3d] canvas')).toBeVisible();
    await page.waitForFunction(() => !!(window as any).__pc3d);
    await page.waitForTimeout(500);

    let d = await full(page);
    const w = eastWall(d);
    // 1) 3Dで壁をタップ → 選択
    const mid = await on3D(page, 8000, 3000, 1350);
    await tap(page, mid, touch);
    d = await full(page);
    expect(d.selection).toEqual({ kind: 'wall', id: w.id });

    // 2) tap selected wall in 3D adds no history（選択でパネルが伸びて3Dの表示サイズが変わるので位置を測り直す）
    await page.waitForTimeout(400);
    const midSel = await on3D(page, 8000, 3000, 1350);
    const past0 = d.past;
    await tap(page, midSel, touch);
    d = await full(page);
    expect(d.past).toBe(past0);

    // 3) 選択済みの壁をドラッグ（東へ）
    const mid2 = midSel;
    const east = await on3D(page, 9500, 3000, 1350);
    await stroke(page, [mid2, east], touch);
    d = await full(page);
    const xa = d.corners[w.a].x, xb = d.corners[w.b].x;
    expect(xa).toBe(xb);
    expect(xa).toBeGreaterThan(8500);
    expect(d.past).toBe(past0 + 1);
    expect(xa % 50).toBe(0);

    if (!isMobile()) {
      // 2D側の壁の線も同じ位置へ
      const line = page.locator(`[data-wall="${w.id}"] line`);
      const x1 = Number(await line.getAttribute('x1'));
      const svgBox = (await page.getByTestId('plan').boundingBox())!;
      const exp = await planToScreen(page, xa, 0);
      expect(Math.abs(svgBox.x + x1 - exp.x)).toBeLessThan(2);
    }
    await page.screenshot({ path: evidence('p2-02-3d-wall-move') });

    // 4) 角ハンドル（手前の南東角）をドラッグして南へ伸ばす
    const se = [d.corners[w.a], d.corners[w.b]].sort((p, q) => p.y - q.y)[0];
    const y0 = se.y;
    const from = await on3D(page, se.x, se.y, 1350);
    const to = await on3D(page, se.x, se.y - 1500, 1350);
    await stroke(page, [from, to], touch);
    d = await full(page);
    expect(d.corners[se.id].y).toBeLessThan(y0 - 500);
    expect(d.past).toBe(past0 + 2);

    // Undo で元に戻る（2回）
    await page.getByTestId('undo').click();
    await page.getByTestId('undo').click();
    d = await full(page);
    expect(d.corners[w.a].x).toBe(8000);
  });

  test('未選択の壁の上のドラッグは回転（壁は動かない）', async ({ page }) => {
    const touch = await touchSession(page);
    await createProject(page, '回転');
    await show(page, '3D');
    await page.waitForFunction(() => !!(window as any).__pc3d);
    await page.waitForTimeout(500);
    const before = await full(page);
    const mid = await on3D(page, 8000, 3000, 1350);
    await stroke(page, [mid, { x: mid.x + 80, y: mid.y }], touch);
    const after = await full(page);
    expect(after.corners).toEqual(before.corners);
    expect(after.past).toBe(before.past);
  });
});

test.describe('Phase 2 断面・階ごとの表示', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('水平断面・縦断面・この階だけ を切り替え、断面で消えた壁は選択できない', async ({ page }) => {
    const touch = await touchSession(page);
    await createProject(page, '断面', { floors: 2 });
    await show(page, '3D');
    await page.waitForFunction(() => !!(window as any).__pc3d);
    if (isMobile()) await page.getByTestId('toggle-vis').click();
    await page.getByTestId('section-z').click();
    let sec = await page.evaluate(() => (window as any).__pc.getState().section);
    expect(sec).toEqual({ mode: 'z', value: 1200 });
    await page.getByTestId('section-value').fill('600');
    sec = await page.evaluate(() => (window as any).__pc.getState().section);
    expect(sec.value).toBe(600);
    await page.getByTestId('floor-filter-activeOnly').click();
    await page.screenshot({ path: evidence('p2-03-section') });
    if (isMobile()) await page.getByTestId('toggle-vis').click();

    // 高さ 600mm で切ったので、高さ 2000mm の位置の壁はタップしても選択されない
    const canvas = page.locator('[data-testid=view3d] canvas');
    const box = (await canvas.boundingBox())!;
    const hi = await page.evaluate(() => (window as any).__pc3d.projectPoint(8000, 3000, 2000));
    await tap(page, { x: box.x + hi.x, y: box.y + hi.y }, touch);
    expect(await page.evaluate(() => (window as any).__pc.getState().selection)).toBeNull();
    const lo = await page.evaluate(() => (window as any).__pc3d.projectPoint(8000, 3000, 300));
    await tap(page, { x: box.x + lo.x, y: box.y + lo.y }, touch);
    expect((await page.evaluate(() => (window as any).__pc.getState().selection))?.kind).toBe('wall');

    if (isMobile()) await page.getByTestId('toggle-vis').click();
    await page.getByTestId('section-x').click();
    sec = await page.evaluate(() => (window as any).__pc.getState().section);
    expect(sec).toEqual({ mode: 'x', value: 4000 });
    await page.getByTestId('section-off').click();
  });
});
