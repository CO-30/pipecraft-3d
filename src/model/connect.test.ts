import { describe, expect, it } from 'vitest';
import { addPolyline, detachSegmentEnd, emptyNetwork, validateNetwork, type Network } from './network';
import { connectToCandidate, findConnectCandidate } from './connect';

const v = (x: number, y: number, z = 100) => ({ x, y, z });
const W = { system: 'water' as const, diameter: 20 };
const tees = (n: Network) => Object.values(n.nodes).filter((x) => x.kind === 'tee').length;

/** 画面の例: 南北の給水管 x=2000 と、東へ描いた給水管がその管を 150mm はみ出して止まっている */
function crossing(sys2 = W) {
  let net = addPolyline(emptyNetwork(), [v(2000, -2000), v(2000, 2000)], W).net;
  const r = addPolyline(net, [v(0, 300), v(2150, 300)], sys2);
  net = r.net;
  return { net, end: r.nodeIds[1] };
}

describe('近くの配管へつなぐ', () => {
  it('はみ出した端 → 南北の管の途中へ分岐（チーズ）でつなぐ。端は管の上へ戻る', () => {
    const { net, end } = crossing();
    const c = findConnectCandidate(net, {}, end)!;
    expect(c).toMatchObject({ type: 'segment', planDist: 150, dz: 0 });
    const out = connectToCandidate(net, end, c);
    expect(tees(out)).toBe(1);
    expect(validateNetwork(out)).toEqual([]);
    const tee = Object.values(out.nodes).find((x) => x.kind === 'tee')!;
    expect(tee.pos).toEqual({ x: 2000, y: 300, z: 100 });
  });

  it('手前で止まった端も同じ。端どうしが近ければ端どうしをつなぐ（エルボ）', () => {
    const a = addPolyline(emptyNetwork(), [v(0, 0), v(3000, 0)], W);
    const b = addPolyline(a.net, [v(3100, 80), v(3100, 2000)], W);
    const c = findConnectCandidate(b.net, {}, b.nodeIds[0])!;
    expect(c).toMatchObject({ type: 'node', id: a.nodeIds[1] });
    const out = connectToCandidate(b.net, b.nodeIds[0], c);
    expect(Object.values(out.nodes).filter((x) => x.kind === 'elbow')).toHaveLength(1);
  });

  it('種類の違う配管（給水と排水）は候補にしない。遠すぎる配管も候補にしない', () => {
    const { net, end } = crossing({ system: 'drain', diameter: 50 } as unknown as typeof W);
    expect(findConnectCandidate(net, {}, end)).toBeNull();
    const far = addPolyline(addPolyline(emptyNetwork(), [v(0, 0), v(1000, 0)], W).net, [v(0, 2000), v(1000, 2000)], W);
    expect(findConnectCandidate(far.net, {}, far.nodeIds[0])).toBeNull();
  });
});

describe('区間の端を片方だけ外す', () => {
  it('チーズの枝の端を外すと、本管は1本に戻り、枝は30mm離れた端点になる', () => {
    const { net, end } = crossing();
    const out = connectToCandidate(net, end, findConnectCandidate(net, {}, end)!);
    const branch = Object.values(out.segments).find((s) => out.nodes[s.a].pos.y === 300 && out.nodes[s.b].pos.y === 300)!;
    const teeEnd = out.nodes[branch.a].kind === 'tee' ? 'a' : 'b';
    const d = detachSegmentEnd(out, branch.id, teeEnd);
    expect(tees(d)).toBe(0);
    expect(validateNetwork(d)).toEqual([]);
    const loose = d.nodes[d.segments[branch.id][teeEnd]];
    expect(loose.kind).toBe('end');
    expect(loose.pos.x).toBeCloseTo(1970, 6);
    // つながっていない端は外せない（変化なし）
    const other = teeEnd === 'a' ? 'b' : 'a';
    expect(detachSegmentEnd(d, branch.id, other)).toBe(d);
  });
});
