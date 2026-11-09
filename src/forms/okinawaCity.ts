/**
 * 沖縄市の申請様式（申請担当者から 2026-11-10 入手）
 * - 給水装置申込及び工事申請書（Excel）
 * - 下水道排水設備計画確認申請書（様式第1号、PDF）
 * - 給水装置使用製品一覧表（A4 横。発行元の企業団は要確認）
 * - 給水装置申込及び工事申請チェックシート
 */
import type { Doc } from '../model/doc';
import type { ApplicationValues, FormField, FormSet } from './types';

export const USE_TYPES = ['一般家庭用（一般住宅）', '一般家庭用（アパート）', '官公署', '学校', '病院', '事務所', '営業用（ホテル・スーパー）', '工場', 'その他'];
export const SUPPLY_TYPES = ['直結', '受水槽', '直結増圧給水'];
export const PURPOSES = ['一般用', '公衆浴場用', '船舶用', '臨時仮設用', '連合専用', '各戸検針用'];
export const WATER_WORK_KINDS = ['新設', '改造', '臨仮'];
export const SEWER_CONNECTIONS = ['公共ます', 'ます設置（新規）', '私設置ます', '物件設置'];
export const SEWER_WORK_KINDS = ['汲取改造', '浄化槽改造', '新築', '増築', '改築', '臨時'];
export const WATER_SOURCES = ['水道水', '井戸水', '雨水', 'その他'];
export const SEWER_BUILDING_USES = ['一般家庭', 'アパート', '会社', '官公署', '学校', '商店', '浴場', 'その他'];
export const STRUCTURES = ['木', '鉄筋コンクリート', '鉄骨', 'コンクリートブロック', 'その他'];

/** 手数料（実例 2 件の値。要確認）: 加入金は口径別、設計審査 160 円、検査 980 円 */
export const FEES = { admission: { 13: 12650, 20: 32450 } as Record<number, number>, designReview: 160, inspection: 980 };

const G = { site: '設置場所・日付', applicant: '申込者（申請者）', user: '使用者', water: '給水の工事内容', sewer: '下水道の工事内容', fee: '手数料（要確認）' };

export const OKINAWA_FIELDS: FormField[] = [
  { id: 'date', label: '申請日', kind: 'date', group: G.site },
  { id: 'siteAddress', label: '設置場所（住居番号で）', kind: 'text', group: G.site, hint: '例: 沖縄市美里5丁目28-2。ゼンリン地図などの○丁目○○-で' },
  { id: 'applicantName', label: '氏名', kind: 'text', group: G.applicant },
  { id: 'applicantKana', label: 'フリガナ', kind: 'text', group: G.applicant },
  { id: 'applicantAddress', label: '住所', kind: 'text', group: G.applicant },
  { id: 'applicantTel', label: '電話', kind: 'text', group: G.applicant },
  { id: 'userSame', label: '使用者は申込者と同じ', kind: 'choice', group: G.user, options: ['同じ', '別'] },
  { id: 'userName', label: '氏名', kind: 'text', group: G.user },
  { id: 'userKana', label: 'フリガナ', kind: 'text', group: G.user },
  { id: 'userAddress', label: '住所', kind: 'text', group: G.user },
  { id: 'waterWorkKind', label: '工事の種類', kind: 'choice', group: G.water, options: WATER_WORK_KINDS },
  { id: 'useType', label: '使用形態', kind: 'choice', group: G.water, options: USE_TYPES },
  { id: 'useTypeOther', label: 'その他の内容', kind: 'text', group: G.water },
  { id: 'households', label: '世帯数', kind: 'number', group: G.water },
  { id: 'supplyType', label: '給水方式', kind: 'choice', group: G.water, options: SUPPLY_TYPES },
  { id: 'sewerConnected', label: '下水道接続', kind: 'choice', group: G.water, options: ['有', '無'] },
  { id: 'purpose', label: '用途別', kind: 'choice', group: G.water, options: PURPOSES },
  { id: 'structure', label: '建築物の構造', kind: 'choice', group: G.water, options: STRUCTURES },
  { id: 'floors', label: '階数', kind: 'number', group: G.water },
  { id: 'diameter', label: '口径（mm）', kind: 'number', group: G.water, hint: '水道メーターの口径。図面のメーターから自動' },
  { id: 'billTo', label: '工事期間中の水道料金請求先', kind: 'text', group: G.water },
  { id: 'drawingNo', label: '図面番号', kind: 'text', group: G.water },
  { id: 'sewerConnection', label: '接続先', kind: 'choice', group: G.sewer, options: SEWER_CONNECTIONS },
  { id: 'obligorName', label: '義務者 氏名', kind: 'text', group: G.sewer, hint: '空なら申請者と同じ' },
  { id: 'obligorAddress', label: '義務者 住所', kind: 'text', group: G.sewer },
  { id: 'sewerWorkKind', label: '工事の種別', kind: 'choice', group: G.sewer, options: SEWER_WORK_KINDS },
  { id: 'waterSource', label: '使用水の種別', kind: 'choice', group: G.sewer, options: WATER_SOURCES },
  { id: 'waterSourceOther', label: 'その他の内容', kind: 'text', group: G.sewer },
  { id: 'sewerBuildingUse', label: '建物の用途', kind: 'choice', group: G.sewer, options: SEWER_BUILDING_USES },
  { id: 'sewerBuildingUseNote', label: '使途（一般家庭・アパート以外）', kind: 'text', group: G.sewer },
  { id: 'people', label: '人員', kind: 'number', group: G.sewer },
  { id: 'apartmentHouseholds', label: 'アパートの世帯数', kind: 'number', group: G.sewer },
  { id: 'apartmentPeople', label: 'アパートの人員', kind: 'number', group: G.sewer },
  { id: 'workFrom', label: '工事予定期間 自', kind: 'date', group: G.sewer },
  { id: 'workTo', label: '工事予定期間 至', kind: 'date', group: G.sewer },
  { id: 'lending', label: '貸付状況', kind: 'choice', group: G.sewer, options: ['有り', '無し'] },
  { id: 'pretreatment', label: '除害施設', kind: 'choice', group: G.sewer, options: ['有り', '無し'] },
  { id: 'pretreatmentNote', label: '除害施設の内容', kind: 'text', group: G.sewer },
  { id: 'feeAdmission', label: '加入金（円）', kind: 'number', group: G.fee, unverified: true, hint: '実例: 13mm 12,650 円・20mm 32,450 円' },
  { id: 'feeDesign', label: '設計審査手数料（円）', kind: 'number', group: G.fee, unverified: true },
  { id: 'feeInspection', label: '工事検査手数料（円）', kind: 'number', group: G.fee, unverified: true },
];

/** 図面の水道メーターの口径（無ければ undefined） */
export function meterDiameter(doc: Doc): number | undefined {
  const m = Object.values(doc.fixtures).find((f) => f.type === 'waterMeter');
  if (!m) return undefined;
  const ports = new Set(Object.values(doc.network.nodes).filter((n) => n.fixtureId === m.id).map((n) => n.id));
  const seg = Object.values(doc.network.segments).find((s) => ports.has(s.a) || ports.has(s.b));
  return seg?.diameter ?? m.params?.diameter;
}

function defaults(doc: Doc, meta: { name: string; address?: string }): ApplicationValues {
  const dia = meterDiameter(doc);
  const hasPublic = Object.values(doc.fixtures).some((f) => f.type.startsWith('public'));
  const floors = doc.building.floors.length;
  return {
    siteAddress: meta.address ?? '',
    userSame: '同じ',
    waterWorkKind: '新設',
    useType: USE_TYPES[0],
    households: '1',
    supplyType: '直結',
    sewerConnected: hasPublic ? '有' : '無',
    purpose: '一般用',
    structure: '木',
    floors: String(floors),
    diameter: dia ? String(dia) : '',
    billTo: '使用者',
    sewerConnection: hasPublic ? '公共ます' : 'ます設置（新規）',
    sewerWorkKind: '新築',
    waterSource: '水道水',
    sewerBuildingUse: '一般家庭',
    lending: '無し',
    pretreatment: '無し',
    feeAdmission: dia && FEES.admission[dia] ? String(FEES.admission[dia]) : '',
    feeDesign: String(FEES.designReview),
    feeInspection: String(FEES.inspection),
  };
}

export const OKINAWA_FORMS: FormSet = {
  profileId: 'okinawa-city',
  fields: OKINAWA_FIELDS,
  defaults,
  checklist: [
    { label: '給水装置申込及び工事申請書（最新のもの）', app: true },
    { label: '口径計算書（直結）・共同住宅における口径計算書', note: '市のホームページの様式' },
    { label: '給水器具承認図、認証番号等（仕様書）※直結のみ', note: '湯沸し器・食洗器・活水器など' },
    { label: '給水装置使用製品一覧表', app: true },
    { label: '建築確認済証' },
    { label: '下水道排水設備計画確認申請書 写し（下水道発行印必須）', app: true, note: '先に下水道に出して受付印をもらう' },
    { label: '道路占用関係書類（道路管理者・警察署）', note: '掘削平面図・復旧断面図。後日提出可' },
    { label: '土地使用承諾書', note: '引込管を第三者の土地に布設する場合' },
    { label: '分岐承諾書', note: '第三者の既存給水管から分岐する場合' },
    { label: '見取図' },
    { label: '建物側面図（本管から一番高い水栓までの高さ記入）', app: true, note: '給水の立面図（展開図）' },
    { label: '平面図（全階。管種・口径・延長を記載）', app: true, note: '図面の 2D 出力' },
    { label: '図面の OCV 表記は N になっているか' },
    { label: '直結の埋設散水栓はないか' },
    { label: 'ガス瞬間湯沸かし器に HT を使用していないか。給湯機露出部分の配管' },
    { label: 'HI 露出配管はないか' },
    { label: '加入金の金額の記載', app: true },
  ],
};
