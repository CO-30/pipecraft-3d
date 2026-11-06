/**
 * 配管・配線ネットワーク（ノード＋区間）。
 * - 座標は共通3D座標系（mm）。x: 東, y: 北, z: 高さ。
 * - 2D表示・3D表示はこのデータから生成する（二重管理しない）。
 * - すべての操作は純粋関数で、新しい Network を返す（Undo/Redo はスナップショットで実現）。
 */
import { newId } from './id';

export type Vec3 = { x: number; y: number; z: number };

export type NodeKind =
  | 'end' // 始点・終点
  | 'joint' // 直線上の接続点（ソケット候補）
  | 'elbow'
  | 'tee'
  | 'cross'
  | 'valve'
  | 'fixture'; // 設備接続点

export type PipeNode = {
  id: string;
  kind: NodeKind;
  pos: Vec3;
  /** true の場合は kind をトポロジーから自動再計算しない（バルブ・設備接続点など） */
  fixedKind?: boolean;
};

export type SystemType =
  | 'water' | 'hotWater' | 'drain' | 'sewage' | 'vent' | 'gas'
  | 'refrigerant' | 'condensate' | 'electric' | 'telecom' | 'other';

export type SegmentAttrs = {
  system: SystemType;
  /** 口径(mm) またはケーブルサイズ */
  diameter: number;
  material?: string;
};

export type MeasureMethod = 'drawing' | 'model' | 'field';

export type Segment = SegmentAttrs & {
  id: string;
  a: string;
  b: string;
  /** 現場実測長(mm)。設定時は図面・モデル値で上書きしない */
  measuredLength?: number;
  /** 余長率（0.05 = 5%）。実測長・図面長とは別に保持 */
  extraRate?: number;
  note?: string;
};

export type Network = {
  nodes: Record<string, PipeNode>;
  segments: Record<string, Segment>;
};

/** これ以下の距離は同一点とみなす(mm) */
export const EPS_MM = 1e-6;
/** 分岐位置が端点からこの距離以内なら端点ノードを使う(mm) */
export const SNAP_TO_NODE_MM = 10;

export const emptyNetwork = (): Network => ({ nodes: {}, segments: {} });

export const dist = (p: Vec3, q: Vec3) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

export function segmentLength(net: Network, segId: string): number {
  const s = net.segments[segId];
  return dist(net.nodes[s.a].pos, net.nodes[s.b].pos);
}

export function totalLength(net: Network): number {
  let sum = 0;
  for (const id in net.segments) sum += segmentLength(net, id);
  return sum;
}

export function segmentsAt(net: Network, nodeId: string): Segment[] {
  return Object.values(net.segments).filter((s) => s.a === nodeId || s.b === nodeId);
}

export const nodeDegree = (net: Network, nodeId: string) => segmentsAt(net, nodeId).length;

const other = (s: Segment, nodeId: string) => (s.a === nodeId ? s.b : s.a);

function sub(p: Vec3, q: Vec3): Vec3 {
  return { x: p.x - q.x, y: p.y - q.y, z: p.z - q.z };
}

function isCollinear(net: Network, nodeId: string, s1: Segment, s2: Segment): boolean {
  const p = net.nodes[nodeId].pos;
  const u = sub(net.nodes[other(s1, nodeId)].pos, p);
  const w = sub(net.nodes[other(s2, nodeId)].pos, p);
  const lu = Math.hypot(u.x, u.y, u.z);
  const lw = Math.hypot(w.x, w.y, w.z);
  if (lu < EPS_MM || lw < EPS_MM) return false;
  const cos = (u.x * w.x + u.y * w.y + u.z * w.z) / (lu * lw);
  return cos < -0.9999; // 反対方向 = 一直線
}

/** 孤立ノードを削除し、ノード種別をトポロジーから再計算する */
export function normalize(net: Network): Network {
  const nodes: Record<string, PipeNode> = {};
  for (const n of Object.values(net.nodes)) {
    const segs = segmentsAt(net, n.id);
    if (segs.length === 0 && !n.fixedKind) continue;
    let kind = n.kind;
    if (!n.fixedKind) {
      if (segs.length === 1) kind = 'end';
      else if (segs.length === 2) kind = isCollinear(net, n.id, segs[0], segs[1]) ? 'joint' : 'elbow';
      else if (segs.length === 3) kind = 'tee';
      else kind = 'cross';
    }
    nodes[n.id] = kind === n.kind ? n : { ...n, kind };
  }
  return { nodes, segments: net.segments };
}

function addNode(net: Network, pos: Vec3): { net: Network; id: string } {
  const id = newId('n');
  return { net: { ...net, nodes: { ...net.nodes, [id]: { id, kind: 'end', pos: { ...pos } } } }, id };
}

function addSegment(net: Network, a: string, b: string, attrs: SegmentAttrs): { net: Network; id: string } {
  const id = newId('s');
  return { net: { ...net, segments: { ...net.segments, [id]: { ...attrs, id, a, b } } }, id };
}

/**
 * 折れ線を配管として追加する。
 * opts.startNodeId / endNodeId を指定すると既存ノードに接続する（その場合 points の先頭/末尾はノード位置で置き換え）。
 */
export function addPolyline(
  net: Network,
  points: Vec3[],
  attrs: SegmentAttrs,
  opts: { startNodeId?: string; endNodeId?: string } = {},
): { net: Network; nodeIds: string[]; segmentIds: string[] } {
  const nodeIds: string[] = [];
  const segmentIds: string[] = [];
  let cur = net;
  const pts = points.slice();
  if (opts.startNodeId) pts[0] = net.nodes[opts.startNodeId].pos;
  if (opts.endNodeId) pts[pts.length - 1] = net.nodes[opts.endNodeId].pos;

  pts.forEach((p, i) => {
    const last = nodeIds.length ? cur.nodes[nodeIds[nodeIds.length - 1]].pos : null;
    const isLast = i === pts.length - 1;
    if (last && dist(last, p) < EPS_MM && !(isLast && opts.endNodeId)) return;
    let id: string;
    if (i === 0 && opts.startNodeId) id = opts.startNodeId;
    else if (isLast && opts.endNodeId) id = opts.endNodeId;
    else ({ net: cur, id } = addNode(cur, p));
    if (nodeIds.length) {
      const prev = nodeIds[nodeIds.length - 1];
      if (prev === id) return;
      let sid: string;
      ({ net: cur, id: sid } = addSegment(cur, prev, id, attrs));
      segmentIds.push(sid);
    }
    nodeIds.push(id);
  });
  return { net: normalize(cur), nodeIds, segmentIds };
}

/** 点を区間上へ射影（区間内にクランプ）。t は a→b のパラメータ */
export function projectOnSegment(net: Network, segId: string, p: Vec3): { pos: Vec3; t: number } {
  const s = net.segments[segId];
  const a = net.nodes[s.a].pos;
  const b = net.nodes[s.b].pos;
  const ab = sub(b, a);
  const len2 = ab.x ** 2 + ab.y ** 2 + ab.z ** 2;
  let t = len2 < EPS_MM ? 0 : ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / len2;
  t = Math.max(0, Math.min(1, t));
  return { pos: { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t }, t };
}

/** 区間をノードで分割する。既存の端点に近ければ分割しない */
export function splitSegment(net: Network, segId: string, p: Vec3): { net: Network; nodeId: string; segmentIds: string[] } {
  const s = net.segments[segId];
  const { pos } = projectOnSegment(net, segId, p);
  const a = net.nodes[s.a].pos;
  const b = net.nodes[s.b].pos;
  if (dist(pos, a) <= SNAP_TO_NODE_MM) return { net, nodeId: s.a, segmentIds: [segId] };
  if (dist(pos, b) <= SNAP_TO_NODE_MM) return { net, nodeId: s.b, segmentIds: [segId] };

  const { [segId]: _removed, ...rest } = net.segments;
  let cur: Network = { ...net, segments: rest };
  let mid: string;
  ({ net: cur, id: mid } = addNode(cur, pos));
  const { id: _i, a: _a, b: _b, measuredLength: _m, ...attrs } = s;
  let s1: string, s2: string;
  ({ net: cur, id: s1 } = addSegment(cur, s.a, mid, attrs));
  ({ net: cur, id: s2 } = addSegment(cur, mid, s.b, attrs));
  return { net: normalize(cur), nodeId: mid, segmentIds: [s1, s2] };
}

/** 既存区間上の点から分岐配管を描く（属性は元区間を引き継ぐ。上書きも可） */
export function branchFromSegment(
  net: Network,
  segId: string,
  at: Vec3,
  path: Vec3[],
  attrs?: Partial<SegmentAttrs>,
): { net: Network; teeId: string; splitSegmentIds: string[]; branchSegmentIds: string[] } {
  const base = net.segments[segId];
  const split = splitSegment(net, segId, at);
  const teePos = split.net.nodes[split.nodeId].pos;
  const r = addPolyline(
    split.net,
    [teePos, ...path],
    { system: base.system, diameter: base.diameter, material: base.material, ...attrs },
    { startNodeId: split.nodeId },
  );
  return { net: r.net, teeId: split.nodeId, splitSegmentIds: split.segmentIds, branchSegmentIds: r.segmentIds };
}

export function moveNode(net: Network, nodeId: string, pos: Vec3): Network {
  const n = net.nodes[nodeId];
  if (!n) return net;
  return normalize({ ...net, nodes: { ...net.nodes, [nodeId]: { ...n, pos: { ...pos } } } });
}

const sameAttrs = (s: Segment, t: Segment) =>
  s.system === t.system && s.diameter === t.diameter && s.material === t.material && (s.extraRate ?? 0) === (t.extraRate ?? 0);

/**
 * 指定ノードが「同じ属性の2区間が一直線につながるだけの点」になっていれば、2区間を1本に結合する。
 * 実測長・備考を持つ区間、種別固定ノード（バルブ等）は結合しない。
 */
export function mergeAtNodes(net: Network, nodeIds: Iterable<string>): Network {
  let cur = net;
  for (const nid of nodeIds) {
    const n = cur.nodes[nid];
    if (!n || n.fixedKind) continue;
    const segs = segmentsAt(cur, nid);
    if (segs.length !== 2) continue;
    const [s1, s2] = segs;
    if (!sameAttrs(s1, s2) || s1.measuredLength !== undefined || s2.measuredLength !== undefined || s1.note || s2.note) continue;
    if (!isCollinear(cur, nid, s1, s2)) continue;
    const a = other(s1, nid), b = other(s2, nid);
    if (a === b) continue;
    const segments = { ...cur.segments };
    delete segments[s2.id];
    segments[s1.id] = { ...s1, a, b };
    const nodes = { ...cur.nodes };
    delete nodes[nid];
    cur = { nodes, segments };
  }
  return normalize(cur);
}

export function deleteSegment(net: Network, segId: string): Network {
  const s = net.segments[segId];
  if (!s) return net;
  const { [segId]: _removed, ...rest } = net.segments;
  return mergeAtNodes(normalize({ ...net, segments: rest }), [s.a, s.b]);
}

/**
 * 分岐単位の削除: fromNode から segId 方向に到達できる区間をすべて削除する。
 * 枝が本管側へループして戻る場合は安全のため削除しない（そのまま返す）。
 */
export function deleteBranch(net: Network, fromNodeId: string, segId: string): Network {
  const start = net.segments[segId];
  if (!start || (start.a !== fromNodeId && start.b !== fromNodeId)) return net;
  const toDelete = new Set<string>([segId]);
  const stack = [other(start, fromNodeId)];
  const seen = new Set<string>([fromNodeId]);
  while (stack.length) {
    const nid = stack.pop()!;
    if (seen.has(nid)) continue;
    seen.add(nid);
    for (const s of segmentsAt(net, nid)) {
      if (toDelete.has(s.id)) continue;
      const o = other(s, nid);
      if (o === fromNodeId) return net; // ループ
      toDelete.add(s.id);
      stack.push(o);
    }
  }
  const segments = Object.fromEntries(Object.entries(net.segments).filter(([id]) => !toDelete.has(id)));
  return mergeAtNodes(normalize({ ...net, segments }), [fromNodeId]);
}

/** 接続情報の整合性チェック。問題がなければ空配列 */
export function validateNetwork(net: Network): string[] {
  const errors: string[] = [];
  const pairs = new Set<string>();
  for (const s of Object.values(net.segments)) {
    if (!net.nodes[s.a] || !net.nodes[s.b]) {
      errors.push(`segment ${s.id}: 端点ノードが存在しない`);
      continue;
    }
    if (s.a === s.b) errors.push(`segment ${s.id}: 自己ループ`);
    if (segmentLength(net, s.id) < EPS_MM) errors.push(`segment ${s.id}: 長さ0`);
    const key = [s.a, s.b].sort().join('|');
    if (pairs.has(key)) errors.push(`segment ${s.id}: 重複区間`);
    pairs.add(key);
  }
  for (const n of Object.values(net.nodes)) {
    const d = nodeDegree(net, n.id);
    if (d === 0 && !n.fixedKind) errors.push(`node ${n.id}: 孤立ノード`);
    if (!n.fixedKind) {
      const expected = normalize(net).nodes[n.id]?.kind;
      if (expected && expected !== n.kind) errors.push(`node ${n.id}: 種別不一致 ${n.kind}≠${expected}`);
    }
  }
  return errors;
}
