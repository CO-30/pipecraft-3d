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
    layout: Object.keys(doc.building.walls).length > 0,
    fixtures: Object.keys(doc.fixtures).length > 0,
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
