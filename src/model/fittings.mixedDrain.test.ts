/**
 * 排水（雑排水）と汚水は同じ排水の管: 床下の φ100 の本管（汚水）へ洗面・キッチンの排水がつながる所は、
 * 「種類の違う配管の分岐」ではなく、ふつうのチーズ・Y・径違い（2026-11-16 実物で要確認に出ていた）
 */
import { describe, expect, it } from 'vitest';
import { analyzeFittings } from './fittings';
import { addPolyline, emptyNetwork, type Vec3 } from './network';

const v = (x: number, y: number, z = -450): Vec3 => ({ x, y, z });

describe('排水と汚水の合流は同じ種類として部品を決める', () => {
  it('汚水の本管へ排水が直角に合流 → チーズ（確定不要）', () => {
    const a = addPolyline(emptyNetwork(), [v(0, 0), v(1000, 0), v(2000, 0)], { system: 'sewage', diameter: 100 });
    const b = addPolyline(a.net, [v(1000, 800), v(1000, 0)], { system: 'drain', diameter: 50 }, { endNodeId: a.nodeIds[1] });
    const f = analyzeFittings(b.net).find((x) => x.nodeId === a.nodeIds[1])!;
    expect(f.needsConfirm).toBe(false);
    expect(f.type).toBe('tee');
  });
  it('汚水の本管の上流の端に排水が直角に入る → 径違いのエルボ（確定不要）', () => {
    const a = addPolyline(emptyNetwork(), [v(0, 0), v(1000, 0)], { system: 'sewage', diameter: 100 });
    const b = addPolyline(a.net, [v(0, 800), v(0, 0)], { system: 'drain', diameter: 50 }, { endNodeId: a.nodeIds[0] });
    const f = analyzeFittings(b.net).find((x) => x.nodeId === a.nodeIds[0])!;
    expect(f.needsConfirm).toBe(false);
    expect(f.type).toBe('elbow90');
  });
  it('給水と排水のように本当に違う系統は今までどおり確かめる', () => {
    const a = addPolyline(emptyNetwork(), [v(0, 0), v(1000, 0), v(2000, 0)], { system: 'sewage', diameter: 100 });
    const b = addPolyline(a.net, [v(1000, 800), v(1000, 0)], { system: 'water', diameter: 20 }, { endNodeId: a.nodeIds[1] });
    expect(analyzeFittings(b.net).find((x) => x.nodeId === a.nodeIds[1])!.needsConfirm).toBe(true);
  });
});

describe('マスの口に入る管・出る管', () => {
  it('マス（汚水ます・公共ます）の口に流入と流出の 2 本がつながるのはふつう（部品の確定は要らない）', () => {
    const a = addPolyline(emptyNetwork(), [v(0, 0, -900), v(1000, 0, -920), v(2000, 0, -940)], { system: 'sewage', diameter: 100 });
    const mid = a.nodeIds[1];
    const net = { ...a.net, nodes: { ...a.net.nodes, [mid]: { ...a.net.nodes[mid], fixtureId: 'm1', portId: 'pipe' } } };
    for (const type of ['manholeSewage', 'publicSewage'] as const) {
      const f = analyzeFittings(net, { m1: { id: 'm1', floorId: 'f', type, x: 1000, y: 0, rotation: 0 } } as never).find((x) => x.nodeId === mid)!;
      expect(f.needsConfirm).toBe(false);
    }
  });
});
