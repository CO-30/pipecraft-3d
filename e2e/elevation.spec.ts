import { test, expect, type Page } from '@playwright/test';
import { createProject, evidence, freshApp, planToScreen, show, stroke, tap, touchSession } from './helpers';

const full = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);
/** 立面座標→画面座標（レイアウトが落ち着くまで待つ） */
const elevToScreen = (page: Page, u: number, v: number) => page.evaluate(async ([u, v]) => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  let prev = '';
  for (let i = 0; i < 30; i++) {
    await frame(); await frame();
    const p = (window as any).__elev.toScreen(u, v);
    const k = `${Math.round(p.x)},${Math.round(p.y)}`;
    if (k === prev) return p;
    prev = k;
  }
  return (window as any).__elev.toScreen(u, v);
}, [u, v] as const) as Promise<{ x: number; y: number }>;

async function makeImage(page: Page, w: number, h: number): Promise<Buffer> {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d')!;
    x.fillStyle = '#d6d3d1'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#334155'; x.lineWidth = 4;
    for (let i = 0; i <= w; i += 40) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); }
    return c.toDataURL('image/jpeg').split(',')[1];
  }, [w, h] as const);
  return Buffer.from(b64, 'base64');
}

test('外壁の写真を立面図に敷き、なぞって縦管を描く（T字金具60mm → サドル直付けに切替）', async ({ page }) => {
  await freshApp(page);
  await createProject(page, '立面テスト', { floors: 3 });
  await show(page, '2D');
  const touch = await touchSession(page);
  const doc0 = await full(page);
  const south = Object.values(doc0.building.walls as Record<string, any>).find((w) => doc0.building.corners[w.a].y === 0 && doc0.building.corners[w.b].y === 0 && w.floorId === doc0.building.floors[0].id)!;
  const ax = doc0.building.corners[south.a].x, bx = doc0.building.corners[south.b].x;
  await page.getByTestId('tool-select').click();
  await tap(page, await planToScreen(page, (ax + bx) / 2, 0), touch);
  await page.getByTestId('wall-elevation').click();
  await expect(page.getByTestId('elev-dialog')).toBeVisible();
  await page.getByTestId('el-height').fill('9000');
  await expect(page.getByTestId('mount-tBracket')).toHaveClass(/on/);
  await expect(page.getByTestId('mount-standoff')).toHaveValue('60');
  await page.getByTestId('wp-file').setInputFiles({ name: '外壁.jpg', mimeType: 'image/jpeg', buffer: await makeImage(page, 900, 700) });
  await expect(page.getByTestId('wp-photo')).toBeVisible();
  await page.getByTestId('wp-rectify').click();
  await expect(page.getByTestId('el-face')).toBeVisible();
  await page.getByTestId('el-create').click();
  await expect(page.getByTestId('elev-view')).toBeVisible();
  await expect(page.getByTestId('elev-photo-img')).toBeVisible();
  await expect(page.getByTestId('elev-title')).toContainText('南面');

  // 屋上付近から地面近くまでなぞる → 縦管、続けて横へ
  const pts = [await elevToScreen(page, 1000, 8500), await elevToScreen(page, 1020, 400), await elevToScreen(page, 2500, 380)];
  await stroke(page, pts, touch);
  let doc = await full(page);
  const segs = Object.values(doc.network.segments as Record<string, any>);
  expect(segs).toHaveLength(2);
  expect(segs.every((s) => s.support === 'tBracket')).toBe(true);
  const ys = Object.values(doc.network.nodes as Record<string, any>).map((n) => n.pos.y);
  // 南の外壁（壁芯 y=0, 厚さ/2 外）から 60mm + 口径/2 外側
  const wallT = south.thickness;
  for (const y of ys) expect(y).toBeCloseTo(-(wallT / 2 + 60 + 10), 0);
  await page.screenshot({ path: evidence('el-01-draw') });

  // 取付をサドル直付けに → 壁に寄る
  await page.getByTestId('elev-settings').click();
  await page.getByTestId('mount-saddle').click();
  await expect(page.getByTestId('elev-msg')).toContainText('サドル直付け');
  doc = await full(page);
  for (const n of Object.values(doc.network.nodes as Record<string, any>)) expect(n.pos.y).toBeCloseTo(-(wallT / 2 + 10), 0);
  expect(Object.values(doc.network.segments as Record<string, any>).every((s) => s.support === 'saddle')).toBe(true);
  // T字金具 100mm に戻す
  await page.getByTestId('mount-tBracket').click();
  await page.getByTestId('mount-standoff').fill('100');
  await page.getByTestId('mount-standoff').press('Enter');
  doc = await full(page);
  for (const n of Object.values(doc.network.nodes as Record<string, any>)) expect(n.pos.y).toBeCloseTo(-(wallT / 2 + 100 + 10), 0);

  // 平面図に戻ると、壁の外に縦管が出ている（チップから立面を開き直せる）
  await expect(page.getByTestId('elev-settings')).toContainText('T字 100mm');
  await page.getByTestId('elev-close').click();
  await expect(page.getByTestId('elev-view')).toBeHidden();
  await page.getByTestId('elev-chip').first().click();
  await expect(page.getByTestId('elev-view')).toBeVisible();
});

test('壁がない現場は寸法だけで外壁を作って立面図で描ける', async ({ page }) => {
  await freshApp(page);
  await createProject(page, '立面白紙', { blank: true });
  await show(page, '2D');
  const touch = await touchSession(page);
  await page.getByTestId('elev-new').click();
  await page.getByTestId('el-width').fill('6000');
  await page.getByTestId('el-height').fill('6000');
  await page.getByTestId('mount-saddle').click();
  await page.getByTestId('el-create').click();
  await expect(page.getByTestId('elev-view')).toBeVisible();
  await stroke(page, [await elevToScreen(page, 3000, 5500), await elevToScreen(page, 3000, 500)], touch);
  const doc = await full(page);
  expect(Object.keys(doc.building.walls)).toHaveLength(1);
  const segs = Object.values(doc.network.segments as Record<string, any>);
  expect(segs).toHaveLength(1);
  expect(segs[0].support).toBe('saddle');
  expect(Object.values(doc.network.nodes as Record<string, any>).map((n) => Math.round(n.pos.z)).sort((a, b) => a - b)).toEqual([500, 5500]);
});
