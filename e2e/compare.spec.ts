/**
 * ⑩ 保存した版との比較。版を残す → 管を足して器具を動かす → 今と比べる（帯の数・2D の色・一覧）→ 3D → 版に戻す → 元に戻す。
 */
import { expect, test, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile, show } from './helpers';
import { createBuildingFromDims } from '../src/model/building';
import { placeFixture } from '../src/model/fixtures';
import { addPolyline, emptyNetwork } from '../src/model/network';
import type { Doc } from '../src/model/doc';

const v = (x: number, y: number, z = 300) => ({ x, y, z });
function site(): { doc: Doc; basin: string } {
  const building = createBuildingFromDims({ width: 9100, depth: 7280, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  const r = addPolyline(emptyNetwork(), [v(1000, 1000), v(5000, 1000)], { system: 'water', diameter: 20, material: 'HIVP' });
  const p = placeFixture({ building, network: r.net, fixtures: {} }, building.floors[0].id, 'washbasin', { x: 6000, y: 4000 });
  return { doc: p.doc, basin: p.fixtureId! };
}
const segCount = (page: Page) => page.evaluate(() => Object.keys((window as any).__pc.getState().doc.network.segments).length);
async function openPanel(page: Page) {
  if (isMobile() && !(await page.getByTestId('versions').isVisible())) await page.getByTestId('toggle-vis').click();
  const d = page.getByTestId('versions');
  if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator('summary').click();
}
async function closePanel(page: Page) { if (isMobile()) await page.getByTestId('toggle-vis').click(); }

test.describe('版の比較', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('版を残す → 変える → 比べる（帯・2D・一覧・3D）→ 戻す → 元に戻す', async ({ page }) => {
    await createProject(page, '比較');
    const s = site();
    await page.evaluate((x) => { const st = (window as any).__pc.getState(); st.newDoc(x, st.meta); }, s.doc);
    await show(page, '2D');

    await openPanel(page);
    await page.getByTestId('version-name').fill('申請提出');
    await page.getByTestId('version-save').click();
    await expect(page.getByTestId('version-status')).toContainText('申請提出');
    await expect(page.getByTestId('version-row')).toHaveCount(1);
    await closePanel(page);

    // 管を 1 本足し、洗面台を動かす
    await page.evaluate((id) => {
      const st = (window as any).__pc.getState();
      st.drawPolyline([{ x: 5000, y: 1000, z: 300 }, { x: 5000, y: 3000, z: 300 }]);
      st.beginDrag(); st.dragFixture(id, { x: 7000, y: 4000 }); st.endDrag();
    }, s.basin);
    expect(await segCount(page)).toBe(2);

    await openPanel(page);
    await page.getByTestId('version-compare').click();
    await closePanel(page);
    const bar = page.getByTestId('compare-bar');
    await expect(bar).toBeVisible();
    await expect(page.getByTestId('compare-name')).toHaveText('申請提出');
    await expect(page.getByTestId('compare-added')).toHaveText('増えた 1');
    await expect(page.getByTestId('compare-removed')).toHaveText('なくなった 0');
    await expect(page.getByTestId('compare-changed')).toHaveText('変わった 1');
    await expect(page.getByTestId('compare-lengths')).toContainText('給水 +2.0m');
    await expect(page.locator('[data-seg][data-diff="added"]')).toHaveCount(1);
    await expect(page.locator(`[data-fixture="${s.basin}"]`)).toHaveAttribute('data-diff', 'changed');
    await expect(page.locator(`[data-diff-old="${s.basin}"]`)).toHaveAttribute('data-diff', 'from');
    await page.getByTestId('compare-list-toggle').click();
    await expect(page.getByTestId('compare-row')).toHaveCount(2);
    await page.locator('[data-testid="compare-row"][data-kind="added"]').click();
    expect(await page.evaluate(() => (window as any).__pc.getState().selection?.kind)).toBe('segment');
    await page.screenshot({ path: evidence('compare-01-plan') });

    await show(page, isMobile() ? '3D' : '2D+3D');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await expect(bar).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: evidence('compare-02-3d') });
    await show(page, '2D');

    // 戻す（2 回押して確定）→ 戻す前の状態も版に残る → 元に戻すで取り消せる
    await openPanel(page);
    await page.getByTestId('version-restore').first().click();
    await page.getByTestId('version-restore-ok').click();
    await expect(page.getByTestId('version-status')).toContainText('戻しました');
    expect(await segCount(page)).toBe(1);
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId('version-row')).toHaveCount(2);
    await expect(page.getByTestId('version-row').first()).toContainText('戻す前');
    await closePanel(page);
    await page.getByTestId('undo').click();
    expect(await segCount(page)).toBe(2);
  });
});
