// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyDoc, useStore } from '../state/store';
import { ShinseiScreen } from './ShinseiScreen';
import { rowStatus } from './ShinseiBundleDialog';
import type { FixtureType } from '../model/fixtures';

const s = () => useStore.getState();
const v = (x: number, y: number, z = 0) => ({ x, y, z });

/** 汚水マス → 公共汚水マス、メーター → 水栓 */
function sampleDoc() {
  s().newDoc(emptyDoc(), { id: 'p', name: 'テスト工事', createdAt: 1 });
  s().updateSite({ designGL: -450 });
  const place = (type: FixtureType, x: number, y: number) => {
    s().setFixtureType(type);
    s().placeFixtureAt({ x, y });
    return Object.values(s().doc.fixtures).filter((f) => f.type === type).pop()!.id;
  };
  const port = (fid: string, pid: string) => Object.values(s().doc.network.nodes).find((n) => n.fixtureId === fid && n.portId === pid)!;
  const m1 = place('manholeSewage', 0, -1200); s().updateFixtureParams(m1, { invertZ: -1000 });
  const m2 = place('publicSewage', 6000, -1200); s().updateFixtureParams(m2, { invertZ: -1060 });
  s().setDrawAttrs({ system: 'sewage', diameter: 100 });
  s().drawPolyline([port(m1, 'pipe').pos, port(m2, 'pipe').pos], { startNodeId: port(m1, 'pipe').id, endNodeId: port(m2, 'pipe').id });
  const meter = place('waterMeter', -1000, 3000);
  const faucet = place('faucet', 3000, 3000);
  s().setDrawAttrs({ system: 'water', diameter: 20 });
  const mo = port(meter, 'out'), fw = port(faucet, 'water');
  s().drawPolyline([mo.pos, v(1000, mo.pos.y, mo.pos.z), v(1000, fw.pos.y, mo.pos.z), v(1000, fw.pos.y, fw.pos.z), fw.pos], { startNodeId: mo.id, endNodeId: fw.id });
}

const rowIds = () => screen.getAllByTestId(/^shinsei-bundle-row-/).map((e) => e.getAttribute('data-testid')!.replace('shinsei-bundle-row-', ''));
const check = (k: string) => within(screen.getByTestId(`shinsei-bundle-row-${k}`)).getByRole('checkbox') as HTMLInputElement;

describe('申請図面: まとめてPDF', () => {
  afterEach(() => cleanup());

  it('一覧は提出の順。作れる図面は最初からチェック、見取図（工事場所なし）は理由つきで外れる', async () => {
    sampleDoc();
    render(<ShinseiScreen onClose={() => {}} />);
    await screen.findByTestId('shinsei-outlet');
    fireEvent.click(screen.getByTestId('shinsei-bundle'));
    await screen.findByTestId('shinsei-bundle-dialog');
    expect(rowIds()).toEqual(['mitori', 'profile', 'masu', 'riser', 'suiri', 'sleeve', 'material']);
    expect(check('profile').checked).toBe(true);
    expect(check('riser').checked).toBe(true);
    expect(check('material').checked).toBe(true);
    expect(check('mitori').checked).toBe(false);
    expect(check('mitori').disabled).toBe(true);
    expect(screen.getByTestId('shinsei-bundle-row-mitori').textContent).toContain('作れません');
    expect(screen.getByTestId('shinsei-bundle-row-profile').textContent).toMatch(/作れます|注意/);
    const btn = screen.getByTestId('shinsei-bundle-pdf') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    // 全部外すと押せない
    for (const k of rowIds()) { const c = check(k); if (c.checked) fireEvent.click(c); }
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('0');
  });

  it('「見る」でその図面のタブへ移り、一覧は閉じる', async () => {
    sampleDoc();
    render(<ShinseiScreen onClose={() => {}} />);
    await screen.findByTestId('shinsei-outlet');
    fireEvent.click(screen.getByTestId('shinsei-bundle'));
    fireEvent.click(within(await screen.findByTestId('shinsei-bundle-row-riser')).getByRole('button', { name: /見る/ }));
    expect(screen.queryByTestId('shinsei-bundle-dialog')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('shinsei-preview').innerHTML).toContain('給水装置 立面図'));
  });

  it('配管が無い工事: 図面はどれも作れず、PDF は押せない（材料表も無い）', async () => {
    s().newDoc(emptyDoc(), { id: 'e', name: '空の工事', createdAt: 1 });
    render(<ShinseiScreen onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId('shinsei-bundle'));
    await screen.findByTestId('shinsei-bundle-dialog');
    for (const k of rowIds()) expect(check(k).checked).toBe(false);
    expect((screen.getByTestId('shinsei-bundle-pdf') as HTMLButtonElement).disabled).toBe(true);
  });

  it('地図が取れず枠だけの見取図は、最初はチェックしない（白い枠だけのページを黙って入れない）', () => {
    const st = rowStatus({ sheets: [{} as never], svg: '', warnings: ['地図が無いため'], error: null, kind: 'mitori', mapMissing: true });
    expect(st.ready).toBe(true);
    expect(st.preChecked).toBe(false);
    expect(st.text).toContain('地図なし');
    expect(rowStatus({ sheets: [{} as never], svg: '', warnings: [], error: null, kind: 'profile' }).preChecked).toBe(true);
  });

  it('PDF を作れなかったときは、一覧の中にその理由が出る', async () => {
    sampleDoc();
    const orig = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response('', { status: 404 }))) as typeof fetch;
    try {
      render(<ShinseiScreen onClose={() => {}} />);
      fireEvent.click(await screen.findByTestId('shinsei-bundle'));
      fireEvent.click(await screen.findByTestId('shinsei-bundle-pdf'));
      const dlg = screen.getByTestId('shinsei-bundle-dialog');
      await waitFor(() => expect(within(dlg).getByRole('alert').textContent).toContain('出力できませんでした'));
    } finally { globalThis.fetch = orig; }
  });
});
