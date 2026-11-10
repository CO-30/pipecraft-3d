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

  it('分岐がある工事: 「全部」なら本線に「→別図」の注記、枝の中の分岐は警告に出る。保存されていないプロファイル ID は警告して標準で描く', async () => {
    // 公共マス(m2) ← 汚水マス(m1) ← 本線: m6（遠い）／枝: 汚水マス(m3) ← 枝の中の分岐: m4, m5
    const place = (type: FixtureType, x: number, y: number) => { s().setFixtureType(type); s().placeFixtureAt({ x, y }); return Object.values(s().doc.fixtures).filter((f) => f.type === type).pop()!.id; };
    const port = (fid: string) => Object.values(s().doc.network.nodes).find((n) => n.fixtureId === fid)!;
    const m3 = place('manholeSewage', 0, -3000); s().updateFixtureParams(m3, { invertZ: -950 });
    const m4 = place('manholeSewage', 0, -5000); s().updateFixtureParams(m4, { invertZ: -900 });
    const m5 = place('manholeSewage', 2000, -3000); s().updateFixtureParams(m5, { invertZ: -900 });
    const m6 = place('manholeSewage', -9000, -1200); s().updateFixtureParams(m6, { invertZ: -900 });
    const m1 = Object.values(s().doc.fixtures).find((f) => f.type === 'manholeSewage' && f.y === -1200)!.id;
    s().setDrawAttrs({ system: 'sewage', diameter: 100 });
    s().drawPolyline([port(m3).pos, port(m1).pos], { startNodeId: port(m3).id, endNodeId: port(m1).id });
    s().drawPolyline([port(m4).pos, port(m3).pos], { startNodeId: port(m4).id, endNodeId: port(m3).id });
    s().drawPolyline([port(m5).pos, port(m3).pos], { startNodeId: port(m5).id, endNodeId: port(m3).id });
    s().drawPolyline([port(m6).pos, port(m1).pos], { startNodeId: port(m6).id, endNodeId: port(m1).id });
    s().updateSite({ municipalityProfileId: 'mp_missing' });
    render(<ShinseiScreen onClose={() => {}} />);
    await screen.findByTestId('shinsei-outlet');
    // 本線上の分岐点は m1 だけ（m3 の分岐は枝の中）
    await waitFor(() => expect(screen.getAllByTestId(/^shinsei-branch-/)).toHaveLength(1));
    expect(screen.getByTestId(`shinsei-branch-${port(m1).id}`)).toBeTruthy();
    const html = () => screen.getByTestId('shinsei-preview').innerHTML;
    await waitFor(() => expect(html()).toContain('→別図'));
    expect(html().match(/<svg/g)?.length).toBe(2); // 本線＋枝
    const warnings = screen.getByTestId('shinsei-warnings').textContent ?? '';
    expect(warnings).toContain('含めていません');
    expect(warnings).toContain('見つからない');
    expect(html()).toContain('標準（下水道協会方式を参考）');
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

describe('ヘッダー工法', () => {
  afterEach(() => cleanup());
  it('給水ヘッダーを置いて出口から水栓へ PB13 をつなぐと、給水立面図（沖縄市: アイソメ）に「給水ヘッダー1P」と PB13', async () => {
    sampleDoc();
    s().updateSite({ municipalityProfileId: 'okinawa-city' });
    s().setFixtureType('waterHeader'); s().placeFixtureAt({ x: 2000, y: 3000 });
    const header = Object.values(s().doc.fixtures).find((f) => f.type === 'waterHeader')!;
    const hin = Object.values(s().doc.network.nodes).find((n) => n.fixtureId === header.id && n.portId === 'in')!;
    const hout = Object.values(s().doc.network.nodes).find((n) => n.fixtureId === header.id && n.portId === 'out1')!;
    const meter = Object.values(s().doc.fixtures).find((f) => f.type === 'waterMeter')!;
    const mo = Object.values(s().doc.network.nodes).find((n) => n.fixtureId === meter.id && n.portId === 'out')!;
    s().setDrawAttrs({ system: 'water', diameter: 20, material: 'HI' });
    s().drawPolyline([mo.pos, { x: hin.pos.x, y: mo.pos.y, z: mo.pos.z }, hin.pos], { startNodeId: mo.id, endNodeId: hin.id });
    s().setFixtureType('faucet'); s().placeFixtureAt({ x: 5000, y: 4000 });
    const faucet = Object.values(s().doc.fixtures).filter((f) => f.type === 'faucet').pop()!;
    const fp = Object.values(s().doc.network.nodes).find((n) => n.fixtureId === faucet.id)!;
    s().setDrawAttrs({ system: 'water', diameter: 13, material: 'PB' });
    s().drawPolyline([hout.pos, { x: fp.pos.x, y: hout.pos.y, z: hout.pos.z }, fp.pos], { startNodeId: hout.id, endNodeId: fp.id });
    render(<ShinseiScreen onClose={() => {}} />);
    await screen.findByTestId('shinsei-outlet');
    fireEvent.click(screen.getByTestId('shinsei-kind-riser'));
    await waitFor(() => expect(screen.getByTestId('shinsei-preview').innerHTML).toContain('給水ヘッダー1P'));
    expect(screen.getByTestId('shinsei-preview').innerHTML).toContain('PB13×');
  });
});
