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
/** ヘッダーの箱（入口の前 200mm を含む）を横切る、別の系統の床下の管（zz: 床下の管の高さ） */
function pipesThrough(doc: Doc, type: 'waterHeader' | 'hotWaterHeader', zz = z) {
  const h = Object.values(doc.fixtures).find((f) => f.type === type)!;
  const hw = FIXTURE_CATALOG[type].size.w / 2, hd = FIXTURE_CATALOG[type].size.d / 2;
  const other = type === 'hotWaterHeader' ? 'water' : 'hotWater';
  return Object.values(doc.network.segments).filter((s) => {
    if (s.system !== other) return false;
    const a = doc.network.nodes[s.a].pos, b = doc.network.nodes[s.b].pos;
    if (Math.abs(a.z - zz) > 1 || Math.abs(b.z - zz) > 1) return false;
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
  test('1 階の床の高さが 0 でない家でも同じ（ヘッダーの高さは床からの高さ）', () => {
    const h = supplyHouse();
    const E = -1000;
    // 建物ごと 1000 下げる（床・基礎・地盤）
    const b = h.doc.building;
    const building = { ...b, floors: b.floors.map((f) => ({ ...f, elevation: f.elevation + E })), foundation: { slabTop: (b.foundation?.slabTop ?? 0) + E },
      members: Object.fromEntries(Object.entries(b.members ?? {}).map(([k, m]) => [k, { ...m, z0: m.z0 + E, z1: m.z1 + E }])) } as typeof b;
    const fixtures = Object.fromEntries(Object.entries(h.doc.fixtures));
    const nodes = Object.fromEntries(Object.entries(h.doc.network.nodes).map(([k, n]) => [k, { ...n, pos: { ...n.pos, z: n.pos.z + E } }]));
    const doc0: Doc = { ...h.doc, building, fixtures, network: { ...h.doc.network, nodes }, site: { ...h.doc.site, designGL: (h.doc.site?.designGL ?? 0) + E } };
    const zz = E + z;
    const base = routeSupplies(doc0, { headers: 'use' });
    const hot0 = Object.values(base.doc.fixtures).find((f) => f.type === 'hotWaterHeader')!;
    const net = addPolyline(doc0.network, [{ x: hot0.x - 1500, y: hot0.y, z: zz }, { x: hot0.x + 1500, y: hot0.y, z: zz }], { system: 'water', diameter: 20, material: 'PB' }).net;
    const r = routeSupplies({ ...doc0, network: net }, { headers: 'use' });
    expect(pipesThrough(r.doc, 'hotWaterHeader', zz)).toEqual([]);
    expect(r.notes.join()).not.toContain('給湯ヘッダーの入口へ配管をつなげませんでした');
  });
  test('床下のどこも先の管が通っていて置けなければ、置かずにそう知らせる（管の上には置かない）', () => {
    const h = supplyHouse();
    let net = h.doc.network;
    // 床下の全面に 100mm おきの給水の管（どの置き場所の箱も横切る）
    for (let y = 100; y < 6000; y += 100) net = addPolyline(net, [{ x: 100, y, z }, { x: 7900, y, z }], { system: 'water', diameter: 13, material: 'PB' }).net;
    const r = routeSupplies({ ...h.doc, network: net }, { headers: 'use' });
    expect(Object.values(r.doc.fixtures).some((f) => f.type === 'hotWaterHeader' || f.type === 'waterHeader')).toBe(false);
    expect(r.notes.join()).toContain('を置ける場所が床下に見つかりませんでした');
  });
});
