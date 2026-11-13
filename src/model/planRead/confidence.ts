/**
 * 読み取り結果の確からしさ。読み取り画面で「確かめてほしいこと」を、読めなかった物（低）→ 推定・標準値・目安（中）→ お知らせ の順に出す。純粋関数。
 */
import type { CheckLevel, ImportReport } from './assemble';

export type CheckItem = { text: string; level: CheckLevel };
const ORDER: Record<CheckLevel, number> = { low: 0, mid: 1, info: 2 };

export function checkItems(report: ImportReport): { items: CheckItem[]; count: Record<CheckLevel, number> } {
  const items = report.check.map((text, i) => ({ text, level: report.levels?.[i] ?? 'mid' as CheckLevel, i }))
    .sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.i - b.i)
    .map(({ text, level }) => ({ text, level }));
  const count = { low: 0, mid: 0, info: 0 };
  for (const it of items) count[it.level]++;
  return { items, count };
}

/** 器具の候補の位置が確かか（器具の名前の文字のそば）。部屋の名前から出したものは大まか */
export const fixtureSure = (c: { near: boolean }) => c.near;
