/**
 * 共通の要望欄。部品は公開 URL から、受付は共通の GAS へ送る（このテストでは両方を横取りして、本物には送らない）。
 * 入力欄に目印の文字を入れて操作してから送り、送信内容に目印が入らないことを確かめる。
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
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
    await page.getByTestId('project-item').first().locator('.pmain').click();
    await expect(page.getByTestId('project-name')).toContainText(MARK);

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
});
