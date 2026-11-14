/** 比べた結果を Markdown の表にする（手元で実物を測ったとき・記録に残すとき） */
import { FIXTURE_CATALOG, type FixtureType } from '../model/fixtures';
import type { ItemScore, Score } from './evaluate';
import type { Truth } from './truth';

const KIND = { detached: '戸建', apartment: 'アパート', mansion: 'マンション' } as const;
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
const mm = (v: number | null) => (v === null ? '—' : `${v}mm`);
const label = (t: string) => FIXTURE_CATALOG[t as FixtureType]?.label ?? t;

function items(s: ItemScore): string {
  if (s.recall === null) return '—';
  const miss = Object.entries(s.byType).flatMap(([t, c]) => [c.missing ? `${label(t)} 不足 ${c.missing}` : '', c.extra ? `${label(t)} 余分 ${c.extra}` : ''].filter(Boolean));
  return `再現率 ${pct(s.recall)} / 適合率 ${pct(s.precision)} / 位置の誤差 中央 ${mm(s.positionMedian)}・最大 ${mm(s.positionMax)}${miss.length ? `（${miss.join('、')}）` : ''}`;
}

export function formatScore(t: Truth, s: Score): string {
  const rows: [string, string][] = [
    ['図面', s.sheets.total ? `種類 ${s.sheets.kindCorrect}/${s.sheets.total}・縮尺 ${s.sheets.scaleCorrect}/${s.sheets.scaleTotal}${s.sheets.wrong.length ? `（${s.sheets.wrong.join('、')}）` : ''}` : '—'],
    ['階', s.floors.truth ? `正解 ${s.floors.truth} 階・読んだ ${s.floors.read} 階・階高の誤差 最大 ${mm(s.floors.heightErrorMax)}・GL〜床 ${mm(s.floors.glToFlError)}` : '—'],
    ['壁', s.walls.recall === null ? '—' : `再現率 ${pct(s.walls.recall)} / 適合率 ${pct(s.walls.precision)} / 厚さの誤差 ${mm(s.walls.thicknessError)}`],
    ['開口', s.openings ? `正解 ${s.openings.truth}・読んだ ${s.openings.read}（差 ${s.openings.diff}）` : '—'],
    ['器具', items(s.fixtures)],
    ['配置図', items(s.site)],
    ['要確認', `${s.checks} 件`],
  ];
  return [
    `## ${t.id}（${KIND[t.kind]}）${t.confirmed ? '' : '⚠ 正解は未確認'}`,
    '',
    '| 項目 | 結果 |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    '',
  ].join('\n');
}
