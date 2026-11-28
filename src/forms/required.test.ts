import { describe, expect, it } from 'vitest';
import { formRequiredReasons } from './required';
import { FORM_SETS } from './formSets';
import type { Doc } from '../model/doc';
import { addFloor, emptyBuilding } from '../model/building';
import { emptyNetwork } from '../model/network';
import { withDefaults } from './types';

const ok = FORM_SETS['okinawa-city'];
const hae = FORM_SETS.haebaru;
const doc: Doc = { building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {}, site: {} };
const full = (set: typeof ok, over: Record<string, string> = {}) => ({ ...withDefaults(set, doc, { name: 'x' }), applicantName: '太郎', applicantAddress: '住所', ownerName: '太郎', ownerAddress: '住所', people: '4', workFrom: '2026-12-01', workTo: '2026-12-20', tempUntil: '2027-03-31', diameter: '20', drainTo: '公共下水道', ...over });
const j = (a: string[]) => a.join('|');

describe('様式ごとの必須項目（空欄のまま印刷される欄）', () => {
  it('既定値と人員・工事予定期間が入った普通の新築は、どの書類も理由なし', () => {
    expect(formRequiredReasons('water', ok, full(ok))).toEqual([]);
    expect(formRequiredReasons('sewer', ok, full(ok))).toEqual([]);
    expect(formRequiredReasons('nanbu', hae, full(hae))).toEqual([]);
    expect(formRequiredReasons('sewer', hae, full(hae))).toEqual([]);
  });

  it('下水道: 工事予定期間・人員が空なら「空欄のまま印刷されます」と出す（既定値だけの状態）', () => {
    const r = formRequiredReasons('sewer', hae, { ...full(hae), people: '', workFrom: '', workTo: ' ' });
    expect(j(r)).toContain('工事予定期間');
    expect(j(r)).toContain('人員');
    expect(j(r)).toContain('空欄のまま印刷されます');
  });

  it('下水道: 選ぶ欄（接続先・工事の種別・使用水の種別・建物の用途）が空なら出す', () => {
    const r = formRequiredReasons('sewer', ok, { ...full(ok), sewerConnection: '', sewerWorkKind: '', waterSource: '', sewerBuildingUse: '' });
    for (const s of ['接続先', '工事の種別', '使用水の種別', '建物の用途']) expect(j(r)).toContain(s);
  });

  it('義務者: 空でも申込者（南風原町は所有者）が印刷されるので、ここでは出さない（申込者の未入力は共通の理由で出る）', () => {
    expect(j(formRequiredReasons('sewer', ok, { ...full(ok), obligorName: '', obligorAddress: '', applicantName: '' }))).not.toContain('義務者');
    expect(j(formRequiredReasons('sewer', hae, { ...full(hae), obligorName: '', ownerName: '', ownerAddress: '' }))).not.toContain('義務者');
  });

  it('条件つき: 「その他」の内容・使途・除害施設の内容', () => {
    const r = formRequiredReasons('sewer', ok, { ...full(ok), waterSource: 'その他', waterSourceOther: '', sewerBuildingUse: '会社', sewerBuildingUseNote: '', pretreatment: '有り', pretreatmentNote: '' });
    expect(j(r)).toContain('使用水の種別「その他」の内容');
    expect(j(r)).toContain('使途');
    expect(j(r)).toContain('除害施設の内容');
    expect(formRequiredReasons('sewer', ok, { ...full(ok), waterSource: 'その他', waterSourceOther: '雨水再利用', sewerBuildingUse: 'アパート', apartmentHouseholds: '6', apartmentPeople: '12', pretreatment: '無し' })).toEqual([]);
    // アパートの欄が空でも、一般の世帯数・人員が印刷される（印刷と同じ補い方）
    expect(formRequiredReasons('sewer', ok, { ...full(ok), sewerBuildingUse: 'アパート' })).toEqual([]);
    expect(j(formRequiredReasons('sewer', ok, { ...full(ok), sewerBuildingUse: 'アパート', households: '', people: '' }))).toContain('アパートの世帯数・アパートの人員');
    expect(j(formRequiredReasons('sewer', hae, { ...full(hae), sewerBuildingUse: 'アパート', sewerHouseholds: '', people: '' }))).toContain('アパートの世帯数・アパートの人員');
  });

  it('工事予定期間の「至」が「自」より前なら出す（同じ日は出さない）', () => {
    expect(j(formRequiredReasons('sewer', hae, { ...full(hae), workFrom: '2026-12-20', workTo: '2026-12-01' }))).toContain('「至」が「自」より前');
    expect(formRequiredReasons('sewer', hae, { ...full(hae), workFrom: '2026-12-01', workTo: '2026-12-01' })).toEqual([]);
  });

  it('給水（沖縄市）: 工事の種類・使用形態・給水方式・用途別・口径。使用者が別なら氏名・住所', () => {
    const r = formRequiredReasons('water', ok, { ...full(ok), waterWorkKind: '', useType: '', supplyType: '', purpose: '', diameter: '', userSame: '別', userName: '', userAddress: '' });
    for (const s of ['工事の種類', '使用形態', '給水方式', '用途別', '口径', '使用者の氏名', '使用者の住所']) expect(j(r)).toContain(s);
    expect(j(formRequiredReasons('water', ok, { ...full(ok), useType: 'その他', useTypeOther: '' }))).toContain('使用形態「その他」の内容');
  });

  it('給水（南部）: 工事・種別・用途・建物・排水放流先・メーター口径。臨時給水が有りなら使用期限', () => {
    const r = formRequiredReasons('nanbu', hae, { ...full(hae), workKind: '', supplyKind: '', useKind: '', buildingUse: '', drainTo: '', diameter: '', tempSupply: '有り', tempUntil: '' });
    for (const s of ['工事', '種別', '用途', '建物', '排水放流先', 'メーター口径', '臨時給水の使用期限']) expect(j(r)).toContain(s);
    expect(j(formRequiredReasons('nanbu', hae, { ...full(hae), tempSupply: '無し', tempUntil: '' }))).not.toContain('使用期限');
  });

  it('様式に無い項目は調べない（南部の給水に下水道の欄は無い → 八重瀬町は下水道の理由を出さない）', () => {
    expect(formRequiredReasons('sewer', FORM_SETS.yaese, full(FORM_SETS.yaese, { people: '' }))).toEqual([]);
  });

  it('世帯数（南風原は sewerHouseholds、沖縄市は households）・貸付状況・除害施設の有無が空なら出す', () => {
    expect(j(formRequiredReasons('sewer', hae, { ...full(hae), sewerHouseholds: '' }))).toContain('世帯数');
    expect(j(formRequiredReasons('sewer', ok, { ...full(ok), households: '' }))).toContain('世帯数');
    const r = j(formRequiredReasons('sewer', ok, { ...full(ok), lending: '', pretreatment: '' }));
    expect(r).toContain('貸付状況');
    expect(r).toContain('除害施設の有無');
  });
});
