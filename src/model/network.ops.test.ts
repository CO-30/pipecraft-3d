import { describe, expect, it } from 'vitest';
import {
  addPolyline, addRiser, branchFromSegment, connectNodeToSegment, connectedComponent, cutSegment, deleteBranch, deleteFitting,
  deleteSegments, detachNode, duplicateSegments, emptyNetwork, insertValve, mergeNodes, nodeDegree, segmentLength,
  segmentsAt, setSegmentLength, splitSegment, translateNodes, validateNetwork, moveNode, type Network,
} from './network';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const W = { system: 'water' as const, diameter: 20 };
const line = (pts: ReturnType<typeof v>[]) => addPolyline(emptyNetwork(), pts, W);
const ok = (net: Network) => expect(validateNetwork(net)).toEqual([]);
const lens = (net: Network) => Object.keys(net.segments).map((id) => Math.round(segmentLength(net, id) * 10) / 10).sort((a, b) => a - b);
const nodeAt = (net: Network, x: number, y: number) => Object.values(net.nodes).find((n) => Math.abs(n.pos.x - x) < 1e-6 && Math.abs(n.pos.y - y) < 1e-6)!;

describe('切断', () => {
  it('3000mm の区間を 1000mm で切断 → 975/1975、端点4', () => {
    const r0 = line([v(0, 0), v(3000, 0)]);
    const r = cutSegment(r0.net, r0.segmentIds[0], v(1000, 50))!;
    expect(r).not.toBeNull();
    ok(r.net);
    expect(lens(r.net)).toEqual([975, 1975]);
    expect(Object.values(r.net.nodes).filter((n) => n.kind === 'end')).toHaveLength(4);
    expect(r.nodeIds).toHaveLength(2);
  });
  it('実測長は按分して概算フラグ', () => {
    const r0 = line([v(0, 0), v(3000, 0)]);
    const sid = r0.segmentIds[0];
    const net = { ...r0.net, segments: { ...r0.net.segments, [sid]: { ...r0.net.segments[sid], measuredLength: 3100 } } };
    const r = cutSegment(net, sid, v(1000, 0))!;
    const ms = Object.values(r.net.segments).map((s) => s.measuredLength!).sort((a, b) => a - b);
    expect(ms[0]).toBeCloseTo((3100 * 975) / 3000, 3);
    expect(ms[1]).toBeCloseTo((3100 * 1975) / 3000, 3);
    expect(Object.values(r.net.segments).every((s) => s.measuredApprox)).toBe(true);
  });
  it('短すぎる区間（150mm 未満）・端に近すぎる位置は切断しない', () => {
    const r0 = line([v(0, 0), v(100, 0)]);
    expect(cutSegment(r0.net, r0.segmentIds[0], v(50, 0))).toBeNull();
    const r1 = line([v(0, 0), v(3000, 0)]);
    expect(cutSegment(r1.net, r1.segmentIds[0], v(10, 0))).toBeNull();
  });
});

describe('接続解除・結合', () => {
  it('T字の中心を接続解除 → 3本ばらばら、各30mm短く', () => {
    const r0 = line([v(0, 0), v(4000, 0)]);
    const b = branchFromSegment(r0.net, r0.segmentIds[0], v(2000, 0), [v(2000, 2000)]);
    const net = detachNode(b.net, b.teeId);
    ok(net);
    expect(Object.values(net.nodes).some((n) => n.kind === 'tee')).toBe(false);
    expect(lens(net)).toEqual([1970, 1970, 1970]);
    expect(Object.values(net.nodes).filter((n) => n.kind === 'end')).toHaveLength(6);
  });
  it('端点は接続解除しても変わらない', () => {
    const r0 = line([v(0, 0), v(4000, 0)]);
    expect(detachNode(r0.net, r0.nodeIds[0])).toBe(r0.net);
  });
  it('離れた端点同士を結合 → エルボ', () => {
    const a = line([v(0, 0), v(1000, 0)]);
    const b = addPolyline(a.net, [v(1000, 10), v(1000, 1000)], W);
    const net = mergeNodes(b.net, a.nodeIds[1], b.nodeIds[0]);
    ok(net);
    expect(Object.keys(net.nodes)).toHaveLength(3);
    expect(net.nodes[a.nodeIds[1]].kind).toBe('elbow');
  });
  it('区間で直接つながった隣のノードとは結合しない', () => {
    const a = line([v(0, 0), v(1000, 0)]);
    expect(mergeNodes(a.net, a.nodeIds[0], a.nodeIds[1])).toBe(a.net);
  });
  it('結合で重複区間ができる場合は拒否', () => {
    // A-B と C-B があり、A と C を結合すると A-B が重複
    const a = line([v(0, 0), v(1000, 0)]);
    const c = addPolyline(a.net, [v(0, 10), v(1000, 0)], W, { endNodeId: a.nodeIds[1] });
    expect(mergeNodes(c.net, a.nodeIds[0], c.nodeIds[0])).toBe(c.net);
  });
  it('端点を区間の途中に結合 → チーズ', () => {
    const a = line([v(0, 0), v(4000, 0)]);
    const b = addPolyline(a.net, [v(2000, 1000), v(2000, 30)], W);
    const net = connectNodeToSegment(b.net, b.nodeIds[1], a.segmentIds[0]);
    ok(net);
    expect(Object.values(net.nodes).filter((n) => n.kind === 'tee')).toHaveLength(1);
    expect(Object.keys(net.segments)).toHaveLength(3);
  });
  it('自分につながる区間には結合しない', () => {
    const a = line([v(0, 0), v(4000, 0)]);
    expect(connectNodeToSegment(a.net, a.nodeIds[0], a.segmentIds[0])).toBe(a.net);
  });
});

describe('部品単位の削除', () => {
  it('エルボを削除 → 前後を直線で結ぶ', () => {
    const r = line([v(0, 0), v(3000, 0), v(3000, 4000)]);
    const elbow = r.nodeIds[1];
    const net = deleteFitting(r.net, elbow);
    ok(net);
    expect(Object.keys(net.segments)).toHaveLength(1);
    expect(lens(net)).toEqual([5000]);
  });
  it('バルブを入れて削除 → 直管に戻る', () => {
    const r = line([v(0, 0), v(3000, 0)]);
    const iv = insertValve(r.net, r.segmentIds[0], v(1000, 0))!;
    ok(iv.net);
    expect(iv.net.nodes[iv.nodeId].kind).toBe('valve');
    expect(Object.keys(iv.net.segments)).toHaveLength(2);
    const net = deleteFitting(iv.net, iv.nodeId);
    ok(net);
    expect(Object.keys(net.segments)).toHaveLength(1);
    expect(lens(net)).toEqual([3000]);
  });
  it('端点を削除 → その区間を削除', () => {
    const r = line([v(0, 0), v(3000, 0), v(3000, 3000)]);
    const net = deleteFitting(r.net, r.nodeIds[2]);
    ok(net);
    expect(lens(net)).toEqual([3000]);
  });
  it('分岐点は削除しない', () => {
    const r0 = line([v(0, 0), v(4000, 0)]);
    const b = branchFromSegment(r0.net, r0.segmentIds[0], v(2000, 0), [v(2000, 2000)]);
    expect(deleteFitting(b.net, b.teeId)).toBe(b.net);
  });
  it('直線で結ぶと既存区間と重複する場合は拒否', () => {
    // 三角形: A-B-C と A-C
    const r = line([v(0, 0), v(1000, 0), v(1000, 1000)]);
    const t = addPolyline(r.net, [v(0, 0), v(1000, 1000)], W, { startNodeId: r.nodeIds[0], endNodeId: r.nodeIds[2] });
    expect(deleteFitting(t.net, r.nodeIds[1])).toBe(t.net);
  });
});

describe('移動・長さ・高さ', () => {
  it('区間の両端を平行移動、つながった区間は伸縮', () => {
    const r = line([v(0, 0), v(2000, 0), v(2000, 2000), v(4000, 2000)]);
    const s = r.segmentIds[1];
    const seg = r.net.segments[s];
    const net = translateNodes(r.net, [seg.a, seg.b], v(500, 0));
    ok(net);
    expect(lens(net)).toEqual([2000, 2500, 1500].sort((a, b) => a - b));
  });
  it('隣と重なる移動は拒否', () => {
    const r = line([v(0, 0), v(2000, 0), v(4000, 0)]);
    expect(translateNodes(r.net, [r.nodeIds[1]], v(-2000, 0))).toBe(r.net);
  });
  it('長さ変更: a 端固定で b 端を方向に沿って移動', () => {
    const r = line([v(0, 0), v(2000, 0)]);
    const s = r.segmentIds[0];
    const net = setSegmentLength(r.net, s, 3500);
    expect(segmentLength(net, s)).toBeCloseTo(3500, 6);
    expect(net.nodes[net.segments[s].a].pos).toEqual(r.net.nodes[r.net.segments[s].a].pos);
    expect(setSegmentLength(r.net, s, 0)).toBe(r.net);
  });
});

describe('配管全体', () => {
  it('つながった区間を全部たどる。別の配管は含まない', () => {
    const r0 = line([v(0, 0), v(4000, 0)]);
    const b = branchFromSegment(r0.net, r0.segmentIds[0], v(2000, 0), [v(2000, 2000)]);
    const other = addPolyline(b.net, [v(0, 5000), v(1000, 5000)], W);
    const c = connectedComponent(other.net, b.branchSegmentIds[0]);
    expect(c.segmentIds).toHaveLength(3);
    expect(c.nodeIds).toHaveLength(4);
    const del = deleteSegments(other.net, c.segmentIds);
    ok(del);
    expect(Object.keys(del.segments)).toEqual(other.segmentIds);
  });
  it('複製: 新しいID・ずらした位置・接続は複製内で維持', () => {
    const r = line([v(0, 0), v(2000, 0), v(2000, 2000)]);
    const d = duplicateSegments(r.net, r.segmentIds, v(500, 0));
    ok(d.net);
    expect(d.segmentIds).toHaveLength(2);
    expect(Object.keys(d.net.segments)).toHaveLength(4);
    expect(d.segmentIds.every((id) => !r.segmentIds.includes(id))).toBe(true);
    expect(nodeAt(d.net, 2500, 0).kind).toBe('elbow');
  });
});

describe('立て管', () => {
  it('ノードから上へ 3000mm の縦区間', () => {
    const r = line([v(0, 0, 100), v(2000, 0, 100)]);
    const up = addRiser(r.net, r.nodeIds[1], 3100)!;
    ok(up.net);
    const n = up.net.nodes[up.nodeId].pos;
    expect(n).toEqual({ x: 2000, y: 0, z: 3100 });
    expect(segmentLength(up.net, up.segmentId)).toBe(3000);
    expect(up.net.nodes[r.nodeIds[1]].kind).toBe('elbow');
  });
  it('同じ高さ・既にその高さに縦管がある場合は作らない', () => {
    const r = line([v(0, 0, 100), v(2000, 0, 100)]);
    expect(addRiser(r.net, r.nodeIds[1], 100.5)).toBeNull();
    const up = addRiser(r.net, r.nodeIds[1], 3100)!;
    expect(addRiser(up.net, r.nodeIds[1], 3100)).toBeNull();
  });
});

/** 疑似乱数（seed 固定） */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('ランダム操作でも接続情報が壊れない', () => {
  it('分岐・切断・結合・移動・削除を 300 回', () => {
    const rand = rng(42);
    const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
    const pt = () => v(Math.round(rand() * 20) * 250, Math.round(rand() * 20) * 250, Math.round(rand() * 3) * 1000);
    let net = line([v(0, 0), v(5000, 0)]).net;
    for (let i = 0; i < 300; i++) {
      const segs = Object.keys(net.segments);
      const nodes = Object.keys(net.nodes);
      const op = Math.floor(rand() * 11);
      if (!segs.length) { net = addPolyline(net, [pt(), pt(), pt()], W).net; continue; }
      if (op === 0) net = addPolyline(net, [pt(), pt()], W).net;
      else if (op === 1) net = branchFromSegment(net, pick(segs), pt(), [pt()]).net;
      else if (op === 2) net = cutSegment(net, pick(segs), pt())?.net ?? net;
      else if (op === 3) net = mergeNodes(net, pick(nodes), pick(nodes));
      else if (op === 4) net = connectNodeToSegment(net, pick(nodes), pick(segs));
      else if (op === 5) net = deleteFitting(net, pick(nodes));
      else if (op === 6) net = translateNodes(net, [pick(nodes)], v(250, -250, 0));
      else if (op === 7) net = detachNode(net, pick(nodes));
      else if (op === 8) { const s = net.segments[pick(segs)]; net = deleteBranch(net, s.a, s.id); }
      else if (op === 9) net = addRiser(net, pick(nodes), 3100)?.net ?? net;
      else net = moveNode(net, pick(nodes), pt());
      const errs = validateNetwork(net);
      if (errs.length) throw new Error(`op ${op} at step ${i}: ${errs[0]}`);
    }
    expect(Object.keys(net.segments).length).toBeGreaterThan(0);
  });
});

it('splitSegment/segmentsAt/nodeDegree は既存のまま使える', () => {
  const r = line([v(0, 0), v(2000, 0)]);
  const s = splitSegment(r.net, r.segmentIds[0], v(1000, 0));
  expect(nodeDegree(s.net, s.nodeId)).toBe(2);
  expect(segmentsAt(s.net, s.nodeId)).toHaveLength(2);
});
