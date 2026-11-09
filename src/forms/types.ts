/**
 * 申請書類の様式定義。
 * 画面の入力欄はこの定義から自動で作る。値は全て文字列で `doc.site.application` に入れる（省略可）。
 */
import type { Doc } from '../model/doc';

export type FormFieldKind = 'text' | 'choice' | 'number' | 'date' | 'multiline';

export type FormField = {
  id: string;
  label: string;
  kind: FormFieldKind;
  /** 画面のまとまり（申込者・使用者・工事内容 …） */
  group: string;
  /** choice の選択肢（様式に書かれている順） */
  options?: string[];
  /** 入力の補足 */
  hint?: string;
  /** 要確認（手数料など、実例から取った値） */
  unverified?: boolean;
};

/** 工事店の情報（端末ごとに保存。公開リポジトリには入れない） */
export type Contractor = {
  name: string;
  /** 沖縄市: 交付番号（沖水第 n 号）。下水道: 指定店（登録）番号 */
  licenseNo: string;
  sewerLicenseNo: string;
  zip: string;
  address: string;
  representative: string;
  tel: string;
  /** 給水装置工事主任技術者 */
  chiefEngineer: string;
  chiefEngineerTel: string;
  /** 排水設備工事責任技術者と登録番号 */
  drainageEngineer: string;
  drainageEngineerNo: string;
};

export const EMPTY_CONTRACTOR: Contractor = { name: '', licenseNo: '', sewerLicenseNo: '', zip: '', address: '', representative: '', tel: '', chiefEngineer: '', chiefEngineerTel: '', drainageEngineer: '', drainageEngineerNo: '' };

export type ApplicationValues = Record<string, string>;

export type FormSet = {
  /** 自治体プロファイル ID */
  profileId: string;
  fields: FormField[];
  /** 現場から既定値を導く（入力済みの値は上書きしない） */
  defaults: (doc: Doc, meta: { name: string; address?: string }) => ApplicationValues;
  /** 提出書類のチェックリスト。app=true はこのアプリで作れるもの */
  checklist: { label: string; app?: boolean; note?: string }[];
};

/** 入力済みの値を優先して既定値と合わせる */
export function withDefaults(set: FormSet, doc: Doc, meta: { name: string; address?: string }): ApplicationValues {
  const d = set.defaults(doc, meta);
  const v = doc.site?.application ?? {};
  // 入力済みの値はキーがあれば（空文字でも）優先する。空にした項目が既定値に戻らないように
  return { ...d, ...v };
}

/** 丸数字（①〜⑳）。選択肢の番号を囲む代わりに使う */
export const circled = (n: number): string => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`);

/** 「1. 直結 2. 受水槽」のような文字列の、選んだ番号を丸数字に置き換える（番号の後ろの空白も含めて置き換える） */
export function markChoice(text: string, index: number): string {
  if (index < 1) return text;
  const re = new RegExp(`(^|[^\\d])${index}\\s*[.．]\\s*`, '');
  return text.replace(re, (_m, pre: string) => `${pre}${circled(index)}`);
}

/** 「有 無」のような二択で、選んだ語の前に ○ を付ける */
export function markWord(text: string, word: string): string {
  const i = text.indexOf(word);
  return i < 0 ? text : `${text.slice(0, i)}○${text.slice(i)}`;
}

/** 和暦（令和）。date は YYYY-MM-DD */
export function reiwa(date: string): { year: number; month: number; day: number } | undefined {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
  if (!m) return undefined;
  const y = Number(m[1]);
  if (y < 2019) return undefined;
  return { year: y - 2018, month: Number(m[2]), day: Number(m[3]) };
}

export const todayIso = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
