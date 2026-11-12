import { describe, expect, test } from 'vitest';
import type { ManholeRow, ManholeTable } from '../model/manholeTable';
import { createBuildingFromDims } from '../model/building';
import { findTextOverlaps } from './labelLayout';
import { MASU_ROWS_PER_PAGE, renderManholeSheets } from './manholeSheet';
import type { Op } from './sheet';

const meta = { siteName: 'テスト工事', date: new Date(2026, 10, 12) };
const texts = (ops: Op[]) => ops.filter((o): o is Extract<Op, { t: 'text' }> => o.t === 'text').map((o) => o.s);
const building = createBuildingFromDims({ width: 9100, depth: 7280, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });

function table(n: number): { t: ManholeTable; pos: Record<string, { x: number; y: number }> } {
  const rows: ManholeRow[] = [];
  const pos: Record<string, { x: number; y: number }> = {};
  for (let i = 0; i < n; i++) {
    rows.push({ nodeId: `n${i}`, no: `NO.${i + 1}`, kind: '汚水マス', size: 'φ300', isPublic: false, existing: false, gl: 300 - i, invert: 900 - i * 20, depth: 600 + i * 20, pipe: 'VUφ100', slope: '2.0%', toNext: 2500, next: `NO.${i + 2}`, ...(i === 2 ? { invertIn: 1100, drop: 250 } : {}) });
    pos[`n${i}`] = { x: -800 + (i % 2) * 400, y: 300 + i * 450 };
  }
  rows.push({ nodeId: 'pub', no: '公共', kind: '公共汚水マス', size: 'φ200', isPublic: true, existing: true, gl: 300, invert: 0, depth: 1200 });
  pos.pub = { x: -3000, y: 3000 };
  return { t: { rows, datumLabel: '高さの基準: 公共汚水ますの管底 ±0', outside: 0 }, pos };
}

describe('ます表の用紙', () => {
  test('A4 横・見出し・番号・高さ（符号つき）・落差・既設。文字が重ならない', () => {
    const { t, pos } = table(4);
    const sheets = renderManholeSheets({ building, network: { nodes: {}, segments: {} }, fixtures: {} }, t, pos, meta);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({ width: 297, height: 210 });
    const s = texts(sheets[0].ops);
    expect(s).toContain('ます表');
    expect(s).toContain('NO.3');
    expect(s).toContain('+900');
    expect(s.some((x) => x.includes('落差 250'))).toBe(true);
    expect(s.some((x) => x.includes('既設'))).toBe(true);
    expect(s.some((x) => x.includes('公共汚水ますの管底'))).toBe(true);
    for (const sh of sheets) expect(findTextOverlaps(sh)).toEqual([]);
  });

  test('多いと続きのページ（見出しを繰り返す）。重ならない', () => {
    const { t, pos } = table(MASU_ROWS_PER_PAGE + 5);
    const sheets = renderManholeSheets({ building, network: { nodes: {}, segments: {} }, fixtures: {} }, t, pos, meta);
    expect(sheets).toHaveLength(2);
    expect(texts(sheets[1].ops)).toContain('ます表（続き）');
    expect(texts(sheets[1].ops)).toContain('地盤高');
    for (const sh of sheets) expect(findTextOverlaps(sh)).toEqual([]);
  });
});
