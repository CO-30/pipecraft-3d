// @vitest-environment jsdom
/** 作業手順ガイド: 申請の手順への切り替えと、各工程のボタン */
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDoc, useStore } from '../state/store';
import { GuideBar } from './GuideBar';
import { usePrefs } from './prefs';
import { createBuildingFromDims } from '../model/building';
import { emptyNetwork } from '../model/network';
import { placeFixture } from '../model/fixtures';

const s = () => useStore.getState();
const step = () => screen.getByTestId('guide-current').getAttribute('data-step');

describe('作業手順ガイド: 申請の手順', () => {
  beforeEach(() => { usePrefs.getState().setGuideHidden(false); usePrefs.getState().setGuideMode('estimate'); });
  afterEach(() => cleanup());

  it('一覧から「申請の手順」に切り替えると 5 工程になり、選んだ手順は覚えておく。見積の手順にも戻せる', () => {
    s().newDoc(emptyDoc(), { id: 'p', name: 'テスト', createdAt: 1 });
    render(<GuideBar onEstimate={() => {}} onPlan={() => {}} onShinsei={() => {}} />);
    expect(step()).toBe('layout');
    fireEvent.click(screen.getByTestId('guide-toggle'));
    fireEvent.click(screen.getByTestId('guide-mode-shinsei'));
    expect(usePrefs.getState().guideMode).toBe('shinsei');
    expect(step()).toBe('sDrawing');
    expect(screen.getByTestId('guide-current').textContent).toContain('1/5');
    fireEvent.click(screen.getByTestId('guide-toggle'));
    expect(screen.getAllByTestId(/^guide-step-s/)).toHaveLength(5);
    fireEvent.click(screen.getByTestId('guide-mode-estimate'));
    expect(step()).toBe('layout');
  });

  it('器具を置いた工事: 「自動でつなぐ」のボタンでまとめてつなぎ、次は「確認の質問」→ ボタンで書類の一覧を開く', async () => {
    usePrefs.getState().setGuideMode('shinsei');
    const b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    s().newDoc({ building: b, network: emptyNetwork(), fixtures: {}, site: { municipalityProfileId: 'haebaru' } }, { id: 'p', name: 'テスト', createdAt: 1 });
    const fl = b.floors[0].id;
    let d = placeFixture(s().doc, fl, 'toilet', { x: 2000, y: 2000 }).doc;
    d = placeFixture(d, fl, 'publicSewage', { x: -3000, y: 2000 }).doc;
    useStore.setState({ doc: d });
    const onShinsei = vi.fn();
    render(<GuideBar onEstimate={() => {}} onPlan={() => {}} onShinsei={onShinsei} />);
    expect(step()).toBe('sConnect');
    expect(screen.getByTestId('guide-do').textContent).toContain('自動でつなぐ');
    fireEvent.click(screen.getByTestId('guide-do'));
    await waitFor(() => expect(Object.keys(s().doc.network.segments).length).toBeGreaterThan(0));
    await waitFor(() => expect(step()).toBe('sQuestions'));
    fireEvent.click(screen.getByTestId('guide-do'));
    expect(onShinsei).toHaveBeenCalled();
  });
});
