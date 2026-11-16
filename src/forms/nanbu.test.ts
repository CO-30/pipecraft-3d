import { describe, expect, test } from 'vitest';
import { addFloor, createBuildingFromDims, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork } from '../model/network';
import { placeFixture, portNodes } from '../model/fixtures';
import { findTextOutside, findTextOverlaps } from '../export/labelLayout';
import type { Sheet } from '../export/sheet';
import { EMPTY_CONTRACTOR, withDefaults, type Contractor } from './types';
import { FORM_SETS } from './formSets';
import { OKINAWA_FORMS } from './okinawaCity';
import { drillChecks, NANBU_FORMS, nanbuWarnings, splitSite } from './nanbu';
import { insetSheet, nanbuSheets } from './nanbuSheets';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
function doc(): Doc {
  let d: Doc = { building: addFloor(addFloor(emptyBuilding(), { height: 3000 }).b, { height: 2800 }).b, network: emptyNetwork(), fixtures: {}, site: { designGL: -100 } };
  const fl = d.building.floors[0].id;
  const m = placeFixture(d, fl, 'waterMeter', { x: 0, y: 0 }); d = m.doc;
  const mp = portNodes(d.network, m.fixtureId!).find((p) => p.portId === 'out')!;
  const f = placeFixture(d, fl, 'faucet', { x: 3000, y: 0 }); d = f.doc;
  const fp = portNodes(d.network, f.fixtureId!)[0];
  d = { ...d, network: addPolyline(d.network, [mp.pos, v(3000, 0, 1000), fp.pos], { system: 'water', diameter: 20, material: 'HIVP' }, { startNodeId: mp.id, endNodeId: fp.id }).net };
  d = placeFixture(d, fl, 'publicSewage', { x: 8000, y: 5000 }).doc;
  return d;
}
const texts = (s: Sheet) => s.ops.filter((o) => o.t === 'text').map((o) => (o as { s: string }).s);
const all = (ss: Sheet[]) => ss.flatMap(texts).join('\n');

describe('南部水道企業団の様式セット（南風原町・八重瀬町）', () => {
  test('南風原町・八重瀬町のプロファイルで使う。チェック表は実物の 14 項目', () => {
    expect(FORM_SETS.haebaru).toBe(NANBU_FORMS);
    expect(FORM_SETS.yaese.fields).toBe(NANBU_FORMS.fields);
    expect(NANBU_FORMS.checklist).toHaveLength(14);
    expect(NANBU_FORMS.checklist[0].label).toBe('給水申請書(表)、臨時給水(裏)');
    const ids = NANBU_FORMS.fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test('既定値: メーター口径・公共ます→公共下水道・設置場所は県と郡を除く・新設は臨時給水あり', () => {
    const vals = withDefaults(NANBU_FORMS, doc(), { name: '現場', address: '沖縄県島尻郡南風原町字テスト1-2' });
    expect(vals).toMatchObject({ diameter: '20', drainTo: '公共下水道', siteAddress: '南風原町字テスト1-2', workKind: '新設', tempSupply: '有り', supplyKind: '専用給水', useKind: '一般用', buildingUse: '住宅', userSame: '同じ', floorsAbove: '2' });
  });
  test('設置場所を町と字以下に分ける（様式第6号の欄）', () => {
    expect(splitSite('南風原町字〇〇100-1')).toEqual({ town: '南風原', aza: '〇〇100-1' });
    expect(splitSite('沖縄県島尻郡八重瀬町字東風平1')).toEqual({ town: '八重瀬', aza: '東風平1' });
    expect(splitSite('那覇市泉崎1-1')).toEqual({ town: '', aza: '那覇市泉崎1-1' });
  });
  test('確認申請書から: 建築主＝所有者・確認番号・延べ面積・工事完了予定＝臨時給水の期限', () => {
    const r = NANBU_FORMS.kakunin!({ ownerName: '水野 太郎', ownerKana: 'ミズノ タロウ', siteAddress: '沖縄県島尻郡南風原町字テスト1', confirmNo: 'ABC-1', confirmDate: '2026-09-30', totalArea: '88.20', floorsAbove: '2', floorsBelow: '0', structure: '木造', workKind: '新築', workEnd: '2027-02-20' });
    expect(r).toMatchObject({ ownerName: '水野 太郎', ownerKana: 'ミズノ タロウ', siteAddress: '南風原町字テスト1', confirmNo: 'ABC-1', confirmDate: '2026-09-30', totalArea: '88.20', floorsAbove: '2', floorsBelow: '0', structure: '木造', workKind: '新設', tempUntil: '2027-02-20' });
  });
  test('沖縄市の様式にも確認申請書から（構造は選択肢に合わせて「木」）', () => {
    expect(OKINAWA_FORMS.kakunin!({ ownerName: '水野 太郎', structure: '木造', floorsAbove: '2', workStart: '2026-12-01', workEnd: '2027-02-20' })).toMatchObject({ applicantName: '水野 太郎', structure: '木', floors: '2', workFrom: '2026-12-01', workTo: '2027-02-20' });
  });
});

describe('穿孔時書類確認（実物の 10 項目）を自動で判定', () => {
  function heaterDoc(hot: string): Doc {
    const building = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 120, slabThickness: 200 });
    let d: Doc = { building, network: emptyNetwork(), fixtures: {} };
    d = placeFixture(d, building.floors[0].id, 'waterHeater', { x: -800, y: 1000 }).doc;
    d = placeFixture(d, building.floors[0].id, 'waterMeter', { x: -2000, y: 1000 }).doc;
    return { ...d, network: addPolyline(d.network, [v(-2000, 2000, -300), v(-1000, 2000, -300)], { system: 'hotWater', diameter: 13, material: hot }).net };
  }
  const st = (d: Doc, vals: Record<string, string>) => Object.fromEntries(drillChecks(d, vals).map((c) => [c.label.slice(0, 6), c.status]));
  test('10 項目。ガス給湯器に HT は ⚠、PB なら ✓', () => {
    expect(drillChecks(heaterDoc('PB'), {})).toHaveLength(10);
    expect(drillChecks(heaterDoc('HTVP'), {})[9]).toMatchObject({ status: 'warn' });
    expect(drillChecks(heaterDoc('PB保温10mm'), {})[9]).toMatchObject({ status: 'ok' });
  });
  test('日付あり ✓・なし ⚠。県道で引込管が PE でなければ ⚠。私道は ⚠（承諾書）。設計水圧が 0.2 以外は ⚠。店舗は ⚠（樹脂製品）', () => {
    const d = heaterDoc('PB');
    const c = drillChecks(d, { date: '2026-11-16', 'road.roadKind': '県道', 'road.waterPipe': 'HIVP', 'suiri.pressure': '0.25', buildingUse: '店舗' });
    expect(c.map((x) => x.status)).toEqual(['manual', 'manual', 'warn', 'warn', 'warn', 'ok', 'ok', 'manual', 'warn', 'ok']);
    const c2 = drillChecks(d, { 'road.roadKind': '私道', 'road.waterPipe': 'PE', 'road.waterMain': 'DIP', 'road.waterMainDia': '75' }, '南風原町');
    expect(c2.map((x) => x.status)).toEqual(['warn', 'manual', 'manual', 'manual', 'manual', 'warn', 'ok', 'manual', 'ok', 'ok']);
    void st;
  });
});

const longC: Contractor = { ...EMPTY_CONTRACTOR, name: '株式会社テスト設備工業所 南部営業所', licenseNo: '99001', address: '沖縄県那覇市テスト一丁目二番地の三 テストビル二階', representative: '代表取締役 水道 太郎', tel: '090-0000-0000', chiefEngineer: '主任 花子', chiefEngineerNo: '900001', chiefEngineerTel: '090-1111-2222' };
const longV = {
  date: '2026-11-16', workKind: '新設', supplyKind: '専用給水', useKind: '一般用', buildingUse: '住宅', drainTo: '公共下水道', diameter: '20', tempSupply: '有り', tempUntil: '2027-02-20',
  siteAddress: '南風原町字テスト字テスト原五十番地の一，二，三（テスト分譲地内）', buildingName: 'テストハイツ',
  ownerZip: '901-0000', ownerAddress: '沖縄県島尻郡南風原町字テスト十番地の五 テストアパート一〇一号室', ownerKana: 'ミズノ タロウ', ownerName: '水野 太郎', ownerTel: '090-0000-1111',
  userSame: '別', userAddress: '沖縄県浦添市テスト一丁目一番地', userKana: 'カブシキガイシャ テストケンセツ オキナワシテン', userName: '株式会社テスト建設 沖縄支店', userTel: '098-000-0000',
  confirmNo: 'ABC-26-00000-1', confirmDate: '2026-09-30', totalArea: '88.20', floorsAbove: '2', floorsBelow: '0', structure: '木造',
  roadOccNo: '南風原町道第 123', roadOccDate: '2026-12-01', roadUseNo: '与那原署第 45', roadUseDate: '2026-11-02',
  offsets: '電柱（No.12）から 3.20m\n汚水桝から 1.50m',
};
const meta = { siteName: '水野邸新築工事', date: new Date(2026, 10, 16) };

describe('南部水道企業団の申請書 PDF 一式（A4 縦）', () => {
  test('並び: チェック表 2 枚 → 給水申込書 → 臨時給水の誓約書 → 様式第6号 → 横断面図・オフセット → 竣工検査項目', () => {
    const ss = nanbuSheets(longV, longC, { ...meta, products: [] });
    expect(ss).toHaveLength(7);
    const heads = ss.map((s) => texts(s).join('').replace(/[　 ]/g, ''));
    expect(heads[0]).toContain('給水装置工事申請書類チェック表');
    expect(heads[1]).toContain('穿孔時書類確認');
    expect(heads[2]).toContain('給水申込書');
    expect(heads[2]).toContain('委任状');
    expect(heads[3]).toContain('臨時用給水に関する誓約書');
    expect(heads[4]).toContain('給水装置工事申請書及び設計書');
    expect(heads[5]).toContain('横断面図');
    expect(heads[5]).toContain('オフセット');
    expect(heads[6]).toContain('竣工検査項目');
  });
  test('臨時給水「無し」なら誓約書は入れない。製品一覧表は最後に付く', () => {
    const prod: Sheet = { width: 297, height: 210, ops: [{ t: 'text', x: 20, y: 20, s: '製品', size: 3 }] };
    const ss = nanbuSheets({ ...longV, tempSupply: '無し' }, longC, { ...meta, products: [prod] });
    expect(ss).toHaveLength(7);
    expect(all(ss)).not.toContain('臨時用給水に関する誓約書');
    expect(ss[6]).toBe(prod);
  });
  test('値が入る（所有者・使用者・確認番号・延べ面積・主任技術者・許可番号・オフセット）', () => {
    const t = all(nanbuSheets(longV, longC, { ...meta, products: [] }));
    for (const s of ['水野 太郎', 'ミズノ タロウ', 'ABC-26-00000-1', '88.20', '900001', '99001', '南風原町道第 123', '電柱（No.12）から 3.20m', '令和9年2月20日']) expect(t).toContain(s);
  });
  test('長い名前・住所でも全シートで文字の重なり 0・はみ出し 0。何も入れなくても描ける', () => {
    for (const vals of [longV, {}]) for (const s of nanbuSheets(vals, vals === longV ? longC : EMPTY_CONTRACTOR, { ...meta, products: [] })) {
      expect([s.width, s.height]).toEqual([210, 297]);
      expect(findTextOverlaps(s)).toEqual([]);
      expect(findTextOutside(s)).toEqual([]);
    }
  });
  test('見取図・道路の横断図を枠に縮めて載せる', () => {
    const map: Sheet = { width: 210, height: 297, ops: [{ t: 'rect', x: 12, y: 40, w: 186, h: 226 }, { t: 'text', x: 100, y: 150, s: '工事場所', size: 4 }] };
    const road: Sheet = { width: 297, height: 210, ops: [{ t: 'text', x: 20, y: 20, s: '横断図・復旧断面図', size: 6 }] };
    const ss = nanbuSheets(longV, longC, { ...meta, products: [], map, roadSection: road });
    expect(texts(ss[2])).toContain('工事場所');
    expect(texts(ss[4])).toContain('工事場所');
    expect(texts(ss[5])).toContain('横断図・復旧断面図');
    for (const s of ss) { expect(findTextOverlaps(s)).toEqual([]); expect(findTextOutside(s)).toEqual([]); }
  });
});

test('insetSheet: 図を枠に合わせて縮めて置く（縦横比はそのまま、中央）', () => {
  const dst: Sheet = { width: 210, height: 297, ops: [] };
  insetSheet(dst, { width: 200, height: 100, ops: [{ t: 'line', x1: 0, y1: 0, x2: 200, y2: 100 }, { t: 'text', x: 100, y: 50, s: 'A', size: 4 }] }, { x: 0, y: 0, w: 200, h: 100 }, { x: 10, y: 10, w: 100, h: 100 });
  expect(dst.ops[0]).toMatchObject({ t: 'line', x1: 10, y1: 35, x2: 110, y2: 85 });
  expect(dst.ops[1]).toMatchObject({ t: 'text', x: 60, y: 60, size: 2 });
});

describe('レビューの指摘（窓口で差し戻されないように）', () => {
  test('誓約書の署名欄は 申請者（施主）・使用者（所在地・社名・代表者）・指定工事事業者 の 3 つ', () => {
    const ss = nanbuSheets({ ...longV, userRep: '代表取締役 建設 次郎' }, longC, { ...meta, products: [] });
    const t = texts(ss[3]).join('\n');
    expect(t).toContain('指定工事事業者');
    expect(t).toContain(longC.name);
    expect(t).toContain('代表取締役 建設 次郎');
    expect(t).toContain('所在地');
    expect(findTextOverlaps(ss[3])).toEqual([]);
    expect(findTextOutside(ss[3])).toEqual([]);
  });
  test('臨時給水ありで使用者が所有者と同じなら気をつけること（誓約書の第 1 項: 使用者は建築工事請負者）', () => {
    expect(nanbuWarnings({ tempSupply: '有り', userSame: '同じ' }).join('')).toContain('使用者');
    expect(nanbuWarnings({ tempSupply: '有り', userSame: '別' })).toEqual([]);
    expect(nanbuWarnings({ tempSupply: '無し', userSame: '同じ' })).toEqual([]);
  });
  test('見取図は枠の形に切り抜いて大きく入れる（工事場所の文字が読める大きさ）。方位の N を描く', () => {
    const map: Sheet = { width: 210, height: 297, ops: [{ t: 'image', x: 12, y: 40, w: 186, h: 226, href: 'data:image/png;base64,AAAA' }, { t: 'text', x: 120, y: 140, s: '工事場所', size: 4.2 }] };
    const ss = nanbuSheets(longV, longC, { ...meta, products: [], map });
    for (const i of [2, 4]) {
      const label = ss[i].ops.find((o) => o.t === 'text' && (o as { s: string }).s === '工事場所') as { size: number };
      expect(label.size).toBeGreaterThanOrEqual(3);
      const img = ss[i].ops.find((o) => o.t === 'image') as { clip?: unknown };
      expect(img.clip).toBeTruthy();
      expect(texts(ss[i])).toContain('N');
      expect(findTextOverlaps(ss[i])).toEqual([]);
    }
  });
  test('穿孔時の確認 1: 添付書類はチェック表が全部済みのときだけ ✓（申請日は既定で入るので日付だけでは判定しない）', () => {
    const d = doc();
    expect(drillChecks(d, { date: '2026-11-16' })[0].status).toBe('manual');
    const all = Object.fromEntries(NANBU_FORMS.checklist.map((c) => [`checklist:${c.label}`, '1']));
    expect(drillChecks(d, { date: '2026-11-16', ...all })[0].status).toBe('ok');
    expect(drillChecks(d, { ...all })[0].status).toBe('warn');
  });
  test('穿孔時の確認 5: 水理計算に使う水圧（入力が無ければ自治体の値）で判定。南部水道企業団は 0.2MPa', () => {
    const d = doc();
    expect(drillChecks(d, {}, '南風原町')[4]).toMatchObject({ status: 'manual' });
    expect(drillChecks(d, {}, '南風原町')[4].note).toContain('0.2');
    expect(drillChecks(d, { 'suiri.pressure': '0.15' }, '南風原町')[4].status).toBe('warn');
  });
});
