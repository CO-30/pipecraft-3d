import { test, expect, type Page, type CDPSession } from '@playwright/test';

type Net = { nodes: Record<string, { id: string; kind: string; pos: { x: number; y: number; z: number } }>; segments: Record<string, { id: string; a: string; b: string }> };

const getNet = (page: Page) => page.evaluate(() => (window as any).__pc.getState().network as Net);
const evidence = (name: string) => `test-evidence/${test.info().project.name}-${name}.png`;

/** 平面座標(mm)→画面座標。既定ビュー: scale=0.08px/mm, 原点(40,360) を SVG 左上基準で */
async function planToScreen(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('plan').boundingBox())!;
  return { x: box.x + 40 + x * 0.08, y: box.y + 360 - y * 0.08 };
}

async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    (window as any).__pc.getState().load({ nodes: {}, segments: {} });
  });
  await expect(page.getByTestId('save-state')).toHaveText('保存済み');
}

/** マウス or タッチで折れ線をなぞる */
async function stroke(page: Page, pts: { x: number; y: number }[], touch: CDPSession | null) {
  const steps: { x: number; y: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    for (let k = 0; k <= 10; k++) steps.push({ x: pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * k) / 10, y: pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * k) / 10 });
  }
  if (touch) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: steps[0].x, y: steps[0].y, id: 1 }] });
    for (const p of steps.slice(1)) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(steps[0].x, steps[0].y);
    await page.mouse.down();
    for (const p of steps.slice(1)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();
  }
}

test.describe('技術検証', () => {
  let touch: CDPSession | null = null;
  test.beforeEach(async ({ page, context }, info) => {
    touch = info.project.name.startsWith('mobile') ? await context.newCDPSession(page) : null;
    await resetApp(page);
  });

  test('配管描画（直角補正）→分岐→削除→Undo がUIで成立する', async ({ page }) => {
    await page.getByTestId('tool-draw').click();
    // 少し傾いたL字を手描き → 直角に補正され 3000 + 2000 の2区間
    await stroke(page, [await planToScreen(page, 0, 0), await planToScreen(page, 3000, 120), await planToScreen(page, 3050, 2000)], touch);
    let net = await getNet(page);
    expect(Object.keys(net.segments)).toHaveLength(2);
    const total = Number(await page.getByTestId('total-length').textContent());
    expect(total).toBeGreaterThan(4800);
    expect(total).toBeLessThan(5200);
    expect(Object.values(net.nodes).some((n) => n.kind === 'elbow')).toBe(true);

    // 既存配管の途中からなぞる → 分岐（チーズ）
    await stroke(page, [await planToScreen(page, 1500, 0), await planToScreen(page, 1500, -1500)], touch);
    net = await getNet(page);
    expect(Object.values(net.nodes).filter((n) => n.kind === 'tee')).toHaveLength(1);
    expect(Object.keys(net.segments)).toHaveLength(4);
    await page.screenshot({ path: evidence('01-branch') });

    // 枝管を選択して「枝管ごと削除」（確認ダイアログあり）
    await page.getByTestId('tool-select').click();
    const p = await planToScreen(page, 1500, -1000);
    if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '枝管ごと削除' }).click();
    net = await getNet(page);
    expect(Object.values(net.nodes).filter((n) => n.kind === 'tee')).toHaveLength(0);
    expect(Object.keys(net.segments)).toHaveLength(2);

    await page.getByTestId('undo').click();
    net = await getNet(page);
    expect(Object.values(net.nodes).filter((n) => n.kind === 'tee')).toHaveLength(1);
  });

  test('2Dで点を動かすと3Dに反映、3Dで動かすと2Dに反映（同一データ）', async ({ page }, info) => {
    await page.getByTestId('tool-draw').click();
    await stroke(page, [await planToScreen(page, 0, 0), await planToScreen(page, 4000, 0)], touch);
    let net = await getNet(page);
    const endId = Object.values(net.nodes).find((n) => n.pos.x > 3000)!.id;

    // 2Dで端点をドラッグ
    await page.getByTestId('tool-select').click();
    await stroke(page, [await planToScreen(page, 4000, 0), await planToScreen(page, 4000, 2000)], touch);
    net = await getNet(page);
    expect(net.nodes[endId].pos.y).toBeGreaterThan(1800);

    // 3D表示へ（PCは2D+3D同時表示、スマホは切替）
    await page.getByRole('button', { name: info.project.name === 'pc-chrome' ? '2D+3D' : '3D', exact: true }).click();
    const canvas = page.locator('[data-testid=view3d] canvas');
    await expect(canvas).toBeVisible();
    await page.waitForFunction(() => !!(window as any).__pc3d);
    await page.waitForTimeout(500);
    await page.screenshot({ path: evidence('02-3d-after-2d-move') });

    // 3Dでその端点をドラッグ（水平面上）
    const box = (await canvas.boundingBox())!;
    const sp = await page.evaluate((id) => (window as any).__pc3d.project(id), endId);
    const from = { x: box.x + sp.x, y: box.y + sp.y };
    const to = { x: from.x - 60, y: from.y + 40 };
    const before = net.nodes[endId].pos;
    await stroke(page, [from, to], touch);
    net = await getNet(page);
    const after = net.nodes[endId].pos;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(200);
    expect(after.z).toBe(before.z);
    await page.waitForTimeout(300);
    await page.screenshot({ path: evidence('03-3d-move') });

    // 2Dに戻ると同じ位置に描かれている
    await page.getByRole('button', { name: '2D', exact: true }).click();
    const circle = page.locator(`[data-node="${endId}"]`);
    const cb = (await circle.boundingBox())!;
    const expected = await planToScreen(page, after.x, after.y);
    expect(Math.abs(cb.x + cb.width / 2 - expected.x)).toBeLessThan(2);
    expect(Math.abs(cb.y + cb.height / 2 - expected.y)).toBeLessThan(2);
  });

  test('2本指ピンチは拡大縮小のみで配管を描かない（スマホ）', async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('mobile'), 'タッチ端末のみ');
    await page.getByTestId('tool-draw').click();
    const c = await planToScreen(page, 2000, 0);
    await touch!.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x - 40, y: c.y, id: 1 }] });
    await touch!.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x - 40, y: c.y, id: 1 }, { x: c.x + 40, y: c.y, id: 2 }] });
    for (let k = 1; k <= 10; k++) {
      await touch!.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x - 40 - k * 6, y: c.y, id: 1 }, { x: c.x + 40 + k * 6, y: c.y, id: 2 }] });
    }
    await touch!.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(Object.keys((await getNet(page)).segments)).toHaveLength(0);
  });

  test('IndexedDBに自動保存され、再読み込み後も残る', async ({ page }) => {
    await page.getByTestId('tool-draw').click();
    await stroke(page, [await planToScreen(page, 0, 0), await planToScreen(page, 2500, 0)], touch);
    await expect(page.getByTestId('save-state')).toHaveText('保存済み');
    await page.reload();
    await expect(page.getByTestId('save-state')).toHaveText('保存済み');
    await expect(page.getByTestId('seg-count')).toHaveText('1');
  });
});
