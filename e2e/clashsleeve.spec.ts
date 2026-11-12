/**
 * 干渉の一覧・スリーブ表。家（2 階建て・基礎スラブ）で、床下の排水と給水が同じ高さで交わる（干渉）＋外から床下へ入る給水＋2 階への立て管。
 * 積算の要確認に「配管どうしの干渉」→「図面で選ぶ」でその区間が選ばれる。申請画面の「スリーブ表」→ 位置図と表 → PDF。
 */
import { expect, test, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile } from './helpers';
import { createBuildingFromDims } from '../src/model/building';
import { addPolyline, emptyNetwork } from '../src/model/network';
import type { Doc } from '../src/model/doc';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
function site(): Doc {
  const building = { ...createBuildingFromDims({ width: 9100, depth: 7280, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }), foundation: { slabTop: -450 } };
  let net = addPolyline(emptyNetwork(), [v(1000, 2000, -300), v(6000, 2000, -300)], { system: 'sewage', diameter: 100, material: 'VU' }).net;
  net = addPolyline(net, [v(-1000, 1000, -250), v(3000, 1000, -250), v(3000, 4000, -250)], { system: 'water', diameter: 20, material: 'HIVP' }).net; // 基礎の外周を通り、排水と交わる
  net = addPolyline(net, [v(5000, 5000, 500), v(5000, 5000, 4000)], { system: 'water', diameter: 20, material: 'HIVP' }).net; // 2 階の床
  return { building, network: net, fixtures: {} };
}
const sel = (page: Page) => page.evaluate(() => (window as any).__pc.getState().selection);

test.describe('干渉・スリーブ表', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('干渉は要確認から選べる。スリーブ表は位置図と表を PDF に', async ({ page }) => {
    await createProject(page, '干渉スリーブ');
    const d = site();
    await page.evaluate((x) => { const s = (window as any).__pc.getState(); s.newDoc(x, s.meta); }, d);
    const drain = Object.values(d.network.segments).find((s) => s.system === 'sewage')!.id;

    await page.getByTestId('open-estimate').click();
    await page.getByTestId('tab-issues').click();
    const item = page.locator('[data-testid="issues"] li').filter({ hasText: '配管どうしの干渉' });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('汚水φ100 と 給水φ20 がぶつかっています');
    await page.screenshot({ path: evidence('clash-01-issues') });
    await item.getByTestId('issue-go').click();
    await expect.poll(() => sel(page)).toEqual({ kind: 'segment', id: drain });

    await page.getByTestId('open-shinsei').click();
    await page.getByTestId('shinsei-kind-sleeve').click();
    const preview = page.getByTestId('shinsei-preview');
    await expect(preview).toContainText('スリーブ表 1階');
    await expect(preview).toContainText('基礎（外周）');
    await expect(preview).toContainText('スリーブ表 2階');
    await expect(page.getByTestId('shinsei-warnings')).toContainText('干渉が 1 か所');
    await page.screenshot({ path: evidence('clash-02-sleeve') });
    if (!isMobile()) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('shinsei-pdf').click()]);
      expect(dl.suggestedFilename()).toMatch(/スリーブ表.*\.pdf$/);
      if (test.info().project.name === 'pc-chrome') await dl.saveAs('test-evidence/pc-chrome-clash-03-sleeve.pdf');
    }
  });

  test('構造を通る配管が無ければ「スリーブはありません」', async ({ page }) => {
    await createProject(page, 'スリーブ無し', { blank: true });
    await page.getByTestId('open-shinsei').click();
    await page.getByTestId('shinsei-kind-sleeve').click();
    await expect(page.getByTestId('shinsei-error')).toContainText('スリーブ（配管が基礎・梁・壁・床を通る所）はありません');
    await expect(page.getByTestId('shinsei-pdf')).toBeDisabled();
  });
});
