/**
 * 積算の要確認（2026-11-16）: 配管・部品の確かめる所が先に 1 件ずつ、単価の未登録は 1 枚にまとめて「単価へ」で単価タブへ。
 * 開けば今までどおり 1 件ずつ。タブの数は配管・部品の確かめる所の数
 */
import { expect, test } from '@playwright/test';
import { createProject, evidence, freshApp } from './helpers';
import { addPolyline, emptyNetwork } from '../src/model/network';

const v = (x: number, y: number, z = -300) => ({ x, y, z });

test.describe('積算の要確認', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('単価の未登録はまとめて 1 枚。「単価へ」で単価タブ、「一覧」で 1 件ずつ', async ({ page }) => {
    await createProject(page, '要確認まとめ');
    const main = addPolyline(emptyNetwork(), [v(0, 0), v(1000, 0), v(2000, 0)], { system: 'water', diameter: 20, material: 'HIVP' });
    const net = addPolyline(main.net, [v(1000, 0), v(1866, 500)], { system: 'water', diameter: 20, material: 'HIVP' }, { startNodeId: main.nodeIds[1] }).net;
    await page.evaluate((n) => { const s = (window as any).__pc.getState(); s.newDoc({ ...s.doc, network: n }, s.meta); }, net);
    await page.getByTestId('open-estimate').click();
    await expect(page.getByTestId('tab-issues')).toHaveText('要確認(1)');
    await page.getByTestId('tab-issues').click();
    const list = page.getByTestId('issues');
    await expect(list.locator('li').first()).toContainText('部品の確定');
    const card = page.getByTestId('issue-prices');
    await expect(card).toContainText('単価が入っていない品目');
    await page.screenshot({ path: evidence('estimate-issues-01') });
    const before = await list.locator('li').count();
    await card.getByRole('button', { name: /一覧/ }).click();
    await expect.poll(() => list.locator('li').count()).toBeGreaterThan(before);
    await card.getByTestId('issue-go').click();
    await expect(page.getByTestId('tab-price')).toHaveClass(/on/);
  });
});
