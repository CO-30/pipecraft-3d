/**
 * 様式ごとの必須の欄: 空のままだと申請書に空欄で印刷される欄を、書類ごとに調べる純関数。
 * 自治体の基準を決めつけない（「空欄のまま印刷されます」という事実だけを伝える）。値を勝手に埋めない。
 * 様式に無い項目は調べない。設置場所・申込者の氏名と住所は共通の理由（docCenter.ts）で調べるので、ここでは扱わない。
 * 義務者の氏名・住所は、空なら申込者（南風原町は所有者）が印刷されるので、申込者が入っていれば空欄にならない（申込者の未入力として共通の理由に出る）。
 */
import type { ApplicationValues, FormSet } from './types';

export type RequiredDoc = 'water' | 'nanbu' | 'sewer';

type Rule = {
  /** 調べる項目（様式にあるものだけ）。どれかが入っていればよい */
  ids: string[];
  label: string;
  /** この条件のときだけ調べる */
  when?: (v: ApplicationValues) => boolean;
};

const blank = (v: ApplicationValues, id: string) => !(v[id] ?? '').trim();
const is = (id: string, ...vals: string[]) => (v: ApplicationValues) => vals.includes((v[id] ?? '').trim());
const userOther = is('userSame', '別');

const RULES: Record<RequiredDoc, Rule[]> = {
  // 沖縄市の給水装置申込及び工事申請書
  water: [
    { ids: ['waterWorkKind'], label: '工事の種類' },
    { ids: ['useType'], label: '使用形態' },
    { ids: ['useTypeOther'], label: '使用形態「その他」の内容', when: is('useType', 'その他') },
    { ids: ['supplyType'], label: '給水方式' },
    { ids: ['purpose'], label: '用途別' },
    { ids: ['diameter'], label: '口径' },
    { ids: ['userName'], label: '使用者の氏名', when: userOther },
    { ids: ['userAddress'], label: '使用者の住所', when: userOther },
  ],
  // 南部水道企業団の給水申込書・工事申請書・誓約書
  nanbu: [
    { ids: ['workKind'], label: '工事' },
    { ids: ['supplyKind'], label: '種別' },
    { ids: ['useKind'], label: '用途' },
    { ids: ['buildingUse'], label: '建物' },
    { ids: ['drainTo'], label: '排水放流先' },
    { ids: ['diameter'], label: 'メーター口径' },
    { ids: ['tempUntil'], label: '臨時給水の使用期限', when: (v) => (v.tempSupply ?? '有り').trim() === '有り' },
    { ids: ['userName'], label: '使用者の氏名・会社名', when: userOther },
    { ids: ['userAddress'], label: '使用者の住所', when: userOther },
  ],
  // 下水道の排水設備計画確認申請書（沖縄市・南風原町）
  sewer: [
    { ids: ['sewerConnection'], label: '接続先' },
    { ids: ['sewerWorkKind'], label: '工事の種別' },
    { ids: ['waterSource'], label: '使用水の種別' },
    { ids: ['waterSourceOther'], label: '使用水の種別「その他」の内容', when: is('waterSource', 'その他') },
    { ids: ['sewerBuildingUse'], label: '建物の用途' },
    { ids: ['sewerBuildingUseOther'], label: '建物の用途「その他」の内容', when: is('sewerBuildingUse', 'その他') },
    { ids: ['sewerBuildingUseNote'], label: '使途（一般家庭・アパート以外のとき）', when: (v) => !blank(v, 'sewerBuildingUse') && !is('sewerBuildingUse', '一般家庭', 'アパート')(v) },
    { ids: ['people'], label: '人員', when: is('sewerBuildingUse', '一般家庭') },
    { ids: ['apartmentHouseholds'], label: 'アパートの世帯数', when: is('sewerBuildingUse', 'アパート') },
    { ids: ['apartmentPeople'], label: 'アパートの人員', when: is('sewerBuildingUse', 'アパート') },
    { ids: ['workFrom'], label: '工事予定期間の「自」' },
    { ids: ['workTo'], label: '工事予定期間の「至」' },
    { ids: ['pretreatmentNote'], label: '除害施設の内容', when: is('pretreatment', '有り') },
  ],
};

/** 書類 1 種類の、空欄のまま印刷される欄と、日付の前後の逆転（無ければ空） */
export function formRequiredReasons(doc: RequiredDoc, set: FormSet, v: ApplicationValues): string[] {
  const has = new Set(set.fields.map((f) => f.id));
  // 項目が様式にあるときだけ調べる。ids が複数なら、どれかが入っていればよい
  const missing: string[] = [];
  for (const r of RULES[doc]) {
    if (!has.has(r.ids[0])) continue;
    if (r.when && !r.when(v)) continue;
    if (r.ids.every((id) => blank(v, id))) missing.push(r.label);
  }
  const out: string[] = [];
  if (missing.length) out.push(`${missing.join('・')}が未入力です（空欄のまま印刷されます。申請書の入力で入れてください）`);
  if (doc === 'sewer' && has.has('workFrom') && has.has('workTo')) {
    const from = (v.workFrom ?? '').trim(), to = (v.workTo ?? '').trim();
    if (from && to && to < from) out.push('工事予定期間の「至」が「自」より前になっています');
  }
  return out;
}
