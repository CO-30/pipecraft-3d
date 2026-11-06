/**
 * 共通ストア。2D/3D の両ビューはここだけを読み書きする（データの二重管理なし）。
 */
import { create } from 'zustand';
import {
  addPolyline, branchFromSegment, collectBranch, deleteBranch, deleteSegment, emptyNetwork, moveNode,
  type Network, type SegmentAttrs, type Vec3,
} from '../model/network';

export type Tool = 'select' | 'draw' | 'branch';

const HISTORY_LIMIT = 200;

type State = {
  network: Network;
  past: Network[];
  future: Network[];
  tool: Tool;
  drawAttrs: SegmentAttrs;
  selectedSegmentId: string | null;
  selectedNodeId: string | null;
  /** ドラッグ中はプレビューだけ更新し、履歴は確定時に1件だけ積む */
  dragBase: Network | null;
  revision: number;

  setTool(t: Tool): void;
  setDrawAttrs(a: Partial<SegmentAttrs>): void;
  select(sel: { segmentId?: string | null; nodeId?: string | null }): void;
  load(net: Network): void;

  drawPolyline(points: Vec3[], opts?: { startNodeId?: string; endNodeId?: string }): void;
  branch(segId: string, at: Vec3, path: Vec3[]): void;
  beginDrag(): void;
  dragNode(nodeId: string, pos: Vec3): void;
  endDrag(): void;
  setNodeHeight(nodeId: string, z: number): void;
  deleteSelected(): void;
  deleteSelectedBranch(): void;
  undo(): void;
  redo(): void;
};

export const useStore = create<State>((set, get) => {
  const commit = (next: Network, extra: Partial<State> = {}) => {
    const { network, past } = get();
    if (next === network) return;
    set({ network: next, past: [...past, network].slice(-HISTORY_LIMIT), future: [], revision: get().revision + 1, ...extra });
  };

  return {
    network: emptyNetwork(),
    past: [],
    future: [],
    tool: 'draw',
    drawAttrs: { system: 'water', diameter: 20 },
    selectedSegmentId: null,
    selectedNodeId: null,
    dragBase: null,
    revision: 0,

    setTool: (tool) => set({ tool }),
    setDrawAttrs: (a) => set({ drawAttrs: { ...get().drawAttrs, ...a } }),
    select: ({ segmentId = null, nodeId = null }) => set({ selectedSegmentId: segmentId, selectedNodeId: nodeId }),
    load: (network) => set({ network, past: [], future: [], dragBase: null, selectedNodeId: null, selectedSegmentId: null, revision: get().revision + 1 }),

    drawPolyline: (points, opts) => {
      if (points.length < 2) return;
      const r = addPolyline(get().network, points, get().drawAttrs, opts);
      commit(r.net, { selectedSegmentId: r.segmentIds.at(-1) ?? null, selectedNodeId: null });
    },
    branch: (segId, at, path) => {
      if (!get().network.segments[segId] || path.length < 1) return;
      const r = branchFromSegment(get().network, segId, at, path);
      commit(r.net, { selectedSegmentId: r.branchSegmentIds.at(-1) ?? null, selectedNodeId: null, tool: 'select' });
    },
    beginDrag: () => set({ dragBase: get().network }),
    dragNode: (nodeId, pos) => set({ network: moveNode(get().network, nodeId, pos) }),
    endDrag: () => {
      const { dragBase, network, past } = get();
      if (!dragBase) return;
      if (dragBase !== network) set({ past: [...past, dragBase].slice(-HISTORY_LIMIT), future: [], revision: get().revision + 1 });
      set({ dragBase: null });
    },
    setNodeHeight: (nodeId, z) => {
      const n = get().network.nodes[nodeId];
      if (n) commit(moveNode(get().network, nodeId, { ...n.pos, z }));
    },
    deleteSelected: () => {
      const id = get().selectedSegmentId;
      if (id) commit(deleteSegment(get().network, id), { selectedSegmentId: null });
    },
    /** 選択区間を含む枝管を、最寄りの分岐点から先ごと削除 */
    deleteSelectedBranch: () => {
      const { network, selectedSegmentId } = get();
      if (!selectedSegmentId) return;
      const tee = findUpstreamBranchPoint(network, selectedSegmentId);
      if (!tee) return;
      commit(deleteBranch(network, tee.nodeId, tee.segmentId), { selectedSegmentId: null });
    },
    undo: () => {
      get().endDrag();
      const { past, network, future } = get();
      const prev = past.at(-1);
      if (!prev) return;
      set({ network: prev, past: past.slice(0, -1), future: [network, ...future], revision: get().revision + 1, selectedSegmentId: null, selectedNodeId: null });
    },
    redo: () => {
      get().endDrag();
      const { past, network, future } = get();
      const next = future[0];
      if (!next) return;
      set({ network: next, past: [...past, network], future: future.slice(1), revision: get().revision + 1, selectedSegmentId: null, selectedNodeId: null });
    },
  };
});

/** 区間から配管をたどり、最初に出会う分岐点（次数3以上）と、そこから枝側へ出る区間を返す */
export function findUpstreamBranchPoint(net: Network, segId: string): { nodeId: string; segmentId: string } | null {
  const start = net.segments[segId];
  if (!start) return null;
  const found: { nodeId: string; segmentId: string }[] = [];
  for (const startNode of [start.a, start.b]) {
    let seg = start;
    let node = startNode;
    const seen = new Set<string>();
    while (!seen.has(seg.id)) {
      seen.add(seg.id);
      const segs = Object.values(net.segments).filter((s) => s.a === node || s.b === node);
      if (segs.length >= 3) { found.push({ nodeId: node, segmentId: seg.id }); break; }
      if (segs.length !== 2) break;
      seg = segs[0].id === seg.id ? segs[1] : segs[0];
      node = seg.a === node ? seg.b : seg.a;
    }
  }
  // 両側に分岐点がある（本管の途中）場合はどちらを消すか曖昧なので対象なし
  return found.length === 1 ? found[0] : null;
}

/** 「枝管ごと削除」で消える区間ID（対象なしなら null） */
export function branchDeletionPreview(net: Network, segId: string): string[] | null {
  const tee = findUpstreamBranchPoint(net, segId);
  return tee ? collectBranch(net, tee.nodeId, tee.segmentId) : null;
}
