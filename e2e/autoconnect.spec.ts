/**
 * 汚水・水・湯をまとめてつなぐ（案）。器具・メーター・給湯器・公共汚水マスを置いた家で 1 回押す →
 * 排水は公共マスまで、給水・給湯はヘッダーで、止水栓・通気弁も → 3D → 元に戻す 1 回で全部戻る。
 */
import { expect, test, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile, show, useTool } from './helpers';
import { supplyHouse } from '../src/model/testSupplyHouse';
import { placeFixture } from '../src/model/fixtures';

const state = (page: Page) => page.evaluate(() => {
  const d = (window as any).__pc.getState().doc;
  const segs = Object.values(d.network.segments) as any[];
  return { segs: segs.length, vents: segs.filter((s) => s.system === 'vent').length, aav: Object.values(d.network.nodes).filter((n: any) => n.fitting?.type === 'aav').length };
});

test('1 回で汚水・給水・給湯・止水栓・通気弁 → 元に戻す 1 回で戻る', async ({ page }) => {
  await freshApp(page);
  await createProject(page, 'まとめて');
  const h = supplyHouse();
  const doc = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1300 }).doc;
  await page.evaluate((d) => { const s = (window as any).__pc.getState(); s.newDoc(d, s.meta); }, doc);
  const before = await state(page);

  await useTool(page, 'fixture');
  await page.getByTestId('auto-connect').click();
  const notice = page.getByTestId('notice');
  await expect(notice).toContainText('公共汚水マス', { timeout: 15000 });
  for (const t of ['給水', '止水栓', '通気弁']) await expect(notice).toContainText(t);
  const after = await state(page);
  expect(after.segs).toBeGreaterThan(before.segs + 10);
  expect(after.aav).toBe(2);
  await page.screenshot({ path: evidence('autoconnect-01-plan') });
  await show(page, isMobile() ? '3D' : '2D+3D');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: evidence('autoconnect-02-3d') });

  await page.getByTestId('undo').click();
  expect(await state(page)).toEqual(before);
});

test('給水・給湯はヘッダー工法で、排水は VU（2026-11-14 の初期設定）。基礎貫通スリーブ・コーキング・ベンリカンが積算に入る', async ({ page }) => {
  await freshApp(page);
  await createProject(page, 'スリーブ');
  const h = supplyHouse();
  const doc = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1300 }).doc;
  await page.evaluate((d) => { const s = (window as any).__pc.getState(); s.newDoc(d, s.meta); }, doc);
  await useTool(page, 'fixture');
  await page.getByTestId('auto-connect').click();
  await expect(page.getByTestId('notice')).toContainText('ヘッダーでつなぎました', { timeout: 15000 });
  const headers = () => page.evaluate(() => Object.values((window as any).__pc.getState().doc.fixtures).filter((f: any) => f.type === 'waterHeader').length);
  expect(await headers()).toBeGreaterThan(0);

  await page.getByTestId('open-estimate').click();
  await page.getByTestId('tab-parts').click();
  await expect(page.getByTestId('kiso-table')).toContainText('基礎貫通スリーブ（排水用）');
  await expect(page.getByTestId('kiso-table')).toContainText('KSA');
  // 給水・給湯は外で立ち上げて基礎を抜ける（コーキング）。給湯器はベンリカン、立上りは φ40 さや管（2026-11-13）
  await expect(page.getByTestId('kiso-table')).toContainText('コーキング');
  await expect(page.getByTestId('kiso-table')).toContainText('ベンリカン');
  await expect(page.getByTestId('kiso-table')).toContainText('さや管');
  await page.screenshot({ path: evidence('autoconnect-03-kiso') });
  await page.getByTestId('tab-quote').click();
  await expect(page.getByTestId('quote-table')).toContainText('基礎貫通スリーブ');
  // 管種を決めていない排水は VU で積算する
  await expect(page.getByTestId('quote-table')).toContainText('VU');
});

test('ヘッダーの質問カード: やさしい言葉で理由と選択肢 →「置く」でヘッダーを置いてつなぐ', async ({ page }) => {
  await freshApp(page);
  await createProject(page, '質問');
  const h = supplyHouse();
  const doc = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1300 }).doc;
  await page.evaluate((d) => { const s = (window as any).__pc.getState(); s.newDoc(d, s.meta);}, doc);
  await page.evaluate(() => (window as any).__pc.setState({ questionDoc: (window as any).__pc.getState().doc, question: { id: 'header', title: '水を分ける部品「ヘッダー」を床下に置きますか？', why: 'テスト', options: [{ value: 'use', label: 'ヘッダーを置いてつなぐ', hint: '床下にヘッダーを置きます' }, { value: 'skip', label: '置かない（自分でつなぐ）', hint: 'いまの形のまま' }] } }));
  const card = page.getByTestId('question-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('ヘッダー');
  await page.screenshot({ path: evidence('autoconnect-04-question') });
  await page.getByTestId('question-use').click();
  await expect(card).toBeHidden();
  await expect.poll(() => page.evaluate(() => Object.values((window as any).__pc.getState().doc.fixtures).filter((f: any) => f.type === 'waterHeader').length)).toBeGreaterThan(0);
});
