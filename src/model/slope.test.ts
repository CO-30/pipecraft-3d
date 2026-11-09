import { describe, expect, test } from 'vitest';
import { addPolyline, emptyNetwork, moveNode, type Network } from './network';
import { downstreamEnd, propagateLockedSlopes, setSlopeRatio } from './slope';

const v = (x: number, y: number, z = 0) => ({ x, y, z });

/** 水平な排水管 a→b（長さ L、φ100） */
function line(L: number): { net: Network; a: string; b: string; s: string } {
  const r = addPolyline(emptyNetwork(), [v(0, 0), v(L, 0)], { system: 'drain', diameter: 100 });
  return { net: r.net, a: r.nodeIds[0], b: r.nodeIds[1], s: r.segmentIds[0] };
}

describe('勾配固定', () => {
  test('downstreamEnd は低い端。同じ高さなら b', () => {
    const { net, s } = line(5000);
    expect(downstreamEnd(net, net.segments[s])).toBe('b');
    const lower = moveNode(net, net.segments[s].a, v(0, 0, -100));
    expect(downstreamEnd(lower, lower.segments[s])).toBe('a');
  });

  test('setSlopeRatio は下流端を下げて slopeLocked にする', () => {
    const { net, b, s } = line(5000);
    const out = setSlopeRatio(net, s, 1 / 100);
    expect(out.nodes[b].pos.z).toBeCloseTo(-50, 5);
    expect(out.segments[s]).toMatchObject({ slope: 0.01, slopeLocked: true });
  });

  test('propagateLockedSlopes: 上流端を上げると下流端が追従する', () => {
    const { net, a, b, s } = line(5000);
    const locked = setSlopeRatio(net, s, 1 / 50);
    const moved = moveNode(locked, a, v(0, 0, 200));
    expect(propagateLockedSlopes(locked, moved, a).nodes[b].pos.z).toBeCloseTo(100, 5);
  });

  test('propagateLockedSlopes: 下流端を手で動かすと固定が外れる', () => {
    const { net, b, s } = line(5000);
    const locked = setSlopeRatio(net, s, 1 / 50);
    const moved = moveNode(locked, b, v(5000, 0, -30));
    const out = propagateLockedSlopes(locked, moved, b);
    expect(out.segments[s].slopeLocked).toBe(false);
    expect(out.nodes[b].pos.z).toBe(-30);
  });

  test('2 区間の連鎖: 上流を動かすと 2 つ先まで再計算', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0), v(4000, 0), v(4000, 3000)], { system: 'drain', diameter: 100 });
    const [a, b, c] = r.nodeIds;
    const outlet = (id: string) => id === c;
    let net = setSlopeRatio(r.net, r.segmentIds[0], 1 / 100, outlet);
    net = setSlopeRatio(net, r.segmentIds[1], 1 / 100, outlet);
    expect(net.nodes[b].pos.z).toBeCloseTo(-40, 5);
    expect(net.nodes[c].pos.z).toBeCloseTo(-70, 5);
    const out = propagateLockedSlopes(net, moveNode(net, a, v(0, 0, 100)), a);
    expect(out.nodes[b].pos.z).toBeCloseTo(60, 5);
    expect(out.nodes[c].pos.z).toBeCloseTo(30, 5);
  });

  test('downstreamEnd: 流末（マス）へ届く側が下流（高さに関係なく）', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0), v(4000, 0), v(4000, 3000)], { system: 'drain', diameter: 100 });
    const [, b, c] = r.nodeIds;
    const net = moveNode(r.net, b, v(4000, 0, -40)); // b が c より低いが、流末は c
    expect(downstreamEnd(net, net.segments[r.segmentIds[1]], (id) => id === c)).toBe('b');
    expect(downstreamEnd(net, net.segments[r.segmentIds[1]])).toBe('a');
  });

  test('下流端を上流より高く動かしても（逆勾配）固定が外れるだけで上流は動かない', () => {
    const { net, a, b, s } = line(5000);
    const locked = setSlopeRatio(net, s, 1 / 50); // b = -100
    const moved = moveNode(locked, b, v(5000, 0, 20));
    const out = propagateLockedSlopes(locked, moved, b);
    expect(out.segments[s].slopeLocked).toBe(false);
    expect(out.nodes[a].pos.z).toBe(0);
    expect(out.nodes[b].pos.z).toBe(20);
  });

  test('固定していない区間は動かさない', () => {
    const { net, a, b } = line(5000);
    const moved = moveNode(net, a, v(0, 0, 200));
    expect(propagateLockedSlopes(net, moved, a)).toBe(moved);
    expect(moved.nodes[b].pos.z).toBe(0);
  });
});
