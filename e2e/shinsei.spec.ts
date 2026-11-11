/**
 * 申請図面（排水縦断図・給水立面図）。サンプル工事（汚水マス→公共汚水マス・設計GL −450）から図面を作り、PDF を保存する。
 * 勾配の入力・固定、自治体プロファイルの複製、旧データ（site・マスなし）の後方互換も確認する。
 */
import { expect, test, type Page } from '@playwright/test';
import { evidence, freshApp, isMobile } from './helpers';

const doc = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);

async function openSample(page: Page) {
  await page.getByTestId('open-sample').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('project-name')).toHaveText('サンプル工事（練習用）');
}

test.describe('申請図面', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('サンプル工事 → 縦断図（公共マスが先頭・警告なし）→ PDF、立面図 → PDF、設計GL 未入力で「仮」', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('open-shinsei').click();
    await expect(page.getByTestId('shinsei-screen')).toBeVisible();
    const outlet = page.getByTestId('shinsei-outlet');
    await expect(outlet.locator('option').first()).toContainText('公共汚水マス');
    const preview = page.getByTestId('shinsei-preview');
    await expect(preview.locator('svg')).toHaveCount(1);
    await expect(preview).toContainText('排水設備 縦断図');
    await expect(preview).toContainText('1/100');
    await expect(page.getByTestId('shinsei-warnings')).toHaveCount(0);
    await expect(page.getByTestId('shinsei-error')).toHaveCount(0);
    await page.screenshot({ path: evidence('shinsei-01-profile') });
    if (!isMobile()) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('shinsei-pdf').click()]);
      expect(dl.suggestedFilename()).toMatch(/縦断図.*\.pdf$/);
      const [svg] = await Promise.all([page.waitForEvent('download'), page.getByTestId('shinsei-svg').click()]);
      expect(svg.suggestedFilename()).toMatch(/縦断図.*\.svg$/);
    }

    // 立面図
    await page.getByTestId('shinsei-kind-riser').click();
    await expect(page.getByTestId('shinsei-root').locator('option').first()).toContainText('水道メーター');
    await expect(preview).toContainText('給水装置 立面図');
    await expect(preview).toContainText('φ20');
    await page.screenshot({ path: evidence('shinsei-02-riser') });
    if (!isMobile()) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('shinsei-pdf').click()]);
      expect(dl.suggestedFilename()).toMatch(/立面図.*\.pdf$/);
    }

    // 設計GL を未入力に戻す → 仮
    await page.getByTestId('shinsei-kind-profile').click();
    await page.getByTestId('shinsei-gl-clear').click();
    await expect(page.getByTestId('shinsei-gl-tentative')).toBeVisible();
    await expect(preview).toContainText('（仮）');
    await expect(page.getByTestId('shinsei-warnings')).toContainText('設計GL');
    await page.screenshot({ path: evidence('shinsei-03-tentative') });
    // 入れ直す
    await page.getByTestId('shinsei-gl').fill('-450');
    await page.getByTestId('shinsei-gl').press('Enter');
    await expect(page.getByTestId('shinsei-gl-tentative')).toHaveCount(0);
    await page.getByTestId('close-shinsei').click();
    await expect(page.getByTestId('editor')).toBeVisible();
  });

  test('排水区間の設計勾配を 1/50 に → 表示が 1/50 で固定、マスのパネルに管底高・深さ', async ({ page }) => {
    await openSample(page);
    const d = await doc(page);
    const pub = Object.values(d.fixtures as Record<string, any>).find((f) => f.type === 'publicSewage')!;
    const port = Object.values(d.network.nodes as Record<string, any>).find((n) => n.fixtureId === pub.id)!;
    const seg = Object.values(d.network.segments as Record<string, any>).find((s) => s.a === port.id || s.b === port.id)!;
    // 区間を選ぶ（ストア経由。画面の選択は他のテストで確認済み）
    await page.evaluate((id) => (window as any).__pc.getState().select({ kind: 'segment', id }), seg.id);
    await expect(page.getByTestId('seg-slope')).toContainText('1/100');
    await page.getByTestId('seg-slope-input').fill('50');
    await page.getByTestId('seg-slope-input').press('Enter');
    await expect(page.getByTestId('seg-slope')).toContainText('1/50');
    await expect(page.getByTestId('seg-slope')).toContainText('🔒');
    await expect(page.getByTestId('seg-slope-lock')).toBeChecked();
    // 公共マスの管底高は固定なので、上流（汚水マス側）の端が上がる
    const d2 = await doc(page);
    const up = d2.network.nodes[seg.a === port.id ? seg.b : seg.a];
    expect(up.pos.z).toBeCloseTo(-1060 + 6000 / 50, 0);
    await page.screenshot({ path: evidence('shinsei-04-slope') });

    // マスを選ぶ → 管底高・深さ
    await page.evaluate((id) => (window as any).__pc.getState().select({ kind: 'fixture', id }), pub.id);
    await expect(page.getByTestId('manhole-params')).toBeVisible();
    await expect(page.getByTestId('manhole-depth')).toContainText('深さ 610mm');
    await page.getByTestId('manhole-invert').fill('-1100');
    await page.getByTestId('manhole-invert').press('Enter');
    await expect(page.getByTestId('manhole-depth')).toContainText('深さ 650mm');
    // 落差桝: 落差 50 → 接続口ノードに dropIn、縦断図の桝名が H600-650（流入側-流出側）に
    await page.getByTestId('manhole-drop').fill('50');
    await page.getByTestId('manhole-drop').press('Enter');
    await expect(page.getByTestId('manhole-drop-note')).toContainText('H600-650');
    const d3 = await doc(page);
    expect(d3.network.nodes[port.id].dropIn).toBe(50);
    await page.screenshot({ path: evidence('shinsei-05-manhole') });
    await page.getByTestId('open-shinsei').click();
    await page.getByTestId('shinsei-profile').selectOption('okinawa-city');
    await expect(page.getByTestId('shinsei-preview')).toContainText('H600-650');
    await page.screenshot({ path: evidence('shinsei-12-drop-manhole') });
    await page.getByTestId('close-shinsei').click();
  });

  test('自治体プロファイルを複製 → 一覧 2 件 → 現場の選択肢に出る', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('open-shinsei').click();
    await page.getByTestId('shinsei-manage-profiles').click();
    await expect(page.getByTestId('profile-row-standard')).toBeVisible();
    await page.getByTestId('profile-dup-standard').click();
    await expect(page.getByTestId('profile-form')).toBeVisible();
    await page.getByTestId('pf-name').fill('那覇市（仮）');
    await page.getByTestId('pf-unverified').fill('土被りの最小値');
    await page.getByTestId('pf-save').click();
    // 同梱 8 件（standard＋南部 7 自治体）＋複製 1 件
    await expect(page.locator('[data-testid^="profile-row-"]')).toHaveCount(9);
    await page.screenshot({ path: evidence('shinsei-06-profiles') });
    await page.getByTestId('profile-close').click();
    const sel = page.getByTestId('shinsei-profile');
    await expect(sel.locator('option')).toHaveCount(9);
    await sel.selectOption({ label: '那覇市（仮）（要確認あり）' });
    await expect(page.getByTestId('shinsei-preview')).toContainText('要確認: 土被りの最小値');
    // 保存されたプロファイルと現場の選択は再読み込み後も残る
    await page.getByTestId('close-shinsei').click();
    await expect(page.getByTestId('save-state')).toHaveText('保存済み');
    await page.reload();
    await expect(page.getByTestId('home')).toBeVisible();
    await page.getByTestId('project-item').first().locator('.pmain').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await page.getByTestId('open-shinsei').click();
    await expect(page.getByTestId('shinsei-profile').locator('option')).toHaveCount(9);
    await expect(page.getByTestId('shinsei-profile')).toHaveValue(/^mp_/);
    // 同梱の自治体プロファイルを選ぶと「要確認」が図面に出る
    await page.getByTestId('shinsei-profile').selectOption('itoman');
    await expect(page.getByTestId('shinsei-preview')).toContainText('要確認');
    await expect(page.getByTestId('shinsei-preview')).toContainText('糸満市');
    await page.screenshot({ path: evidence('shinsei-08-itoman') });
    // 沖縄市: 公共桝の管底 ±0、桝の名前を図の上に、排水のアイソメ図、給水はアイソメ図
    await page.getByTestId('shinsei-profile').selectOption('okinawa-city');
    await expect(page.getByTestId('shinsei-preview')).toContainText('公共桝の管底を ±0');
    await expect(page.getByTestId('shinsei-preview')).toContainText('NO.1汚水マス');
    await expect(page.getByTestId('shinsei-preview')).toContainText('新設公共汚水マス');
    await expect(page.getByTestId('shinsei-preview')).toContainText('受付番号');
    await expect(page.getByTestId('shinsei-preview')).toContainText('立面図（展開図）');
    await page.screenshot({ path: evidence('shinsei-09-okinawa-profile'), fullPage: false });
    await page.getByTestId('shinsei-kind-riser').click();
    await expect(page.getByTestId('shinsei-preview')).toContainText('NO SCALE');
    await expect(page.getByTestId('shinsei-preview')).toContainText('HI');
    await page.screenshot({ path: evidence('shinsei-10-okinawa-iso') });
    // 申請書タブ: 工事店の情報を保存 → 申請情報を入力 → 給水申請書 (Excel)・下水道申請書 (PDF)・製品一覧表 (PDF) をダウンロード
    await page.getByTestId('shinsei-kind-forms').click();
    await expect(page.getByTestId('shinsei-forms')).toBeVisible();
    await page.getByTestId('forms-contractor-toggle').click();
    await page.getByTestId('contractor-name').fill('テスト設備');
    await page.getByTestId('contractor-licenseNo').fill('123');
    await page.getByTestId('contractor-chiefEngineer').fill('主任 花子');
    await page.getByTestId('contractor-save').click();
    await expect(page.getByTestId('forms-msg')).toContainText('保存しました');
    await page.getByTestId('forms-contractor-toggle').click();
    await page.getByTestId('app-applicantName').fill('水道 太郎');
    await page.getByTestId('app-applicantAddress').fill('沖縄市仲宗根町26-1');
    await expect(page.getByTestId('app-diameter')).toHaveValue('20');
    await page.screenshot({ path: evidence('shinsei-11-forms') });
    const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByTestId('forms-water').click()]);
    expect(xlsx.suggestedFilename()).toContain('給水装置申込及び工事申請書.xlsx');
    // 図の欄に画像（給水の立面図の PNG）が入っている
    const xlsxPath = await xlsx.path();
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xlsxPath!);
    expect(wb.getWorksheet('申請書（表）')!.getImages().length).toBe(1);
    expect(wb.getWorksheet('申請書（裏）')!.getImages().length).toBeGreaterThanOrEqual(1);
    if (test.info().project.name === 'pc-chrome') await xlsx.saveAs('test-evidence/pc-chrome-shinsei-11-water-application.xlsx');
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('forms-sewer').click()]);
    expect(pdf.suggestedFilename()).toContain('下水道排水設備計画確認申請書.pdf');
    const [list] = await Promise.all([page.waitForEvent('download'), page.getByTestId('forms-products').click()]);
    expect(list.suggestedFilename()).toContain('給水装置使用製品一覧表.pdf');
    // 入力は現場に保存される
    await page.getByTestId('close-shinsei').click();
    await expect(page.getByTestId('save-state')).toHaveText('保存済み');
    await page.reload();
    await page.getByTestId('project-item').first().locator('.pmain').click();
    await page.getByTestId('open-shinsei').click();
    await page.getByTestId('shinsei-kind-forms').click();
    await expect(page.getByTestId('app-applicantName')).toHaveValue('水道 太郎');
  });

  test('新しい工事の住所の市町村から、申請書類と決まりの自治体を選ぶ。無ければ標準と知らせる', async ({ page }) => {
    const create = async (name: string, address: string) => {
      await page.getByTestId('new-project').click();
      await page.getByTestId('np-name').fill(name);
      await page.getByTestId('np-address').fill(address);
      await page.getByTestId('np-create').click();
      await expect(page.getByTestId('editor')).toBeVisible();
    };
    await create('住所テスト', '沖縄県豊見城市字高安 123');
    await expect(page.locator('.toast.notice')).toContainText('住所（豊見城市）から、申請書類と決まり');
    expect(await page.evaluate(() => (window as any).__pc.getState().doc.site?.municipalityProfileId)).toBe('tomigusuku');
    await page.getByTestId('back-home').click();
    await create('住所テスト2', '千葉県市原市五井');
    await expect(page.locator('.toast.notice')).toContainText('市原市の申請の決まりはまだ入っていないので、標準');
    expect(await page.evaluate(() => (window as any).__pc.getState().doc.site?.municipalityProfileId)).toBeUndefined();
  });

  test('後方互換: site・マスの無い旧データを読み込んでも申請図面が開ける', async ({ page }) => {
    const old = {
      schemaVersion: 5, id: 'old1', name: '旧データ', createdAt: 1, updatedAt: 2,
      building: { floors: [{ id: 'f1', name: '1階', elevation: 0, height: 2900, slabThickness: 200 }], corners: {}, walls: {}, openings: {}, rooms: {} },
      network: {
        nodes: { a: { id: 'a', kind: 'end', pos: { x: 0, y: 0, z: -400 } }, b: { id: 'b', kind: 'end', pos: { x: 5000, y: 0, z: -450 } } },
        segments: { s: { id: 's', a: 'a', b: 'b', system: 'sewage', diameter: 100, slope: 0.01 } },
      },
      fixtures: {},
      estimate: { extraRate: 0.05, taxRate: 0.1, overhead: { mode: 'rate', value: 0.1 }, prices: {}, extras: [] },
      underlays: {},
    };
    await page.getByTestId('import-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
    await expect(page.getByText('「旧データ」を読み込みました')).toBeVisible();
    await page.getByTestId('project-item').first().locator('.pmain').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await page.getByTestId('open-shinsei').click();
    await expect(page.getByTestId('shinsei-screen')).toBeVisible();
    // マスが無いので排水の端点が候補、GL は仮
    await expect(page.getByTestId('shinsei-outlet').locator('option').first()).toContainText('排水の端点');
    await expect(page.getByTestId('shinsei-gl-tentative')).toBeVisible();
    await expect(page.getByTestId('shinsei-preview')).toContainText('（仮）');
    await expect(page.getByTestId('shinsei-error')).toHaveCount(0);
    await page.screenshot({ path: evidence('shinsei-07-old-data') });
  });
});
