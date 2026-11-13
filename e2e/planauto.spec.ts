import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';
import { evidence, isMobile, show, useTool } from './helpers';

const full = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);
const PT_MM = 25.4 / 72;
const PITCH = 910, W = 8 * PITCH, D = 6 * PITCH;

/** 図面座標(mm)で描く作り物の図面（A3 横）。scale: 1/n の n */
async function sheet(scale: number, draw: (d: { line(x1: number, y1: number, x2: number, y2: number, w?: number): void; wall(x1: number, y1: number, x2: number, y2: number, t?: number): void; text(x: number, y: number, s: string, size?: number): void }) => void, grid = true): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page: PDFPage = doc.addPage([1191, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // 日本語の文字（「基礎天端」など）はアプリと同じ日本語フォントで書く
  doc.registerFontkit(fontkit);
  const jp = await doc.embedFont(readFileSync('public/fonts/NotoSansJP-JIS.ttf'), { subset: true });
  const fontOf = (s: string) => (/[^\x20-\x7e]/.test(s) ? jp : font);
  const k = PT_MM * scale, ox = 250, oy = 200;
  const X = (x: number) => ox + x / k, Y = (y: number) => oy + y / k;
  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.5) => page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: w });
  const text = (x: number, y: number, s: string, size = 8) => page.drawText(s, { x: X(x) - fontOf(s).widthOfTextAtSize(s, size) / 2, y: Y(y) - size / 2, size, font: fontOf(s) });
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
  text(1800, 2850, '基礎天端'); text(1800, 2550, '-350'); // 区画のスラブの高さの印（基礎天端の 350 下）
});
const elevation = () => sheet(100, ({ line, text }) => {
  text(0, 0, 'GL'); text(0, 550, '1FL'); text(900, 280, '550');
  line(-1000, 0, 9000, 0);
  text(3000, -2600, 'S:1/100', 12);
}, false);

/** 配置図（1/100、通り芯なし）: 家の外形（外壁の外面）、凡例、北の汚水桝 3・公共桝、東の雨水桝、WM、敷地の高さ */
const sitePlan = () => sheet(100, ({ line, text }) => {
  const box = (cx: number, cy: number, z: number, cross: boolean) => {
    const h = z / 2;
    line(cx - h, cy - h, cx + h, cy - h, 0.24); line(cx + h, cy - h, cx + h, cy + h, 0.24); line(cx + h, cy + h, cx - h, cy + h, 0.24); line(cx - h, cy + h, cx - h, cy - h, 0.24);
    if (cross) { line(cx - h, cy - h, cx + h, cy + h, 0.24); line(cx - h, cy + h, cx + h, cy - h, 0.24); }
  };
  for (const [x1, y1, x2, y2] of [[-60, -60, W + 60, -60], [W + 60, -60, W + 60, D + 60], [W + 60, D + 60, -60, D + 60], [-60, D + 60, -60, -60]]) line(x1, y1, x2, y2, 0.38);
  const lx = -6000; // 紙の中（左の余白）
  box(lx, 9000, 200, false); box(lx, 9000, 150, true); text(lx + 2500, 9000, '汚水 公共桝');
  box(lx, 8500, 150, true); text(lx + 2500, 8500, '汚水桝');
  box(lx, 8000, 150, false); text(lx + 2500, 8000, '雨水桝');
  for (const x of [1000, 3000, 5000]) box(x, D + 600, 150, true);
  box(-1500, D + 600, 200, false); box(-1500, D + 600, 150, true);
  box(W + 600, 1000, 150, false);
  text(-800, -800, 'WM');
  text(W / 2, D + 900, 'GL±0'); text(-1000, D + 900, 'GL-500'); text(-2500, D + 900, 'GL-950');
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
    // 基礎天端（標準 GL+400）の 350 下 = 床下の底 GL+50
    await expect(page.getByTestId('ir-found')).toContainText('床下の底（基礎のスラブの上）は GL+50mm');
    await expect(page.getByTestId('ir-sheets').locator('li')).toHaveCount(3);
    await page.screenshot({ path: evidence('planauto-report') });
    await page.getByTestId('ir-ok').click();
    await expect(report).toBeHidden();

    const doc = await full(page);
    const walls = Object.values(doc.building.walls) as { id: string; kind: string; thickness: number; locked?: boolean }[];
    expect(walls).toHaveLength(7);
    expect(walls.filter((w) => w.kind === 'interior')).toHaveLength(1);
    // 読み取った壁はロック（2026-11-13）: 選ぶと 🔒 にチェック、削除は押せない。外すと消せる
    expect(walls.every((w) => w.locked)).toBe(true);
    await page.evaluate((id) => (window as any).__pc.getState().select({ kind: 'wall', id }), walls[0].id);
    await expect(page.getByTestId('wall-lock')).toBeChecked();
    await page.getByTestId('wall-lock').uncheck();
    expect(await page.evaluate((id) => (window as any).__pc.getState().doc.building.walls[id].locked, walls[0].id)).toBeFalsy();
    await page.getByTestId('wall-lock').check();
    await page.evaluate(() => (window as any).__pc.getState().select(null));
    expect((Object.values(doc.building.openings) as { type: string }[]).map((o) => o.type).sort()).toEqual(['door', 'window']);
    const members = Object.values(doc.building.members) as { kind: string; z0: number; z1: number }[];
    expect(members).toHaveLength(6);
    expect(members.every((m) => m.kind === 'footing' && m.z0 === -550 && m.z1 === -150)).toBe(true);
    expect(doc.site.designGL).toBe(-550);
    expect(doc.building.foundation).toEqual({ slabTop: -500 });
    // 高さの並びを階の設定に出す。床下は「基礎の中・地面より上」
    if (await page.getByTestId('floor-settings').isVisible()) await page.getByTestId('floor-settings').click();
    await expect(page.getByTestId('floor-levels')).toHaveText('1階の床 GL+550・基礎天端 GL+400・床下の底 GL+50');
    await page.getByTestId('underfloor-chip').click();
    await expect(page.getByTestId('plan-caption')).toContainText('GL+50〜GL+400 の基礎の中・地面より上');
    await page.screenshot({ path: evidence('planauto-underfloor-levels') });
    await page.getByTestId('floor-chip').first().click();
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
    // 3D の地面は 1 階の床ではなく設計 GL（床下が地下に見えない）
    await expect(page.getByTestId('view3d')).toHaveAttribute('data-ground-z', '-550');
    await page.waitForTimeout(800);
    await page.screenshot({ path: evidence('planauto-3d') });

    // 保存して開き直しても残る（保存形式に基礎の立上りが入る）
    await page.getByTestId('back-home').click();
    await page.getByText('自動3Dテスト').first().click();
    await expect(page.getByTestId('editor')).toBeVisible();
    expect(Object.keys((await full(page)).building.members)).toHaveLength(6);
    expect((await full(page)).building.foundation).toEqual({ slabTop: -500 });
  });

  test('器具の候補を確認して置き、真下に配管を落とし、排水を外の桝までつなぐ。取り消しで戻せる', async ({ page }) => {
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
    await page.getByTestId('drop-depth').fill('400'); // 打ってすぐ押しても、打った深さで落ちる
    await page.getByTestId('drop-run').click();
    doc = await full(page);
    const segs = Object.values(doc.network.segments) as { system: string; a: string; b: string }[];
    expect(segs.map((s) => s.system).sort()).toEqual(['sewage', 'water']);
    const low = (Object.values(doc.network.nodes) as { fixtureId?: string; pos: { z: number } }[]).filter((n) => !n.fixtureId);
    expect(low.map((n) => n.pos.z)).toEqual([-400, -400]);
    // もう一度押しても増えない
    await page.getByTestId('drop-run').click();
    expect(Object.keys((await full(page)).network.segments)).toHaveLength(2);
    // 排水を外の桝までつなぐ（案）: 便器は北の壁に近く（芯から 360）、前澤 KSA の土間の口（外の面から 255 + H 内）より壁側なので、
    // 西の外壁から出す。床下を水平に土間の口へ → 45° で下り → 基礎を水平に抜けて外の汚水マスへ
    await page.getByTestId('drain-route').click();
    await expect(page.locator('.toast.notice')).toContainText('排水 1 本を外の汚水マス（新しく 1 個）へつなぎました');
    doc = await full(page);
    const mh = (Object.values(doc.fixtures) as { type: string; x: number; y: number }[]).filter((f) => f.type === 'manholeSewage');
    expect(mh).toHaveLength(1);
    expect(mh[0].x).toBe(-60 - 700);
    expect(Math.abs(mh[0].y - 5100)).toBeLessThan(200);
    // 落とした 2 本 + 床下の横 + 45° + 基礎を抜けてマスへ（GL が仮なので外の口は GL−370 より深く、外で落とさない）
    expect(Object.keys(doc.network.segments)).toHaveLength(5);
    // 基礎貫通スリーブ（KSA）の形: 基礎の内側で 45° で下り、地中で基礎を抜けてマスへ。建物の外（西の外壁より外）に配管の点は無い。地面より下の点は管頂の土かぶり 20cm 以上
    const gl = doc.site?.designGL ?? 0; // この工事は立面図が無いので GL は仮（床の高さ）
    const nodes = (Object.values(doc.network.nodes) as { pos: { y: number; z: number }; fixtureId?: string }[]).filter((n) => !n.fixtureId);
    expect(nodes.filter((n) => (n.pos as { x?: number }).x! < -60)).toHaveLength(0);
    expect(nodes.filter((n) => n.pos.z < gl - 300).every((n) => gl - (n.pos.z + 89) >= 200)).toBe(true);
    await page.getByTestId('drain-route').click(); // もう一度押しても増えない
    expect(Object.keys((await full(page)).network.segments)).toHaveLength(5);
    await show(page, '3D');
    if (!isMobile()) await page.getByRole('button', { name: '設備だけ' }).click(); // スマホは 👁 の中
    await page.waitForTimeout(600);
    await page.screenshot({ path: evidence('planauto-drop-3d') });
    // 取り消し: つなぎ案 → 落とした配管 → 器具 の順に戻る
    await page.getByTestId('undo').click();
    doc = await full(page);
    expect(Object.keys(doc.network.segments)).toHaveLength(2);
    expect(Object.keys(doc.fixtures)).toHaveLength(1);
    await page.getByTestId('undo').click();
    expect(Object.keys((await full(page)).network.segments)).toHaveLength(0);
    await page.getByTestId('undo').click();
    expect(Object.keys((await full(page)).fixtures)).toHaveLength(0);
    expect(Object.keys((await full(page)).building.walls)).toHaveLength(7);
  });

  test('配置図も選ぶと、家の外形で位置を合わせて ます・水道メーター・敷地の高さが入る', async ({ page }) => {
    await createAuto(page, '配置図テスト', [
      { name: '1階平面図.pdf', buffer: await plan() },
      { name: '配置図.pdf', buffer: await sitePlan() },
      { name: '立面図.pdf', buffer: await elevation() },
    ]);
    await expect(page.getByTestId('import-report')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ir-found')).toContainText('配置図: 汚水公共ます 1・汚水ます 3・雨水ます 1・水道メーター 1');
    await page.screenshot({ path: evidence('planauto-site-report') });
    await page.getByTestId('ir-ok').click();
    const doc = await full(page);
    const fx = Object.values(doc.fixtures) as { type: string; x: number; y: number }[];
    const pub = fx.find((f) => f.type === 'publicSewage')!;
    expect(Math.abs(pub.x - -1500)).toBeLessThan(80);
    expect(Math.abs(pub.y - (D + 600))).toBeLessThan(80);
    expect(fx.filter((f) => f.type === 'manholeSewage')).toHaveLength(3);
    expect(fx.filter((f) => f.type === 'waterMeter')).toHaveLength(1);
    expect(doc.site.groundPoints.map((g: { gl: number }) => g.gl).sort((a: number, b: number) => a - b)).toEqual([-950, -500, 0]);
    await show(page, '2D');
    await page.screenshot({ path: evidence('planauto-site-2d') });
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
