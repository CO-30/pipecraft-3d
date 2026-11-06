import { expect, test, type CDPSession, type Page } from '@playwright/test';

export type Net = { nodes: Record<string, { id: string; kind: string; pos: { x: number; y: number; z: number } }>; segments: Record<string, { id: string; a: string; b: string }> };
export type Bld = { floors: { id: string }[]; walls: Record<string, { id: string; floorId: string; kind: string }>; openings: Record<string, { type: string }>; rooms: Record<string, unknown>; corners: Record<string, unknown> };

export const state = (page: Page) => page.evaluate(() => {
  const s = (window as any).__pc.getState();
  return { net: s.doc.network as Net, bld: s.doc.building as Bld, activeFloorId: s.activeFloorId as string, vis: s.visibility, selection: s.selection };
});
export const evidence = (name: string) => `test-evidence/${test.info().project.name}-${name}.png`;
export const isMobile = () => test.info().project.name.startsWith('mobile');

/** 共通座標(mm)→画面座標（PlanView の現在のビュー） */
export const planToScreen = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => (window as any).__plan.toScreen(x, y), [x, y] as const) as Promise<{ x: number; y: number }>;

export async function touchSession(page: Page): Promise<CDPSession | null> {
  return isMobile() ? page.context().newCDPSession(page) : null;
}

/** マウス or タッチで折れ線をなぞる */
export async function stroke(page: Page, pts: { x: number; y: number }[], touch: CDPSession | null) {
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

export async function tap(page: Page, p: { x: number; y: number }, touch: CDPSession | null) {
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/** 平面図上の2点(mm)をなぞる */
export async function strokeMm(page: Page, pts: [number, number][], touch: CDPSession | null) {
  const s = [];
  for (const [x, y] of pts) s.push(await planToScreen(page, x, y));
  await stroke(page, s, touch);
}

export async function freshApp(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases?.();
    for (const d of dbs ?? []) if (d.name) indexedDB.deleteDatabase(d.name);
  });
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible();
}

export async function createProject(page: Page, name: string, opts: { blank?: boolean; floors?: number } = {}) {
  await page.getByTestId('new-project').click();
  await page.getByTestId('np-name').fill(name);
  if (opts.blank) await page.getByRole('button', { name: '白紙から描く' }).click();
  if (opts.floors) await page.getByTestId('np-floors').fill(String(opts.floors));
  await page.getByTestId('np-create').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('project-name')).toHaveText(name);
}

export async function show(page: Page, layout: '2D' | '3D' | '2D+3D') {
  await page.getByRole('button', { name: layout, exact: true }).click();
}
