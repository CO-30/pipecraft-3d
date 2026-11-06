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
  /** 設備機器の接続口ノード: 器具ID と接続口ID */
  fixtureId?: string;
  portId?: string;
  /** 所属階（階高の変更に追従するため） */
  floorId?: string;
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

// ---------------------------------------------------------------------------
// Phase 3: 編集操作（すべて不変条件を守り、守れない場合は元の Network を返す）
// ---------------------------------------------------------------------------

const DEFAULT_ATTRS: SegmentAttrs = { system: 'other', diameter: 20 };
/** 切断・解除で残す区間の最小長(mm) */
export const MIN_PIECE_MM = 25;

const attrsOf = (s: Segment): SegmentAttrs & Pick<Segment, 'extraRate' | 'note'> => {
  const { id: _i, a: _a, b: _b, measuredLength: _m, measuredApprox: _ma, ...rest } = s;
  return rest;
};
const lerp = (p: Vec3, q: Vec3, t: number): Vec3 => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t });
const add = (p: Vec3, d: Vec3): Vec3 => ({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z });

/**
 * タップ位置で区間を切断し、gap(mm) の隙間を空けて2本の端点にする。
 * 区間が 150mm 未満・どちらかの残りが MIN_PIECE_MM 未満なら null。
 */
export function cutSegment(net: Network, segId: string, p: Vec3, gap = 50): { net: Network; nodeIds: [string, string] } | null {
  const s = net.segments[segId];
  if (!s) return null;
  const A = net.nodes[s.a].pos, Bp = net.nodes[s.b].pos;
  const L = dist(A, Bp);
  if (L < 150) return null;
  const { t } = projectOnSegment(net, segId, p);
  const d1 = t * L - gap / 2, d2 = t * L + gap / 2;
  if (d1 < MIN_PIECE_MM || L - d2 < MIN_PIECE_MM) return null;
  const { [segId]: _removed, ...rest } = net.segments;
  let cur: Network = { ...net, segments: rest };
  let n1: string, n2: string, s1: string, s2: string;
  ({ net: cur, id: n1 } = addNode(cur, lerp(A, Bp, d1 / L)));
  ({ net: cur, id: n2 } = addNode(cur, lerp(A, Bp, d2 / L)));
  const attrs = attrsOf(s);
  ({ net: cur, id: s1 } = addSegment(cur, s.a, n1, attrs));
  ({ net: cur, id: s2 } = addSegment(cur, n2, s.b, attrs));
  if (s.measuredLength !== undefined) {
    cur.segments[s1] = { ...cur.segments[s1], measuredLength: (s.measuredLength * d1) / L, measuredApprox: true };
    cur.segments[s2] = { ...cur.segments[s2], measuredLength: (s.measuredLength * (L - d2)) / L, measuredApprox: true };
  }
  return { net: normalize(cur), nodeIds: [n1, n2] };
}

/** ノードにつながる区間をそれぞれ pull(mm) 手前の新しい端点で切り離す（接続解除） */
export function detachNode(net: Network, nodeId: string, pull = 30): Network {
  const n = net.nodes[nodeId];
  if (!n) return net;
  const segs = segmentsAt(net, nodeId);
  if (segs.length < 2) return net;
  let cur: Network = { nodes: { ...net.nodes }, segments: { ...net.segments } };
  for (const s of segs) {
    const o = net.nodes[other(s, nodeId)].pos;
    const L = dist(o, n.pos);
    if (L - pull < MIN_PIECE_MM) return net;
    let nid: string;
    ({ net: cur, id: nid } = addNode(cur, lerp(n.pos, o, pull / L)));
    cur.segments[s.id] = s.a === nodeId ? { ...s, a: nid } : { ...s, b: nid };
  }
  // バルブなど種別固定のノードは切り離すと意味がないので消す（設備の接続口は残す）
  if (!n.fixtureId) delete cur.nodes[nodeId];
  return normalize(cur);
}

/** source の区間を target へ付け替えて1つのノードにする（接続）。設備の接続口は残す側にする */
export function mergeNodes(net: Network, targetId: string, sourceId: string): Network {
  let t = net.nodes[targetId], s = net.nodes[sourceId];
  if (!t || !s || t.id === s.id) return net;
  if (s.fixedKind && t.fixedKind) return net;
  if (s.fixedKind) [t, s] = [s, t];
  const segs = segmentsAt(net, s.id);
  const pairs = new Set(Object.values(net.segments).filter((x) => x.a !== s.id && x.b !== s.id).map((x) => pairKey(x.a, x.b)));
  const segments = { ...net.segments };
  for (const x of segs) {
    const o = other(x, s.id);
    if (o === t.id) return net;
    if (dist(net.nodes[o].pos, t.pos) < MIN_SEGMENT_MM) return net;
    const k = pairKey(o, t.id);
    if (pairs.has(k)) return net;
    pairs.add(k);
    segments[x.id] = x.a === s.id ? { ...x, a: t.id } : { ...x, b: t.id };
  }
  const nodes = { ...net.nodes };
  delete nodes[s.id];
  return normalize({ nodes, segments });
}

/** ノードを区間の途中（最寄り点）に接続する。区間を分割してから結合 */
export function connectNodeToSegment(net: Network, nodeId: string, segId: string): Network {
  const seg = net.segments[segId];
  const n = net.nodes[nodeId];
  if (!seg || !n || seg.a === nodeId || seg.b === nodeId) return net;
  const sp = splitSegment(net, segId, n.pos);
  const merged = mergeNodes(sp.net, sp.nodeId, nodeId);
  return merged === sp.net ? net : merged;
}

/**
 * 部品単位の削除。
 * バルブ: 外して直管に戻す / 次数2（エルボ・ソケット）: 前後を1本の直線でつなぐ / 端点: その区間を削除 / 分岐点・設備の接続口(次数2以上): 削除しない
 */
export function deleteFitting(net: Network, nodeId: string): Network {
  const n = net.nodes[nodeId];
  if (!n) return net;
  const segs = segmentsAt(net, nodeId);
  if (n.fixtureId && segs.length !== 1) return net;
  if (segs.length === 1) return deleteSegment(net, segs[0].id);
  if (segs.length === 0) {
    const nodes = { ...net.nodes };
    delete nodes[nodeId];
    return { ...net, nodes };
  }
  if (segs.length >= 3) {
    if (n.fixedKind) return normalize({ ...net, nodes: { ...net.nodes, [nodeId]: { ...n, fixedKind: undefined } } });
    return net;
  }
  const [s1, s2] = segs;
  const a = other(s1, nodeId), b = other(s2, nodeId);
  if (a === b || dist(net.nodes[a].pos, net.nodes[b].pos) < MIN_SEGMENT_MM) return net;
  const segments = { ...net.segments };
  delete segments[s1.id];
  delete segments[s2.id];
  const k = pairKey(a, b);
  if (Object.values(segments).some((x) => pairKey(x.a, x.b) === k)) return net;
  const healed: Segment = { ...attrsOf(s1), id: s1.id, a, b };
  if (s1.measuredLength !== undefined || s2.measuredLength !== undefined) {
    // 実測長は捨てない。片側だけ実測なら残りはモデル長で補い、概算として印を付ける
    const m1 = s1.measuredLength ?? segmentLength(net, s1.id), m2 = s2.measuredLength ?? segmentLength(net, s2.id);
    healed.measuredLength = m1 + m2;
    const exact = s1.measuredLength !== undefined && s2.measuredLength !== undefined && isCollinear(net, nodeId, s1, s2) && !s1.measuredApprox && !s2.measuredApprox;
    if (!exact) healed.measuredApprox = true;
  }
  segments[s1.id] = healed;
  const nodes = { ...net.nodes };
  delete nodes[nodeId];
  return normalize({ nodes, segments });
}

/** 区間の途中にバルブを入れる。端に近すぎる位置は null */
export function insertValve(net: Network, segId: string, p: Vec3): { net: Network; nodeId: string } | null {
  if (!net.segments[segId]) return null;
  const sp = splitSegment(net, segId, p);
  if (sp.segmentIds.length !== 2) return null;
  const n = sp.net.nodes[sp.nodeId];
  return { net: { ...sp.net, nodes: { ...sp.net.nodes, [n.id]: { ...n, kind: 'valve', fixedKind: true } } }, nodeId: n.id };
}

/** 複数ノードを平行移動。長さ0の区間ができる移動は拒否 */
export function translateNodes(net: Network, nodeIds: string[], d: Vec3): Network {
  const set = new Set(nodeIds.filter((id) => net.nodes[id]));
  if (!set.size) return net;
  const nodes = { ...net.nodes };
  for (const id of set) nodes[id] = { ...nodes[id], pos: add(nodes[id].pos, d) };
  for (const s of Object.values(net.segments)) {
    if ((set.has(s.a) || set.has(s.b)) && dist(nodes[s.a].pos, nodes[s.b].pos) < MIN_SEGMENT_MM) return net;
  }
  return normalize({ ...net, nodes });
}

/** 区間の長さを変更（a 端を固定し、b 端を区間の方向に沿って移動） */
export function setSegmentLength(net: Network, segId: string, length: number): Network {
  const s = net.segments[segId];
  if (!s || !(length >= MIN_SEGMENT_MM) || !Number.isFinite(length)) return net;
  const A = net.nodes[s.a].pos, Bp = net.nodes[s.b].pos;
  const L = dist(A, Bp);
  return moveNode(net, s.b, lerp(A, Bp, length / L));
}

/** 区間からつながっている配管全体（連結成分） */
export function connectedComponent(net: Network, segId: string): { segmentIds: string[]; nodeIds: string[] } {
  const s0 = net.segments[segId];
  if (!s0) return { segmentIds: [], nodeIds: [] };
  const adj = adjacency(net);
  const segs = new Set<string>(), nodes = new Set<string>();
  const stack = [s0.a, s0.b];
  while (stack.length) {
    const nid = stack.pop()!;
    if (nodes.has(nid)) continue;
    nodes.add(nid);
    for (const s of adj.get(nid) ?? []) {
      segs.add(s.id);
      stack.push(other(s, nid));
    }
  }
  return { segmentIds: [...segs], nodeIds: [...nodes] };
}

export function deleteSegments(net: Network, ids: string[]): Network {
  const del = new Set(ids);
  const ends = ids.flatMap((id) => (net.segments[id] ? [net.segments[id].a, net.segments[id].b] : []));
  const segments = Object.fromEntries(Object.entries(net.segments).filter(([id]) => !del.has(id)));
  return mergeAtNodes(normalize({ ...net, segments }), ends);
}

/** 区間を複製して offset だけずらす（実測長・設備の接続口は引き継がない） */
export function duplicateSegments(net: Network, ids: string[], offset: Vec3): { net: Network; segmentIds: string[] } {
  const map = new Map<string, string>();
  let cur: Network = { nodes: { ...net.nodes }, segments: { ...net.segments } };
  const segmentIds: string[] = [];
  for (const id of ids) {
    const s = net.segments[id];
    if (!s) continue;
    const ends = [s.a, s.b].map((nid) => {
      let m = map.get(nid);
      if (!m) {
        const src = net.nodes[nid];
        ({ net: cur, id: m } = addNode(cur, add(src.pos, offset)));
        if (src.kind === 'valve' && src.fixedKind) cur.nodes[m] = { ...cur.nodes[m], kind: 'valve', fixedKind: true };
        map.set(nid, m);
      }
      return m;
    });
    let sid: string;
    ({ net: cur, id: sid } = addSegment(cur, ends[0], ends[1], attrsOf(s)));
    segmentIds.push(sid);
  }
  return { net: normalize(cur), segmentIds };
}

/** ノードから同じ x,y で高さ z まで縦区間（立て管）を追加。高さが同じ・既にある場合は null */
export function addRiser(net: Network, fromNodeId: string, z: number, attrs?: SegmentAttrs): { net: Network; nodeId: string; segmentId: string } | null {
  const n = net.nodes[fromNodeId];
  if (!n || !Number.isFinite(z) || Math.abs(z - n.pos.z) < MIN_SEGMENT_MM) return null;
  const target = { x: n.pos.x, y: n.pos.y, z };
  if (segmentsAt(net, fromNodeId).some((s) => dist(net.nodes[other(s, fromNodeId)].pos, target) < MIN_SEGMENT_MM)) return null;
  const base = segmentsAt(net, fromNodeId)[0];
  const at = base ? attrsOf(base) : attrs ?? DEFAULT_ATTRS;
  let cur = net, nid: string, sid: string;
  ({ net: cur, id: nid } = addNode(cur, target));
  ({ net: cur, id: sid } = addSegment(cur, fromNodeId, nid, at));
  return { net: normalize(cur), nodeId: nid, segmentId: sid };
}
