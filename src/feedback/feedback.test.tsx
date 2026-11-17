// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDoc, useStore } from '../state/store';
import { HelpDialog } from '../ui/HelpDialog';
import './feedback-widget.fixture.js'; // 本番は公開 URL から読む部品の写し
import { FEEDBACK_OPTIONS, FEEDBACK_SCRIPT, FEEDBACK_URL, fbError, feedbackContext, feedbackWidget, initFeedback } from './feedback';
import { canCapture, captureScreen } from './capture';
import { startTrail } from './trail';

const s = () => useStore.getState();
beforeEach(() => { initFeedback(); s().newDoc(emptyDoc(), { id: 'p', name: '山田様邸新築工事', address: '宜野湾市大山1-2-3', createdAt: 1 }); });
afterEach(cleanup);

describe('要望欄', () => {
  it('使い方の画面に要望欄が出て、共通の受付へ送れる状態になる', async () => {
    render(<HelpDialog onClose={() => {}} />);
    expect(await screen.findByText('ご要望・不具合の報告')).toBeTruthy();
    const go = screen.getByRole('button', { name: '送信する' }) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
    expect(FEEDBACK_URL).toMatch(/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/);
  });

  it('送る中身に工事名・住所が入らない', () => {
    const p = feedbackWidget()!.payload('テスト');
    expect(p.app).toBe('給水');
    const all = JSON.stringify(p);
    expect(all).not.toContain('山田');
    expect(all).not.toContain('宜野湾市大山');
    expect(feedbackContext()).toMatchObject({ 画面: '作業', 階数: 1 });
  });

  it('工事の一覧・メモの一覧のボタンは名前でなく決まった記録名になる', () => {
    const d = document.createElement('div');
    d.innerHTML = '<button data-fb="工事を開く"><span class="pname">山田様邸新築工事</span></button>';
    document.body.appendChild(d);
    expect(feedbackWidget()!._labelOf(d.querySelector('.pname')!)).toBe('押した: 工事を開く');
    d.remove();
  });

  it('要望を書いている途中の Esc（入力欄・日本語の変換の取り消し）では使い方の画面を閉じない', async () => {
    const close = vi.fn();
    render(<HelpDialog onClose={close} />);
    const ta = (await screen.findByPlaceholderText(/○○の画面/)) as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('ファイル名・住所・名前が入るボタンと選択肢は、決まった記録名か記録しない印がある', () => {
    const must: [string, string][] = [
      ['src/ui/HomeScreen.tsx', 'className="pmain" data-fb="工事を開く"'],
      ['src/ui/Notes.tsx', 'data-fb="メモの一覧から選ぶ"'],
      ['src/ui/NewProjectDialog.tsx', 'data-fb="図面ファイルを外す"'],
      ['src/ui/UnderlayPanel.tsx', 'data-fb="下敷きを選ぶ"'],
      ['src/ui/Panels.tsx', 'data-testid="floor-chip" data-fb="階を選ぶ"'],
      ['src/ui/Panels.tsx', 'data-testid="elev-chip" data-fb="立面を選ぶ"'],
      ['src/ui/LocationPanel.tsx', 'data-testid="mitori-place" data-fb-skip'],
      ['src/ui/SiteImportDialog.tsx', 'data-testid="site-fp" data-fb-skip'],
      ['src/ui/SiteImportDialog.tsx', 'data-testid="site-place" data-fb="住所の候補を選ぶ"'],
      ['src/ui/Panels.tsx', 'data-testid="port-cand" data-fb="接続先の器具を選ぶ"'],
      ['src/ui/ImportReportDialog.tsx', 'data-testid="ir-fixtures" data-fb-skip'],
      ['src/ui/ShinseiForms.tsx', '`app-${f.id}`} data-fb-skip'],
      ['src/ui/Versions.tsx', 'data-testid="compare-row" data-fb="比較の一覧から選ぶ"'],
      ['src/ui/ShinseiScreen.tsx', 'data-testid="shinsei-profile" data-fb-skip'],
      ['src/ui/ShinseiScreen.tsx', 'data-testid="shinsei-outlet" data-fb-skip'],
      ['src/ui/ShinseiScreen.tsx', 'data-testid="shinsei-root" data-fb-skip'],
      ['src/ui/ShinseiScreen.tsx', '`shinsei-branch-${b.nodeId}`} data-fb-skip'],
    ];
    for (const [f, t] of must) expect(readFileSync(f, 'utf8'), `${f}: ${t}`).toContain(t);
  });

  it('画面に出したエラーは「：」「（」より前だけ記録する（ファイル名・サーバーの文言を残さない）', () => {
    fbError('PDF を開けませんでした（山田邸_平面図.pdf）。PDF のファイルを選んでください');
    fbError('工事を開けませんでした: QuotaExceededError 山田邸');
    const errs = feedbackWidget()!.payload('x').errors.map((e) => e.m);
    expect(errs.slice(-2)).toEqual(['表示: PDF を開けませんでした', '表示: 工事を開けませんでした']);
    expect(JSON.stringify(errs)).not.toContain('山田');
  });
});

describe('スクショ・AIに渡す・操作の記録（部品 v1.15.0）', () => {
  it('部品 v1.15.0 を読み、スクショ 3 枚・AIに渡す・記録 80 件・今の画面を宣言する', () => {
    expect(FEEDBACK_SCRIPT).toMatch(/\?v=1\.15\.0$/);
    expect(FEEDBACK_OPTIONS).toMatchObject({ shots: 3, aiShare: true, maxLog: 80 });
    expect(typeof FEEDBACK_OPTIONS.capture).toBe('function');
    for (let i = 0; i < 100; i++) feedbackWidget()!.log('押した: ' + i);
    const p = feedbackWidget()!.payload('x');
    expect(p.log.length).toBe(80);
    expect(p.shots).toEqual([]);
  });

  it('使い方の画面の要望欄に「スクショ・写真を選ぶ」と「AIに渡す」が出る。写す図面が無い所では「今の画面を添える」は出さない', async () => {
    render(<HelpDialog onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: /スクショ・写真を選ぶ（3枚まで）/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /AIに渡す/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '今の画面を添える' })).toBeNull();
    expect(canCapture()).toBe(false);
    expect(await captureScreen()).toBeNull();
  });

  it('AIに渡す文は開発担当への指示書になり、工事名・住所は入らない', () => {
    const t = feedbackWidget()!.aiText!('配管が消える', '不具合');
    expect(t).toMatch(/^あなたは「給水」の開発担当です/);
    expect(t).toContain('内容：配管が消える');
    expect(t).not.toContain('山田');
    expect(t).not.toContain('宜野湾市大山');
  });

  it('道具・床下の切り替えと、器具の数の増減を記録する（名前は残さない）', async () => {
    vi.useFakeTimers();
    const stop = startTrail();
    try {
      s().setTool('fixture');
      s().setUnderFloor(true);
      s().setFixtureType('toilet');
      s().placeFixtureAt({ x: 1000, y: 1000 });
      vi.advanceTimersByTime(900);
      const log = feedbackWidget()!.payload('x').log.map((x) => x.a);
      expect(log).toContain('道具: 器具');
      expect(log).toContain('床下: ON');
      expect(log.some((a) => /^変化: .*器具\+1/.test(a))).toBe(true);
      expect(JSON.stringify(log)).not.toContain('山田');
    } finally { stop(); vi.useRealTimers(); }
  });

  it('工事を開くと、名前でなく数だけを記録する', () => {
    const stop = startTrail();
    try {
      s().newDoc(emptyDoc(), { id: 'q', name: '佐藤様邸', address: '那覇市1-1', createdAt: 2 });
      const log = feedbackWidget()!.payload('x').log.map((x) => x.a);
      expect(log.some((a) => /^工事を開いた（配管0 器具0/.test(a))).toBe(true);
      expect(JSON.stringify(log)).not.toContain('佐藤');
    } finally { stop(); }
  });
});
