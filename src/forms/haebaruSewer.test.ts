/**
 * 南風原町で受理された排水設備の申請図面（2026-11-18 入手）と同じ書き方・同じ数値になるか。
 * 工事データは実物の配管を再現したもの（src/sample/haebaruCase.ts。個人情報は持たない）
 */
import { describe, expect, test } from 'vitest';
import { haebaruCase } from '../sample/haebaruCase';
import { BUILTIN_PROFILES } from '../model/municipality';
import { buildProfile, extractRoute, trimToManholes } from '../model/profileDrawing';
import { buildIsometric, isoManholeLabels } from '../model/isometric';
import { findTextOverlaps } from '../export/labelLayout';
import type { Sheet } from '../export/sheet';
import { drainageSheetsFor, drawingTitleValues, FORM_SETS } from './formSets';
import { haebaruSewerSheets, renderHaebaruSewerPage1 } from './haebaruSewer';
import { EMPTY_CONTRACTOR, withDefaults } from './types';
import { renderProfileSheet } from '../export/profileSheet';

const H = BUILTIN_PROFILES.find((p) => p.id === 'haebaru')!;
const texts = (s: Sheet) => s.ops.filter((o) => o.t === 'text').map((o) => (o as { s: string }).s);
const date = new Date(2026, 10, 18);
const tv = { '申請地': '南風原町字宮平100-1', '申請者': '山田 太郎 邸', '指定工事店': 'テスト設備' };

function model() {
  const { doc, publicPort } = haebaruCase({ twoFloors: true });
  const r = extractRoute(doc.network, publicPort);
  if (!('route' in r)) throw new Error('経路が取れない');
  return { doc, m: buildProfile(doc, trimToManholes(doc, r.route), H, '排水設備 縦断図') };
}

describe('縦断面図: 実物と同じ数値', () => {
  test('公共汚水ますの管底を ±0、地盤高・管底高・落差・区間（m）', () => {
    const { m } = model();
    const r = (x: number | undefined) => (x === undefined ? undefined : Math.round(x));
    // 上流（NO.1）→ 下流（公共）
    expect(m.nodes.map((n) => [r(n.groundLevel), r(n.invertLevel), r(n.invertIn)])).toEqual([
      [2000, 1590, undefined], [2000, 1550, undefined], [2000, 720, 1400], [1100, 690, undefined], [1100, 65, 580], [1100, 0, undefined],
    ]);
    expect(m.segments.map((s) => (s.distance / 1000).toFixed(2))).toEqual(['1.60', '7.10', '1.30', '5.30', '3.00']);
    expect(m.segments.map((s) => s.slopeText)).toEqual(['2.5/100', '2.1/100', '2.3/100', '2.1/100', '2.2/100']);
    expect(m.segments.map((s) => s.pipeSpec)).toEqual(Array(5).fill('100VU'));
    expect(m.nodes.map((n) => n.manhole?.name)).toEqual(['NO.1小口径桝', 'NO.2小口径桝', 'NO.3小口径桝', 'NO.4小口径桝', 'NO.5小口径桝', '既設公共桝']);
    expect(m.nodes.map((n) => n.manhole && [Math.round(n.manhole.depthIn ?? n.manhole.depth), Math.round(n.manhole.depth)])).toEqual([[410, 410], [450, 450], [600, 1280], [410, 410], [520, 1035], [1100, 1100]]);
  });
  test('図の書き方: 斜めの引出線の桝名・GL の段差・凡例の箱・表題欄', () => {
    const { m, doc } = model();
    const iso = buildIsometric(doc, 'drain', H, { manholeLabels: isoManholeLabels([m]) });
    const sheet = renderProfileSheet(m, { siteName: 'x', date, titleValues: tv }, iso);
    const t = texts(sheet);
    expect(t).toContain('立面図・縦断面図（展開図）');
    expect(t).toContain('NO.1小口径桝 内径150深410');
    expect(t).toContain('NO.3小口径桝 内径150深600-1280');
    expect(t).toContain('NO.5小口径桝 内径150深520-1035');
    expect(t).toContain('既設公共桝 内径250深1100');
    expect(t).toContain('(+900)');
    expect(t).toContain('(±0)');
    expect(t.filter((s) => /^\(([+−±])/.test(s))).toHaveLength(2); // 桝ごとには書かない
    expect(t).toEqual(expect.arrayContaining(['既設管', '新設管', '町下水道管', '※単位はmm　管長はm', 'S=1/300', '南風原町字宮平100-1', '山田 太郎 邸', 'テスト設備']));
    expect(t.some((s) => s.startsWith('DL '))).toBe(false);
    // 桝名は 30° 傾けて書く
    expect(sheet.ops.some((o) => o.t === 'text' && o.s.startsWith('NO.1小口径桝') && o.rotate === -30)).toBe(true);
    expect(findTextOverlaps(sheet)).toEqual([]);
  });
  test('配管立図: ① H=410、落差は H=600-1280、公共は 既設公共汚水桝 H=1100、枝は 長さ／口径 の 2 段', () => {
    const { m, doc } = model();
    const iso = buildIsometric(doc, 'drain', H, { manholeLabels: isoManholeLabels([m]) });
    const ds = drainageSheetsFor(doc, H, 'x', date, tv);
    const t = texts(ds.iso!);
    expect(t).toEqual(expect.arrayContaining(['① H=410', '② H=450', '③ H=600-1280', '④ H=410', '⑤ H=520-1035', '既設公共汚水桝 H=1100', 'VU100×1.6', 'VU100×7.1', 'VU100×3.0']));
    // 枝（器具から）は「VU50×…」と 1 行にしない。曲がりごとに書かず 1 本に 1 回
    expect(t.filter((s) => /^VU(50|75)×/.test(s))).toEqual([]);
    expect(t.filter((s) => s === 'VU75')).toHaveLength(1);
    expect(iso.lines.filter((l) => l.main)).toHaveLength(5);
    expect(findTextOverlaps(ds.iso!)).toEqual([]);
  });
});

describe('平面図（A3）', () => {
  test('各階の平面に排水。桝は ① H=410、本管は VU100×1.6、枝は VU50 と 長さの 2 段、GL は □ で囲む', () => {
    const { doc } = model();
    const plan = drainageSheetsFor(doc, H, 'x', date, tv).plan!;
    expect([plan.width, plan.height]).toEqual([420, 297]);
    const t = texts(plan);
    expect(t).toEqual(expect.arrayContaining(['① H=410', '③ H=600-1280', '既設公共汚水桝 H=1100', 'VU100×1.6', 'VU100×7.1', 'VU100×1.3', 'VU100×5.3', 'VU100×3.0', 'VU75', 'VU50', 'GL±0', 'GL−900', '1階', '2階', '既設管', '町下水道管', '山田 太郎 邸']));
    expect(t.filter((s) => /^VU(50|75)×/.test(s))).toEqual([]);
    // 既設（公共へ）は青、新設は赤
    expect(plan.ops.some((o) => o.t === 'line' && o.color === H.colors.existing)).toBe(true);
    expect(plan.ops.some((o) => o.t === 'line' && o.color === H.colors.newWork)).toBe(true);
    expect(plan.content).toBeDefined();
    expect(findTextOverlaps(plan)).toEqual([]);
  });
});

describe('排水設備計画確認申請書（4 面）', () => {
  const v = { date: '2026-11-18', ownerName: '山田 太郎', ownerKana: 'ヤマダ タロウ', ownerAddress: '南風原町字兼城1-1', ownerTel: '090-0000-0000', siteAddress: '南風原町字宮平100-1', sewerConnection: '公共ます', sewerWorkKind: '新築', waterSource: '水道水', sewerBuildingUse: '一般家庭', sewerHouseholds: '1', people: '4', workFrom: '2026-12-01', workTo: '2027-03-31', lending: '無し', pretreatment: '無し' };
  const c = { ...EMPTY_CONTRACTOR, name: 'テスト設備', sewerLicenseNo: '283', address: '那覇市テスト1-2-3', representative: '試験 一郎', tel: '098-000-0000', drainageEngineer: '試験 一郎', drainageEngineerNo: 'KT00 000-000000' };
  test('1 面: 様式の見出しと値。選んだ番号を ○ で囲む（接続先・種別・使用水・用途・貸付・除害）', () => {
    const p1 = renderHaebaruSewerPage1(v, c);
    const t = texts(p1);
    expect(t).toEqual(expect.arrayContaining(['排水設備計画確認申請書', '南', '様', '設置場所', '接続先', '義務者', '工事の種別', '使用水の種別', '建物の用途', '貸付状況', '除害施設', '太線内は記入しないでください。']));
    expect(t).toEqual(expect.arrayContaining(['8', '11', '18', '南風原町字兼城1-1', 'ヤマダ タロウ', '山田 太郎', '南風原町字宮平100-1', '第283号', '那覇市テスト1-2-3', 'テスト設備　098-000-0000', 'KT00 000-000000', '121']));
    // 義務者は所有者（申請者）と同じ
    expect(t.filter((s) => s === '山田 太郎')).toHaveLength(2);
    expect(p1.ops.filter((o) => o.t === 'circle')).toHaveLength(6);
    expect(findTextOverlaps(p1)).toEqual([]);
  });
  test('2〜4 面: 平面図＋縦断面図、配管立図、見取図の欄（図が無ければ空欄の注記）', () => {
    const { doc } = model();
    const ds = drainageSheetsFor(doc, H, 'x', date, tv);
    const pages = haebaruSewerSheets(v, c, { plan: ds.plan, profile: ds.profileOnly, iso: ds.iso });
    expect(pages).toHaveLength(4);
    expect(pages.every((p) => p.width === 210 && p.height === 297)).toBe(true);
    expect(texts(pages[1])).toEqual(expect.arrayContaining(['平面図及び縦断面図', '① H=410', 'NO.1小口径桝 内径150深410', '新設・増設は赤色、既設排水設備は青色、公共下水道は黒色で記入すること。']));
    // 2 面の縦断面図にはアイソメ図を入れない（3 面にある）
    expect(texts(pages[1]).filter((s) => s === '⑤ H=520-1035')).toHaveLength(1);
    expect(texts(pages[2])).toEqual(expect.arrayContaining(['配管立図', '① H=410', '既設公共汚水桝 H=1100']));
    expect(texts(pages[3])).toContain('見取図');
    const empty = haebaruSewerSheets(v, c, {});
    expect(texts(empty[1]).join('')).toContain('空欄');
  });
  test('南風原町の様式セット: 既定値と、確認申請書から工期', () => {
    const set = FORM_SETS.haebaru;
    const { doc } = model();
    expect(withDefaults(set, doc, { name: 'x' })).toMatchObject({ sewerConnection: '公共ます', sewerWorkKind: '新築', waterSource: '水道水', sewerBuildingUse: '一般家庭', lending: '無し', pretreatment: '無し' });
    expect(set.kakunin!({ workStart: '2026-12-01', workEnd: '2027-03-31' } as never)).toMatchObject({ workFrom: '2026-12-01', workTo: '2027-03-31' });
  });
  test('表題欄の値: 申請地は県・郡と続きの地番を省く、申請者は「○○ 邸」', () => {
    expect(drawingTitleValues({ siteAddress: '沖縄県島尻郡南風原町字宮平100-1,2,3', ownerName: '山田 太郎' }, '夢設備')).toEqual({ '申請地': '南風原町字宮平100-1', '申請者': '山田 太郎 邸', '指定工事店': '夢設備' });
    expect(drawingTitleValues(undefined, '', '沖縄市美里1-2')).toEqual({ '申請地': '沖縄市美里1-2', '申請者': '', '指定工事店': '' });
  });
});
