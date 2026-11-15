/**
 * 道路の手続き（本管からの取出し）の入力項目と既定値。
 * 値は `doc.site.application` に `road.` で始まるキーで入れる（文字列。長さ・幅は m）。
 */
import type { Doc } from '../model/doc';
import { cityOf } from '../model/municipality';
import type { ApplicationValues, Contractor, FormField } from '../forms/types';

/** 提出先（市町村名 → 道路管理者の宛名・警察署）。この端末に覚える */
export type RoadOffices = Record<string, { roadAdmin?: string; police?: string }>;
export const ROAD_OFFICES_KEY = 'roadOffices';

export const YES = 'する', NO = 'しない';
export const ROAD_KINDS = ['町道', '市道', '村道', '県道', '国道', '私道'];
export const PAVEMENTS = ['アスファルト', 'コンクリート', '未舗装'];
export const TRAFFIC = ['片側交互通行', '路肩規制', '通行止め'];
/** 作業（工程表の行）。id は日数の項目 road.days.<id> */
export const STEPS: { id: string; label: string }[] = [
  { id: 'prep', label: '準備・保安施設の設置' },
  { id: 'dig', label: '舗装切断・掘削' },
  { id: 'branch', label: '分岐・取付（穿孔）' },
  { id: 'backfill', label: '埋戻し・転圧' },
  { id: 'temp', label: '仮復旧' },
  { id: 'final', label: '本復旧' },
];

const F = (id: string, label: string, group: string, kind: FormField['kind'] = 'text', extra: Partial<FormField> = {}): FormField => ({ id: `road.${id}`, label, group, kind, ...extra });
const G_ROAD = '① どの道路を掘りますか', G_W = '② 水道（給水管）の取出し', G_S = '③ 下水（取付管）の取付', G_DIG = '④ 掘る大きさと元に戻し方', G_TR = '⑤ 車や人の通し方', G_DAY = '⑥ 日程', G_TO = '⑦ 提出先と申請者';

export const ROAD_FIELDS: FormField[] = [
  F('roadKind', '道路の種類', G_ROAD, 'choice', { options: ROAD_KINDS, hint: '分からなければ役所の道路担当に。私道なら所有者の承諾が要ります' }),
  F('routeName', '路線名', G_ROAD, 'text', { hint: '例: 町道与那原1号線' }),
  F('place', '掘る場所（地番）', G_ROAD, 'text', { hint: '空なら工事の住所' }),
  F('roadWidth', '道路の幅（m）', G_ROAD, 'number', { hint: '官民境界から向こう側の端まで' }),
  F('sidewalk', '歩道', G_ROAD, 'choice', { options: ['無し', '有り'] }),
  F('pavement', '舗装', G_ROAD, 'choice', { options: PAVEMENTS }),
  F('curb', '側溝や縁石を壊す・作り直す', G_ROAD, 'choice', { options: ['いいえ', 'はい'], hint: 'はいの場合は「道路工事施行承認」も要ります' }),

  F('water', '水道の取出し', G_W, 'choice', { options: [YES, NO] }),
  F('waterMain', '本管の管種', G_W, 'text', { hint: '例: DIP・VP' }),
  F('waterMainDia', '本管の口径（mm）', G_W, 'number'),
  F('waterMainAt', '本管の位置（官民境界から m）', G_W, 'number', { hint: '水道の担当で配管図を見せてもらえます' }),
  F('waterPipe', '引込管の管種', G_W, 'text'),
  F('waterPipeDia', '引込管の口径（mm）', G_W, 'number'),
  F('waterDepth', '引込管の深さ（土かぶり m）', G_W, 'number', { hint: '道路管理者の基準に合わせます' }),

  F('sewer', '下水の取付管', G_S, 'choice', { options: [YES, NO], hint: '公共ますを役所が設置する場合は「しない」' }),
  F('sewerMain', '本管の管種', G_S, 'text', { hint: '例: VU・HP' }),
  F('sewerMainDia', '本管の口径（mm）', G_S, 'number'),
  F('sewerMainAt', '本管の位置（官民境界から m）', G_S, 'number'),
  F('sewerPipe', '取付管の管種', G_S, 'text'),
  F('sewerPipeDia', '取付管の口径（mm）', G_S, 'number'),
  F('sewerDepth', '取付管の深さ（本管との接続の土かぶり m）', G_S, 'number'),
  F('gap', '給水と下水の間隔（道路に沿って m）', G_S, 'number', { hint: '平面図の絵に使います' }),

  F('digWidth', '掘削の幅（m）', G_DIG, 'number'),
  F('restoreMargin', '復旧の余裕幅（片側 m）', G_DIG, 'number', { hint: '掘った幅より広く舗装を戻す決まりがあれば' }),
  F('layersTemp', '仮復旧の舗装（1 行に「名前 厚さmm」）', G_DIG, 'multiline', { hint: '空なら舗装の種類から一般的な構成' }),
  F('layersFinal', '本復旧の舗装（1 行に「名前 厚さmm」）', G_DIG, 'multiline', { hint: '空なら舗装の種類から一般的な構成' }),

  F('traffic', '規制のしかた', G_TR, 'choice', { options: TRAFFIC }),
  F('guards', '交通誘導員（人）', G_TR, 'number'),
  F('hours', '作業時間', G_TR, 'text'),

  F('start', '着工日', G_DAY, 'date'),
  F('end', '完了日', G_DAY, 'date', { hint: '空なら作業の日数から' }),
  ...STEPS.map((s) => F(`days.${s.id}`, `${s.label}（日）`, G_DAY, 'number')),

  F('roadAdmin', '道路管理者（宛名）', G_TO, 'text', { hint: '例: 与那原町長。一度入れるとこの町では次から自動で入ります' }),
  F('police', '警察署長（宛名）', G_TO, 'text', { hint: '例: ◯◯警察署長' }),
  F('period', '占用の期間', G_TO, 'text', { hint: '道路管理者の指定に合わせます（例: 許可の日から10年）' }),
  F('applicantName', '申請者（会社名）', G_TO),
  F('applicantAddress', '申請者の住所', G_TO),
  F('applicantRep', '代表者', G_TO),
  F('applicantTel', '電話番号', G_TO),
  F('siteManager', '現場責任者', G_TO),
  F('siteManagerTel', '現場責任者の携帯', G_TO),
];

/** 数として読む（全角・前後の空白・末尾の単位 m / mm / 人 / 日 を許す）。読めなければ undefined */
export function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const t = s.replace(/[０-９．－]/g, (c) => (c === '．' ? '.' : c === '－' ? '-' : String.fromCharCode(c.charCodeAt(0) - 0xfee0))).trim().replace(/(mm|m|ｍ|人|日)$/i, '').trim();
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return undefined;
  return Number(t);
}

/** メーターの入口につながる管（無ければ undefined） */
function meterInletPipe(doc: Doc): { diameter: number; material?: string } | undefined {
  const meter = Object.values(doc.fixtures).find((f) => f.type === 'waterMeter');
  if (!meter) return undefined;
  const port = Object.values(doc.network.nodes).find((n) => n.fixtureId === meter.id && n.portId === 'in');
  if (!port) return undefined;
  return Object.values(doc.network.segments).find((s) => s.a === port.id || s.b === port.id);
}

/** 給水の取出しと下水の取付の、道路に沿った間隔（メーターと公共汚水マスの距離 m）。どちらか無ければ undefined */
function waterSewerGap(doc: Doc): number | undefined {
  const fx = Object.values(doc.fixtures);
  const m = fx.find((f) => f.type === 'waterMeter'), p = fx.find((f) => f.type === 'publicSewage');
  if (!m || !p) return undefined;
  return Math.round(Math.hypot(m.x - p.x, m.y - p.y) / 100) / 10;
}

/** 現場から導く既定値（入力済みの値は roadValues で優先する） */
export function roadDefaults(doc: Doc, meta: { name: string; address?: string }, c: Contractor, offices: RoadOffices): ApplicationValues {
  const pipe = meterInletPipe(doc);
  const city = meta.address ? cityOf(meta.address) : undefined;
  const office = city ? offices[city] : undefined;
  const hasPublic = Object.values(doc.fixtures).some((f) => f.type === 'publicSewage');
  const gap = waterSewerGap(doc);
  const d: ApplicationValues = {
    'road.place': meta.address ?? '',
    'road.sidewalk': '無し', 'road.pavement': 'アスファルト', 'road.curb': 'いいえ',
    'road.water': YES, 'road.waterPipe': pipe?.material ?? '', 'road.waterPipeDia': pipe ? String(pipe.diameter) : '',
    'road.sewer': hasPublic ? YES : NO, 'road.sewerPipe': 'VU', 'road.sewerPipeDia': '150',
    'road.gap': gap !== undefined ? String(gap) : '',
    'road.digWidth': '0.6', 'road.restoreMargin': '0',
    'road.traffic': TRAFFIC[0], 'road.guards': '2', 'road.hours': '9:00〜17:00',
    ...Object.fromEntries(STEPS.map((s) => [`road.days.${s.id}`, '1'])),
    'road.roadAdmin': office?.roadAdmin ?? '', 'road.police': office?.police ?? '',
    'road.applicantName': c.name, 'road.applicantAddress': [c.zip ? `〒${c.zip.replace(/^〒/, '')}` : '', c.address].filter(Boolean).join(' '),
    'road.applicantRep': c.representative, 'road.applicantTel': c.tel,
    'road.siteManager': c.chiefEngineer, 'road.siteManagerTel': c.chiefEngineerTel,
  };
  return d;
}

/** 既定値に入力済みの road.* を重ねる（キーがあれば空でも優先） */
export function roadValues(doc: Doc, meta: { name: string; address?: string }, c: Contractor, offices: RoadOffices): ApplicationValues {
  const app = doc.site?.application ?? {};
  const own = Object.fromEntries(Object.entries(app).filter(([k]) => k.startsWith('road.')));
  return { ...roadDefaults(doc, meta, c, offices), ...own };
}
