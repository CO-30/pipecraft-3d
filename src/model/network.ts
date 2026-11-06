/**
 * 配管・配線ネットワーク（ノード＋区間）。
 * - 座標は共通3D座標系（mm）。x: 東, y: 北, z: 高さ。
 * - 2D表示・3D表示はこのデータから生成する（二重管理しない）。
 * - すべての操作は純粋関数で、新しい Network を返す（Undo/Redo はスナップショットで実現）。
 * - 不変条件: 端点ノードが存在 / 自己ループなし / 長さ MIN_SEGMENT_MM 以上 / 同一ノード対の重複なし /
 *   孤立ノードなし（種別固定を除く）/ 種別はトポロジーと一致。これを壊す操作は行わない（元の Network を返す）。
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
  /** 実測長を分割時に按分した概算値である（再実測を推奨） */
  measuredApprox?: boolean;
  /** 余長率（0.05 = 5%）。実測長・図面長とは別に保持 */
  extraRate?: number;
  note?: string;
};

export type Network = {
  nodes: Record<string, PipeNode>;
  segments: Record<string, Segment>;
};

/** これ未満の区間は作らない(mm) */
export const MIN_SEGMENT_MM = 1;
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

/** ノードID → 接続区間 の隣接表 */
export function adjacency(net: Network): Map<string, Segment[]> {
  const m = new Map<string, Segment[]>();
  for (const s of Object.values(net.segments)) {
    for (const n of [s.a, s.b]) {
      const arr = m.get(n);
      if (arr) arr.push(s);
      else m.set(n, [s]);
    }
  }
  return m;
}

export function segmentsAt(net: Network, nodeId: string): Segment[] {
  return Object.values(net.segments).filter((s) => s.a === nodeId || s.b === nodeId);
}

export const nodeDegree = (net: Network, nodeId: string) => segmentsAt(net, nodeId).length;

const other = (s: Segment, nodeId: string) => (s.a === nodeId ? s.b : s.a);
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function hasPair(net: Network, a: string, b: string): boolean {
  const k = pairKey(a, b);
  return Object.values(net.segments).some((s) => pairKey(s.a, s.b) === k);
}

function sub(p: Vec3, q: Vec3): Vec3 {
  return { x: p.x - q.x, y: p.y - q.y, z: p.z - q.z };
}

/** 2区間が nodeId で一直線（反対方向）につながるか。cosLimit: -0.9999 ≒ 0.8° */
function isCollinear(net: Network, nodeId: string, s1: Segment, s2: Segment, cosLimit = -0.9999): boolean {
  const p = net.nodes[nodeId].pos;
  const u = sub(net.nodes[other(s1, nodeId)].pos, p);
  const w = sub(net.nodes[other(s2, nodeId)].pos, p);
  const lu = Math.hypot(u.x, u.y, u.z);
  const lw = Math.hypot(w.x, w.y, w.z);
  if (lu < MIN_SEGMENT_MM || lw < MIN_SEGMENT_MM) return false;
  return (u.x * w.x + u.y * w.y + u.z * w.z) / (lu * lw) < cosLimit;
}

function kindFor(net: Network, n: PipeNode, segs: Segment[]): NodeKind {
  if (n.fixedKind) return n.kind;
  if (segs.length === 1) return 'end';
  if (segs.length === 2) return isCollinear(net, n.id, segs[0], segs[1]) ? 'joint' : 'elbow';
  if (segs.length === 3) return 'tee';
  return 'cross';
}

/** 孤立ノードを削除し、ノード種別をトポロジーから再計算する */
export function normalize(net: Network): Network {
  const adj = adjacency(net);
  const nodes: Record<string, PipeNode> = {};
  for (const n of Object.values(net.nodes)) {
    const segs = adj.get(n.id) ?? [];
    if (segs.length === 0 && !n.fixedKind) continue;
    const kind = kindFor(net, n, segs);
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
 * 短すぎる区間・既存区間と重複する区間は作らない。
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
    const isLast = i === pts.length - 1;
    const prev = nodeIds.at(-1);
    const forcedEnd = isLast && !!opts.endNodeId;
    if (prev && !forcedEnd && dist(cur.nodes[prev].pos, p) < MIN_SEGMENT_MM) return;
    let id: string;
    if (i === 0 && opts.startNodeId) id = opts.startNodeId;
    else if (forcedEnd) id = opts.endNodeId!;
    else ({ net: cur, id } = addNode(cur, p));
    if (prev) {
      if (prev === id || hasPair(cur, prev, id) || dist(cur.nodes[prev].pos, cur.nodes[id].pos) < MIN_SEGMENT_MM) {
        if (prev !== id) nodeIds.push(id);
        return;
      }
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
  let t = len2 === 0 ? 0 : ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / len2;
  t = Math.max(0, Math.min(1, t));
  return { pos: { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t }, t };
}

/**
 * 区間をノードで分割する。既存の端点に近ければ分割しない。
 * 実測長がある場合は長さ比で按分し measuredApprox を立てる（値を捨てない）。
 */
export function splitSegment(net: Network, segId: string, p: Vec3): { net: Network; nodeId: string; segmentIds: string[] } {
  const s = net.segments[segId];
  const { pos, t } = projectOnSegment(net, segId, p);
  const a = net.nodes[s.a].pos;
  const b = net.nodes[s.b].pos;
  const snap = Math.max(MIN_SEGMENT_MM, Math.min(SNAP_TO_NODE_MM, dist(a, b) / 2 - MIN_SEGMENT_MM));
  if (dist(pos, a) <= snap) return { net, nodeId: s.a, segmentIds: [segId] };
  if (dist(pos, b) <= snap) return { net, nodeId: s.b, segmentIds: [segId] };

  const { [segId]: _removed, ...rest } = net.segments;
  let cur: Network = { ...net, segments: rest };
  let mid: string;
  ({ net: cur, id: mid } = addNode(cur, pos));
  const { id: _i, a: _a, b: _b, measuredLength, measuredApprox: _ma, ...attrs } = s;
  let s1: string, s2: string;
  ({ net: cur, id: s1 } = addSegment(cur, s.a, mid, attrs));
  ({ net: cur, id: s2 } = addSegment(cur, mid, s.b, attrs));
  if (measuredLength !== undefined) {
    cur = {
      ...cur,
      segments: {
        ...cur.segments,
        [s1]: { ...cur.segments[s1], measuredLength: measuredLength * t, measuredApprox: true },
        [s2]: { ...cur.segments[s2], measuredLength: measuredLength * (1 - t), measuredApprox: true },
      },
    };
  }
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

/** ノード移動。接続先ノードと重なる（長さ0区間ができる）移動は拒否して元の Network を返す */
export function moveNode(net: Network, nodeId: string, pos: Vec3): Network {
  const n = net.nodes[nodeId];
  if (!n) return net;
  for (const s of segmentsAt(net, nodeId)) {
    if (dist(net.nodes[other(s, nodeId)].pos, pos) < MIN_SEGMENT_MM) return net;
  }
  return normalize({ ...net, nodes: { ...net.nodes, [nodeId]: { ...n, pos: { ...pos } } } });
}

const sameAttrs = (s: Segment, t: Segment) =>
  s.system === t.system && s.diameter === t.diameter && s.material === t.material && (s.extraRate ?? 0) === (t.extraRate ?? 0);

/**
 * 指定ノードが「同じ属性の2区間がほぼ完全に一直線につながるだけの点」なら、2区間を1本に結合する。
 * 実測長・備考を持つ区間、種別固定ノード（バルブ等）、結合で重複区間ができる場合は結合しない。
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
    if (!isCollinear(cur, nid, s1, s2, -0.9999999)) continue;
    const a = other(s1, nid), b = other(s2, nid);
    if (a === b || hasPair(cur, a, b)) continue;
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

/** fromNode から segId 方向に到達できる区間ID一覧。枝が本管側へループして戻る場合は null */
export function collectBranch(net: Network, fromNodeId: string, segId: string): string[] | null {
  const start = net.segments[segId];
  if (!start || (start.a !== fromNodeId && start.b !== fromNodeId)) return null;
  const adj = adjacency(net);
  const result = new Set<string>([segId]);
  const stack = [other(start, fromNodeId)];
  const seen = new Set<string>([fromNodeId]);
  while (stack.length) {
    const nid = stack.pop()!;
    if (seen.has(nid)) continue;
    seen.add(nid);
    for (const s of adj.get(nid) ?? []) {
      if (result.has(s.id)) continue;
      const o = other(s, nid);
      if (o === fromNodeId) return null;
      result.add(s.id);
      stack.push(o);
    }
  }
  return [...result];
}

/** 分岐単位の削除: fromNode から segId 方向の枝をすべて削除。ループなら削除しない */
export function deleteBranch(net: Network, fromNodeId: string, segId: string): Network {
  const ids = collectBranch(net, fromNodeId, segId);
  if (!ids) return net;
  const del = new Set(ids);
  const segments = Object.fromEntries(Object.entries(net.segments).filter(([id]) => !del.has(id)));
  return mergeAtNodes(normalize({ ...net, segments }), [fromNodeId]);
}

/** 接続情報の整合性チェック。問題がなければ空配列（O(N+S)） */
export function validateNetwork(net: Network): string[] {
  const errors: string[] = [];
  const pairs = new Set<string>();
  for (const s of Object.values(net.segments)) {
    if (!net.nodes[s.a] || !net.nodes[s.b]) {
      errors.push(`segment ${s.id}: 端点ノードが存在しない`);
      continue;
    }
    if (s.a === s.b) errors.push(`segment ${s.id}: 自己ループ`);
    if (segmentLength(net, s.id) < MIN_SEGMENT_MM) errors.push(`segment ${s.id}: 長さ0`);
    const key = pairKey(s.a, s.b);
    if (pairs.has(key)) errors.push(`segment ${s.id}: 重複区間`);
    pairs.add(key);
  }
  if (errors.length) return errors;
  const adj = adjacency(net);
  for (const n of Object.values(net.nodes)) {
    const segs = adj.get(n.id) ?? [];
    if (segs.length === 0 && !n.fixedKind) errors.push(`node ${n.id}: 孤立ノード`);
    else if (!n.fixedKind) {
      const expected = kindFor(net, n, segs);
      if (expected !== n.kind) errors.push(`node ${n.id}: 種別不一致 ${n.kind}≠${expected}`);
    }
  }
  return errors;
}
