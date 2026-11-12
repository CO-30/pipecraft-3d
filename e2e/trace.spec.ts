/**
 * ⑧ 系統をたどって強調。給水の管を選んで「この系統をたどる」→ 帯に系統・長さ・器具の数、2D で系統の管と器具が強調。
 * 器具からは系統ごと（給湯）にたどれる。「強調をやめる」で消える。
 */
import { expect, test, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile, show } from './helpers';
import { createBuildingFromDims } from '../src/model/building';
import { placeFixture, portNodes } from '../src/model/fixtures';
import { addPolyline, emptyNetwork } from '../src/model/network';
import type { Doc } from '../src/model/doc';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
function site(): { doc: Doc; water: string[]; hot: string; basin: string } {
  const building = createBuildingFromDims({ width: 9100, depth: 7280, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  let doc: Doc = { building, network: emptyNetwork(), fixtures: {} };
  const r = placeFixture(doc, building.floors[0].id, 'washbasin', { x: 6000, y: 3000 });
  doc = r.doc;
  const port = (id: string) => portNodes(doc.network, r.fixtureId!).find((n) => n.portId === id)!;
  const wp = port('water'), hp = port('hot');
  const w = addPolyline(doc.network, [v(1000, 1000, wp.pos.z), v(4000, 1000, wp.pos.z), wp.pos], { system: 'water', diameter: 20, material: 'HIVP' }, { endNodeId: wp.id });
  const h = addPolyline(w.net, [v(1000, 5000, hp.pos.z), hp.pos], { system: 'hotWater', diameter: 13, material: 'HTVP' }, { endNodeId: hp.id });
  const d = addPolyline(h.net, [v(500, 6500, -300), v(8000, 6500, -300)], { system: 'sewage', diameter: 100, material: 'VU' });
  return { doc: { ...doc, network: d.net }, water: w.segmentIds, hot: h.segmentIds[0], basin: r.fixtureId! };
}
const trace = (page: Page) => page.evaluate(() => (window as any).__pc.getState().trace);

test.describe('系統をたどる', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('給水をたどると系統の管・器具が強調され、長さと器具の数が出る。器具から給湯もたどれる', async ({ page }) => {
    await createProject(page, '系統');
    const s = site();
    await page.evaluate((x) => { const st = (window as any).__pc.getState(); st.newDoc(x, st.meta); }, s.doc);
    await show(page, '2D');
    await page.evaluate((id) => (window as any).__pc.getState().select({ kind: 'segment', id }), s.water[0]);

    await page.getByTestId('trace-system').click();
    const bar = page.getByTestId('trace-bar');
    await expect(bar).toBeInViewport(); // パネルを下へ送っていても見える
    await expect(bar).toContainText('給水');
    await expect(page.getByTestId('trace-fixtures')).toHaveText('1');
    const len = Number((await page.getByTestId('trace-length').textContent())!.replace('m', ''));
    expect(len).toBeGreaterThan(5.0);
    for (const id of s.water) await expect(page.locator(`[data-seg="${id}"]`)).toHaveAttribute('data-trace', '1');
    await expect(page.locator(`[data-seg="${s.hot}"]`)).not.toHaveAttribute('data-trace', '1');
    await expect(page.locator(`[data-fixture="${s.basin}"]`)).toHaveAttribute('data-trace', '1');
    await page.screenshot({ path: evidence('trace-01-water') });

    // 器具から給湯をたどる
    await page.evaluate((id) => (window as any).__pc.getState().select({ kind: 'fixture', id }), s.basin);
    await page.getByTestId('trace-hotWater').click();
    await expect(bar).toContainText('給湯');
    await expect(page.locator(`[data-seg="${s.hot}"]`)).toHaveAttribute('data-trace', '1');
    await expect(page.locator(`[data-seg="${s.water[0]}"]`)).not.toHaveAttribute('data-trace', '1');

    // 3D でも（系統の外は半透明）。帯は出たまま
    await show(page, isMobile() ? '3D' : '2D+3D');
    await expect(bar).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: evidence('trace-02-hot-3d') });

    await page.getByTestId('trace-clear').click();
    await expect(bar).toHaveCount(0);
    expect(await trace(page)).toBeNull();
  });

  test('たどり始めた管を消すと強調も消える', async ({ page }) => {
    await createProject(page, '系統2');
    const s = site();
    await page.evaluate((x) => { const st = (window as any).__pc.getState(); st.newDoc(x, st.meta); }, s.doc);
    await page.evaluate((id) => { const st = (window as any).__pc.getState(); st.setTrace(id); }, s.hot);
    await expect(page.getByTestId('trace-bar')).toContainText('給湯');
    await page.evaluate((id) => { const st = (window as any).__pc.getState(); st.select({ kind: 'segment', id }); st.deleteSelected(); }, s.hot);
    await expect(page.getByTestId('trace-bar')).toHaveCount(0);
  });
});
