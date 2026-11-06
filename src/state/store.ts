/**
 * 共通ストア。2D/3D の両ビューはここだけを読み書きする（データの二重管理なし）。
 * 建物と配管は1つの Doc として、1本の Undo/Redo 履歴で管理する。
 */
import { create } from 'zustand';
import {
  addPolyline, branchFromSegment, collectBranch, deleteBranch, deleteSegment, emptyNetwork, moveNode,
  type Network, type SegmentAttrs, type Vec3,
} from '../model/network';
import * as B from '../model/building';
import type { Building, OpeningType, Vec2 } from '../model/building';
import { mergeRooms, splitRoom } from '../model/roomOps';
import { clampSection, defaultSectionValue, type Section, type SectionMode } from '../model/section';
import { SCHEMA_VERSION, type ProjectData } from '../model/schema';
import type { BoxCategory } from '../model/building3d';

export type Doc = { building: Building; network: Network };
export type Tool = 'select' | 'pipe' | 'wall' | 'room' | 'split' | 'door' | 'window';
export type SelKind = 'segment' | 'node' | 'wall' | 'corner' | 'opening' | 'room';
export type Selection = { kind: SelKind; id: string } | null;
export type VisCategory = BoxCategory | 'pipes';
export type VisMode = 'show' | 'ghost' | 'hide';
export type FloorFilter = 'all' | 'upToActive' | 'activeOnly';
export type ProjectMeta = { id: string; name: string; address?: string; createdAt: number };

const HISTORY_LIMIT = 200;
export const VIS_CATEGORIES: { id: VisCategory; label: string }[] = [
  { id: 'exteriorWall', label: '外壁' }, { id: 'interiorWall', label: '内壁' }, { id: 'floor', label: '床' },
  { id: 'ceiling', label: '天井' }, { id: 'door', label: 'ドア' }, { id: 'window', label: '窓' }, { id: 'pipes', label: '配管・配線' },
];
const defaultVisibility = (): Record<VisCategory, VisMode> => ({
  exteriorWall: 'show', interiorWall: 'show', floor: 'show', ceiling: 'hide', door: 'show', window: 'show', pipes: 'show',
});

export const emptyDoc = (): Doc => ({ building: B.addFloor(B.emptyBuilding()).b, network: emptyNetwork() });

type State = {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  meta: ProjectMeta | null;
  activeFloorId: string;
  tool: Tool;
  drawAttrs: SegmentAttrs;
  /** 配管を描く高さ（現在の階の床からの高さ mm） */
  drawHeight: number;
  orthoSnap: boolean;
  selection: Selection;
  visibility: Record<VisCategory, VisMode>;
  /** 個別に非表示/半透明にした要素ID */
  hiddenIds: string[];
  ghostIds: string[];
  dragBase: Doc | null;
  revision: number;
  /** 結合待ちの部屋（次にタップした部屋と結合する） */
  pendingMerge: string | null;
  /** 3D の断面・階ごとの表示（表示専用。履歴・保存の対象外） */
  section: Section;
  floorFilter: FloorFilter;
  setSectionMode(mode: SectionMode): void;
  setSectionValue(value: number): void;
  setFloorFilter(f: FloorFilter): void;
  /** 部屋を分割するとき切断線に壁も作る */
  splitWithWall: boolean;
  setSplitWithWall(v: boolean): void;

  openProject(p: ProjectData): void;
  newDoc(doc: Doc, meta: ProjectMeta | null): void;
  closeProject(): void;
  toProjectData(): ProjectData | null;
  renameProject(name: string, address?: string): void;

  setTool(t: Tool): void;
  setDrawAttrs(a: Partial<SegmentAttrs>): void;
  setDrawHeight(h: number): void;
  setOrthoSnap(v: boolean): void;
  select(sel: Selection): void;
  setActiveFloor(id: string): void;

  // 配管
  drawPolyline(points: Vec3[], opts?: { startNodeId?: string; endNodeId?: string }): void;
  branch(segId: string, at: Vec3, path: Vec3[]): void;
  setNodeHeight(nodeId: string, z: number): void;
  updateSegment(segId: string, patch: Partial<SegmentAttrs>): void;
  deleteSelectedBranch(): void;

  // ドラッグ（確定時に履歴1件）
  beginDrag(): void;
  dragNode(nodeId: string, pos: Vec3): void;
  dragCorner(cornerId: string, p: Vec2): void;
  dragWall(wallId: string, dx: number, dy: number): void;
  endDrag(): void;

  // 建物
  addWall(p: Vec2, q: Vec2): void;
  addRoom(p: Vec2, q: Vec2): void;
  addOpening(wallId: string, type: OpeningType, offset: number): void;
  updateWall(wallId: string, patch: Partial<Pick<B.Wall, 'thickness' | 'kind'>>): void;
  updateOpening(id: string, patch: Partial<Pick<B.Opening, 'offset' | 'width' | 'height' | 'sill'>>): void;
  renameRoom(id: string, name: string): void;
  /** p→q の直線で部屋を分割。withWall なら切断線に内壁も作る（1つの履歴） */
  splitRoomAt(roomId: string, p: Vec2, q: Vec2, withWall: boolean): void;
  startMerge(): void;
  cancelMerge(): void;
  mergeRoomWith(otherId: string): void;
  addFloor(copyExterior: boolean): void;
  updateFloor(id: string, patch: Partial<Pick<B.Floor, 'name' | 'height' | 'slabThickness'>>): void;
  deleteFloor(id: string): void;
  deleteSelected(): void;

  // 表示
  setVisibility(cat: VisCategory, mode: VisMode): void;
  setElementVisibility(id: string, mode: VisMode): void;
  resetElementVisibility(): void;

  undo(): void;
  redo(): void;
};

export const useStore = create<State>((set, get) => {
  /** 新しい Doc を履歴付きで確定。変化がなければ何もしない */
  const commit = (next: Doc, extra: Partial<State> = {}) => {
    const { doc, past } = get();
    if (next.building === doc.building && next.network === doc.network) return false;
    set({ doc: next, past: [...past, doc].slice(-HISTORY_LIMIT), future: [], revision: get().revision + 1, ...extra });
    return true;
  };
  const withNet = (network: Network): Doc => ({ ...get().doc, network });
  const withBld = (building: Building): Doc => ({ ...get().doc, building });
  const fixActiveFloor = (doc: Doc, preferred: string) =>
    doc.building.floors.some((f) => f.id === preferred) ? preferred : doc.building.floors[0]?.id ?? '';
  const resetView = (doc: Doc): Partial<State> => ({
    past: [], future: [], dragBase: null, selection: null, hiddenIds: [], ghostIds: [], pendingMerge: null,
    section: { mode: 'off', value: 0 }, floorFilter: 'all',
    activeFloorId: doc.building.floors[0]?.id ?? '', tool: 'select', revision: get().revision + 1,
  });

  const initial = emptyDoc();
  return {
    doc: initial,
    past: [],
    future: [],
    meta: null,
    activeFloorId: initial.building.floors[0].id,
    tool: 'select',
    drawAttrs: { system: 'water', diameter: 20 },
    drawHeight: 100,
    orthoSnap: true,
    selection: null,
    visibility: defaultVisibility(),
    hiddenIds: [],
    ghostIds: [],
    dragBase: null,
    revision: 0,
    pendingMerge: null,
    splitWithWall: true,
    section: { mode: 'off', value: 0 },
    floorFilter: 'all',
    setSectionMode: (mode) => {
      const { doc, activeFloorId, section } = get();
      if (mode === section.mode) return;
      set({ section: mode === 'off' ? { mode, value: section.value } : { mode, value: defaultSectionValue(doc.building, mode, activeFloorId) } });
    },
    setSectionValue: (value) => set({ section: clampSection(get().doc.building, { ...get().section, value }) }),
    setFloorFilter: (floorFilter) => set({ floorFilter }),
    setSplitWithWall: (splitWithWall) => set({ splitWithWall }),

    openProject: (p) => {
      const doc = { building: p.building, network: p.network };
      set({ doc, meta: { id: p.id, name: p.name, address: p.address, createdAt: p.createdAt }, ...resetView(doc) });
    },
    newDoc: (doc, meta) => set({ doc, meta, ...resetView(doc) }),
    closeProject: () => set({ meta: null, selection: null, dragBase: null }),
    toProjectData: () => {
      const { meta, doc } = get();
      if (!meta) return null;
      return { schemaVersion: SCHEMA_VERSION, ...meta, updatedAt: Date.now(), building: doc.building, network: doc.network };
    },
    renameProject: (name, address) => {
      const m = get().meta;
      if (m) set({ meta: { ...m, name, address }, revision: get().revision + 1 });
    },

    setTool: (tool) => set({ tool, pendingMerge: null }),
    setDrawAttrs: (a) => set({ drawAttrs: { ...get().drawAttrs, ...a } }),
    setDrawHeight: (drawHeight) => set({ drawHeight }),
    setOrthoSnap: (orthoSnap) => set({ orthoSnap }),
    select: (selection) => set({ selection }),
    setActiveFloor: (activeFloorId) => set({ activeFloorId, selection: null }),

    drawPolyline: (points, opts) => {
      if (points.length < 2) return;
      const r = addPolyline(get().doc.network, points, get().drawAttrs, opts);
      const last = r.segmentIds.at(-1);
      commit(withNet(r.net), { selection: last ? { kind: 'segment', id: last } : null });
    },
    branch: (segId, at, path) => {
      if (!get().doc.network.segments[segId] || path.length < 1) return;
      const r = branchFromSegment(get().doc.network, segId, at, path);
      const last = r.branchSegmentIds.at(-1);
      commit(withNet(r.net), { selection: last ? { kind: 'segment', id: last } : null });
    },
    setNodeHeight: (nodeId, z) => {
      const n = get().doc.network.nodes[nodeId];
      if (n) commit(withNet(moveNode(get().doc.network, nodeId, { ...n.pos, z })));
    },
    updateSegment: (segId, patch) => {
      const net = get().doc.network;
      const s = net.segments[segId];
      if (!s || (patch.diameter !== undefined && !(patch.diameter > 0))) return;
      commit(withNet({ ...net, segments: { ...net.segments, [segId]: { ...s, ...patch } } }));
    },
    deleteSelectedBranch: () => {
      const sel = get().selection;
      if (sel?.kind !== 'segment') return;
      const net = get().doc.network;
      const tee = findUpstreamBranchPoint(net, sel.id);
      if (!tee) return;
      commit(withNet(deleteBranch(net, tee.nodeId, tee.segmentId)), { selection: null });
    },

    beginDrag: () => set({ dragBase: get().doc }),
    dragNode: (nodeId, pos) => set({ doc: withNet(moveNode(get().doc.network, nodeId, pos)) }),
    dragCorner: (cornerId, p) => set({ doc: withBld(B.moveCorner(get().doc.building, cornerId, p)) }),
    dragWall: (wallId, dx, dy) => {
      const base = get().dragBase ?? get().doc;
      set({ doc: { ...get().doc, building: B.moveWall(base.building, wallId, dx, dy) } });
    },
    endDrag: () => {
      const { dragBase, doc, past } = get();
      if (!dragBase) return;
      const changed = dragBase.building !== doc.building || dragBase.network !== doc.network;
      set({ dragBase: null, ...(changed ? { past: [...past, dragBase].slice(-HISTORY_LIMIT), future: [], revision: get().revision + 1 } : {}) });
    },

    addWall: (p, q) => {
      const r = B.addWall(get().doc.building, get().activeFloorId, p, q);
      if (r.wallIds[0]) commit(withBld(r.b), { selection: { kind: 'wall', id: r.wallIds[0] } });
    },
    addRoom: (p, q) => {
      if (Math.abs(p.x - q.x) < 300 || Math.abs(p.y - q.y) < 300) return;
      const n = Object.values(get().doc.building.rooms).filter((r) => r.floorId === get().activeFloorId).length + 1;
      const r = B.addRoomRect(get().doc.building, get().activeFloorId, p, q, `部屋${n}`);
      commit(withBld(r.b), { selection: { kind: 'room', id: r.roomId } });
    },
    addOpening: (wallId, type, offset) => {
      const r = B.addOpening(get().doc.building, wallId, type, offset);
      if (r.openingId) commit(withBld(r.b), { selection: { kind: 'opening', id: r.openingId } });
    },
    updateWall: (id, patch) => { commit(withBld(B.updateWall(get().doc.building, id, patch))); },
    updateOpening: (id, patch) => { commit(withBld(B.updateOpening(get().doc.building, id, patch))); },
    renameRoom: (id, name) => { commit(withBld(B.renameRoom(get().doc.building, id, name))); },
    splitRoomAt: (roomId, p, q, withWall) => {
      const r = splitRoom(get().doc.building, roomId, p, q);
      if (!r.roomIds.length) return;
      let b = r.b;
      if (withWall && r.cut) b = B.addWall(b, b.rooms[r.roomIds[0]].floorId, r.cut[0], r.cut[1]).b;
      commit(withBld(b), { selection: { kind: 'room', id: r.roomIds[0] } });
    },
    startMerge: () => {
      const sel = get().selection;
      if (sel?.kind === 'room') set({ pendingMerge: sel.id });
    },
    cancelMerge: () => set({ pendingMerge: null }),
    mergeRoomWith: (otherId) => {
      const a = get().pendingMerge;
      set({ pendingMerge: null });
      if (!a) return;
      const r = mergeRooms(get().doc.building, a, otherId);
      if (r.roomId) commit(withBld(r.b), { selection: { kind: 'room', id: r.roomId } });
    },
    addFloor: (copyExterior) => {
      const r = B.addFloor(get().doc.building, copyExterior ? { copyExteriorFrom: get().activeFloorId } : {});
      commit(withBld(r.b), { activeFloorId: r.floorId, selection: null });
    },
    updateFloor: (id, patch) => { commit(withBld(B.updateFloor(get().doc.building, id, patch))); },
    deleteFloor: (id) => {
      const next = withBld(B.deleteFloor(get().doc.building, id));
      commit(next, { activeFloorId: fixActiveFloor(next, get().activeFloorId), selection: null });
    },
    deleteSelected: () => {
      const sel = get().selection;
      if (!sel) return;
      const { building, network } = get().doc;
      let next: Doc | null = null;
      if (sel.kind === 'segment') next = withNet(deleteSegment(network, sel.id));
      else if (sel.kind === 'wall') next = withBld(B.deleteWall(building, sel.id));
      else if (sel.kind === 'opening') next = withBld(B.deleteOpening(building, sel.id));
      else if (sel.kind === 'room') next = withBld(B.deleteRoom(building, sel.id));
      if (next) commit(next, { selection: null });
    },

    setVisibility: (cat, mode) => set({ visibility: { ...get().visibility, [cat]: mode } }),
    setElementVisibility: (id, mode) => {
      const hiddenIds = get().hiddenIds.filter((x) => x !== id);
      const ghostIds = get().ghostIds.filter((x) => x !== id);
      if (mode === 'hide') hiddenIds.push(id);
      if (mode === 'ghost') ghostIds.push(id);
      set({ hiddenIds, ghostIds });
    },
    resetElementVisibility: () => set({ hiddenIds: [], ghostIds: [] }),

    undo: () => {
      get().endDrag();
      const { past, doc, future } = get();
      const prev = past.at(-1);
      if (!prev) return;
      set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], revision: get().revision + 1, selection: null, activeFloorId: fixActiveFloor(prev, get().activeFloorId) });
    },
    redo: () => {
      get().endDrag();
      const { past, doc, future } = get();
      const next = future[0];
      if (!next) return;
      set({ doc: next, past: [...past, doc], future: future.slice(1), revision: get().revision + 1, selection: null, activeFloorId: fixActiveFloor(next, get().activeFloorId) });
    },
  };

});

/** 現在の階の床高さ(mm) */
export const activeFloorElevation = () => {
  const s = useStore.getState();
  return B.floorById(s.doc.building, s.activeFloorId)?.elevation ?? 0;
};

/** 区間から配管をたどり、片側にだけある最寄りの分岐点（次数3以上）と、そこから枝側へ出る区間を返す */
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
