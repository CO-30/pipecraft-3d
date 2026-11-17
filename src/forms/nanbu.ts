/**
 * 南部水道企業団（南風原町・八重瀬町の給水）の申請様式。受理された 1 件分の実物（2026-11-16 入手、記入済み）から項目を起こした:
 * - 給水申込書（様式第7号）＋委任状／（裏）臨時用給水に関する誓約書
 * - 給水装置工事申請書及び設計書（様式第6号）／（裏）平面図
 * - 横断面図・オフセット／（裏）竣工検査項目
 * - 給水装置使用製品一覧表、給水装置工事申請書類チェック表（2 枚目は穿孔時書類確認）
 * 手数料・加入金は実物が空欄なので入れない（窓口で記入）。
 */
import type { Doc } from '../model/doc';
import { htWithGasHeater } from '../model/materials';
import { resolveSupplyRules } from '../model/hydraulics/supplyRules';
import { stripHead } from '../model/municipality';
import type { KakuninInfo } from './kakunin';
import { meterDiameter } from './okinawaCity';
import { todayIso, type ApplicationValues, type FormField, type FormSet } from './types';

export const NANBU_WORK_KINDS = ['新設', '改造', '修繕'];
export const NANBU_SUPPLY_KINDS = ['専用給水', '共用給水', '臨時給水'];
export const NANBU_USE_KINDS = ['一般用', '連合用', '高層用', '臨時用'];
export const NANBU_BUILDING_USES = ['住宅', '店舗', 'アパート', '事務所', 'その他'];
export const NANBU_DRAIN_TO = ['公共下水道', '浄化槽'];

const G = { site: '申請日・設置場所', kind: '工事・種別・用途', owner: '所有者（申請者・施主）', user: '使用者', building: '建築確認', road: '道路の許可（取れたら）', cross: '横断面図・オフセット' };
const F = (id: string, label: string, group: string, kind: FormField['kind'] = 'text', extra: Partial<FormField> = {}): FormField => ({ id, label, group, kind, ...extra });

export const NANBU_FIELDS: FormField[] = [
  F('date', '申請日', G.site, 'date'),
  F('siteAddress', '設置場所', G.site, 'text', { hint: '例: 南風原町字〇〇100-1（県・郡は書かない）' }),
  F('buildingName', 'ビル等名称', G.site),
  F('workKind', '工事', G.kind, 'choice', { options: NANBU_WORK_KINDS }),
  F('supplyKind', '種別', G.kind, 'choice', { options: NANBU_SUPPLY_KINDS }),
  F('useKind', '用途', G.kind, 'choice', { options: NANBU_USE_KINDS }),
  F('buildingUse', '建物', G.kind, 'choice', { options: NANBU_BUILDING_USES }),
  F('drainTo', '排水放流先', G.kind, 'choice', { options: NANBU_DRAIN_TO }),
  F('diameter', 'メーター口径（mm）', G.kind, 'number', { hint: '図面のメーターから自動' }),
  F('tempSupply', '工事中の臨時給水', G.kind, 'choice', { options: ['有り', '無し'], hint: '有りなら誓約書（給水申込書の裏）も作ります' }),
  F('tempUntil', '臨時給水の使用期限', G.kind, 'date', { hint: '確認申請書の工事完了予定日から入ります' }),
  F('ownerZip', '〒', G.owner),
  F('ownerAddress', '住所', G.owner),
  F('ownerKana', 'フリガナ', G.owner),
  F('ownerName', '氏名', G.owner),
  F('ownerTel', 'TEL', G.owner),
  F('userSame', '使用者は所有者と同じ', G.user, 'choice', { options: ['同じ', '別'], hint: '新築の工事中は建築会社が使用者になることが多いです' }),
  F('userAddress', '住所', G.user),
  F('userKana', 'フリガナ', G.user),
  F('userName', '氏名・会社名', G.user),
  F('userTel', 'TEL', G.user),
  F('userRep', '代表者（会社のとき）', G.user, 'text', { hint: '誓約書の使用者の欄に書きます' }),
  F('confirmNo', '確認通知番号', G.building, 'text', { hint: '確認済証の「第 … 号」' }),
  F('confirmDate', '確認の年月日', G.building, 'date'),
  F('totalArea', '延べ面積（㎡）', G.building, 'number'),
  F('floorsAbove', '地上階', G.building, 'number'),
  F('floorsBelow', '地下階', G.building, 'number'),
  F('structure', '構造', G.building, 'text', { hint: '例: 木造' }),
  F('roadOccNo', '道路占用許可番号', G.road),
  F('roadOccDate', '道路占用の許可年月日', G.road, 'date'),
  F('roadUseNo', '道路使用許可番号', G.road),
  F('roadUseDate', '道路使用の許可年月日', G.road, 'date'),
  F('offsets', 'オフセット（1 行に 1 つ。例: 電柱 No.12 から 3.20m）', G.cross, 'multiline', { hint: '引込みの分岐点を、動かない構造物（電柱・汚水桝・グレーチング等）からの距離で' }),
];

/** 住所から県・郡を外す（南部水道企業団の申込書の書き方） */
export const siteOf = (address: string) => stripHead(address);

/** 様式第6号の「（町名）町 字（以下）」に分ける。町名が無ければ全部を字以下に */
export function splitSite(address: string): { town: string; aza: string } {
  const s = siteOf(address);
  const m = /^([^\s、。,，]{1,6}?)町字?(.*)$/.exec(s);
  return m && !/[市区村]/.test(m[1]) ? { town: m[1], aza: m[2] } : { town: '', aza: s };
}

function defaults(doc: Doc, meta: { name: string; address?: string }): ApplicationValues {
  const dia = meterDiameter(doc);
  const hasPublic = Object.values(doc.fixtures).some((f) => f.type === 'publicSewage');
  const floors = doc.building.floors.length;
  return {
    date: todayIso(),
    siteAddress: meta.address ? siteOf(meta.address) : '',
    workKind: '新設', supplyKind: '専用給水', useKind: '一般用', buildingUse: '住宅',
    drainTo: hasPublic ? '公共下水道' : '',
    diameter: dia ? String(dia) : '',
    tempSupply: '有り',
    userSame: '同じ',
    floorsAbove: floors > 0 ? String(floors) : '',
    floorsBelow: '0',
  };
}

function kakunin(k: KakuninInfo): ApplicationValues {
  const v: ApplicationValues = {};
  const put = (id: string, s: string | undefined) => { if (s) v[id] = s; };
  put('ownerName', k.ownerName); put('ownerKana', k.ownerKana); put('ownerZip', k.ownerZip); put('ownerAddress', k.ownerAddress); put('ownerTel', k.ownerTel);
  put('siteAddress', k.siteAddress ? siteOf(k.siteAddress) : undefined);
  put('confirmNo', k.confirmNo); put('confirmDate', k.confirmDate);
  put('totalArea', k.totalArea); put('floorsAbove', k.floorsAbove); put('floorsBelow', k.floorsBelow); put('structure', k.structure);
  put('workKind', k.workKind === '新築' ? '新設' : k.workKind ? '改造' : undefined);
  put('tempUntil', k.workEnd);
  return v;
}

export const NANBU_FORMS: FormSet = {
  profileId: 'haebaru',
  water: 'nanbu',
  fields: NANBU_FIELDS,
  defaults,
  kakunin,
  // 給水装置工事申請書類チェック表（実物の 1〜14）
  checklist: [
    { label: '給水申請書(表)、臨時給水(裏)', app: true },
    { label: '給水装置工事申請書及び設計書(表)、平面図(裏)', app: true, note: '平面図は 2D の図面から' },
    { label: '横断図・オフセット(表)、竣工検査(裏)', app: true, note: '現場で記入できるよう図記。構造物（汚水桝、グレーチング等）を記入する' },
    { label: '設備設計図(平面図・立面図)', app: true, note: '立面図は申請図面の「立面図」' },
    { label: '給水装置使用製品一覧表', app: true },
    { label: '所要水頭計算書', app: true, note: '直結の場合。申請図面の「水理計算書」（タンクの場合は計画水量をもとに口径計算書）' },
    { label: '建築確認済書(写) or 建築確認申請書(写)', note: '※無指定区域は工事届。様式第6号に記入し、その解る写し' },
    { label: '建築図面(配置図)', note: 'レベル、境界線等の確認できるもの' },
    { label: '道路占用許可書(写)', note: '様式第6号に記入し、その解る写し' },
    { label: '道路使用許可証(写)', note: '様式第6号に記入し、その解る写し' },
    { label: '現況写真(引込み・メータ位置記入)' },
    { label: '小規模貯水槽水道設置届', note: '貯水槽がある場合' },
    { label: '公図・登記簿' },
    { label: 'その他、承諾書等' },
  ],
};

export type DrillCheck = { label: string; status: 'ok' | 'warn' | 'manual'; note?: string };

/** 穿孔時書類確認（チェック表の 2 枚目、実物の 10 項目）。v は申請書の値に道路（road.*）・水理（suiri.*）の値を重ねたもの */
export function drillChecks(doc: Doc, v: ApplicationValues, city?: string): DrillCheck[] {
  const fx = Object.values(doc.fixtures);
  const roadKind = v['road.roadKind'] ?? '';
  const rules = resolveSupplyRules({ profileName: city });
  const pressure = Number(v['suiri.pressure'] || rules.designPressure.v);
  const checklist = NANBU_FORMS.checklist.filter((c) => v[`checklist:${c.label}`] === '1').length;
  const ht = htWithGasHeater(doc);
  const tank = fx.some((f) => f.type === 'roofTank');
  const dia = Number(v.diameter || meterDiameter(doc) || 0);
  const main = [v['road.waterMain'], v['road.waterMainDia'] && `φ${v['road.waterMainDia']}`].filter(Boolean).join(' ');
  return [
    !v.date ? { label: '添付書類が整っているか？ 日付は記入されているか？', status: 'warn', note: '申請日が空です' }
      : checklist === NANBU_FORMS.checklist.length ? { label: '添付書類が整っているか？ 日付は記入されているか？', status: 'ok', note: '申請日あり。提出書類のチェックリストが全部済み' }
      : { label: '添付書類が整っているか？ 日付は記入されているか？', status: 'manual', note: `提出書類のチェックリスト ${checklist}/${NANBU_FORMS.checklist.length} 済み` },
    fx.some((f) => f.type === 'waterMeter')
      ? { label: 'メータ位置は適切か？（植栽や車庫等により検針の支障にならないこと）', status: 'manual', note: '図面のメーターの位置を確かめてください' }
      : { label: 'メータ位置は適切か？（植栽や車庫等により検針の支障にならないこと）', status: 'warn', note: '図面にメーターがありません' },
    v['road.waterMain'] && v['road.waterMainDia']
      ? { label: '本管の管種と口径は一致しているか？', status: 'manual', note: `本管 ${main}（道路の手続きの入力）。配管図と合っているか` }
      : { label: '本管の管種と口径は一致しているか？', status: 'warn', note: '道路の手続きで本管の管種・口径を入れてください' },
    (roadKind === '国道' || roadKind === '県道') && !/PE|ポリエチレン/i.test(v['road.waterPipe'] ?? '')
      ? { label: '国道・県道・距離が長い・本管が耐震管の場合は PE 管', status: 'warn', note: `${roadKind}なので引込管は PE 管（今は ${v['road.waterPipe'] || '未入力'}）` }
      : { label: '国道・県道・距離が長い・本管が耐震管の場合は PE 管', status: 'manual', note: '距離が長い・本管が耐震管なら PE 管' },
    pressure !== 0.2
      ? { label: '水理計算は 0.2MPa で計算しているが、そもそも現地水圧が大丈夫か？', status: 'warn', note: `水理計算の設計水圧が ${pressure}MPa（企業団は 0.2MPa で計算）` }
      : { label: '水理計算は 0.2MPa で計算しているが、そもそも現地水圧が大丈夫か？', status: 'manual', note: '水理計算は 0.2MPa。現地の水圧を確かめてください' },
    roadKind === '私道'
      ? { label: '私有地ではないか？（私有地の場合は承諾書・地役権）', status: 'warn', note: '私道なので所有者の承諾書・地役権が要ります' }
      : roadKind ? { label: '私有地ではないか？（私有地の場合は承諾書・地役権）', status: 'ok', note: `${roadKind}から引込み` } : { label: '私有地ではないか？（私有地の場合は承諾書・地役権）', status: 'manual', note: '道路の手続きで道路の種類を選ぶと判定します' },
    tank && dia >= 40
      ? { label: 'φ40 以上の受水槽の場合は、定流量弁を設置すること', status: 'warn', note: `受水槽があり口径 φ${dia}` }
      : { label: 'φ40 以上の受水槽の場合は、定流量弁を設置すること', status: tank ? 'manual' : 'ok', note: tank ? '受水槽の口径を確かめてください' : '受水槽はありません' },
    { label: '月使用量がメーターの適正範囲内であるか？', status: 'manual', note: `メーター φ${dia || '　'}` },
    v.buildingUse === '店舗'
      ? { label: '有機溶剤等を取り扱う店舗の場合は、樹脂製品は NG', status: 'warn', note: '店舗です。有機溶剤を扱うなら樹脂管（HIVP・PB）は使えません' }
      : { label: '有機溶剤等を取り扱う店舗の場合は、樹脂製品は NG', status: 'ok', note: '店舗ではありません' },
    ht.length
      ? { label: '瞬間湯沸かし器（ガス給湯器）を使用する場合は、HT の使用は NG', status: 'warn', note: `給湯管に HT が ${ht.length} 区間あります。PB にしてください` }
      : { label: '瞬間湯沸かし器（ガス給湯器）を使用する場合は、HT の使用は NG', status: 'ok', note: 'HT はありません' },
  ];
}

/** 書類どうしの食い違いなど、気をつけること（穿孔時の確認とは別に出す） */
export function nanbuWarnings(v: ApplicationValues): string[] {
  const out: string[] = [];
  if ((v.tempSupply ?? '有り') === '有り' && (v.userSame ?? '同じ') !== '別') out.push('工事中の臨時給水が「有り」なのに、使用者が所有者（施主）と同じです。誓約書の第 1 項で、使用者の名義は建築工事請負者（建築会社）です。「使用者は所有者と同じ」を「別」にして建築会社を入れてください');
  return out;
}
