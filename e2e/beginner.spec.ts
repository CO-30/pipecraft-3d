/**
 * 初心者の操作シナリオ（依頼書のテスト1〜13）。説明を読まずに、画面の案内（手順ガイド・道具・候補ボタン）だけで進める。
 */
import { test, expect, type Page } from '@playwright/test';
import { evidence, freshApp, isMobile, planToScreen, strokeMm, tap, touchSession } from './helpers';

type Touch = Awaited<ReturnType<typeof touchSession>>;
const tapMm = async (page: Page, x: number, y: number, touch: Touch) => tap(page, await planToScreen(page, x, y), touch);
const doc = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);
const step = (page: Page) => page.getByTestId('guide-current').getAttribute('data-step');
const portId = (d: any, type: string, port: string) => {
  const f = Object.values(d.fixtures as Record<string, any>).find((x) => x.type === type)!;
  return (Object.values(d.network.nodes as Record<string, any>).find((n) => n.fixtureId === f.id && n.portId === port) as any).id as string;
};
const segCount = async (page: Page) => Object.keys((await doc(page)).network.segments).length;

async function placeFixture(page: Page, type: string, x: number, y: number, touch: Touch) {
  if (await page.getByTestId('sel-clear').isVisible()) await page.getByTestId('sel-clear').click();
  await page.getByTestId(`fixture-${type}`).click();
  await tapMm(page, x, y, touch);
  await expect(page.getByTestId('sel-bar')).toBeVisible(); // 置いた器具が「選択中」に出る
}

async function gotoFloor(page: Page, i: number) {
  if (await page.getByTestId('sel-clear').isVisible()) await page.getByTestId('sel-clear').click();
  await page.getByTestId('floor-chip').nth(i).click();
}

test.describe('初心者シナリオ', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('新規作成 → 間取り → メーター・屋上タンク・器具 → 配管 → 分岐・変更・削除・戻す → 実測 → 集計 → 3D → 保存・再読込', async ({ page }) => {
    const touch = await touchSession(page);
    await page.screenshot({ path: evidence('ux-after-01-home') });

    // テスト1: 新しい工事を作る（おすすめの「なぞって描く」・2階建て）
    await page.getByTestId('new-project').click();
    await page.getByTestId('np-name').fill('初心者テスト邸');
    await expect(page.getByTestId('np-mode-sketch')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('np-floors').fill('2');
    await page.getByTestId('np-create').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    expect(await step(page)).toBe('layout');
    await expect(page.getByTestId('plan-empty')).toBeVisible();
    await page.screenshot({ path: evidence('ux-after-02-new') });

    // テスト3: 図面なしで間取り（ガイドのボタン → 外周をなぞる）
    await page.getByTestId('guide-do').click();
    expect(await page.evaluate(() => (window as any).__pc.getState().tool)).toBe('outline');
    await strokeMm(page, [[0, 0], [0, 6000], [8000, 6000], [8000, 0], [0, 0]], touch);
    expect(Object.keys((await doc(page)).building.walls).length).toBeGreaterThanOrEqual(8);
    await page.getByTestId('dim-close').click();
    expect(await step(page)).toBe('fixtures');

    // テスト4・5: メーター、2階（最上階）に屋上タンク、1階にトイレ・洗面台
    await page.getByTestId('guide-do').click();
    await placeFixture(page, 'waterMeter', 600, 5200, touch);
    await gotoFloor(page, 1);
    await placeFixture(page, 'roofTank', 4000, 3000, touch);
    await gotoFloor(page, 0);
    await placeFixture(page, 'toilet', 6000, 1500, touch);
    await placeFixture(page, 'washbasin', 2000, 1500, touch);
    let d = await doc(page);
    expect(Object.values(d.fixtures as Record<string, any>).map((f) => f.type).sort()).toEqual(['roofTank', 'toilet', 'washbasin', 'waterMeter']);
    const tank = Object.values(d.fixtures as Record<string, any>).find((f) => f.type === 'roofTank');
    expect(tank.floorId).toBe(d.building.floors[1].id);
    expect(await step(page)).toBe('pipes');

    // テスト6: 屋上タンクを選び、候補ボタンで メーター出口 → タンク入口、タンク出口 → トイレ をつなぐ
    await page.getByTestId('guide-do').click();
    await page.getByTestId('tool-select').click();
    await gotoFloor(page, 1);
    await tapMm(page, 4000, 3000, touch);
    await expect(page.getByTestId('sel-bar')).toContainText('屋上タンク');
    const meterOut = portId(d, 'waterMeter', 'out'), toiletWater = portId(d, 'toilet', 'water');
    await page.getByTestId('port-connect').filter({ hasText: '入口から' }).locator(`[data-target="${meterOut}"]`).click();
    await page.getByTestId('port-connect').filter({ hasText: '出口から' }).locator(`[data-target="${toiletWater}"]`).click();
    d = await doc(page);
    const deg = (id: string) => Object.values(d.network.segments as Record<string, any>).filter((s) => s.a === id || s.b === id).length;
    for (const id of [meterOut, portId(d, 'roofTank', 'in'), portId(d, 'roofTank', 'out'), toiletWater]) expect(deg(id)).toBe(1);
    await page.screenshot({ path: evidence('ux-after-03-connected') });

    // テスト7: 1階の横引き管の途中からなぞって分岐 → 口径を変更 → 削除 → 戻す（テスト13）
    await gotoFloor(page, 0);
    await page.getByTestId('tool-pipe').click();
    const before = await segCount(page);
    await strokeMm(page, [[5400, 3000], [5400, 4500]], touch);
    d = await doc(page);
    const tees = Object.keys(d.network.nodes).filter((id) => Object.values(d.network.segments as Record<string, any>).filter((s) => s.a === id || s.b === id).length === 3);
    expect(tees.length).toBe(1);
    expect(await segCount(page)).toBe(before + 2); // 分けた本管 +1、枝管 +1
    await page.getByTestId('tool-select').click();
    await tapMm(page, 5400, 3750, touch);
    await expect(page.getByTestId('sel-bar')).toContainText('給水の配管');
    await page.getByTestId('seg-diameter').selectOption('20');
    await expect(page.getByTestId('sel-bar')).toContainText('φ20');
    const withBranch = await segCount(page);
    await page.getByTestId('delete-seg').click();
    expect(await segCount(page)).toBeLessThan(withBranch);
    await page.getByTestId('undo').click();
    expect(await segCount(page)).toBe(withBranch);

    // テスト8: ガイドの「配管長さの入力」→ 未入力の配管が選ばれる → 実測長
    await page.getByTestId('guide-toggle').click();
    await page.getByTestId('guide-step-lengths').click();
    await expect(page.getByTestId('jump-measure')).toBeVisible();
    await page.getByTestId('jump-measure').click();
    const measured = page.getByTestId('seg-measured');
    await measured.fill('3100');
    await measured.press('Enter');
    await expect(page.getByTestId('seg-used')).toContainText('実測 3100mm');

    // テスト9: 集計が 区間ごとの長さ（実測優先）の合計と一致
    d = await doc(page);
    const len = (s: any) => {
      const a = d.network.nodes[s.a].pos, b = d.network.nodes[s.b].pos;
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    };
    const byDia = new Map<number, number>();
    for (const s of Object.values(d.network.segments as Record<string, any>)) byDia.set(s.diameter, (byDia.get(s.diameter) ?? 0) + (s.measuredLength ?? len(s)));
    await page.getByTestId('guide-toggle').click();
    await page.getByTestId('guide-step-quantities').click();
    await expect(page.getByTestId('qty-table')).toBeVisible();
    await expect(page.getByTestId('tab-help')).toBeVisible();
    const used = await page.getByTestId('qty-used').allTextContents();
    expect(used).toEqual([...byDia.keys()].sort((a, b) => a - b).map((k) => `${Math.round(byDia.get(k)!)}mm`));
    await page.getByTestId('tab-parts').click();
    await expect(page.getByTestId('parts-table')).toContainText('チーズ');
    await page.screenshot({ path: evidence('ux-after-04-estimate') });
    await page.getByTestId('close-estimate').click();

    // テスト10: 3D でも表示（2D で描いた配管が同じデータで見える）
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.locator('.view3d canvas')).toBeVisible();
    await page.getByTestId('vis-preset-pipes').or(page.getByTestId('toggle-vis')).first().click();
    if (isMobile()) await page.getByTestId('vis-preset-pipes').click();
    expect((await page.evaluate(() => (window as any).__pc.getState().visibility)).exteriorWall).toBe('ghost');
    await page.waitForTimeout(500);
    await page.screenshot({ path: evidence('ux-after-05-3d') });

    // テスト11: 保存して開き直しても同じ
    const snap = await doc(page);
    await expect(page.getByTestId('save-state')).toContainText('保存済み');
    await page.reload();
    await page.getByText('初心者テスト邸').first().click();
    await expect(page.getByTestId('editor')).toBeVisible();
    const again = await doc(page);
    expect(Object.keys(again.network.segments).length).toBe(Object.keys(snap.network.segments).length);
    expect(Object.keys(again.fixtures).length).toBe(4);
    expect(Object.values(again.network.segments as Record<string, any>).filter((s) => s.measuredLength === 3100)).toHaveLength(1);

    // テスト12: スマホでも 戻す・やり直し が画面内、道具バーが横にはみ出さない
    const vp = page.viewportSize()!;
    for (const id of ['undo', 'redo', 'tool-building', 'tool-pipe']) {
      const bb = (await page.getByTestId(id).boundingBox())!;
      expect(bb.x + bb.width).toBeLessThanOrEqual(vp.width + 1);
      expect(bb.y + bb.height).toBeLessThanOrEqual(vp.height + 1);
    }
    expect(await page.locator('nav.toolbar').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(await page.locator('header').first().evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  });

  test('図面・写真から始める（テスト2）と、建物の道具の切り替え', async ({ page }) => {
    await page.getByTestId('new-project').click();
    await page.getByTestId('np-name').fill('写真から');
    await page.getByTestId('np-mode-photo').click();
    await page.getByTestId('np-create').click();
    await expect(page.getByTestId('underlay-panel')).toBeVisible();
    await expect(page.getByTestId('tool-building')).toHaveClass(/on/);
    const png = Buffer.from(await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300;
      const x = c.getContext('2d')!; x.fillStyle = '#e2e8f0'; x.fillRect(0, 0, 400, 300); x.strokeRect(40, 40, 320, 220);
      return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    await page.getByTestId('ul-image-file').setInputFiles({ name: '間取り.jpg', mimeType: 'image/png', buffer: png });
    await expect(page.locator('[data-underlay]')).toHaveCount(1);
    await page.getByTestId('guide-toggle').click();
    await expect(page.getByTestId('guide-step-drawing')).toContainText('✓');
    await page.getByTestId('guide-step-layout').click(); // 次の工程（間取り）へ
    expect(await page.evaluate(() => (window as any).__pc.getState().tool)).toBe('outline');
    // 建物の道具: 開く → 壁を選ぶと閉じる（図面を隠したままにしない）
    await page.getByTestId('tool-building').click();
    await expect(page.getByTestId('building-tools')).toBeVisible();
    await page.getByTestId('tool-wall').click();
    await expect(page.getByTestId('building-tools')).toBeHidden();
    expect(await page.evaluate(() => (window as any).__pc.getState().tool)).toBe('wall');
  });

  test('サンプル工事と使い方', async ({ page }) => {
    await page.getByTestId('open-help').click();
    await expect(page.getByTestId('help-dialog')).toContainText('作業の流れ');
    await page.getByTestId('help-close').click();
    await page.getByTestId('open-sample').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await expect(page.getByTestId('project-name')).toHaveText('サンプル工事（練習用）');
    expect(await step(page)).toBe('quantities');
    await expect(page.getByTestId('undo')).toBeDisabled(); // 練習用は「戻す」で消えない
    await page.screenshot({ path: evidence('ux-after-06-sample') });
    await page.getByTestId('guide-do').click();
    await expect(page.getByTestId('qty-table')).toBeVisible();
    expect(await page.getByTestId('qty-used').count()).toBeGreaterThanOrEqual(2);
    await page.getByTestId('close-estimate').click();
    // 一覧へ戻ると保存済みの工事に並ぶ
    await page.getByTestId('back-home').click();
    await expect(page.getByTestId('project-item')).toHaveCount(1);
  });
});

test.describe('レビュー対応', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('3Dだけの表示でもガイドのボタンで図面の見える表示に戻る・建物の道具の行は Esc / 外のタップ / 道具の変更で閉じる', async ({ page }) => {
    await page.getByTestId('new-project').click();
    await page.getByTestId('np-name').fill('表示テスト');
    await page.getByTestId('np-create').click();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.getByTestId('plan')).toHaveCount(0);
    await page.getByTestId('guide-do').click();
    await expect(page.getByTestId('plan')).toBeVisible();

    await page.getByTestId('tool-building').click();
    await expect(page.getByTestId('building-tools')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('building-tools')).toBeHidden();
    await page.getByTestId('tool-building').click();
    await page.getByTestId('guide-bar').click({ position: { x: 5, y: 5 } }); // 外をタップ
    await expect(page.getByTestId('building-tools')).toBeHidden();
    await page.getByTestId('tool-building').click();
    await page.evaluate(() => (window as any).__pc.getState().setTool('pipe')); // 別の所で道具が変わった
    await expect(page.getByTestId('building-tools')).toBeHidden();
  });

  for (const vp of [{ width: 320, height: 568, name: '小さいスマホ' }, { width: 740, height: 360, name: 'スマホ横向き' }]) {
    test(`${vp.name}（${vp.width}×${vp.height}）でも 戻す・やり直し に届き、図面が残る`, async ({ page }) => {
      test.skip(!isMobile(), 'スマホのみ');
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.getByTestId('open-sample').click();
      await expect(page.getByTestId('editor')).toBeVisible();
      for (const id of ['undo', 'redo']) {
        await page.getByTestId(id).scrollIntoViewIfNeeded();
        const bb = (await page.getByTestId(id).boundingBox())!;
        expect(bb.x + bb.width).toBeLessThanOrEqual(vp.width + 1);
        expect(bb.y + bb.height).toBeLessThanOrEqual(vp.height + 1);
      }
      const plan = (await page.getByTestId('plan').boundingBox())!;
      expect(plan.height).toBeGreaterThanOrEqual(vp.height * 0.3);
      await page.screenshot({ path: evidence(`ux-after-07-${vp.width}x${vp.height}`) });
    });
  }
});

test('キーボード: 作り方・配管の種類は矢印で選べる。表示プリセットは選択中が分かる。案内は✕で閉じる', async ({ page }) => {
  test.skip(isMobile(), 'PC のみ');
  await freshApp(page);
  await page.getByTestId('new-project').click();
  await page.getByTestId('np-name').fill('キーボード');
  await page.getByTestId('np-mode-sketch').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('np-mode-dims')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('np-mode-dims')).toBeFocused();
  await page.getByTestId('np-create').click();
  await page.getByTestId('tool-pipe').click();
  await page.getByTestId('sys-water').focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => (window as any).__pc.getState().drawAttrs.system)).toBe('hotWater');
  await expect(page.getByTestId('vis-preset-all')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('vis-preset-pipes').click();
  await expect(page.getByTestId('vis-preset-pipes')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('vis-preset-all')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('coach-close').click();
  await expect(page.getByTestId('plan-coach')).toHaveCount(0);
});
