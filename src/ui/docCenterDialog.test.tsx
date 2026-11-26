// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuildingFromDims } from '../model/building';
import { emptyNetwork } from '../model/network';
import { emptyDoc, useStore } from '../state/store';
import { ShinseiScreen } from './ShinseiScreen';
import { repo } from '../storage/instance';
import { CONTRACTOR_KEY } from '../forms/formSets';
import { EMPTY_CONTRACTOR } from '../forms/types';
import { placeFixture } from '../model/fixtures';

const s = () => useStore.getState();
const open = async () => {
  render(<ShinseiScreen onClose={() => {}} />);
  fireEvent.click(await screen.findByTestId('shinsei-docs'));
  return screen.findByTestId('doc-center');
};
const ids = () => screen.getAllByTestId(/^doc-row-/).map((e) => e.getAttribute('data-testid')!.replace('doc-row-', ''));

describe('提出書類一式（書類センター）', () => {
  afterEach(async () => { cleanup(); await repo.setSetting(CONTRACTOR_KEY, EMPTY_CONTRACTOR); });

  it('南風原町: 必要な書類が状態つきで並ぶ。未入力があれば「確認が必要」で理由が見え、申請書の入力へ行ける', async () => {
    s().newDoc(emptyDoc(), { id: 'p', name: 'テスト工事', createdAt: 1 });
    s().updateSite({ municipalityProfileId: 'haebaru' });
    await open();
    await waitFor(() => expect(ids()).toEqual(['nanbu', 'nanbuProducts', 'haebaruSewer', 'road', 'drawings']));
    const row = screen.getByTestId('doc-row-nanbu');
    await waitFor(() => expect(row.textContent).toContain('確認が必要'));
    expect(row.textContent).toContain('工事店の情報が未入力');
    // 配管が無い工事: 図面は作れないので最初から外れていて、選べない
    const draw = within(screen.getByTestId('doc-row-drawings')).getByRole('checkbox') as HTMLInputElement;
    expect(draw.disabled).toBe(true);
    expect((screen.getByTestId('doc-zip') as HTMLButtonElement).textContent).toContain('4');
    fireEvent.click(within(row).getByRole('button', { name: /直す/ }));
    expect(screen.queryByTestId('doc-center')).toBeNull();
    expect(await screen.findByTestId('shinsei-forms')).toBeTruthy();
  });

  it('工事店が入っていれば製品一覧表の理由は「製品が無い」だけ。様式が未登録の町は申請書を出さない', async () => {
    await repo.setSetting(CONTRACTOR_KEY, { ...EMPTY_CONTRACTOR, name: 'テスト設備' });
    s().newDoc(emptyDoc(), { id: 'p', name: 'テスト工事', createdAt: 1 });
    s().updateSite({ municipalityProfileId: 'haebaru' });
    await open();
    await waitFor(() => expect(screen.getByTestId('doc-row-nanbuProducts').textContent).toContain('載せる製品がありません'));
    expect(screen.getByTestId('doc-row-nanbuProducts').textContent).not.toContain('工事店の情報');
    expect(screen.getByTestId('doc-check-summary').textContent).toContain('確認が必要な書類が');
    cleanup();
    s().updateSite({ municipalityProfileId: 'standard' });
    await open();
    await waitFor(() => expect(ids()).toEqual(['unregistered', 'road', 'drawings']));
    expect(screen.getByTestId('doc-row-road').textContent).toContain('まだ選ばれていません');
    expect(screen.getByTestId('doc-row-unregistered').textContent).toContain('まだ登録していません');
  });

  it('確認の質問: おすすめが選ばれていて、1 押しで決まる。答えは工事に保存され、申請書の理由から消える。後から変えられる', async () => {
    await repo.setSetting(CONTRACTOR_KEY, { ...EMPTY_CONTRACTOR, name: 'テスト設備' });
    s().newDoc(emptyDoc(), { id: 'p', name: 'テスト工事', createdAt: 1 });
    s().updateSite({ municipalityProfileId: 'okinawa-city' });
    await open();
    // おすすめがある質問は 1 行（答えが見える）。「変える」で選択肢が開く
    expect((await screen.findByTestId('doc-q-value-supplyType')).textContent).toBe('直結');
    fireEvent.click(within(screen.getByTestId('doc-q-supplyType')).getByRole('button', { name: /変える/ }));
    expect((within(screen.getByTestId('doc-q-supplyType')).getByRole('radio', { name: /直結 *おすすめ/ }) as HTMLInputElement).checked).toBe(true);
    // 道路を掘るかどうかはおすすめ無し: 選ぶまで決まらない（勝手に「する」にしない）
    expect(screen.getByTestId('doc-q-undecided').textContent).toContain('2 件');
    fireEvent.click(screen.getByTestId('doc-q-save'));
    expect('road.water' in s().doc.site!.application!).toBe(false);
    expect(screen.getByTestId('doc-questions').textContent).toContain('はじめに 2 件');
    await waitFor(() => expect(screen.getByTestId('doc-row-water').textContent).toContain('確認の質問が'));
    fireEvent.click(within(screen.getByTestId('doc-q-road.water')).getByRole('radio', { name: /しない/ }));
    fireEvent.click(within(screen.getByTestId('doc-q-road.sewer')).getByRole('radio', { name: /しない/ }));
    fireEvent.click(screen.getByTestId('doc-q-save'));
    const app = s().doc.site!.application!;
    expect(app.supplyType).toBe('直結');
    expect(app['road.water']).toBe('しない');
    expect(app.sewerConnection).toBe('ます設置（新規）');
    await screen.findByTestId('doc-q-done');
    expect(screen.queryByTestId('doc-questions')).toBeNull();
    expect(screen.getByTestId('doc-row-water').textContent).not.toContain('確認の質問が');
    // 取出しを「しない」にしたので道路の書類は一覧から外れる（下水も公共ますが無ければ「しない」が初期値ではないので確かめる）
    fireEvent.click(screen.getByTestId('doc-q-edit'));
    fireEvent.click(within(screen.getByTestId('doc-q-supplyType')).getByRole('button', { name: /変える/ }));
    fireEvent.click(within(screen.getByTestId('doc-q-supplyType')).getByRole('radio', { name: /受水槽/ }));
    fireEvent.click(screen.getByTestId('doc-q-save'));
    expect(s().doc.site!.application!.supplyType).toBe('受水槽');
  });

  it('検査の結果: 排水の注意・つなぎ忘れの器具が、下水道の申請書の理由に出る（「出力できます」にしない）', async () => {
    await repo.setSetting(CONTRACTOR_KEY, { ...EMPTY_CONTRACTOR, name: 'テスト設備' });
    s().newDoc(emptyDoc(), { id: 'p', name: 'テスト工事', createdAt: 1 });
    s().updateSite({ municipalityProfileId: 'haebaru' });
    const d = s().doc;
    const p = placeFixture(d, d.building.floors[0]?.id ?? '', 'toilet', { x: 0, y: 0 });
    expect(p.fixtureId).toBeTruthy();
    useStore.setState({ doc: p.doc });
    useStore.setState({ drainIssues: [{ kind: 'minSlope', level: 'error', target: { kind: 'segment', id: 'x' }, message: '区間 A の勾配が足りません', fixes: [] }] });
    await open();
    const row = await screen.findByTestId('doc-row-haebaruSewer');
    await waitFor(() => expect(row.textContent).toContain('排水の検査で注意が 1 件'));
    expect(row.textContent).toContain('区間 A の勾配が足りません');
    expect(row.textContent).toContain('トイレの汚水');
  });

  const withPipe = async () => {
    await repo.setSetting(CONTRACTOR_KEY, { ...EMPTY_CONTRACTOR, name: 'テスト設備' });
    const b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    s().newDoc({ building: { ...b, foundation: { slabTop: -550 } }, network: emptyNetwork(), fixtures: {}, site: { designGL: -600, municipalityProfileId: 'haebaru' } }, { id: 'p', name: 'テスト工事', createdAt: 1 });
    s().setActiveFloor(b.floors[1].id);
    s().setDrawAttrs({ system: 'sewage', diameter: 100 });
    s().drawPolyline([{ x: 4000, y: 3000, z: -300 }, { x: 300, y: 3000, z: -300 }]);
    s().setActiveFloor(b.floors[0].id);
    const seg = Object.values(s().doc.network.segments)[0];
    useStore.setState({ drainIssues: [
      { kind: 'unverifiedRule', level: 'info', target: { kind: 'site', id: '' }, message: 'お知らせ', fixes: [] },
      { kind: 'minSlope', level: 'error', target: { kind: 'segment', id: seg.id }, message: '区間 A の勾配が足りません', fixes: [{ label: '管径を φ150 に上げる', apply: (d) => ({ ...d, network: { ...d.network, segments: { ...d.network.segments, [seg.id]: { ...d.network.segments[seg.id], diameter: 150 } } } }) }] },
      { kind: 'noPublic', level: 'warn', target: { kind: 'site', id: '' }, message: '敷地の注意', fixes: [] },
    ] });
    return { seg, floor: s().doc.network.nodes[seg.a].floorId };
  };

  it('排水の注意の一覧: 「図面で見る」でその配管を選んで図面へ戻る（お知らせは並べない）', async () => {
    const { seg, floor } = await withPipe();
    const closed = vi.fn();
    render(<ShinseiScreen onClose={closed} />);
    fireEvent.click(await screen.findByTestId('shinsei-docs'));
    const list = await screen.findByTestId('doc-drain-issues');
    expect(list.textContent).toContain('区間 A の勾配が足りません');
    expect(list.textContent).toContain('敷地の注意');
    expect(list.textContent).not.toContain('お知らせ');
    // 敷地全体の注意には移動先がないので「図面で見る」は 1 つだけ
    const go = within(list).getAllByTestId('doc-drain-go');
    expect(go).toHaveLength(1);
    fireEvent.click(go[0]);
    expect(closed).toHaveBeenCalled();
    expect(s().selection).toEqual({ kind: 'segment', id: seg.id });
    expect(s().activeFloorId).toBe(floor);
    expect(s().tool).toBe('select');
  });

  it('排水の注意の一覧: 直し方のボタンで直すと、計算し直した結果に変わる（元に戻すで戻せる）', async () => {
    const { seg } = await withPipe();
    await open();
    const list = await screen.findByTestId('doc-drain-issues');
    fireEvent.click(within(list).getByRole('button', { name: '管径を φ150 に上げる' }));
    expect(s().doc.network.segments[seg.id].diameter).toBe(150);
    await waitFor(() => expect(screen.queryByText('区間 A の勾配が足りません')).toBeNull());
    s().undo();
    expect(s().doc.network.segments[seg.id].diameter).toBe(100);
  });
});
