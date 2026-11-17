/**
 * マスへ高く着く排水の管（管ごとのドロップ dropEnd・落差桝 dropIn）は、マスの外で L で落とす形（dropLegs・3D と同じ）。
 * 部品の向きは着く高さで見る（2026-11-18: 落とす前の管をマスの管底へ真っすぐ向けて見て、床下から出る所に 56°・77° の曲がりが出ていた）
 */
import { describe, expect, it } from 'vitest';
import { analyzeFittings } from './fittings';
import { addPolyline, emptyNetwork, type Network, type Vec3 } from './network';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
/** 床下から下りてきた立て管の下 K（−980）→ 525mm 先のマス M（管底 −1340）→ さらに下流の点 P → 曲がって Q */
function exitToManhole(dropEnd?: number): { net: Network; K: string; P: string } {
  const a = addPolyline(emptyNetwork(), [v(0, 0, -300), v(0, 0, -980), v(525, 0, -1340)], { system: 'sewage', diameter: 100 });
  const M = a.nodeIds[2];
  const b = addPolyline(a.net, [v(525, 0, -1340), v(2525, 0, -1380), v(2525, 2000, -1420)], { system: 'sewage', diameter: 100 }, { startNodeId: M });
  const inflow = a.segmentIds[1];
  const net: Network = {
    nodes: { ...b.net.nodes, [M]: { ...b.net.nodes[M], fixtureId: 'f_masu', portId: 'p' } },
    segments: { ...b.net.segments, [inflow]: { ...b.net.segments[inflow], ...(dropEnd ? { dropEnd } : {}) } },
  };
  return { net, K: a.nodeIds[1], P: b.nodeIds[1] };
}

describe('マスへ高く着く管の部品の向き', () => {
  it('マスの外で L で落とす管: 床下から出る所は 90° のエルボ（確定不要）', () => {
    // 着く高さ −1340 + 350 = −990（K から 10mm 下がる = 1/50 くらい）
    const { net, K } = exitToManhole(350);
    const f = analyzeFittings(net).find((x) => x.nodeId === K)!;
    expect(f.needsConfirm).toBe(false);
    expect(f.type).toBe('elbow90');
  });
  it('落差が無ければ今までどおり（マスの管底へ斜めに下りる管は曲がりの角度を確かめる）', () => {
    const { net, K } = exitToManhole();
    expect(analyzeFittings(net).find((x) => x.nodeId === K)!.needsConfirm).toBe(true);
  });
  it('マスから出ていく側（下流）の部品は落差に関係なく同じ', () => {
    const a = exitToManhole(350), b = exitToManhole();
    const fa = analyzeFittings(a.net).find((x) => x.nodeId === a.P)!, fb = analyzeFittings(b.net).find((x) => x.nodeId === b.P)!;
    expect({ type: fa.type, needsConfirm: fa.needsConfirm }).toEqual({ type: fb.type, needsConfirm: fb.needsConfirm });
  });
});
