import { describe, expect, it } from 'vitest';
import {
  addPolyline,
  branchFromSegment,
  deleteSegment,
  deleteBranch,
  emptyNetwork,
  moveNode,
  segmentLength,
  totalLength,
  validateNetwork,
  nodeDegree,
  type Network,
} from './network';

const v = (x: number, y: number, z = 0) => ({ x, y, z });

function straight(): { net: Network; segId: string } {
  const { net, segmentIds } = addPolyline(emptyNetwork(), [v(0, 0), v(4000, 0)], { system: 'water', diameter: 20 });
  return { net, segId: segmentIds[0] };
}

describe('配管ネットワーク: 描画', () => {
  it('直線: 2点で1区間・2ノード、長さ4000mm', () => {
    const { net } = straight();
    expect(Object.keys(net.nodes)).toHaveLength(2);
    expect(Object.keys(net.segments)).toHaveLength(1);
    expect(totalLength(net)).toBe(4000);
    expect(validateNetwork(net)).toEqual([]);
  });

  it('直角: 3点で2区間、中間ノードはエルボ', () => {
    const { net, nodeIds } = addPolyline(emptyNetwork(), [v(0, 0), v(3000, 0), v(3000, 2000)], { system: 'water', diameter: 20 });
    expect(Object.keys(net.segments)).toHaveLength(2);
    expect(net.nodes[nodeIds[1]].kind).toBe('elbow');
    expect(net.nodes[nodeIds[0]].kind).toBe('end');
    expect(totalLength(net)).toBe(5000);
  });

  it('斜め・高さ変化を含む3D長さ', () => {
    const { net } = addPolyline(emptyNetwork(), [v(0, 0, 0), v(3000, 4000, 0), v(3000, 4000, 1200)], { system: 'drain', diameter: 50 });
    expect(totalLength(net)).toBe(6200);
  });

  it('連続する同一点は区間を作らない', () => {
    const { net } = addPolyline(emptyNetwork(), [v(0, 0), v(0, 0), v(1000, 0)], { system: 'water', diameter: 20 });
    expect(Object.keys(net.segments)).toHaveLength(1);
  });

  it('既存ノードから描き始めると接続される', () => {
    const a = straight();
    const endId = a.net.segments[a.segId].b;
    const { net } = addPolyline(a.net, [v(4000, 0), v(4000, 3000)], { system: 'water', diameter: 20 }, { startNodeId: endId });
    expect(nodeDegree(net, endId)).toBe(2);
    expect(net.nodes[endId].kind).toBe('elbow');
    expect(Object.keys(net.nodes)).toHaveLength(3);
    expect(validateNetwork(net)).toEqual([]);
  });
});

describe('配管ネットワーク: 分岐', () => {
  it('T字分岐: 区間が分割されチーズノードができる', () => {
    const { net, segId } = straight();
    const r = branchFromSegment(net, segId, v(1500, 0), [v(1500, 2000)]);
    expect(Object.keys(r.net.segments)).toHaveLength(3);
    expect(r.net.nodes[r.teeId].kind).toBe('tee');
    expect(nodeDegree(r.net, r.teeId)).toBe(3);
    expect(totalLength(r.net)).toBe(6000);
    expect(validateNetwork(r.net)).toEqual([]);
  });

  it('分岐点は区間上に射影される（ずれたタップ位置）', () => {
    const { net, segId } = straight();
    const r = branchFromSegment(net, segId, v(1500, 37), [v(1500, 2000)]);
    expect(r.net.nodes[r.teeId].pos).toEqual(v(1500, 0));
  });

  it('分岐先の属性は元区間を引き継ぐ', () => {
    const { net, segId } = straight();
    const r = branchFromSegment(net, segId, v(1000, 0), [v(1000, 1000)]);
    for (const s of Object.values(r.net.segments)) {
      expect(s.system).toBe('water');
      expect(s.diameter).toBe(20);
    }
  });

  it('複数分岐: 同じ配管から3本分岐しても整合', () => {
    let { net, segId } = straight();
    let current = segId;
    for (const x of [1000, 2000, 3000]) {
      const r = branchFromSegment(net, current, v(x, 0), [v(x, 1000)]);
      net = r.net;
      // 次の分岐は右側の区間（x→4000）上で行う
      current = r.splitSegmentIds.find((id) => {
        const s = net.segments[id];
        const xs = [net.nodes[s.a].pos.x, net.nodes[s.b].pos.x];
        return Math.max(...xs) === 4000;
      })!;
    }
    expect(Object.values(net.nodes).filter((n) => n.kind === 'tee')).toHaveLength(3);
    expect(totalLength(net)).toBe(7000);
    expect(validateNetwork(net)).toEqual([]);
  });

  it('端点付近での分岐は端点ノードから分岐する（ゼロ長区間を作らない）', () => {
    const { net, segId } = straight();
    const r = branchFromSegment(net, segId, v(2, 0), [v(0, 1000)]);
    expect(Object.keys(r.net.segments)).toHaveLength(2);
    expect(validateNetwork(r.net)).toEqual([]);
  });
});

describe('配管ネットワーク: 移動・削除', () => {
  it('分岐点を移動すると接続された3区間がすべて追従する', () => {
    const { net, segId } = straight();
    const r = branchFromSegment(net, segId, v(2000, 0), [v(2000, 1000)]);
    const moved = moveNode(r.net, r.teeId, v(2000, 0, 300));
    const touching = Object.values(moved.segments).filter((s) => s.a === r.teeId || s.b === r.teeId);
    expect(touching).toHaveLength(3);
    expect(moved.nodes[r.teeId].pos.z).toBe(300);
    expect(validateNetwork(moved)).toEqual([]);
  });

  it('区間削除: 孤立ノードが消え、分岐で分割された本管は1本に戻る', () => {
    const { net, segId } = straight();
    const r = branchFromSegment(net, segId, v(2000, 0), [v(2000, 1000)]);
    const branchSeg = r.branchSegmentIds[0];
    const d = deleteSegment(r.net, branchSeg);
    expect(Object.keys(d.segments)).toHaveLength(1);
    expect(Object.keys(d.nodes)).toHaveLength(2);
    expect(d.nodes[r.teeId]).toBeUndefined();
    expect(totalLength(d)).toBe(4000);
    expect(validateNetwork(d)).toEqual([]);
  });

  it('属性が異なる区間どうしは結合しない（口径変化点は残す）', () => {
    const a = addPolyline(emptyNetwork(), [v(0, 0), v(2000, 0)], { system: 'water', diameter: 20 });
    const endId = a.nodeIds[1];
    const b = addPolyline(a.net, [v(2000, 0), v(4000, 0)], { system: 'water', diameter: 25 }, { startNodeId: endId });
    const c = addPolyline(b.net, [v(2000, 0), v(2000, 1000)], { system: 'water', diameter: 20 }, { startNodeId: endId });
    const d = deleteSegment(c.net, c.segmentIds[0]);
    expect(Object.keys(d.segments)).toHaveLength(2);
    expect(d.nodes[endId].kind).toBe('joint');
  });

  it('実測長が入った区間は結合しない（実測値を失わない）', () => {
    const { net, segId } = straight();
    const r = branchFromSegment(net, segId, v(2000, 0), [v(2000, 1000)]);
    const [s1] = r.splitSegmentIds;
    const withMeasure = { ...r.net, segments: { ...r.net.segments, [s1]: { ...r.net.segments[s1], measuredLength: 2010 } } };
    const d = deleteSegment(withMeasure, r.branchSegmentIds[0]);
    expect(Object.keys(d.segments)).toHaveLength(2);
    expect(d.segments[s1].measuredLength).toBe(2010);
  });

  it('分岐単位の削除: 枝管全体（先の分岐含む）が消え、本管は残る', () => {
    const { net, segId } = straight();
    const r1 = branchFromSegment(net, segId, v(2000, 0), [v(2000, 1000), v(2000, 2000)]);
    const r2 = branchFromSegment(r1.net, r1.branchSegmentIds[1], v(2000, 1500), [v(2500, 1500)]);
    const d = deleteBranch(r2.net, r1.teeId, r1.branchSegmentIds[0]);
    expect(totalLength(d)).toBe(4000);
    expect(Object.keys(d.segments)).toHaveLength(1);
    expect(validateNetwork(d)).toEqual([]);
  });

  it('分岐・削除・移動の繰り返しで接続情報が壊れない（ランダム操作100回）', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let { net } = straight();
    for (let i = 0; i < 100; i++) {
      const segs = Object.keys(net.segments);
      const nodes = Object.keys(net.nodes);
      const op = rnd();
      if (segs.length === 0) {
        net = addPolyline(net, [v(0, 0), v(4000, 0)], { system: 'water', diameter: 20 }).net;
      } else if (op < 0.45) {
        const s = net.segments[segs[Math.floor(rnd() * segs.length)]];
        const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos;
        const t = rnd();
        const p = v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
        net = branchFromSegment(net, s.id, p, [v(p.x + 500, p.y + 700, p.z)]).net;
      } else if (op < 0.7) {
        net = deleteSegment(net, segs[Math.floor(rnd() * segs.length)]);
      } else {
        const id = nodes[Math.floor(rnd() * nodes.length)];
        const p = net.nodes[id].pos;
        net = moveNode(net, id, v(p.x + 100, p.y - 50, p.z + 10));
      }
      expect(validateNetwork(net)).toEqual([]);
    }
  });

  it('segmentLength は浮動小数点誤差を含まない値に丸めない（内部は生値）', () => {
    const { net } = addPolyline(emptyNetwork(), [v(0, 0), v(1, 1)], { system: 'water', diameter: 20 });
    const s = Object.values(net.segments)[0];
    expect(segmentLength(net, s.id)).toBeCloseTo(Math.SQRT2, 10);
  });
});
