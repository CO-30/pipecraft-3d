/**
 * ⑨ 図面・3D にメモ。道具「メモ」で図面の空いた所・器具の上をタップして置く → 本文を書く → ピンと吹き出し。
 * 器具に付けたメモは器具を動かすとついてくる。済にすると一覧の「未対応だけ」から消える。3D に札。消す・元に戻す。
 */
import { expect, test, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile, planToScreen, show, stroke, tap, touchSession, useTool } from './helpers';
import { createBuildingFromDims } from '../src/model/building';
import { placeFixture } from '../src/model/fixtures';
import { emptyNetwork } from '../src/model/network';
import type { Doc } from '../src/model/doc';

function site(): { doc: Doc; toilet: string } {
  const building = createBuildingFromDims({ width: 9100, depth: 7280, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  const r = placeFixture({ building, network: emptyNetwork(), fixtures: {} }, building.floors[0].id, 'toilet', { x: 6000, y: 3000 });
  return { doc: r.doc, toilet: r.fixtureId! };
}
const notes = (page: Page) => page.evaluate(() => Object.values((window as any).__pc.getState().doc.notes ?? {}) as any[]);
/** 一覧を出す（スマホは「表示」のシート） */
async function openList(page: Page) {
  if (isMobile() && !(await page.getByTestId('notes-list').isVisible())) await page.getByTestId('toggle-vis').click();
  await expect(page.getByTestId('notes-list')).toBeVisible();
}

test.describe('メモ', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('空いた所と器具に置いて書く → ピン・吹き出し・一覧。器具を動かすとついてくる。済・絞り込み・3D の札・消す・元に戻す', async ({ page }) => {
    await createProject(page, '山田邸');
    const s = site();
    await page.evaluate((x) => { const st = (window as any).__pc.getState(); st.newDoc(x, st.meta); }, s.doc);
    await show(page, '2D');
    const touch = await touchSession(page);

    // 1) 空いた所に置く → すぐ書ける
    await useTool(page, 'note');
    await tap(page, await planToScreen(page, 2000, 2000), touch);
    await expect(page.getByTestId('note-editor')).toBeVisible();
    await expect(page.getByTestId('note-text')).toBeFocused(); // 置いたらすぐ書ける
    await page.getByTestId('note-text').fill('梁を避けて下から回す');
    // 書いたまま図面の空いた所をタップしても本文は残る
    await tap(page, await planToScreen(page, 3000, 5500), touch);
    await page.locator(`[data-testid="note-row"]`).count(); // 描画を待つ
    expect((await notes(page))[0]?.text).toBe('梁を避けて下から回す');
    await page.evaluate(() => { const st = (window as any).__pc.getState(); st.select({ kind: 'note', id: Object.keys(st.doc.notes)[0] }); });
    const n1 = (await notes(page))[0];
    expect(n1).toMatchObject({ text: '梁を避けて下から回す', x: 2000, y: 2000 });
    await expect(page.locator(`[data-note="${n1.id}"]`).first()).toBeVisible();
    await expect(page.getByTestId('note-balloon')).toContainText('梁を避けて下から回す');
    expect(await page.evaluate(() => (window as any).__pc.getState().tool)).toBe('select');

    // 2) 器具の上に置く → 器具に付く
    await useTool(page, 'note');
    await tap(page, await planToScreen(page, 6000, 3000), touch);
    await expect(page.getByTestId('note-editor')).toContainText('トイレに付けています');
    await page.getByTestId('note-text').fill('便器の位置 施主確認');
    await page.getByTestId('note-text').blur();
    const n2 = (await notes(page)).find((n) => n.target)!;
    expect(n2.target).toEqual({ kind: 'fixture', id: s.toilet });

    // 器具を動かすとついてくる
    await page.evaluate((id) => { const st = (window as any).__pc.getState(); st.beginDrag(); st.dragFixture(id, { x: 7000, y: 4000 }); st.endDrag(); }, s.toilet);
    expect((await notes(page)).find((n) => n.id === n2.id)).toMatchObject({ x: 7000, y: 4000 });

    // 3) 一覧: 数・済・未対応だけ
    await openList(page);
    await expect(page.getByTestId('notes-count')).toHaveText('未対応 2 / 全 2');
    await page.locator(`[data-testid="note-row"][data-note="${n1.id}"]`).click();
    await page.getByTestId('note-done').check();
    await expect(page.getByTestId('notes-count')).toHaveText('未対応 1 / 全 2');
    await page.getByTestId('notes-only-open').check();
    await expect(page.getByTestId('note-row')).toHaveCount(1);
    await page.screenshot({ path: evidence('notes-01-plan') });
    if (isMobile()) await page.getByTestId('toggle-vis').click();

    // 4) 3D の札（タップで選べる）
    await show(page, isMobile() ? '3D' : '2D+3D');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('note-tag')).toHaveCount(2, { timeout: 15000 });
    await page.locator(`[data-testid="note-tag"][data-note="${n2.id}"]`).click();
    await expect(page.getByTestId('note-editor')).toContainText('トイレに付けています');
    await page.waitForTimeout(500);
    await page.screenshot({ path: evidence('notes-02-3d') });

    // 5) 消す → 元に戻す
    await page.getByTestId('note-delete').click();
    expect(await notes(page)).toHaveLength(1);
    await page.getByTestId('undo').click();
    expect(await notes(page)).toHaveLength(2);
  });

  test('ピンをタップすると選ぶだけ（付けた先から外れない）。ドラッグすると動いて付けた先から外れる', async ({ page }) => {
    await createProject(page, 'ピン');
    const s = site();
    await page.evaluate((x) => { const st = (window as any).__pc.getState(); st.newDoc(x, st.meta); st.select({ kind: 'fixture', id: Object.keys(x.fixtures)[0] }); }, s.doc);
    await show(page, '2D');
    const touch = await touchSession(page);
    await page.getByTestId('note-add-sel').click();
    const id = (await notes(page))[0].id;
    await page.getByTestId('sel-clear').click();

    // メモの道具でなぞる（図面を動かす）だけなら置かない
    await useTool(page, 'note');
    const a = await planToScreen(page, 2000, 2000);
    await stroke(page, [a, { x: a.x + 80, y: a.y + 40 }], touch);
    expect(await notes(page)).toHaveLength(1);
    await useTool(page, 'select');

    // ピンの丸は指す点の少し上
    const p = await planToScreen(page, 6000, 3000);
    const pin = { x: p.x, y: p.y - 20 };
    await tap(page, pin, touch);
    await expect(page.getByTestId('note-editor')).toBeVisible();
    expect((await notes(page))[0].target).toEqual({ kind: 'fixture', id: s.toilet });

    await stroke(page, [pin, { x: pin.x - 120, y: pin.y + 60 }], touch);
    const n = (await notes(page))[0];
    expect(n.id).toBe(id);
    expect(n.target).toBeUndefined();
    expect(n.x).toBeLessThan(6000 - 500);
  });
});
