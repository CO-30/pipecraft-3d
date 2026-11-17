/**
 * 共通の要望欄。部品は公開 URL から、受付は共通の GAS へ送る（このテストでは両方を横取りして、本物には送らない）。
 * 入力欄に目印の文字を入れて操作してから送り、送信内容に目印が入らないことを確かめる。
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { evidence, freshApp } from './helpers';

const MARK = 'ZQX目印';
const WIDGET = readFileSync('src/feedback/feedback-widget.fixture.js', 'utf8');

async function intercept(page: Page) {
  const posts: any[] = [];
  await page.route('https://co-30.github.io/invoice-maker/feedback/feedback-widget.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: WIDGET }));
  await page.route('https://script.google.com/macros/**', (r) => {
    posts.push(JSON.parse(r.request().postData() || '{}'));
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  return posts;
}

/** 画面の中で、目印の文字が見えるボタン・リンク・選択肢・チェックの名前に、固定の記録名か「記録しない」印があるか */
async function unprotected(page: Page, mark: string) {
  return page.evaluate((m) => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll('button,a,[role=button],[role=tab],summary,label,select'))) {
      const text = (el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '');
      if (!text.includes(m)) continue;
      if (el.closest('[data-fb-skip]')) continue;
      const own = el.matches('label') ? el.querySelector('input,select') : el;
      if (own?.getAttribute('data-fb') || el.getAttribute('data-fb')) continue;
      bad.push(el.outerHTML.slice(0, 120));
    }
    return bad;
  }, mark);
}

test.describe('要望欄', () => {
  test('入力欄に目印を入れて操作してから送っても、送信内容に目印・金額が入らない', async ({ page }) => {
    const posts = await intercept(page);
    await freshApp(page);

    // ホームのいちばん下に要望欄がある
    const home = page.getByTestId('feedback-box');
    await expect(home).toContainText('ご要望・不具合の報告');
    await expect(home).toHaveAttribute('id', 'feedback');

    // 目印の入った工事を作る（工事名・住所）→ 積算を開く → 一覧で検索 → 一覧から開く
    await page.getByTestId('new-project').click();
    await page.getByTestId('np-name').fill(`${MARK}邸`);
    await page.getByTestId('np-address').fill(`${MARK}市1-2-3`);
    await page.getByTestId('np-create').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await page.getByTestId('open-estimate').click();
    await page.keyboard.press('Escape');
    await page.getByTestId('back-home').click();
    await page.getByTestId('search').fill(MARK);
    expect(await unprotected(page, MARK)).toEqual([]);
    await page.getByTestId('project-item').first().locator('.pmain').click();
    await expect(page.getByTestId('project-name')).toContainText(MARK);
    expect(await unprotected(page, MARK)).toEqual([]);

    // 作業画面の「？」から送る（返信先は空・本文は目印なし）
    await page.getByTestId('open-help-editor').click();
    const box = page.getByTestId('feedback-box-help');
    await expect(box).toContainText('ご要望・不具合の報告');
    await box.locator('textarea').fill('E2E の送信テスト');
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidence('feedback-01-editor') });
    await box.getByRole('button', { name: '送信する' }).click();
    await expect(box).toContainText('送信しました');

    expect(posts).toHaveLength(1);
    const p = posts[0];
    expect(p.app).toBe('給水');
    expect(p.text).toBe('E2E の送信テスト');
    expect(p.context.画面).toBe('作業');
    const acts = p.log.map((l: any) => l.a);
    expect(acts).toContain('押した: 工事を開く');
    expect(acts).toContain('画面: ホーム'); // 部品が届く前の記録も残る
    expect(acts).toContain('画面: 作業');
    expect(acts).toContain('画面: 積算');
    const all = JSON.stringify(p);
    expect(all).not.toContain(MARK);
    expect(all).not.toMatch(/[¥￥]\s?\d|\d{1,3}(,\d{3})+\s?円/); // 金額
  });

  test('部品を読み込めない（電波が無い）ときも、アプリは動き、理由を出す', async ({ page }) => {
    await page.route('https://co-30.github.io/**', (r) => r.abort());
    await page.route('https://script.google.com/**', (r) => r.abort());
    await freshApp(page);
    await expect(page.getByTestId('feedback-offline')).toBeVisible();
    await page.getByTestId('open-sample').click();
    await expect(page.getByTestId('editor')).toBeVisible();
  });
  test('今の画面を添えて送れ、「AIに渡す」で指示書がコピー（スマホは共有）される', async ({ page }) => {
    const posts = await intercept(page);
    // コピーと共有を横取りして中身を確かめる（本物のクリップボード・共有シートは使わない）
    await page.addInitScript(() => {
      const w = window as any;
      w.__copied = ''; w.__shared = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t: string) => { w.__copied = t; return Promise.resolve(); } } });
      (navigator as any).share = (d: any) => { w.__shared = { text: d.text, files: (d.files || []).map((f: File) => f.type + ':' + f.size) }; return Promise.resolve(); };
      (navigator as any).canShare = () => true;
    });
    await freshApp(page);
    await page.getByTestId('open-sample').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    if (test.info().project.name === 'pc-chrome') await expect(page.locator('[data-testid="view3d"] canvas')).toBeVisible(); // 2D と 3D を並べて写す
    await page.getByTestId('open-help-editor').click();
    const box = page.getByTestId('feedback-box-help');
    await box.getByRole('button', { name: '今の画面を添える' }).click();
    await expect(box.locator('.th img')).toHaveCount(1);
    await expect(box).toContainText('今の画面を添えました');
    await box.locator('textarea').fill('E2E スクショの確認');
    await box.getByRole('button', { name: /AIに渡す/ }).click();
    const copied = await page.evaluate(() => (window as any).__copied as string);
    expect(copied).toMatch(/^あなたは「給水」の開発担当です/);
    expect(copied).toContain('内容：E2E スクショの確認');
    expect(copied).toContain('スクショ：1枚');
    expect(copied).toContain('画面: 使い方');
    const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
    const shared = await page.evaluate(() => (window as any).__shared);
    if (touch) { expect(shared.files).toHaveLength(1); expect(shared.files[0]).toMatch(/^image\/jpeg:\d+/); }
    else expect(shared).toBeNull();
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidence('feedback-02-shots') });

    await box.getByRole('button', { name: '送信する' }).click();
    await expect(box).toContainText('送信しました');
    await expect(box.locator('.th img')).toHaveCount(0);
    const p = posts[0];
    expect(p.shots).toHaveLength(1);
    expect(p.shots[0]).toMatch(/^\/9j\//);
    expect(p.shots[0].length * 0.75).toBeLessThanOrEqual(400000);
    expect(p.log.length).toBeGreaterThan(5);
    writeFileSync(`test-evidence/${test.info().project.name}-feedback-03-captured.jpg`, Buffer.from(p.shots[0], 'base64')); // 送られた「今の画面」
  });
});
