import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, type PDFPage } from 'pdf-lib';
import { evidence, isMobile, show, useTool } from './helpers';

const full = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);
const PT_MM = 25.4 / 72;
const PITCH = 910, W = 8 * PITCH, D = 6 * PITCH;

/** 図面座標(mm)で描く作り物の図面（A3 横）。scale: 1/n の n */
async function sheet(scale: number, draw: (d: { line(x1: number, y1: number, x2: number, y2: number, w?: number): void; wall(x1: number, y1: number, x2: number, y2: number, t?: number): void; text(x: number, y: number, s: string, size?: number): void }) => void, grid = true): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page: PDFPage = doc.addPage([1191, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const k = PT_MM * scale, ox = 250, oy = 200;
  const X = (x: number) => ox + x / k, Y = (y: number) => oy + y / k;
  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.5) => page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: w });
  const text = (x: number, y: number, s: string, size = 8) => page.drawText(s, { x: X(x) - font.widthOfTextAtSize(s, size) / 2, y: Y(y) - size / 2, size, font });
  const wall = (x1: number, y1: number, x2: number, y2: number, t = 120) => {
    const h = t / 2;
    if (y1 === y2) { line(x1, y1 - h, x2, y1 - h); line(x1, y1 + h, x2, y1 + h); } else { line(x1 - h, y1, x1 - h, y2); line(x1 + h, y1, x1 + h, y2); }
  };
  if (grid) {
    for (let i = 0; i < 9; i++) { text(i * PITCH, -1500, `X${i + 1}`); line(i * PITCH, -1200, i * PITCH, D + 1200, 0.1); }
    for (let j = 0; j < 7; j++) { text(-1500, j * PITCH, `Y${j + 1}`); line(-1200, j * PITCH, W + 1200, j * PITCH, 0.1); }
  }
  // 実際の図面のように、細い線（仕上げ・ハッチ）を多く入れる
  for (let i = 0; i < 300; i++) line(W + 3000 + (i % 30) * 40, i * 20, W + 3600 + (i % 30) * 40, i * 20, 0.1);
  draw({ line, wall, text });
  return Buffer.from(await doc.save());
}

const plan = () => sheet(100, ({ line, wall, text }) => {
  wall(0, D, W, D); wall(0, 0, 0, D); wall(W, 0, W, D);
  wall(0, 0, 1820, 0); wall(3640, 0, W, 0);
  line(1820, 0, 3640, 0, 0.1); line(1820, 30, 3640, 30, 0.1); // 窓
  wall(3640, 0, 3640, 910); wall(3640, 1820, 3640, D);
  line(3640, 910, 3640, 1820, 0.1); // ドア
  text(3000, -2600, 'S:1/100', 12);
  text(900, 4600, 'WC'); text(5500, 2500, 'LDK'); // 部屋の名前 → 器具の候補
});
const foundation = () => sheet(50, ({ wall, text }) => {
  wall(0, D, W, D, 150); wall(0, 0, W, 0, 150); wall(0, 0, 0, D, 150); wall(W, 0, W, D, 150);
  wall(3640, 0, 3640, 2730, 150); wall(3640, 3330, 3640, D, 150);
  text(3000, -2600, 'S:1/50', 12);
});
const elevation = () => sheet(100, ({ line, text }) => {
  text(0, 0, 'GL'); text(0, 550, '1FL'); text(900, 280, '550');
  line(-1000, 0, 9000, 0);
  text(3000, -2600, 'S:1/100', 12);
}, false);

async function createAuto(page: Page, name: string, files: { name: string; buffer: Buffer }[]) {
  await page.getByTestId('new-project').click();
  await page.getByTestId('np-name').fill(name);
  await page.getByTestId('np-mode-auto').click();
  await expect(page.getByTestId('np-create')).toBeDisabled(); // 図面を選ぶまで作れない
  await page.getByTestId('np-files').setInputFiles(files.map((f) => ({ ...f, mimeType: 'application/pdf' })));
  await expect(page.getByTestId('np-file-list').locator('li')).toHaveCount(files.length);
  await page.getByTestId('np-create').click();
}

test.describe('図面から自動で3Dにする', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('平面図・基礎伏図・立面図の PDF を選ぶと、壁・開口部・基礎の入った建物ができ、平面図が下に敷かれる', async ({ page }) => {
    await createAuto(page, '自動3Dテスト', [
      { name: '1階平面図.pdf', buffer: await plan() },
      { name: '基礎伏図.pdf', buffer: await foundation() },
      { name: '立面図.pdf', buffer: await elevation() },
    ]);
    const report = page.getByTestId('import-report');
    await expect(report).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ir-found')).toContainText('1階の壁 7 本・開口部 2 か所');
    await expect(page.getByTestId('ir-found')).toContainText('基礎の立上り 6 本');
    await expect(page.getByTestId('ir-found')).toContainText('GL+550mm');
    await expect(page.getByTestId('ir-sheets').locator('li')).toHaveCount(3);
    await page.screenshot({ path: evidence('planauto-report') });
    await page.getByTestId('ir-ok').click();
    await expect(report).toBeHidden();

    const doc = await full(page);
    const walls = Object.values(doc.building.walls) as { kind: string; thickness: number }[];
    expect(walls).toHaveLength(7);
    expect(walls.filter((w) => w.kind === 'interior')).toHaveLength(1);
    expect((Object.values(doc.building.openings) as { type: string }[]).map((o) => o.type).sort()).toEqual(['door', 'window']);
    const members = Object.values(doc.building.members) as { kind: string; z0: number; z1: number }[];
    expect(members).toHaveLength(6);
    expect(members.every((m) => m.kind === 'footing' && m.z0 === -550 && m.z1 === -150)).toBe(true);
    expect(doc.site.designGL).toBe(-550);
    // 平面図が実寸で壁に重なって敷かれている: X1-Y1 の交点（原点）が紙の (250pt, 下から 200pt)
    const [u] = Object.values(doc.underlays) as { scaled: boolean; mmPerPx: number; widthPx: number; heightPx: number; center: { x: number; y: number } }[];
    expect(u.scaled).toBe(true);
    const k = PT_MM * 100;
    expect(u.mmPerPx * u.widthPx).toBeCloseTo(1191 * k, -2);
    expect(u.center.x).toBeCloseTo((1191 / 2 - 250) * k, -2);
    expect(u.center.y).toBeCloseTo((842 / 2 - 200) * k, -2);

    await show(page, '2D');
    await page.screenshot({ path: evidence('planauto-2d') });
    await show(page, '3D');
    await page.waitForTimeout(800);
    await page.screenshot({ path: evidence('planauto-3d') });

    // 保存して開き直しても残る（保存形式に基礎の立上りが入る）
    await page.getByTestId('back-home').click();
    await page.getByText('自動3Dテスト').first().click();
    await expect(page.getByTestId('editor')).toBeVisible();
    expect(Object.keys((await full(page)).building.members)).toHaveLength(6);
  });

  test('器具の候補を確認して置き、真下に配管を落とす。取り消しで戻せる', async ({ page }) => {
    await createAuto(page, '器具の候補', [{ name: '1階平面図.pdf', buffer: await plan() }]);
    await expect(page.getByTestId('import-report')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ir-found')).toContainText('器具の候補 2 個（トイレ・キッチン）');
    const rows = page.getByTestId('ir-fixtures').locator('li');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('トイレ');
    await expect(rows.nth(0)).toContainText('「WC」の部屋');
    await page.getByTestId('ir-fx-1').uncheck(); // キッチンは置かない
    await expect(page.getByTestId('ir-ok')).toHaveText('器具 1 個を置いて閉じる');
    await page.screenshot({ path: evidence('planauto-fixtures') });
    await page.getByTestId('ir-ok').click();
    let doc = await full(page);
    const fx = Object.values(doc.fixtures) as { type: string; x: number; y: number; rotation: number }[];
    expect(fx.map((f) => f.type)).toEqual(['toilet']);
    // 「WC」の文字（900, 4600）にいちばん近い北の壁（y = 5460）ぎわ、奥を壁に向ける
    expect(fx[0].rotation).toBe(0);
    expect(Math.abs(fx[0].x - 900)).toBeLessThan(40);
    expect(Math.abs(fx[0].y - (5460 - 60 - 350))).toBeLessThan(40);
    expect(Object.keys(doc.network.segments)).toHaveLength(0);

    await useTool(page, 'fixture');
    await page.getByTestId('drop-depth').fill('400');
    await page.getByTestId('drop-depth').blur();
    await page.getByTestId('drop-run').click();
    doc = await full(page);
    const segs = Object.values(doc.network.segments) as { system: string; a: string; b: string }[];
    expect(segs.map((s) => s.system).sort()).toEqual(['sewage', 'water']);
    const low = (Object.values(doc.network.nodes) as { fixtureId?: string; pos: { z: number } }[]).filter((n) => !n.fixtureId);
    expect(low.map((n) => n.pos.z)).toEqual([-400, -400]);
    // もう一度押しても増えない
    await page.getByTestId('drop-run').click();
    expect(Object.keys((await full(page)).network.segments)).toHaveLength(2);
    await show(page, '3D');
    if (!isMobile()) await page.getByRole('button', { name: '設備だけ' }).click(); // スマホは 👁 の中
    await page.waitForTimeout(600);
    await page.screenshot({ path: evidence('planauto-drop-3d') });
    // 取り消し: 配管 → 器具 の順に戻る
    await page.getByTestId('undo').click();
    expect(Object.keys((await full(page)).network.segments)).toHaveLength(0);
    await page.getByTestId('undo').click();
    expect(Object.keys((await full(page)).fixtures)).toHaveLength(0);
    expect(Object.keys((await full(page)).building.walls)).toHaveLength(7);
  });

  test('平面図だけでも作れる。足りない図面は「確かめてほしいこと」に出る', async ({ page }) => {
    await createAuto(page, '平面図だけ', [{ name: '1階平面図.pdf', buffer: await plan() }]);
    await expect(page.getByTestId('import-report')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ir-check')).toContainText('基礎伏図が無い');
    await expect(page.getByTestId('ir-check')).toContainText('立面図が無い');
    expect(Object.keys((await full(page)).building.walls)).toHaveLength(7);
  });

  test('平面図が無いときは、工事を作らずに分かる文で知らせる。選んだ図面は残り、足して作り直せる', async ({ page }) => {
    await createAuto(page, '立面図だけ', [{ name: '立面図.pdf', buffer: await elevation() }]);
    await expect(page.getByRole('alert')).toContainText('平面図が見つかりませんでした');
    await expect(page.getByTestId('editor')).toHaveCount(0);
    // 入力と選んだ図面は残る → 平面図を足せばそのまま作れる
    await expect(page.getByTestId('np-name')).toHaveValue('立面図だけ');
    await expect(page.getByTestId('np-file-list').locator('li')).toHaveCount(1);
    await page.getByTestId('np-files').setInputFiles({ name: '1階平面図.pdf', mimeType: 'application/pdf', buffer: await plan() });
    await page.getByTestId('np-create').click();
    await expect(page.getByTestId('import-report')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ir-found')).toContainText('GL+550mm');
  });
});
