/**
 * 南風原町「排水設備計画確認申請書」（A4 縦 4 面）を描き起こす。受理された実物（記入済み、2026-11-18 入手）の罫線と見出しを写した
 * （白紙の様式 PDF は町のサイトから取れず、記入済みの実物は個人情報を含むので背景には使わない）。
 * 1 面: 申請書（値と、選んだ番号を ○ で囲む）
 * 2 面「平面図及び縦断面図」: 上に排水平面図、下に縦断面図（表まで）
 * 3 面「配管立図」: 排水のアイソメ図（立面図・展開図）
 * 4 面「見取図」: 地図（申請地に ☆）
 * 値は南部水道企業団の給水と同じ入力（所有者＝申請者・義務者）に、下水道の項目（接続先・工事の種別 …）を足したもの。
 */
import type { Doc } from '../model/doc';
import { MAP_FRAME } from '../export/locationSheet';
import { fitText, GRAY, type Sheet } from '../export/sheet';
import { insetSheet } from './nanbuSheets';
import { HAEBARU_SEWER_RULES, HAEBARU_SEWER_TEXTS } from './haebaruSewerLayout';
import { NANBU_FIELDS, NANBU_FORMS } from './nanbu';
import { SEWER_BUILDING_USES, WATER_SOURCES } from './okinawaCity';
import { reiwa, type ApplicationValues, type Contractor, type FormField, type FormSet } from './types';

const W = 210, H = 297;
const G = '下水道（排水設備計画確認申請書）';
/** 申請書の様式の選択肢（実物の書き方。「くみ取改造」「ます設置(新規)」） */
export const HAEBARU_CONNECTIONS = ['公共ます', 'ます設置(新規)', '私設置ます', '物件設置'];
export const HAEBARU_WORK_KINDS = ['くみ取改造', '浄化槽改造', '新築', '増築', '改築', '臨時'];

export const HAEBARU_SEWER_FIELDS: FormField[] = [
  { id: 'sewerConnection', label: '接続先', kind: 'choice', group: G, options: HAEBARU_CONNECTIONS },
  { id: 'sewerWorkKind', label: '工事の種別', kind: 'choice', group: G, options: HAEBARU_WORK_KINDS },
  { id: 'waterSource', label: '使用水の種別', kind: 'choice', group: G, options: WATER_SOURCES },
  { id: 'waterSourceOther', label: '使用水 その他の内容', kind: 'text', group: G },
  { id: 'sewerBuildingUse', label: '建物の用途', kind: 'choice', group: G, options: SEWER_BUILDING_USES },
  { id: 'sewerBuildingUseOther', label: '用途 その他の内容', kind: 'text', group: G },
  { id: 'sewerBuildingUseNote', label: '使途（一般家庭・アパート以外）', kind: 'text', group: G },
  { id: 'sewerHouseholds', label: '世帯数', kind: 'number', group: G },
  { id: 'people', label: '人員', kind: 'number', group: G },
  { id: 'obligorName', label: '義務者 氏名', kind: 'text', group: G, hint: '空なら所有者（申請者）と同じ' },
  { id: 'obligorAddress', label: '義務者 住所', kind: 'text', group: G, hint: '空なら所有者（申請者）と同じ' },
  { id: 'workFrom', label: '工事予定期間 自', kind: 'date', group: G },
  { id: 'workTo', label: '工事予定期間 至', kind: 'date', group: G },
  { id: 'lending', label: '貸付状況', kind: 'choice', group: G, options: ['有り', '無し'] },
  { id: 'pretreatment', label: '除害施設', kind: 'choice', group: G, options: ['有り', '無し'] },
  { id: 'pretreatmentNote', label: '除害施設の内容', kind: 'text', group: G },
];

/** 南風原町: 給水（南部水道企業団）と下水道（町）の申請書を同じ入力から作る */
export const HAEBARU_FORMS: FormSet = {
  ...NANBU_FORMS,
  profileId: 'haebaru',
  fields: [...NANBU_FIELDS, ...HAEBARU_SEWER_FIELDS],
  sewer: 'haebaru',
  defaults: (doc: Doc, meta) => {
    const hasPublic = Object.values(doc.fixtures).some((f) => f.type === 'publicSewage');
    return { ...NANBU_FORMS.defaults(doc, meta), sewerConnection: hasPublic ? '公共ます' : 'ます設置(新規)', sewerWorkKind: '新築', waterSource: '水道水', sewerBuildingUse: '一般家庭', sewerHouseholds: '1', lending: '無し', pretreatment: '無し' };
  },
  kakunin: (k) => ({ ...NANBU_FORMS.kakunin!(k), ...(k.workStart ? { workFrom: k.workStart } : {}), ...(k.workEnd ? { workTo: k.workEnd } : {}) }),
  checklist: [
    ...NANBU_FORMS.checklist,
    { label: '下水道: 排水設備計画確認申請書（申請書・平面図及び縦断面図・配管立図・見取図）', app: true, note: '「下水道申請書 (PDF)」。別に A3 の平面図・A4 の縦断面図も申請図面から' },
  ],
};

type T = { t: 'text'; x: number; y: number; s: string; size: number; anchor?: 'start' | 'middle' | 'end'; color?: string };
const tx = (x: number, y: number, s: string, size = 3.4, anchor: T['anchor'] = 'start'): T => ({ t: 'text', x, y, s, size, anchor });

/** 1 面（申請書） */
export function renderHaebaruSewerPage1(v: ApplicationValues, c: Contractor): Sheet {
  const sheet: Sheet = { width: W, height: H, ops: [] };
  for (const [x1, y1, x2, y2, w] of HAEBARU_SEWER_RULES) sheet.ops.push({ t: 'line', x1, y1, x2, y2, w: Math.max(0.17, w) });
  sheet.ops.push(tx(W / 2, 28.9, '排水設備計画確認申請書', 5.4, 'middle'));
  for (const [x, y, size, s] of HAEBARU_SEWER_TEXTS) sheet.ops.push(tx(x, y, s, size));
  const put = (x: number, y: number, s: string | undefined, size = 3.4, maxW = 120, anchor: T['anchor'] = 'start') => { if (s) sheet.ops.push(tx(x, y, fitText(s, size, maxW), size, anchor)); };
  const circle = (cx: number, cy: number, r = 2.5) => sheet.ops.push({ t: 'circle', cx, cy, r, lw: 0.3 });
  const pick = (opts: readonly string[], val: string | undefined) => opts.indexOf(val ?? '');

  // 届出年月日（令和 n 年 n 月 n 日）
  const d = reiwa(v.date ?? '');
  if (d) { put(141.2, 49.0, String(d.year), 3.4, 20, 'end'); put(152.5, 49.0, String(d.month), 3.4, 10, 'end'); put(163.6, 49.0, String(d.day), 3.4, 10, 'end'); }
  // 申請者（南部の入力: 所有者＝施主）
  const name = v.applicantName || v.ownerName || '', addr = v.applicantAddress || v.ownerAddress || '';
  put(108.6, 54.9, addr, 3.4, 84);
  put(144.2, 60.8, v.applicantKana || v.ownerKana, 2.2, 48);
  put(144.0, 66.7, name, 3.4, 48);
  put(158.5, 72.6, v.applicantTel || v.ownerTel, 3.4, 33);
  put(59.2, 78.5, v.siteAddress, 3.4, 131);
  put(66.6, 90.3, v.obligorAddress || addr, 3.4, 124);
  put(66.6, 95.1, v.obligorName || name, 3.4, 124);
  // 選択肢（番号の中心 x、行の中心 y）
  const nx = (pt: number) => (pt + 5.25) * (25.4 / 72);
  const ci = pick(HAEBARU_CONNECTIONS, v.sewerConnection === 'ます設置（新規）' ? 'ます設置(新規)' : v.sewerConnection);
  if (ci >= 0) circle(nx([157.2, 225.6, 325.4, 404.0][ci]), 82.7);
  const wk = v.sewerWorkKind === '汲取改造' ? 'くみ取改造' : v.sewerWorkKind;
  const wi = pick(HAEBARU_WORK_KINDS, wk);
  if (wi >= 0) circle(nx([157.2, 236.0, 314.9, 362.2, 409.4, 456.7][wi]), 99.9);
  const si = pick(WATER_SOURCES, v.waterSource);
  if (si >= 0) circle(nx([157.2, 215.1, 272.7, 320.0][si]), 105.6);
  if (si === 3) put(135.2, 106.9, v.waterSourceOther, 3, 34);
  const bi = pick(SEWER_BUILDING_USES, v.sewerBuildingUse);
  if (bi >= 0 && bi < 6) circle(nx([157.2, 225.6, 293.9, 341.2, 398.9, 446.1][bi]), 113.8);
  else if (bi >= 6) circle(nx([157.2, 225.6][bi - 6]), 118.6);
  if (bi === 7) put(101.8, 119.9, v.sewerBuildingUseOther, 3, 32);
  if (bi >= 2) put(164.8, 129.5, v.sewerBuildingUseNote, 2.6, 21);
  // 7 使用世帯数及び人員（アパートは右の欄）
  const hh = v.sewerHouseholds || v.households || '', pp = v.people || '';
  if (bi === 1) { put(149.7, 150.2, v.apartmentHouseholds || hh, 3.4, 14, 'middle'); put(165.9, 150.2, v.apartmentPeople || pp, 3.4, 16, 'middle'); }
  else { put(92.7, 150.2, hh, 3.4, 14, 'middle'); put(108.8, 150.2, pp, 3.4, 16, 'middle'); }
  // 8 工事予定期間
  const f = reiwa(v.workFrom ?? ''), t = reiwa(v.workTo ?? '');
  if (f) { put(73.4, 161.3, String(f.year), 3.4, 10, 'end'); put(84.6, 161.3, String(f.month), 3.4, 8, 'end'); put(95.6, 161.3, String(f.day), 3.4, 8, 'end'); }
  if (t) { put(129.0, 161.3, String(t.year), 3.4, 10, 'end'); put(140.1, 161.3, String(t.month), 3.4, 8, 'end'); put(151.2, 161.3, String(t.day), 3.4, 8, 'end'); }
  if (f && t) {
    const days = Math.round((Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(f.year, f.month - 1, f.day)) / 86400000) + 1;
    if (days > 0) put(164.4, 161.3, String(days), 3.4, 10, 'end');
  }
  // 9 指定工事店・10 責任技術者
  const lic = (c.sewerLicenseNo || '').trim();
  put(85.2, 166.6, /^\d+$/.test(lic) ? `第${lic}号` : lic, 3.4, 60);
  put(70.3, 171.4, c.address, 3.4, 118);
  put(88.8, 176.2, [c.name, c.tel].filter(Boolean).join('　'), 3.4, 100);
  put(88.8, 181.0, c.representative, 3.4, 60);
  put(74.0, 187.0, c.drainageEngineerNo, 3.4, 80);
  put(74.0, 191.9, c.drainageEngineer, 3.4, 60);
  // 11 貸付状況・12 除害施設（語を ○ で囲む）
  if (v.lending === '有り') circle(70.2, 196.9, 3.6); else if (v.lending === '無し') circle(92.5, 196.9, 3.6);
  if (v.pretreatment === '有り') { circle(146.7, 196.9, 2.6); put(154.1, 198.2, v.pretreatmentNote, 2.6, 18); }
  else if (v.pretreatment === '無し') circle(182.8, 196.9, 3.6);
  return sheet;
}

/** 2〜4 面の枠（見出しの欄と注意書き）。戻り値は図を入れる箱 */
function drawingPage(title: string, labelW: number, bottom: number, notes: string[]): { sheet: Sheet; box: { x: number; y: number; w: number; h: number } } {
  const sheet: Sheet = { width: W, height: H, ops: [] };
  sheet.ops.push({ t: 'rect', x: 22, y: 21.2, w: 170.2, h: bottom - 21.2, lw: 0.45 });
  sheet.ops.push({ t: 'line', x1: 22, y1: 33.6, x2: 192.2, y2: 33.6, w: 0.45 }, { t: 'line', x1: 22 + labelW, y1: 21.2, x2: 22 + labelW, y2: 33.6, w: 0.45 });
  sheet.ops.push(tx(23.7, 29.4, title, 3.4));
  notes.forEach((n, i) => { sheet.ops.push(tx(20, bottom + 6.6 + 5.9 * i, '※', 3.4), tx(27.4, bottom + 6.6 + 5.9 * i, fitText(n, 3.2, 170), 3.2)); });
  return { sheet, box: { x: 23.5, y: 35.5, w: 167.2, h: bottom - 37.5 } };
}

/** 図の範囲（content）が無い図は用紙全体 */
const contentOf = (s: Sheet & { content?: { x: number; y: number; w: number; h: number } }) => s.content ?? { x: 0, y: 0, w: s.width, h: s.height };

/** 4 面。plan: 排水平面図、profile: 縦断面図（アイソメなし）、iso: 配管立図、map: 見取図（src/export/locationSheet.ts） */
export function haebaruSewerSheets(v: ApplicationValues, c: Contractor, d: { plan?: Sheet; profile?: Sheet; iso?: Sheet; map?: Sheet }): Sheet[] {
  const NOTE = '設計図は、「排水設備工事責任技術者講習用テキスト」(日下協発行)に沿って、作成すること。';
  const p2 = drawingPage('平面図及び縦断面図', 40.8, 246, [NOTE, '新設・増設は赤色、既設排水設備は青色、公共下水道は黒色で記入すること。']);
  const half = p2.box.h * 0.48;
  if (d.plan) insetSheet(p2.sheet, d.plan, contentOf(d.plan), { x: p2.box.x, y: p2.box.y, w: p2.box.w, h: half });
  if (d.profile) insetSheet(p2.sheet, d.profile, contentOf(d.profile), { x: p2.box.x, y: p2.box.y + half + 2, w: p2.box.w, h: p2.box.h - half - 2 });
  if (!d.plan && !d.profile) p2.sheet.ops.push(tx(W / 2, 140, '（排水の配管が無いため空欄）', 3, 'middle'));
  const p3 = drawingPage('配管立図', 22.2, 246, [NOTE]);
  if (d.iso) insetSheet(p3.sheet, d.iso, contentOf(d.iso), p3.box);
  const p4 = drawingPage('見取図', 22.2, 252, ['方位、位置及び目標となる地物を表示し、工事施工の位置を明示すること。']);
  if (d.map) insetSheet(p4.sheet, d.map, MAP_FRAME, { x: p4.box.x + 4, y: p4.box.y - 1, w: p4.box.w - 8, h: p4.box.h * 0.6 });
  else p4.sheet.ops.push({ t: 'text', x: W / 2, y: 120, s: '（見取図は申請図面の「見取図」で工事場所を決めると入ります）', size: 3, anchor: 'middle', color: GRAY });
  return [renderHaebaruSewerPage1(v, c), p2.sheet, p3.sheet, p4.sheet];
}
