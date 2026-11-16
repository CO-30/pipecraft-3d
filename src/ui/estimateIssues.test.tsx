// @vitest-environment jsdom
/**
 * 積算の「要確認」: 配管・部品の確かめる所を先に 1 件ずつ、単価の未登録はまとめて 1 枚（開くと一覧）。
 * 2026-11-16 実物: 単価の未登録 60 件以上が並んで、確かめる所が埋もれていた
 */
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyDoc, useStore } from '../state/store';
import { EstimateScreen } from './EstimateScreen';
import { computeEstimate } from '../model/estimate';
import { addPolyline, emptyNetwork } from '../model/network';

const s = () => useStore.getState();
const v = (x: number, y: number, z = -300) => ({ x, y, z });

function docWithPipes(clash: boolean) {
  const main = addPolyline(emptyNetwork(), [v(0, 0), v(1000, 0), v(2000, 0)], { system: 'water', diameter: 20 });
  let net = main.net;
  // 30° の分岐（部品を確定してほしい所）
  if (clash) net = addPolyline(net, [v(1000, 0), v(1866, 500)], { system: 'water', diameter: 20 }, { startNodeId: main.nodeIds[1] }).net;
  s().newDoc({ ...emptyDoc(), network: net }, { id: 'p', name: 'テスト', createdAt: 1 });
}

describe('積算の要確認', () => {
  afterEach(() => cleanup());

  it('単価の未登録はまとめて 1 枚。タブの数は配管・部品の確かめる所の数', () => {
    docWithPipes(true);
    const est = computeEstimate(s().doc);
    const prices = est.issues.filter((i) => i.kind === 'noPrice').length, real = est.issues.length - prices;
    expect(prices).toBeGreaterThan(1);
    expect(real).toBeGreaterThan(0);
    render(<EstimateScreen onClose={() => {}} initialTab="issues" />);
    expect(screen.getByTestId('tab-issues').textContent).toBe(`要確認(${real})`);
    const list = screen.getByTestId('issues');
    // 配管・部品が先、単価のまとめが最後
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(real + 1);
    expect(items[0].textContent).toContain('部品の確定');
    const card = screen.getByTestId('issue-prices');
    expect(card.textContent).toContain(`${prices}`);
    // 開くと 1 件ずつ（今までどおり）
    fireEvent.click(within(card).getByRole('button', { name: /一覧/ }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(real + 1 + prices);
  });

  it('確かめる所が無ければそう書き、単価のまとめだけ出す', () => {
    docWithPipes(false);
    render(<EstimateScreen onClose={() => {}} initialTab="issues" />);
    expect(screen.getByTestId('tab-issues').textContent).toBe('要確認');
    expect(screen.getByTestId('issues-design-ok').textContent).toContain('ありません');
    expect(screen.getByTestId('issue-prices')).toBeTruthy();
  });
});
