import { describe, expect, it } from 'vitest';
import { addPolyline, emptyNetwork, type SegmentAttrs } from './network';
import { analyzeFittings } from './fittings';
import { arcPoints, NICE_R_FACTOR, pbBendArcs, trimmedEnds } from './pbBends';

const draw = (pts: [number, number][], attrs: SegmentAttrs) => addPolyline(emptyNetwork(), pts.map(([x, y]) => ({ x, y, z: -300 })), attrs);
const PB: SegmentAttrs = { system: 'water', diameter: 13, material: 'PB保温5mm' };

describe('PB の曲げ配管の見た目（pbBends）', () => {
  it('直線が長ければ大きく曲げる（最小曲げ半径 170mm の 3 倍まで）。区間は曲がりの始まりまで縮める', () => {
    const r = draw([[0, 0], [2000, 0], [2000, 2000]], PB);
    const arcs = pbBendArcs(r.net, analyzeFittings(r.net));
    const arc = arcs.get(r.nodeIds[1])!;
    expect(arc.r).toBe(170 * NICE_R_FACTOR);
    expect(arc.from).toEqual({ x: 2000 - 510, y: 0, z: -300 });
    expect(arc.to).toMatchObject({ x: 2000, z: -300 });
    expect(arc.to.y).toBeCloseTo(510, 6);
    const [a, b] = trimmedEnds(r.net, arcs, r.segmentIds[0]);
    expect([a.x, b.x]).toEqual([0, 1490]);
    // 曲線は角の内側を通り、端は区間の縮めた端とつながる
    const pts = arcPoints(arc);
    expect(pts[0]).toEqual(arc.from);
    expect(pts.at(-1)).toEqual(arc.to);
    expect(pts[6].x).toBeLessThan(2000);
    expect(pts[6].y).toBeGreaterThan(0);
  });

  it('曲げが続くときは間の直線を半分ずつ使う。曲げ半径は最小以上', () => {
    const r = draw([[0, 0], [1000, 0], [1000, 400], [2000, 400]], PB);
    const arcs = pbBendArcs(r.net, analyzeFittings(r.net));
    expect(arcs.get(r.nodeIds[1])!.r).toBeCloseTo(200, 6);
    expect(arcs.get(r.nodeIds[2])!.r).toBeCloseTo(200, 6);
  });

  it('エルボを使う角・塩ビ管・部品を選び直した角は曲線にしない', () => {
    const tight = draw([[0, 0], [1000, 0], [1000, 150], [2000, 150]], PB);
    expect(pbBendArcs(tight.net, analyzeFittings(tight.net)).size).toBe(0);
    const pvc = draw([[0, 0], [2000, 0], [2000, 2000]], { system: 'water', diameter: 13, material: 'HIVP' });
    expect(pbBendArcs(pvc.net, analyzeFittings(pvc.net)).size).toBe(0);
    const r = draw([[0, 0], [2000, 0], [2000, 2000]], PB);
    const id = r.nodeIds[1];
    const net = { ...r.net, nodes: { ...r.net.nodes, [id]: { ...r.net.nodes[id], fitting: { type: 'elbow90' as const, degree: 2 } } } };
    expect(pbBendArcs(net, analyzeFittings(net)).size).toBe(0);
  });
});
