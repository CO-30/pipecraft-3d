import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate';
import { formatScore } from './report';
import { parseTruth } from './truth';

const empty = { sheets: [], floors: [], walls: [], openings: [], fixtures: [], site: [], checks: [] };

describe('結果の表（formatScore）', () => {
  it('項目ごとに 1 行、測れない項目は「—」、未確認の正解は見出しに出す', () => {
    const t = parseTruth({ id: 'k1', kind: 'detached', walls: [{ floor: 1, a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, thickness: 120 }] });
    const md = formatScore(t, evaluate(empty, t));
    expect(md).toContain('## k1（戸建）⚠ 正解は未確認');
    expect(md).toContain('| 壁 | 再現率 0.0% / 適合率 0.0% / 厚さの誤差 — |');
    expect(md).toContain('| 器具 | — |');
  });
  it('器具は種類ごとの 不足・余分 を書く', () => {
    const t = parseTruth({ id: 'k2', kind: 'mansion', confirmedBy: 'a', confirmedAt: 'b', fixtures: [{ floor: 1, type: 'toilet', x: 0, y: 0 }] });
    const md = formatScore(t, evaluate({ ...empty, fixtures: [{ floor: 1, type: 'kitchen', x: 0, y: 0 }] }, t));
    expect(md).toContain('## k2（マンション）');
    expect(md).not.toContain('未確認');
    expect(md).toContain('トイレ 不足 1');
    expect(md).toContain('キッチン 余分 1');
  });
});
