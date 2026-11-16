/**
 * 家のすぐ横（外壁から 300mm 未満）にある立水栓（2026-11-16 実物: 外壁の芯から 250mm・家の角のそば）:
 * 外の給水管へは、立水栓と同じくらい家に近い道でまっすぐ分ける。遠回りして本管の上に重ねない（分岐角 0° の要確認・干渉が出ていた）
 */
import { describe, expect, test } from 'vitest';
import { routeSupplies } from './supplyRoute';
import { supplyHouse } from './testSupplyHouse';
import { moveFixture, placeFixture } from './fixtures';
import { analyzeFittings } from './fittings';
import { findPipeClashes } from './clash';

describe('家のすぐ横の立水栓', () => {
  const h = supplyHouse();
  // 実物の並び: メーターは南西の角の外、給湯器は北。外の給水管は西側を北へ。立水栓は南の外壁のすぐ外（西の角のそば）
  let doc = moveFixture(h.doc, h.ids.meter!, { x: -1500, y: -1400 });
  doc = moveFixture(doc, h.ids.heater, { x: 2000, y: 6300 });
  doc = placeFixture(doc, h.floorId, 'outdoorFaucet', { x: 325, y: -247 }, 0).doc;
  const r = routeSupplies(doc, { headers: 'use' });
  const net = r.doc.network;
  test.skipIf(!process.env.DUMP)('dump', () => { for (const s of Object.values(net.segments)) if (s.system === 'water') { const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos; console.log(s.diameter, s.material, [a.x, a.y, a.z].map(Math.round), [b.x, b.y, b.z].map(Math.round)); } });
  test('つながり、地中の管は重ならない（同じ線上で重なる管が無い）', () => {
    expect(r.notes.join('/')).toContain('立水栓 1 個');
    const segs = Object.values(net.segments).filter((s) => s.system === 'water');
    const P = (id: string) => net.nodes[id].pos;
    for (const s of segs) for (const t of segs) {
      if (s.id >= t.id) continue;
      const a = P(s.a), b = P(s.b), c = P(t.a), d = P(t.b);
      if (Math.abs(a.z - b.z) > 1 || Math.abs(c.z - d.z) > 1 || Math.abs(a.z - c.z) > 1) continue;
      const vx = Math.abs(a.x - b.x) < 1 && Math.abs(c.x - d.x) < 1 && Math.abs(a.x - c.x) < 1;
      const hy = Math.abs(a.y - b.y) < 1 && Math.abs(c.y - d.y) < 1 && Math.abs(a.y - c.y) < 1;
      const ov = vx ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
        : hy ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) : 0;
      expect(ov, `重なり ${JSON.stringify([a, b, c, d])}`).toBeLessThan(10);
    }
  });
  test('部品の確定・干渉の要確認が出ない', () => {
    expect(analyzeFittings(net, r.doc.fixtures).filter((f) => f.needsConfirm).map((f) => f.reason)).toEqual([]);
    expect(findPipeClashes(r.doc).filter((c) => net.segments[c.segA].system === 'water' && net.segments[c.segB].system === 'water')).toEqual([]);
  });
});
