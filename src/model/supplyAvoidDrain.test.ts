/**
 * 床下の給水・給湯は、器具から下りてくる排水の立て管をよける（2026-11-16 実物: 給湯 φ13 が排水 φ40 の立て管にぶつかっていた）
 */
import { describe, expect, test } from 'vitest';
import { routeSupplies } from './supplyRoute';
import { supplyHouse } from './testSupplyHouse';
import { findPipeClashes } from './clash';
import { addPolyline } from './network';

describe('床下の給水・給湯は排水の立て管をよける', () => {
  const h = supplyHouse({ header: true });
  const first = routeSupplies(h.doc, { headers: 'use' });
  // いちばん長い床下の給湯・給水の横の管の真ん中に、排水の立て管（床から土間の近くまで）を立てる
  const net0 = first.doc.network;
  const longest = Object.values(net0.segments).filter((s) => (s.system === 'hotWater' || s.system === 'water') && Math.abs(net0.nodes[s.a].pos.z - net0.nodes[s.b].pos.z) < 1 && net0.nodes[s.a].pos.z < 0)
    .sort((p, q) => Math.hypot(net0.nodes[q.a].pos.x - net0.nodes[q.b].pos.x, net0.nodes[q.a].pos.y - net0.nodes[q.b].pos.y) - Math.hypot(net0.nodes[p.a].pos.x - net0.nodes[p.b].pos.x, net0.nodes[p.a].pos.y - net0.nodes[p.b].pos.y))[0];
  const A = net0.nodes[longest.a].pos, B = net0.nodes[longest.b].pos;
  const m = { x: Math.round((A.x + B.x) / 2), y: Math.round((A.y + B.y) / 2) };
  const drop = addPolyline(h.doc.network, [{ ...m, z: 0 }, { ...m, z: -480 }], { system: 'drain', diameter: 40 });
  const doc = { ...h.doc, network: drop.net };
  const r = routeSupplies(doc, { headers: 'use' });
  test('前提: よけないと、その立て管にぶつかる位置', () => {
    expect(Math.hypot(B.x - A.x, B.y - A.y)).toBeGreaterThan(1000);
  });
  test('給水・給湯は立て管にぶつからない（つなぐ本数は同じ）', () => {
    const net = r.doc.network;
    const clashes = findPipeClashes(r.doc).filter((c) => [net.segments[c.segA].system, net.segments[c.segB].system].includes('drain'));
    expect(clashes).toEqual([]);
    expect(r.connected).toEqual(first.connected);
  });
});
