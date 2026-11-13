import { describe, expect, it } from 'vitest';
import { buildFromSheets } from '../model/planRead/assemble';
import { elevationSheet, foundationSheet, planSheet, siteSheet } from '../model/planRead/testHouse';
import { designFromReading } from './design';

describe('読み取り結果から自動で配管をつなぐ（数量の照合の「自動」側）', () => {
  it('器具の候補を全部置き、配置図の物を入れ、「まとめてつなぐ」で配管を作って材料集計を出す', () => {
    const r = buildFromSheets([{ name: 'p', page: planSheet() }, { name: 'k', page: foundationSheet() }, { name: 'e', page: elevationSheet() }, { name: 's', page: siteSheet() }]);
    const d = designFromReading(r);
    expect(Object.values(d.doc.fixtures).filter((f) => f.type === 'toilet')).toHaveLength(1);
    expect(Object.values(d.doc.fixtures).some((f) => f.type === 'publicSewage')).toBe(true);
    expect(Object.keys(d.doc.network.segments).length).toBeGreaterThan(0);
    const pipes = d.summary.sections.flatMap((s) => s.items).filter((i) => i.kind === 'pipe');
    expect(pipes.length).toBeGreaterThan(0);
    expect(pipes.every((p) => p.total > 0)).toBe(true);
  });
});
