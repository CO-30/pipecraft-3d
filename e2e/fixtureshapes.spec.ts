/**
 * 器具の形（2D の平面の記号・3D の部品）。水まわり・水栓・メーター・ヘッダー・電気などを並べ、
 * 2D では器具ごとに記号（2 つ以上の形）が描かれ、3D では器具が部品の組み合わせ（group）になっていることを確かめる。
 */
import { expect, test } from '@playwright/test';
import { createProject, evidence, freshApp, show } from './helpers';
import { createBuildingFromDims } from '../src/model/building';
import { emptyNetwork } from '../src/model/network';
import { placeFixture, type FixtureType } from '../src/model/fixtures';
import type { Doc } from '../src/model/doc';

const ROW1: [FixtureType, number, number, 0 | 90 | 180 | 270][] = [['toilet', 600, 6500, 0], ['washbasin', 1600, 6700, 0], ['kitchen', 3800, 6600, 0], ['washer', 6000, 6600, 0], ['waterHeater', 7200, 6800, 0]];
const ROW2: [FixtureType, number, number, 0 | 90 | 180 | 270][] = [['bathtub', 1200, 4200, 0], ['shower', 3000, 4300, 0], ['faucet', 4200, 4600, 0], ['mixFaucet', 4900, 4600, 0], ['aircon', 6500, 4700, 0], ['panel', 7700, 4700, 0]];
const ROW3: [FixtureType, number, number, 0 | 90 | 180 | 270][] = [['waterMeter', 800, 1500, 0], ['waterHeader', 2000, 1500, 0], ['hotWaterHeader', 3000, 1500, 0], ['pump', 4200, 1500, 0], ['outdoorFaucet', 5200, 1500, 0], ['toilet', 6500, 1500, 90], ['light', 7600, 1500, 0]];

function showroom(): Doc {
  let doc: Doc = { building: createBuildingFromDims({ width: 8500, depth: 7500, floors: 1, floorHeight: 2700, wallThickness: 150, slabThickness: 200 }), network: emptyNetwork(), fixtures: {} };
  const f = doc.building.floors[0].id;
  for (const [t, x, y, r] of [...ROW1, ...ROW2, ...ROW3]) doc = placeFixture(doc, f, t, { x, y }, r).doc;
  return doc;
}

test('器具は 2D で平面の記号、3D で部品の組み合わせ', async ({ page }) => {
  await freshApp(page);
  await createProject(page, '器具の形', { blank: true });
  const d = showroom();
  await page.evaluate((x) => { const s = (window as any).__pc.getState(); s.newDoc(x, s.meta); }, d);
  await show(page, '2D');
  for (const fx of Object.values(d.fixtures)) {
    const sym = page.locator(`[data-fixture="${fx.id}"] [data-symbol]`);
    await expect(sym).toHaveCount(1);
    expect(await sym.locator('> *').count()).toBeGreaterThanOrEqual(2);
  }
  await page.screenshot({ path: evidence('fixtureshapes-01-2d') });
  // 拡大して記号を見る（水まわりの列）
  const plan = page.getByTestId('plan');
  const box = (await plan.boundingBox())!;
  const toilet = Object.values(d.fixtures).find((x) => x.type === 'kitchen')!;
  const at = await page.evaluate(([x, y]) => (window as any).__plan.toScreen(x, y), [toilet.x - 1200, toilet.y - 300] as const) as { x: number; y: number };
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
  await page.screenshot({ path: evidence('fixtureshapes-01b-2d-zoom'), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  await show(page, '3D');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: evidence('fixtureshapes-02-3d') });
  const v = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.move(v.x + v.width * 0.48, v.y + v.height * 0.42);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(60); }
  await page.waitForTimeout(600);
  await page.screenshot({ path: evidence('fixtureshapes-02b-3d-zoom'), clip: { x: v.x, y: v.y, width: v.width, height: v.height } });
});
