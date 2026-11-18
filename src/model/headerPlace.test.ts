/**
 * 床下のヘッダーを、先に引いた給水・給湯の管の上に置かない（2026-11-18 実物: 給湯ヘッダーを給水ヘッダーへ入る給水の管の上に置き、
 * 給湯ヘッダーの入口へ入る道がその管で塞がって「給湯ヘッダーの入口へ配管をつなげませんでした（手でつないでください）」になっていた）
 */
import { describe, expect, test } from 'vitest';
import type { Doc } from './doc';
import { FIXTURE_CATALOG } from './fixtures';
import { addPolyline } from './network';
import { routeSupplies, UNDERFLOOR_Z } from './supplyRoute';
import { supplyHouse } from './testSupplyHouse';

const z = UNDERFLOOR_Z;
/** ヘッダーの箱（入口の前 200mm を含む）を横切る、別の系統の床下の管 */
function pipesThrough(doc: Doc, type: 'waterHeader' | 'hotWaterHeader') {
  const h = Object.values(doc.fixtures).find((f) => f.type === type)!;
  const hw = FIXTURE_CATALOG[type].size.w / 2, hd = FIXTURE_CATALOG[type].size.d / 2;
  const other = type === 'hotWaterHeader' ? 'water' : 'hotWater';
  return Object.values(doc.network.segments).filter((s) => {
    if (s.system !== other) return false;
    const a = doc.network.nodes[s.a].pos, b = doc.network.nodes[s.b].pos;
    if (Math.abs(a.z - z) > 1 || Math.abs(b.z - z) > 1) return false;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    return x0 <= h.x + hw && x1 >= h.x - hw - 200 && y0 <= h.y + hd && y1 >= h.y - hd;
  });
}

describe('ヘッダーを先の管の上に置かない', () => {
  test('今まで: この家では給湯ヘッダーは給湯器の入口の内側（2150,825）に置かれる', () => {
    const h = supplyHouse();
    const r = routeSupplies(h.doc, { headers: 'use' });
    const hot = Object.values(r.doc.fixtures).find((f) => f.type === 'hotWaterHeader')!;
    expect({ x: hot.x, y: hot.y }).toEqual({ x: 2150, y: 825 });
  });
  test('そこを給水の管が通っていれば、そこを避けて給湯ヘッダーを置き、入口へつなぐ', () => {
    const h = supplyHouse();
    // 給湯ヘッダーを最初に置こうとする列（y=825）を横切る給水の床下の管（給水ヘッダーへ入る管などの代わり）
    const net = addPolyline(h.doc.network, [{ x: 600, y: 825, z }, { x: 3500, y: 825, z }], { system: 'water', diameter: 20, material: 'PB' }).net;
    const r = routeSupplies({ ...h.doc, network: net }, { headers: 'use' });
    expect(pipesThrough(r.doc, 'hotWaterHeader')).toEqual([]);
    expect(r.notes.join()).not.toContain('給湯ヘッダーの入口へ配管をつなげませんでした');
    expect(r.notes.join()).not.toContain('給湯ヘッダーを置ける場所');
  });
});
