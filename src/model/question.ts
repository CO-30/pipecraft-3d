/**
 * 使う人に聞く質問（はじめての人にも分かる言葉で）。自動の作業が「どうしても決められない」ときだけ出す。
 * title: 聞きたいこと、why: なぜ聞くのか（見つかったこと）、options: 選べる答えと、その答えで何が起きるかの一言
 */
export type QuestionOption = { value: string; label: string; hint: string };
export type Question = { id: string; title: string; why: string; options: QuestionOption[] };

/** 給水・給湯を分岐でつなげなかった器具があるとき: ヘッダー（1 本の管を何本にも分ける部品）を床下に置くか */
export function headerQuestion(need: { water: number; hot: number }): Question | null {
  const parts = [need.water ? `給水 ${need.water} か所` : '', need.hot ? `お湯 ${need.hot} か所` : ''].filter(Boolean);
  if (!parts.length) return null;
  return {
    id: 'header',
    title: '水を分ける部品「ヘッダー」を床下に置きますか？',
    why: `ヘッダーを使わずに管の途中から枝分かれ（チーズ）でつなごうとしましたが、${parts.join('・')}は、ほかの管や基礎をよけて通る道が見つかりませんでした。ヘッダーは 1 本の管を何本にも分ける部品で、ここから 1 か所ずつ専用の管を引くので、通しやすくなります（部品が 1 つ増えます）。`,
    options: [
      { value: 'use', label: 'ヘッダーを置いてつなぐ', hint: '床下にヘッダーを置き、つながっていない所だけをヘッダーからつなぎます' },
      { value: 'skip', label: '置かない（自分でつなぐ）', hint: 'いまの形のまま。残りは配管の道具で手でつないでください' },
    ],
  };
}
