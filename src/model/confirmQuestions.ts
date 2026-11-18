/**
 * 確認の質問: 図面からは決められず、現場を知っている人が決めること（工事の種類・給水方式・排水の行き先・道路を掘るか）だけを聞く。
 * 推奨（図面と様式から導いた初期値）を最初から選んでおき、まとめて 1 押しで決められるようにする。
 * 答えは doc.site.application に入り、申請書・道路の書類・図面の表題に共通で使われる（キーがあれば「答えた」）。
 */
import type { ApplicationValues, FormSet } from '../forms/types';
import type { Question } from './question';

export type ConfirmQuestion = Question & {
  /** 推奨の答え（決められなければ空） */
  recommended: string;
  /** 使う人がもう答えたか */
  answered: boolean;
  /** いまの値（答え、無ければ推奨） */
  current: string;
};

type Def = { title: string; why: string; hints?: Record<string, string>; options?: string[]; /** 図面から導けないので、おすすめを付けない */ noRecommend?: boolean };
const WORK: Def = {
  title: 'どんな工事ですか？',
  why: '申請書の「工事の種類」に入ります。新しく水道を引くのか、今あるものを直すのかで、書く内容が変わります。',
  hints: { 新設: '新しく水道を引く（新築はこれ）', 改造: '今ある水道の管や器具を変える', 修繕: '壊れた所を直す', 臨仮: '工事の間だけの仮設の水道' },
};
const YESNO = ['する', 'しない'];
/** 聞く順。様式にその項目があるときだけ聞く */
const DEFS: [string, Def][] = [
  ['waterWorkKind', WORK],
  ['workKind', WORK],
  ['supplyType', {
    title: '水はどうやって建物に送りますか？',
    why: '給水方式で、要る計算書と書類が変わります。戸建て・2 階建てまでは、ほとんどが「直結」です。',
    hints: { 直結: '道路の水道管の力で、そのまま蛇口へ（タンクなし）', 受水槽: 'いったんタンクにためて、ポンプで送る', 直結増圧給水: 'タンクなしで、ポンプで力を足して送る' },
  }],
  ['drainTo', {
    title: '使った水（排水）はどこへ流しますか？',
    why: '図面に公共ますがあれば「公共下水道」をおすすめにしています。下水道が来ていない所は浄化槽です。',
    hints: { 公共下水道: '道路の下水管へ流す', 浄化槽: '敷地の中の浄化槽できれいにして流す' },
  }],
  ['sewerConnection', {
    title: '排水は、どこにつなぎますか？',
    why: '下水道の申請書の「接続先」に入ります。図面に公共ますがあるかどうかでおすすめを選んでいます。現場のますを見て確かめてください。',
    hints: { 公共ます: '道路ぎわに、もうある公共ますへつなぐ', 'ます設置（新規）': '公共ますが無いので、新しく付けてもらう', 'ます設置(新規)': '公共ますが無いので、新しく付けてもらう', 私設置ます: '自分で付けたますへつなぐ', 物件設置: '建物についているますへつなぐ' },
  }],
  ['tempSupply', {
    title: '工事の間、水道を使いますか？（臨時給水）',
    why: '使うときは、臨時給水の申込みと誓約書が一式に入ります。',
    hints: { 有り: '工事の間も水を使う（新築はふつうこれ）', 無し: '工事の間は使わない' },
  }],
  ['road.water', {
    title: '道路の水道管から敷地へ、新しく管を引き込みますか？',
    why: '引き込むときは道路を掘るので、道路の書類（道路占用・道路使用許可）が要ります。図面からは分からないので、現場を見て選んでください。',
    hints: { する: '道路を掘って、水道の本管から敷地へ管を引く', しない: '敷地まで、もう管が来ている' }, options: YESNO, noRecommend: true,
  }],
  ['road.sewer', {
    title: '道路の下水管から公共ますまでの管（取付管）を、この工事で付けますか？',
    why: '付けるときは道路を掘るので、道路の書類に下水の分も入れます。図面からは分からないので、現場を見て選んでください。',
    hints: { する: '道路を掘って、下水の本管から公共ますまでの管を付ける', しない: '取付管と公共ますがもうある、または役所が付けてくれる' }, options: YESNO, noRecommend: true,
  }],
];

/**
 * @param stored 使う人が入れた値（doc.site.application）
 * @param values 初期値と合わせた申請書の値（withDefaults）
 * @param road 道路の値（roadValues）
 */
export function confirmQuestions(set: FormSet | undefined, stored: ApplicationValues | undefined, values: ApplicationValues, road: ApplicationValues): ConfirmQuestion[] {
  const out: ConfirmQuestion[] = [];
  for (const [id, def] of DEFS) {
    const isRoad = id.startsWith('road.');
    const field = set?.fields.find((f) => f.id === id);
    const options = def.options ?? field?.options;
    if (!options?.length || (!isRoad && !field)) continue;
    // 浄化槽へ流すなら下水の取付管は無い
    if (id === 'road.sewer' && values.drainTo === '浄化槽') continue;
    const answered = !!stored && !!stored[id];
    const raw = (isRoad ? road[id] : values[id]) ?? '';
    // かっこの全角・半角などの違いは同じ答えとして扱う
    const value = options.find((o) => norm(o) === norm(raw)) ?? raw;
    const known = options.includes(value);
    out.push({
      id, title: def.title, why: def.why, answered,
      recommended: !answered && known && !def.noRecommend ? value : '',
      current: answered || (known && !def.noRecommend) ? value : '',
      options: [
        ...options.map((o) => ({ value: o, label: o, hint: def.hints?.[o] ?? '' })),
        // 選択肢に無い値が入っている工事（前の版・手入力）: 消さずに「いまの値」として見せる
        ...(answered && !known ? [{ value, label: value, hint: '前に入れた値です' }] : []),
      ],
    });
  }
  return out;
}
const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');

/** まとめて決めるときに保存する値: まだ答えていない質問の、選んだ答え（選んでいなければ推奨。どちらも無ければ入れない） */
export function answersOf(qs: ConfirmQuestion[], picked: Record<string, string>): ApplicationValues {
  const out: ApplicationValues = {};
  for (const q of qs) {
    const v = picked[q.id] ?? (q.answered ? '' : q.recommended);
    if (v) out[q.id] = v;
  }
  return out;
}
