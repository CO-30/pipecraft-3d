import { describe, expect, test } from 'vitest';
import { addPolyline, emptyNetwork, moveNode, type Network } from './network';
import { actualSlope, downstreamEnd, endZ, propagateLockedSlopes, setSlopeRatio } from './slope';

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

  test('downstreamEnd: 隣の固定区間がこの端へ流れ込んでいれば、その端が上流', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0, 0), v(4000, 0, 0), v(7000, 0, 0)], { system: 'drain', diameter: 100 });
    const net = setSlopeRatio(r.net, r.segmentIds[0], 1 / 100); // a→b 固定、b = -40（c は 0 のまま）
    // b は c より低いが、a→b が b へ流れ込んでいるので b→c の下流は c
    expect(downstreamEnd(net, net.segments[r.segmentIds[1]])).toBe('b');
  });

  test('固定していない区間は動かさない', () => {
    const { net, a, b } = line(5000);
    const moved = moveNode(net, a, v(0, 0, 200));
    expect(propagateLockedSlopes(net, moved, a)).toBe(moved);
    expect(moved.nodes[b].pos.z).toBe(0);
  });
});

describe('勾配固定: 合流点', () => {
  /** U1→J→D と U2→J。高さは 1/100 に合わせて置き、固定の印だけ付ける（U1=0, J=-40, D=-70, U2=-10） */
  function junction() {
    const r1 = addPolyline(emptyNetwork(), [v(0, 0, 0), v(4000, 0, -40), v(7000, 0, -70)], { system: 'drain', diameter: 100 });
    const [u1, j, d] = r1.nodeIds;
    const r2 = addPolyline(r1.net, [v(4000, 3000, -10), v(4000, 0, -40)], { system: 'drain', diameter: 100 }, { endNodeId: j });
    const u2 = r2.nodeIds[0];
    const segments = { ...r2.net.segments };
    for (const id of [...r1.segmentIds, ...r2.segmentIds]) segments[id] = { ...segments[id], slope: 0.01, slopeLocked: true };
    return { net: { ...r2.net, segments }, u1, u2, j, d, s1: r1.segmentIds[0], s2: r1.segmentIds[1], s3: r2.segmentIds[0] };
  }
  test('上流 U1 を動かしても、合流点につながる別の枝 U2 は動かさない（固定は外す）', () => {
    const { net, u1, u2, j, d, s3 } = junction();
    const zj = net.nodes[j].pos.z, zu2 = net.nodes[u2].pos.z;
    expect(zu2).toBeGreaterThan(zj);
    const moved = moveNode(net, u1, v(0, 0, 500));
    const out = propagateLockedSlopes(net, moved, u1);
    expect(out.nodes[j].pos.z).toBeCloseTo(460, 5);
    expect(out.nodes[d].pos.z).toBeCloseTo(430, 5);
    expect(out.nodes[u2].pos.z).toBe(zu2); // 触っていない枝は動かない
    expect(out.segments[s3].slopeLocked).toBe(false); // 勾配が保てないので固定を外す
  });
});

describe('落差桝（node.dropIn）', () => {
  test('流入側の区間は管底 + dropIn を端の高さとして勾配を計算する。流出側は node.z のまま', () => {
    // 上流 u(0,0,-500) → 落差桝 m(5000,0,-900, dropIn 300) → 下流 d(10000,0,-1000)
    const r1 = addPolyline(emptyNetwork(), [v(0, 0, -500), v(5000, 0, -900)], { system: 'sewage', diameter: 100 });
    const m = r1.nodeIds[1];
    const r2 = addPolyline(r1.net, [v(5000, 0, -900), v(10000, 0, -1000)], { system: 'sewage', diameter: 100 }, { startNodeId: m });
    const net: Network = { ...r2.net, nodes: { ...r2.net.nodes, [m]: { ...r2.net.nodes[m], dropIn: 300 } } };
    const up = net.segments[r1.segmentIds[0]], down = net.segments[r2.segmentIds[0]];
    expect(endZ(net, up, up.a === m ? 'a' : 'b')).toBe(-600); // 流入側は -900 + 300
    expect(endZ(net, down, down.a === m ? 'a' : 'b')).toBe(-900);
    expect(actualSlope(net, up)).toBeCloseTo(100 / 5000, 6); // (-500 − -600) / 5000
    expect(actualSlope(net, down)).toBeCloseTo(100 / 5000, 6);
  });
  test('setSlopeRatio: 下流端が落差桝（器具でない点）なら node.z = 上流 − 勾配×L − dropIn', () => {
    const r1 = addPolyline(emptyNetwork(), [v(0, 0, -500), v(5000, 0, -900)], { system: 'sewage', diameter: 100 });
    const m = r1.nodeIds[1];
    const net: Network = { ...r1.net, nodes: { ...r1.net.nodes, [m]: { ...r1.net.nodes[m], dropIn: 300 } } };
    const out = setSlopeRatio(net, r1.segmentIds[0], 1 / 50);
    expect(out.nodes[m].pos.z).toBeCloseTo(-500 - 100 - 300, 1);
  });
});
