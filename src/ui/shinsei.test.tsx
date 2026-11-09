// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyDoc, useStore } from '../state/store';
import { ShinseiScreen } from './ShinseiScreen';
import type { FixtureType } from '../model/fixtures';

const s = () => useStore.getState();
const v = (x: number, y: number, z = 0) => ({ x, y, z });

/** トイレ → 汚水マス → 公共汚水マス、メーター → 水栓 */
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
  return { m2 };
}

describe('申請図面の画面', () => {
  beforeEach(() => { sampleDoc(); });
  afterEach(() => cleanup());

  it('下流端の候補は公共マスが先頭、プレビューに縦断図の SVG が出る', async () => {
    render(<ShinseiScreen onClose={() => {}} />);
    const sel = (await screen.findByTestId('shinsei-outlet')) as HTMLSelectElement;
    expect(sel.options[0].textContent).toContain('公共汚水マス');
    await waitFor(() => expect(screen.getByTestId('shinsei-preview').innerHTML).toContain('<svg'));
    expect(screen.getByTestId('shinsei-preview').innerHTML).toContain('排水設備 縦断図');
    expect(screen.getByTestId('shinsei-preview').innerHTML).toContain('1/100');
    expect(screen.queryByTestId('shinsei-error')).toBeNull();
  });

  it('立面図に切り替えると給水装置 立面図', async () => {
    render(<ShinseiScreen onClose={() => {}} />);
    await screen.findByTestId('shinsei-outlet');
    fireEvent.click(screen.getByTestId('shinsei-kind-riser'));
    await waitFor(() => expect(screen.getByTestId('shinsei-preview').innerHTML).toContain('給水装置 立面図'));
    expect((screen.getByTestId('shinsei-root') as HTMLSelectElement).options[0].textContent).toContain('水道メーター');
  });

  it('設計GL を空にすると「仮」、排水の無い工事ではエラー表示', async () => {
    s().updateSite({ designGL: undefined });
    render(<ShinseiScreen onClose={() => {}} />);
    await screen.findByTestId('shinsei-outlet');
    await waitFor(() => expect(screen.getByTestId('shinsei-preview').innerHTML).toContain('（仮）'));
    expect(screen.getByTestId('shinsei-gl-tentative')).toBeTruthy();
    cleanup();
    s().newDoc(emptyDoc(), { id: 'q', name: '空', createdAt: 1 });
    render(<ShinseiScreen onClose={() => {}} />);
    expect((await screen.findByTestId('shinsei-error')).textContent).toContain('排水の配管がありません');
  });
});
