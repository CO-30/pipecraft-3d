/**
 * 給湯器の給水の分け口が、外の給水管の曲がり（床下へ立ち上げる所）のすぐそばになるとき（2026-11-16 実物: 10mm）:
 * 曲がりの点へ斜めにつながず、まっすぐな所でチーズ（直角）で分ける（「一直線の本管がない分岐」の要確認が出ていた）
 */
import { describe, expect, test } from 'vitest';
import { routeSupplies } from './supplyRoute';
import { supplyHouse } from './testSupplyHouse';
import { moveFixture } from './fixtures';
import { analyzeFittings } from './fittings';
import { findPipeClashes } from './clash';

describe('給湯器の給水の分け口', () => {
  const h = supplyHouse();
  let doc = moveFixture(h.doc, h.ids.meter!, { x: -1500, y: -1400 });
  doc = moveFixture(doc, h.ids.heater, { x: 2000, y: 6185 });
  const r = routeSupplies(doc, { headers: 'use' });
  const net = r.doc.network;
  test.skipIf(!process.env.DUMP)('dump', () => { for (const s of Object.values(net.segments)) if (s.system === 'water' && s.material === 'HIVP') { const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos; console.log(s.diameter, [a.x, a.y, a.z].map(Math.round), [b.x, b.y, b.z].map(Math.round)); } });
  test('外の給水管の管はすべて縦横（斜めの管が無い）', () => {
    for (const s of Object.values(net.segments)) {
      if (s.system !== 'water' || s.material !== 'HIVP') continue;
      const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos;
      const axes = [Math.abs(a.x - b.x) > 1, Math.abs(a.y - b.y) > 1, Math.abs(a.z - b.z) > 1].filter(Boolean).length;
      expect(axes, JSON.stringify([a, b])).toBeLessThanOrEqual(1);
    }
  });
  test('部品の確定・給水どうしの干渉の要確認が出ない', () => {
    expect(r.notes.join('/')).toContain('給湯器の給水');
    expect(analyzeFittings(net, r.doc.fixtures).filter((f) => f.needsConfirm).map((f) => f.reason)).toEqual([]);
    expect(findPipeClashes(r.doc).filter((c) => net.segments[c.segA].system === 'water' && net.segments[c.segB].system === 'water')).toEqual([]);
  });
});
