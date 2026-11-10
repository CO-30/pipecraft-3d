// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyDoc, useStore } from '../state/store';
import { repo } from '../storage/instance';
import { ShinseiScreen } from './ShinseiScreen';
import { CONTRACTOR_KEY } from '../forms/formSets';
import type { Contractor } from '../forms/types';
import type { FixtureType } from '../model/fixtures';

const s = () => useStore.getState();

function sampleDoc() {
  s().newDoc(emptyDoc(), { id: 'p', name: 'テスト工事', address: '沖縄市美里5-28-2', createdAt: 1 });
  s().updateSite({ designGL: -450, municipalityProfileId: 'okinawa-city' });
  const place = (type: FixtureType, x: number, y: number) => { s().setFixtureType(type); s().placeFixtureAt({ x, y }); return Object.values(s().doc.fixtures).filter((f) => f.type === type).pop()!.id; };
  const port = (fid: string, pid: string) => Object.values(s().doc.network.nodes).find((n) => n.fixtureId === fid && n.portId === pid)!;
  const m1 = place('manholeSewage', 0, -1200); s().updateFixtureParams(m1, { invertZ: -1000 });
  const m2 = place('publicSewage', 6000, -1200); s().updateFixtureParams(m2, { invertZ: -1060 });
  s().setDrawAttrs({ system: 'sewage', diameter: 100 });
  s().drawPolyline([port(m1, 'pipe').pos, port(m2, 'pipe').pos], { startNodeId: port(m1, 'pipe').id, endNodeId: port(m2, 'pipe').id });
  const meter = place('waterMeter', -1000, 3000);
  const faucet = place('faucet', 3000, 3000);
  s().setDrawAttrs({ system: 'water', diameter: 20 });
  const mo = port(meter, 'out'), fw = port(faucet, 'water');
  s().drawPolyline([mo.pos, { x: 1000, y: mo.pos.y, z: mo.pos.z }, { x: 1000, y: fw.pos.y, z: fw.pos.z }, fw.pos], { startNodeId: mo.id, endNodeId: fw.id });
}

describe('申請書タブ', () => {
  beforeEach(() => { sampleDoc(); });
  afterEach(() => cleanup());

  it('沖縄市: 項目が現場の既定値で出て、入力すると現場に保存される。チェックリストあり', async () => {
    render(<ShinseiScreen onClose={() => {}} />);
    await screen.findByTestId('shinsei-outlet');
    fireEvent.click(screen.getByTestId('shinsei-kind-forms'));
    await screen.findByTestId('shinsei-forms');
    expect((screen.getByTestId('app-diameter') as HTMLInputElement).value).toBe('20');
    expect((screen.getByTestId('app-siteAddress') as HTMLInputElement).value).toBe('沖縄市美里5-28-2');
    expect((screen.getByTestId('app-sewerConnection') as HTMLSelectElement).value).toBe('公共ます');
    expect((screen.getByTestId('app-feeAdmission') as HTMLInputElement).value).toBe('32450');
    fireEvent.change(screen.getByTestId('app-applicantName'), { target: { value: '水道 太郎' } });
    expect(s().doc.site?.application?.applicantName).toBe('水道 太郎');
    fireEvent.change(screen.getByTestId('app-supplyType'), { target: { value: '受水槽' } });
    expect(s().doc.site?.application?.supplyType).toBe('受水槽');
    expect(screen.getByTestId('forms-checklist').textContent).toContain('下水道排水設備計画確認申請書');
    // 図面の PDF/SVG ボタンは申請書タブでは使えない
    expect((screen.getByTestId('shinsei-pdf') as HTMLButtonElement).disabled).toBe(true);
  });

  it('工事店の情報はこの端末に保存され、次に開いたときに入っている', async () => {
    render(<ShinseiScreen onClose={() => {}} />);
    await screen.findByTestId('shinsei-outlet');
    fireEvent.click(screen.getByTestId('shinsei-kind-forms'));
    await screen.findByTestId('forms-contractor-missing');
    fireEvent.click(screen.getByTestId('forms-contractor-toggle'));
    fireEvent.change(screen.getByTestId('contractor-name'), { target: { value: 'テスト設備' } });
    fireEvent.change(screen.getByTestId('contractor-chiefEngineer'), { target: { value: '主任 花子' } });
    fireEvent.click(screen.getByTestId('contractor-save'));
    await screen.findByTestId('forms-msg');
    const saved = await repo.getSetting<Contractor>(CONTRACTOR_KEY);
    expect(saved?.name).toBe('テスト設備');
    expect(saved?.chiefEngineer).toBe('主任 花子');
    cleanup();
    render(<ShinseiScreen onClose={() => {}} />);
    await screen.findByTestId('shinsei-outlet');
    fireEvent.click(screen.getByTestId('shinsei-kind-forms'));
    await screen.findByTestId('shinsei-forms');
    await waitFor(() => expect(screen.queryByTestId('forms-contractor-missing')).toBeNull());
  });

  it('様式が無い自治体（標準）は未登録と出る', async () => {
    s().updateSite({ municipalityProfileId: 'standard' });
    render(<ShinseiScreen onClose={() => {}} />);
    await screen.findByTestId('shinsei-outlet');
    fireEvent.click(screen.getByTestId('shinsei-kind-forms'));
    await screen.findByTestId('shinsei-forms-none');
  });
});
