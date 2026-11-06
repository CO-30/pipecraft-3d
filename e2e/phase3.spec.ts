import { test, expect, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, planToScreen, show, state, strokeMm, tap, touchSession } from './helpers';

type N = { id: string; kind: string; pos: { x: number; y: number; z: number }; floorId?: string; fixtureId?: string; portId?: string };
const full = (page: Page) => page.evaluate(() => {
  const s = (window as any).__pc.getState();
  return {
    nodes: s.doc.network.nodes as Record<string, N>,
    segs: s.doc.network.segments as Record<string, { id: string; a: string; b: string; system: string }>,
    fixtures: s.doc.fixtures as Record<string, { id: string; rotation: number }>,
    floors: s.doc.building.floors as { id: string; elevation: number }[],
    activeFloorId: s.activeFloorId as string,
    selection: s.selection as { kind: string; id: string } | null,
  };
});
const tapMm = async (page: Page, x: number, y: number, touch: Awaited<ReturnType<typeof touchSession>>) => tap(page, await planToScreen(page, x, y), touch);
const degree = (d: Awaited<ReturnType<typeof full>>, id: string) => Object.values(d.segs).filter((s) => s.a === id || s.b === id).length;
const tees = (d: Awaited<ReturnType<typeof full>>) => Object.values(d.nodes).filter((n) => n.kind === 'tee').length;

test.describe('Phase 3 配管・配線', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('端点を別の配管の上へドラッグして接続 → 切断 → Undo で順に元に戻る', async ({ page }) => {
    await createProject(page, '接続テスト', { blank: true });
    await show(page, '2D');
    const touch = await touchSession(page);
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[0, 0], [4000, 0]], touch);
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[2000, 4000], [2000, 2000]], touch);
    let d = await full(page);
    expect(Object.keys(d.segs)).toHaveLength(2);
    expect(tees(d)).toBe(0);

    await page.getByTestId('tool-select').click();
    await strokeMm(page, [[2000, 2000], [2000, 1000], [2000, 0]], touch);
    d = await full(page);
    expect(tees(d)).toBe(1);
    expect(Object.keys(d.segs)).toHaveLength(3);
    await page.screenshot({ path: evidence('p3-01-connect') });

    await tapMm(page, 3200, 0, touch);
    await page.getByTestId('cut-seg').click();
    d = await full(page);
    expect(Object.keys(d.segs)).toHaveLength(4);
    expect(Object.values(d.nodes).filter((n) => n.kind === 'end')).toHaveLength(5); // 両端2＋枝の先1＋切断した2

    await page.getByTestId('undo').click();
    d = await full(page);
    expect(Object.keys(d.segs)).toHaveLength(3);
    expect(tees(d)).toBe(1);
    await page.getByTestId('undo').click();
    d = await full(page);
    expect(Object.keys(d.segs)).toHaveLength(2);
    expect(tees(d)).toBe(0);
  });

  test('立て管: 1F の端点から「上の階へ」→ 2F でその上端から配管を続けて描ける', async ({ page }) => {
    await createProject(page, '立て管テスト', { floors: 2 });
    await show(page, '2D');
    const touch = await touchSession(page);
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[1000, 1000], [3000, 1000]], touch);
    await page.getByTestId('tool-select').click();
    await tapMm(page, 3000, 1000, touch);
    await page.getByTestId('riser-up').click();
    let d = await full(page);
    const [f1, f2] = d.floors;
    expect(d.activeFloorId).toBe(f2.id);
    const top = d.nodes[d.selection!.id];
    expect(top.floorId).toBe(f2.id);
    expect(top.pos.x).toBe(3000);
    expect(top.pos.z).toBeGreaterThan(f2.elevation);
    await expect(page.locator('[data-riser]')).toHaveCount(1);

    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[3000, 1000], [3000, 4000]], touch);
    d = await full(page);
    expect(Object.keys(d.segs)).toHaveLength(3);
    expect(degree(d, top.id)).toBe(2);
    await page.screenshot({ path: evidence('p3-02-riser-2f') });

    // 1F に戻っても立て管の記号が見える
    await page.getByTestId('tool-select').click();
    await page.getByTestId('floor-chip').first().click();
    expect((await full(page)).activeFloorId).toBe(f1.id);
    await expect(page.locator('[data-riser]')).toHaveCount(1);
  });

  test('他の階の配管はタップしても選択されず、上から描いてもつながらない', async ({ page }) => {
    await createProject(page, '階テスト', { floors: 2 });
    await show(page, '2D');
    const touch = await touchSession(page);
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[1000, 1000], [4000, 1000]], touch);
    await page.getByTestId('tool-select').click();
    await page.getByTestId('tool-select').click(); // ツールを押すと選択解除（スマホで階バーを出す）
    await page.getByTestId('floor-chip').nth(1).click();
    await tapMm(page, 2500, 1000, touch);
    expect((await full(page)).selection?.kind).not.toBe('segment'); // 下の階の配管ではなく、この階の部屋が選ばれる
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[1000, 1000], [1000, 3000]], touch);
    const d = await full(page);
    expect(Object.keys(d.segs)).toHaveLength(2);
    expect(Object.values(d.nodes).every((n) => degree(d, n.id) === 1)).toBe(true);
  });

  test('器具: トイレを置く → 給水口から配管 → 回転で配管の端が追従 → 削除しても配管は残る', async ({ page }) => {
    await createProject(page, '器具テスト', { blank: true });
    await show(page, '2D');
    const touch = await touchSession(page);
    await page.getByTestId('tool-fixture').click();
    await page.getByTestId('fixture-toilet').click();
    await tapMm(page, 2000, 2000, touch);
    let d = await full(page);
    const fid = Object.keys(d.fixtures)[0];
    expect(fid).toBeTruthy();
    const water = Object.values(d.nodes).find((n) => n.fixtureId === fid && n.portId === 'water')!;
    expect(water.pos).toEqual({ x: 2150, y: 2300, z: 150 });

    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[2150, 2300], [2150, 4000], [4500, 4000]], touch);
    d = await full(page);
    expect(degree(d, water.id)).toBe(1);

    await page.getByTestId('tool-fixture').click();
    await tapMm(page, 1900, 1800, touch); // 置いた器具をタップ → 選択
    await page.getByTestId('rotate-fixture').click();
    d = await full(page);
    expect(d.fixtures[fid].rotation).toBe(90);
    expect(d.nodes[water.id].pos).toEqual({ x: 1700, y: 2150, z: 150 });
    expect(degree(d, water.id)).toBe(1);
    await page.screenshot({ path: evidence('p3-03-fixture') });

    page.once('dialog', (dl) => dl.accept());
    await page.getByTestId('delete-fixture').click();
    d = await full(page);
    expect(Object.keys(d.fixtures)).toHaveLength(0);
    expect(Object.keys(d.segs)).toHaveLength(2);
    expect(d.nodes[water.id].fixtureId).toBeUndefined();
  });

  test('部品削除: エルボを消すと直線、バルブを入れて外す', async ({ page }) => {
    await createProject(page, '部品テスト', { blank: true });
    await show(page, '2D');
    const touch = await touchSession(page);
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[0, 0], [3000, 0], [3000, 3000]], touch);
    await page.getByTestId('tool-select').click();
    await tapMm(page, 3000, 0, touch);
    await expect(page.getByTestId('delete-fitting')).toBeEnabled();
    await page.getByTestId('delete-fitting').click();
    let d = await full(page);
    expect(Object.keys(d.segs)).toHaveLength(1);
    const len = Number(await page.getByTestId('total-length').textContent());
    expect(len).toBeGreaterThan(4100);
    expect(len).toBeLessThan(4400);

    await tapMm(page, 1500, 1500, touch);
    await page.getByTestId('add-valve').click();
    d = await full(page);
    expect(Object.values(d.nodes).filter((n) => n.kind === 'valve')).toHaveLength(1);
    expect(Object.keys(d.segs)).toHaveLength(2);
    await page.getByTestId('delete-fitting').click();
    d = await full(page);
    expect(Object.values(d.nodes).filter((n) => n.kind === 'valve')).toHaveLength(0);
    expect(Object.keys(d.segs)).toHaveLength(1);
  });

  test('3D で器具・配管・立て管が表示され、保存→再読み込みで復元', async ({ page }) => {
    await createProject(page, '3D表示テスト', { floors: 2 });
    await show(page, '2D');
    const touch = await touchSession(page);
    await page.getByTestId('tool-fixture').click();
    await page.getByTestId('fixture-washbasin').click();
    await tapMm(page, 6000, 4000, touch);
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[1000, 1000], [5900, 1000], [5900, 4200]], touch);
    await page.getByTestId('tool-select').click();
    await tapMm(page, 1000, 1000, touch);
    await page.getByTestId('riser-up').click();
    const before = await full(page);
    await expect(page.getByTestId('save-state')).toHaveText('保存済み');
    await show(page, '3D');
    await page.waitForTimeout(500);
    await page.screenshot({ path: evidence('p3-04-3d') });

    await page.reload();
    await page.getByText('3D表示テスト').first().click();
    await expect(page.getByTestId('editor')).toBeVisible();
    const after = await full(page);
    expect(Object.keys(after.fixtures)).toEqual(Object.keys(before.fixtures));
    expect(Object.keys(after.segs).sort()).toEqual(Object.keys(before.segs).sort());
    const { net } = await state(page);
    expect(Object.keys(net.nodes).length).toBe(Object.keys(before.nodes).length);
  });

  test('高さが違う配管の上で描き終えてもつながらない／同じ高さならつながる', async ({ page }) => {
    await createProject(page, '高さ違いテスト', { blank: true });
    await show(page, '2D');
    const touch = await touchSession(page);
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[0, 0], [4000, 0]], touch); // 床上 100mm
    await page.getByTestId('tool-select').click();
    await tapMm(page, 3000, 0, touch);
    await page.getByTestId('seg-height').fill('2600');
    await page.getByTestId('seg-height').press('Enter');
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[2000, 3000], [2000, 0]], touch);
    let d = await full(page);
    expect(tees(d)).toBe(0);
    expect(Object.keys(d.segs)).toHaveLength(2);
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[1000, 3000], [1000, 0]], touch);
    d = await full(page);
    expect(Object.keys(d.segs)).toHaveLength(3); // 床上の配管は z=100 → 天井の配管(2600)とは別
    expect(tees(d)).toBe(0);
  });

  test('小さい器具（コンセント）もタップで選択・移動できる', async ({ page }) => {
    await createProject(page, '小さい器具', { blank: true });
    await show(page, '2D');
    const touch = await touchSession(page);
    await page.getByTestId('tool-fixture').click();
    await page.getByTestId('fixture-outlet').click();
    await tapMm(page, 3000, 3000, touch);
    await page.getByTestId('tool-select').click();
    await tapMm(page, 3000, 3000, touch);
    let d = await full(page);
    expect(d.selection?.kind).toBe('fixture');
    await strokeMm(page, [[3000, 3000], [3500, 3000], [4000, 3000]], touch);
    d = await full(page);
    expect(Object.values(d.fixtures)[0]).toMatchObject({ x: 4000, y: 3000 });
    await page.getByTestId('port-power').click();
    expect((await full(page)).selection?.kind).toBe('node');
  });
});
