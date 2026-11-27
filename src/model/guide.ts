/**
 * 作業手順ガイド。工事データ（doc）から各工程が済んでいるかを毎回計算する（保存はしない）。
 * 初めての人に「今どこで、次に何をするか」を示すためのもの。経験者はどの工程からでも操作できる。
 */
import type { Doc } from './doc';

export type GuideStepId = 'info' | 'drawing' | 'layout' | 'fixtures' | 'pipes' | 'lengths' | 'quantities' | 'quote';
export type GuideStep = { id: GuideStepId; no: number; title: string; hint: string; optional: boolean; done: boolean; progress?: string };

const DEF: { id: GuideStepId; title: string; hint: string; optional?: boolean }[] = [
  { id: 'info', title: '工事名・現場情報', hint: '工事名と住所を入れます（作成時に入力済み）' },
  { id: 'drawing', title: '図面の取り込み', hint: '間取り図の写真やPDFを下に敷いて、なぞって描けます（なくても進めます）', optional: true },
  { id: 'layout', title: '間取りの作成', hint: '建物の外周を指で1周なぞると外壁になります。部屋・ドア・窓も足せます' },
  { id: 'fixtures', title: '水道設備の配置', hint: 'メーター・屋上タンク・トイレなどを選んで図面をタップして置きます' },
  { id: 'pipes', title: '配管ルートの作成', hint: '器具の丸（接続口）から指でなぞると配管になります。配管の途中から描くと分岐します' },
  { id: 'lengths', title: '配管長さの入力', hint: '配管をタップして、現場で測った長さを「実測長」に入れます（なくても集計できます）', optional: true },
  { id: 'quantities', title: '材料・部品の集計', hint: '配管の長さ・継手・器具の数が自動で集計されます。内容を確認します' },
  { id: 'quote', title: '見積もり作成', hint: '単価を確認して見積書（PDF・Excel）を出力します' },
];

export function guideSteps(doc: Doc): GuideStep[] {
  const segs = Object.values(doc.network.segments);
  const measured = segs.filter((s) => s.measuredLength !== undefined).length;
  const hasPipes = segs.length > 0;
  const done: Record<GuideStepId, boolean> = {
    info: true,
    drawing: Object.keys(doc.underlays ?? {}).length > 0,
    // 配管まで描いてある工事（白紙で描いた等）は、壁・器具がなくても先の工程へ進める
    layout: Object.keys(doc.building.walls).length > 0 || hasPipes,
    fixtures: Object.keys(doc.fixtures).length > 0 || hasPipes,
    pipes: hasPipes,
    lengths: hasPipes && measured === segs.length,
    quantities: hasPipes,
    quote: hasPipes,
  };
  return DEF.map((d, i) => ({
    id: d.id, no: i + 1, title: d.title, hint: d.hint, optional: !!d.optional, done: done[d.id],
    ...(d.id === 'lengths' && hasPipes ? { progress: `実測 ${measured}/${segs.length}区間` } : {}),
  }));
}

/** 次にやる工程: 最初の未完了の必須工程。全部済んでいれば「集計」（確認して見積へ進む） */
export function currentStep(steps: GuideStep[]): GuideStep {
  return steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => s.id === 'quantities')!;
}

/**
 * 申請の手順（2026-11-26）: 図面を入れる → 器具を置く → 自動でつなぐ → 確認の質問 → 書類を出す。
 * 見積の手順（guideSteps）とは別の並び。つなぎ忘れ・質問の数は画面側で数えて渡す（この関数は数えない）。
 */
export type ShinseiStepId = 'sDrawing' | 'sFixtures' | 'sConnect' | 'sQuestions' | 'sDocs';
export type ShinseiStep = { id: ShinseiStepId; no: number; title: string; hint: string; done: boolean; progress?: string };
export type ShinseiCtx = {
  /** つながっていない器具の口（給水・給湯・排水）の数 */
  openPorts: number;
  /** 答えていない確認の質問の数 */
  openQuestions: number;
  /** 提出先の自治体を選んである */
  municipality: boolean;
};

const SDEF: { id: ShinseiStepId; title: string; hint: string }[] = [
  { id: 'sDrawing', title: '図面を入れる', hint: '建築図面（PDF・写真・Jw_cad）を取り込みます。壁を指でなぞって描いてもかまいません' },
  { id: 'sFixtures', title: '器具を置く', hint: 'トイレ・洗面台などの器具と、水道メーター・公共汚水ますを置きます' },
  { id: 'sConnect', title: '自動でつなぐ', hint: '汚水・水・お湯をまとめて自動でつなぎます（元に戻す 1 回で全部戻せます）' },
  { id: 'sQuestions', title: '確認の質問に答える', hint: '新設か・道路を掘るかなど、図面からは決められないことを数タップで答えます' },
  { id: 'sDocs', title: '書類を出す', hint: '申請書・申請図面・道路の書類を、状態を確かめてまとめて保存します' },
];

export function shinseiSteps(doc: Doc, ctx: ShinseiCtx): ShinseiStep[] {
  const hasPipes = Object.keys(doc.network.segments).length > 0;
  const types = new Set(Object.values(doc.fixtures).map((f) => f.type));
  const missing = [...(types.has('waterMeter') ? [] : ['水道メーター']), ...(types.has('publicSewage') ? [] : ['公共汚水ます'])];
  const done: Record<ShinseiStepId, boolean> = {
    sDrawing: Object.keys(doc.underlays ?? {}).length > 0 || Object.keys(doc.building.walls).length > 0 || hasPipes,
    sFixtures: types.size > 0 || hasPipes,
    sConnect: hasPipes && ctx.openPorts === 0,
    sQuestions: ctx.municipality && ctx.openQuestions === 0,
    // 書類は出したかどうかを工事データに残していないので、いつも最後の工程として残す
    sDocs: false,
  };
  const progress: Partial<Record<ShinseiStepId, string>> = {
    ...(types.size > 0 && missing.length ? { sFixtures: `${missing.join('・')}がまだです` } : {}),
    ...(hasPipes && ctx.openPorts > 0 ? { sConnect: `つながっていない口が ${ctx.openPorts} か所` } : {}),
    ...(!ctx.municipality ? { sQuestions: '提出先の自治体がまだです' } : ctx.openQuestions > 0 ? { sQuestions: `あと ${ctx.openQuestions} 件` } : {}),
  };
  return SDEF.map((d, i) => ({ id: d.id, no: i + 1, title: d.title, hint: d.hint, done: done[d.id], ...(progress[d.id] ? { progress: progress[d.id] } : {}) }));
}

/** 次にやる工程: 最初の未完了の工程（書類はいつも未完了なので、最後はそこに止まる） */
export function currentShinseiStep(steps: ShinseiStep[]): ShinseiStep {
  return steps.find((s) => !s.done) ?? steps[steps.length - 1];
}
