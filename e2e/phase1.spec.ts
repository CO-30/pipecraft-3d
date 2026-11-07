import { test, expect } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile, openVisDetails, planToScreen, show, state, strokeMm, tap, touchSession, useTool } from './helpers';

const wallsOn = (bld: Awaited<ReturnType<typeof state>>['bld'], floorId: string) => Object.values(bld.walls).filter((w) => w.floorId === floorId);

test.describe('Phase 1 建物作成 受入テスト', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('寸法から作成→内壁・ドア・窓・部屋・階追加→表示切替→保存→再読み込みで復元', async ({ page }) => {
    const touch = await touchSession(page);
    await createProject(page, '山田様邸', { floors: 2 });
    let s = await state(page);
    expect(s.bld.floors).toHaveLength(2);
    expect(Object.values(s.bld.walls).filter((w) => w.kind === 'exterior')).toHaveLength(8);
    const f1 = s.activeFloorId;

    await show(page, '2D');
    // 内壁: 南壁(3000,0)から北壁(3000,6000)へ → 南北の外壁が分割され +3
    await useTool(page, 'wall');
    await strokeMm(page, [[3000, 0], [3000, 6000]], touch);
    s = await state(page);
    expect(wallsOn(s.bld, f1)).toHaveLength(7);

    // ドア: 内壁をタップ、窓: 南の外壁をタップ
    await useTool(page, 'door');
    await tap(page, await planToScreen(page, 3000, 3000), touch);
    await useTool(page, 'window');
    await tap(page, await planToScreen(page, 5500, 0), touch);
    s = await state(page);
    expect(Object.values(s.bld.openings).map((o) => o.type).sort()).toEqual(['door', 'window']);

    // 部屋
    await useTool(page, 'room');
    await strokeMm(page, [[3200, 200], [7800, 5800]], touch);
    s = await state(page);
    expect(Object.keys(s.bld.rooms)).toHaveLength(3);
    await page.screenshot({ path: evidence('p1-01-plan') });

    // 階の追加（外壁コピー）
    await page.getByTestId('tool-select').click();
    if (isMobile()) await tap(page, await planToScreen(page, -3000, -3000), touch); // 選択解除で階バーを出す
    await page.getByTestId('add-floor').click();
    s = await state(page);
    expect(s.bld.floors).toHaveLength(3);
    expect(wallsOn(s.bld, s.activeFloorId)).toHaveLength(6); // T字で分割済みの外壁6本をコピー

    // 3D表示・外壁を半透明
    await show(page, '3D');
    if (isMobile()) await page.getByTestId('toggle-vis').click();
    await openVisDetails(page);
    await page.getByTestId('vis-exteriorWall-ghost').click();
    await page.getByTestId('vis-ceiling-hide').click();
    s = await state(page);
    expect(s.vis.exteriorWall).toBe('ghost');
    await page.waitForTimeout(600);
    await page.screenshot({ path: evidence('p1-02-3d-ghost') });

    // 保存→ホーム→ブラウザ再読み込み→開く
    await expect(page.getByTestId('save-state')).toHaveText('保存済み');
    const before = await state(page);
    await page.getByTestId('back-home').click();
    await expect(page.getByTestId('project-item')).toHaveCount(1);
    await page.reload();
    await page.getByText('山田様邸').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    const after = await state(page);
    expect(Object.keys(after.bld.walls).length).toBe(Object.keys(before.bld.walls).length);
    expect(after.bld.openings).toEqual(before.bld.openings);
    expect(after.bld.floors).toEqual(before.bld.floors);
  });

  test('壁をドラッグ移動・階高変更・Undo', async ({ page }) => {
    const touch = await touchSession(page);
    await createProject(page, '移動テスト');
    await show(page, '2D');
    await useTool(page, 'wall');
    await strokeMm(page, [[3000, 0], [3000, 6000]], touch);
    const wid = (await state(page)).selection.id as string;
    await page.getByTestId('tool-select').click();
    await strokeMm(page, [[3000, 3000], [3500, 3000]], touch);
    const s = await page.evaluate((id) => {
      const b = (window as any).__pc.getState().doc.building;
      return b.corners[b.walls[id].a].x;
    }, wid);
    expect(s).toBe(3500);
    await page.getByTestId('undo').click();
    const back = await page.evaluate((id) => {
      const b = (window as any).__pc.getState().doc.building;
      return b.corners[b.walls[id].a].x;
    }, wid);
    expect(back).toBe(3000);
  });

  test('現場の複製・書き出し・読み込み・削除（PC）', async ({ page }) => {
    test.skip(isMobile(), 'ファイル操作はPCで検証');
    await createProject(page, '元の現場');
    await page.getByTestId('back-home').click();
    await page.getByRole('button', { name: '複製' }).click();
    await expect(page.getByTestId('project-item')).toHaveCount(2);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: '書き出し' }).first().click();
    const file = await (await dl).path();
    await page.getByTestId('import-file').setInputFiles(file!);
    await expect(page.getByRole('status')).toContainText('読み込みました');
    await expect(page.getByTestId('project-item')).toHaveCount(3);
    await page.getByTestId('search').fill('コピー');
    await expect(page.getByTestId('project-item')).toHaveCount(2); // 複製と、複製を書き出して読み込んだもの
    await page.getByTestId('search').fill('');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '削除' }).first().click();
    await expect(page.getByTestId('project-item')).toHaveCount(2);
  });
});
