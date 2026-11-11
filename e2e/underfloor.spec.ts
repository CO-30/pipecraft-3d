import { test, expect, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, planToScreen, show, strokeMm, tap, touchSession } from './helpers';

const tapMm = async (page: Page, x: number, y: number, touch: Awaited<ReturnType<typeof touchSession>>) => tap(page, await planToScreen(page, x, y), touch);
const doc = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);

test('床下: 接続口は給水=青・給湯=赤・排水=茶。床下を選んで洗面台の給水から描くと床下へ下ろして PB、外へ出ると HIVP に替わる', async ({ page }) => {
  await freshApp(page);
  await createProject(page, '床下テスト'); // 8000 × 6000 の家
  await show(page, '2D');
  const touch = await touchSession(page);
  await page.getByTestId('tool-fixture').click();
  await page.getByTestId('fixture-washbasin').click();
  await tapMm(page, 2000, 3000, touch);

  // 接続口の色
  const color = (sys: string) => page.locator(`[data-port-system="${sys}"]`).first().getAttribute('fill');
  expect(await color('water')).toBe('#2563eb');
  expect(await color('hotWater')).toBe('#dc2626');
  expect(await color('drain')).toBe('#92400e');

  // 「床下」を選ぶ（スマホは選択を外すと階のバーが出る）
  await page.evaluate(() => (window as any).__pc.getState().select(null));
  await page.getByTestId('underfloor-chip').click();
  await expect(page.getByTestId('underfloor-chip')).toHaveClass(/on/);
  await page.getByTestId('tool-pipe').click();
  await expect(page.getByTestId('draw-height')).toHaveValue('-300');
  await page.getByTestId('draw-system').selectOption('water');
  await expect(page.getByTestId('draw-material')).toHaveValue('');

  let d = await doc(page);
  const port = Object.values(d.network.nodes as Record<string, any>).find((n) => n.portId === 'water')!;
  await strokeMm(page, [[port.pos.x, port.pos.y], [port.pos.x, 1000], [-1500, 1000]], touch);
  d = await doc(page);
  const segs = Object.values(d.network.segments as Record<string, any>);
  const nodes = d.network.nodes as Record<string, any>;
  // 接続口から真下へ（床から 300mm 下まで）
  const riser = segs.find((s) => (s.a === port.id || s.b === port.id))!;
  const bottom = nodes[riser.a === port.id ? riser.b : riser.a];
  expect([bottom.pos.x, bottom.pos.y, bottom.pos.z]).toEqual([port.pos.x, port.pos.y, -300]);
  // 屋内は PB、外壁の外で HIVP に替わる
  const mats = new Set(segs.filter((s) => s.system === 'water').map((s) => s.material));
  expect(mats).toEqual(new Set(['PB保温5mm', 'HIVP']));
  await page.screenshot({ path: evidence('uf-01-underfloor') });

  await page.getByTestId('open-estimate').click();
  await page.getByTestId('tab-parts').click();
  await expect(page.getByTestId('parts-table')).toContainText('HIVP変換継手');
  await page.getByTestId('close-estimate').click();

  // 階を選び直すと床上に戻る
  await page.evaluate(() => (window as any).__pc.getState().select(null));
  await page.getByTestId('tool-select').click();
  await page.getByTestId('floor-chip').first().click();
  await expect(page.getByTestId('underfloor-chip')).not.toHaveClass(/on/);
  expect(await page.evaluate(() => (window as any).__pc.getState().drawHeight)).toBe(100);
});

test('床下: 給水ヘッダーを床下に置ける（出口が床から −300）。パネルで床上に戻せる', async ({ page }) => {
  await freshApp(page);
  await createProject(page, 'ヘッダー床下');
  await show(page, '2D');
  const touch = await touchSession(page);
  await page.getByTestId('underfloor-chip').click();
  await page.getByTestId('tool-fixture').click();
  await page.getByTestId('fixture-waterHeader').click();
  await tapMm(page, 3000, 3000, touch);
  let d = await doc(page);
  const f = Object.values(d.fixtures as Record<string, any>)[0];
  expect(f.params?.mountZ).toBe(-400);
  const out1 = Object.values(d.network.nodes as Record<string, any>).find((n) => n.fixtureId === f.id && n.portId === 'out1')!;
  expect(out1.pos.z).toBe(-300);
  await expect(page.locator(`[data-fixture="${f.id}"]`)).toHaveAttribute('data-under', '1');
  await expect(page.getByTestId('header-mount')).toBeVisible();
  await page.screenshot({ path: evidence('uf-02-header') });
  await page.getByRole('button', { name: '床上（標準）' }).click();
  d = await doc(page);
  expect(Object.values(d.network.nodes as Record<string, any>).find((n) => n.fixtureId === f.id && n.portId === 'out1')!.pos.z).toBe(400);
});
