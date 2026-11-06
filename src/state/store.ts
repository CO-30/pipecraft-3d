/**
 * 共通ストア。2D/3D の両ビューはここだけを読み書きする（データの二重管理なし）。
 * 建物と配管は1つの Doc として、1本の Undo/Redo 履歴で管理する。
 */
import { create } from 'zustand';
import {
  addPolyline, addRiser, branchFromSegment, collectBranch, connectNodeToSegment, connectedComponent, cutSegment, deleteBranch,
  deleteFitting, deleteSegment, deleteSegments, detachNode, duplicateSegments, emptyNetwork, insertValve, mergeNodes, moveNode,
  setSegmentLength as setSegLen, translateNodes, validateNetwork,
  type Network, type SegmentAttrs, type Vec3,
} from '../model/network';
import type { Doc } from '../model/doc';
import { deleteFixture, moveFixture, placeFixture, syncAllFixturePorts, type FixtureType, type Rotation } from '../model/fixtures';
import { floorIndexForZ, followFloors, tagNodeFloors } from '../model/pipeFloors';
import * as B from '../model/building';
import type { Building, OpeningType, Vec2 } from '../model/building';
import { mergeRooms, splitRoom } from '../model/roomOps';
import { clampSection, defaultSectionValue, type Section, type SectionMode } from '../model/section';
import { SCHEMA_VERSION, type ProjectData } from '../model/schema';
import type { BoxCategory } from '../model/building3d';

export type { Doc };
export type Tool = 'select' | 'pipe' | 'wall' | 'room' | 'split' | 'door' | 'window' | 'fixture';
export type SelKind = 'segment' | 'node' | 'wall' | 'corner' | 'opening' | 'room' | 'fixture';
/** at: 区間をタップした位置（切断・バルブ挿入に使う） */
export type Selection = { kind: SelKind; id: string; at?: Vec3 } | null;
export type VisCategory = BoxCategory | 'pipes' | 'fixtures';
/** 配管全体の複製でずらす量(mm) */
export const DUPLICATE_OFFSET: Vec3 = { x: 500, y: 0, z: 0 };
export type VisMode = 'show' | 'ghost' | 'hide';
export type FloorFilter = 'all' | 'upToActive' | 'activeOnly';
export type ProjectMeta = { id: string; name: string; address?: string; createdAt: number };

const HISTORY_LIMIT = 200;
export const VIS_CATEGORIES: { id: VisCategory; label: string }[] = [
  { id: 'exteriorWall', label: '外壁' }, { id: 'interiorWall', label: '内壁' }, { id: 'floor', label: '床' },
  { id: 'ceiling', label: '天井' }, { id: 'door', label: 'ドア' }, { id: 'window', label: '窓' }, { id: 'pipes', label: '配管・配線' },
  { id: 'fixtures', label: '設備機器' },
];
const defaultVisibility = (): Record<VisCategory, VisMode> => ({
  exteriorWall: 'show', interiorWall: 'show', floor: 'show', ceiling: 'hide', door: 'show', window: 'show', pipes: 'show', fixtures: 'show',
});

export const emptyDoc = (): Doc => ({ building: B.addFloor(B.emptyBuilding()).b, network: emptyNetwork(), fixtures: {} });

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
  /** 器具ツールで置く種類 */
  fixtureType: FixtureType;
  setFixtureType(t: FixtureType): void;
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
  /** endSegId: 終点を既存区間の途中に接続する */
  drawPolyline(points: Vec3[], opts?: { startNodeId?: string; endNodeId?: string; endSegId?: string }): void;
  branch(segId: string, at: Vec3, path: Vec3[], opts?: { endNodeId?: string; endSegId?: string }): void;
  cutSelected(): void;
  insertValveAtSelection(): void;
  detachSelectedNode(): void;
  deleteSelectedFitting(): void;
  deleteRun(segId: string): void;
  duplicateRun(segId: string): void;
  setRunHeightDelta(segId: string, dz: number): void;
  setSegmentHeight(segId: string, z: number): void;
  setSegmentLength(segId: string, length: number): void;
  /** 立て管: 'up'/'down' = 上/下の階の床高 + 描画高さ、数値 = 絶対高さ(mm) */
  addRiserFromNode(nodeId: string, target: 'up' | 'down' | number): void;
  // 設備機器
  placeFixtureAt(p: Vec2): void;
  rotateFixture(id: string): void;
  setNodeHeight(nodeId: string, z: number): void;
  updateSegment(segId: string, patch: Partial<SegmentAttrs>): void;
  deleteSelectedBranch(): void;

  // ドラッグ（確定時に履歴1件）
  beginDrag(): void;
  dragNode(nodeId: string, pos: Vec3): void;
  dragSegment(segId: string, d: Vec3): void;
  dragFixture(id: string, p: Vec2): void;
  /** ドラッグ中のノードを別のノード・区間に結合（endDrag で履歴1件） */
  dropNode(nodeId: string, target: { type: 'node' | 'segment'; id: string } | null): void;
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
    if (next.building === doc.building && next.network === doc.network && next.fixtures === doc.fixtures) return false;
    set({ doc: next, past: [...past, doc].slice(-HISTORY_LIMIT), future: [], revision: get().revision + 1, ...extra });
    return true;
  };
  /** 新しいノードには所属階を付ける（つながった同じ高さのノード → 現在の階 → 高さから判定） */
  const withNet = (network: Network): Doc => {
    const { doc, activeFloorId } = get();
    return network === doc.network ? doc : { ...doc, network: tagNodeFloors(network, doc.building.floors, activeFloorId) };
  };
  /** 配管ノードのうち、設備の接続口でないもの（接続口は器具と一緒にしか動かさない） */
  const movable = (net: Network, ids: string[]) => ids.filter((id) => net.nodes[id] && !net.nodes[id].fixtureId);
  const connectEnd = (net: Network, endNodeId: string | undefined, endSegId?: string) =>
    endNodeId && endSegId && net.segments[endSegId] ? connectNodeToSegment(net, endNodeId, endSegId) : net;
  /** 建物の階が変わったときに配管・器具を追従させる。配管が壊れる場合は null */
  const withFloors = (nextBld: Building, removedFloorId?: string): Doc | null => {
    let doc: Doc = get().doc;
    if (removedFloorId) for (const f of Object.values(doc.fixtures)) if (f.floorId === removedFloorId) doc = deleteFixture(doc, f.id);
    const network = followFloors(doc.network, doc.building.floors, nextBld.floors);
    const next = syncAllFixturePorts({ ...doc, building: nextBld, network });
    return validateNetwork(next.network).length ? null : next;
  };
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
    fixtureType: 'toilet',
    setFixtureType: (fixtureType) => set({ fixtureType }),
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
      const doc = { building: p.building, network: p.network, fixtures: p.fixtures };
      set({ doc, meta: { id: p.id, name: p.name, address: p.address, createdAt: p.createdAt }, ...resetView(doc) });
    },
    newDoc: (doc, meta) => set({ doc, meta, ...resetView(doc) }),
    closeProject: () => set({ meta: null, selection: null, dragBase: null }),
    toProjectData: () => {
      const { meta, doc } = get();
      if (!meta) return null;
      return { schemaVersion: SCHEMA_VERSION, ...meta, updatedAt: Date.now(), building: doc.building, network: doc.network, fixtures: doc.fixtures };
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
    setActiveFloor: (activeFloorId) => set({ activeFloorId, selection: null, pendingMerge: null }),

    drawPolyline: (points, opts) => {
      if (points.length < 2) return;
      const { endSegId, ...o } = opts ?? {};
      const r = addPolyline(get().doc.network, points, get().drawAttrs, o);
      const last = r.segmentIds.at(-1);
      if (!last) return;
      const net = connectEnd(r.net, r.nodeIds.at(-1), endSegId);
      commit(withNet(net), { selection: net.segments[last] ? { kind: 'segment', id: last } : null });
    },
    branch: (segId, at, path, opts) => {
      if (!get().doc.network.segments[segId] || path.length < 1) return;
      const r = branchFromSegment(get().doc.network, segId, at, path);
      const last = r.branchSegmentIds.at(-1);
      if (!last) return;
      let net = r.net;
      const endId = net.segments[last].b; // addPolyline は前のノード→新しいノードの順で区間を作る
      if (opts?.endNodeId && net.nodes[opts.endNodeId] && endId !== opts.endNodeId) net = mergeNodes(net, opts.endNodeId, endId);
      else net = connectEnd(net, endId, opts?.endSegId);
      commit(withNet(net), { selection: net.segments[last] ? { kind: 'segment', id: last } : null });
    },
    cutSelected: () => {
      const sel = get().selection;
      const net = get().doc.network;
      if (sel?.kind !== 'segment' || !net.segments[sel.id]) return;
      const s = net.segments[sel.id];
      const r = cutSegment(net, sel.id, sel.at ?? midpoint(net, s.a, s.b));
      if (r) commit(withNet(r.net), { selection: { kind: 'node', id: r.nodeIds[0] } });
    },
    insertValveAtSelection: () => {
      const sel = get().selection;
      const net = get().doc.network;
      if (sel?.kind !== 'segment' || !net.segments[sel.id]) return;
      const s = net.segments[sel.id];
      const r = insertValve(net, sel.id, sel.at ?? midpoint(net, s.a, s.b));
      if (r) commit(withNet(r.net), { selection: { kind: 'node', id: r.nodeId } });
    },
    detachSelectedNode: () => {
      const sel = get().selection;
      if (sel?.kind === 'node') commit(withNet(detachNode(get().doc.network, sel.id)), { selection: null });
    },
    deleteSelectedFitting: () => {
      const sel = get().selection;
      if (sel?.kind === 'node') commit(withNet(deleteFitting(get().doc.network, sel.id)), { selection: null });
    },
    deleteRun: (segId) => {
      const net = get().doc.network;
      const c = connectedComponent(net, segId);
      if (c.segmentIds.length) commit(withNet(deleteSegments(net, c.segmentIds)), { selection: null });
    },
    duplicateRun: (segId) => {
      const net = get().doc.network;
      const c = connectedComponent(net, segId);
      if (!c.segmentIds.length) return;
      const r = duplicateSegments(net, c.segmentIds, DUPLICATE_OFFSET);
      commit(withNet(r.net), { selection: r.segmentIds[0] ? { kind: 'segment', id: r.segmentIds[0] } : null });
    },
    setRunHeightDelta: (segId, dz) => {
      const net = get().doc.network;
      const c = connectedComponent(net, segId);
      commit(withNet(translateNodes(net, movable(net, c.nodeIds), { x: 0, y: 0, z: dz })));
    },
    setSegmentHeight: (segId, z) => {
      const net = get().doc.network;
      const s = net.segments[segId];
      if (!s) return;
      let cur = net;
      for (const id of movable(net, [s.a, s.b])) cur = moveNode(cur, id, { ...cur.nodes[id].pos, z });
      if (movable(net, [s.a, s.b]).every((id) => cur.nodes[id].pos.z === z)) commit(withNet(cur));
    },
    setSegmentLength: (segId, length) => {
      const net = get().doc.network;
      const s = net.segments[segId];
      if (!s) return;
      // 動かす端は接続口でない方（b が接続口なら向きを入れ替える）
      if (net.nodes[s.b].fixtureId && !net.nodes[s.a].fixtureId) {
        const swapped = { ...net, segments: { ...net.segments, [segId]: { ...s, a: s.b, b: s.a } } };
        const r = setSegLen(swapped, segId, length);
        if (r !== swapped) commit(withNet({ ...r, segments: { ...r.segments, [segId]: { ...r.segments[segId], a: s.a, b: s.b } } }));
        return;
      }
      if (net.nodes[s.b].fixtureId) return;
      commit(withNet(setSegLen(net, segId, length)));
    },
    addRiserFromNode: (nodeId, target) => {
      const { doc, drawHeight, drawAttrs } = get();
      const n = doc.network.nodes[nodeId];
      if (!n) return;
      const floors = doc.building.floors;
      const cur = floors.findIndex((f) => f.id === n.floorId);
      const idx = cur >= 0 ? cur : floorIndexForZ(floors, n.pos.z);
      let z: number;
      let floorId: string | undefined;
      if (target === 'up' || target === 'down') {
        const f = floors[idx + (target === 'up' ? 1 : -1)];
        if (!f) return;
        z = f.elevation + drawHeight;
        floorId = f.id;
      } else z = target;
      const r = addRiser(doc.network, nodeId, z, drawAttrs);
      if (!r) return;
      const net = floorId ? { ...r.net, nodes: { ...r.net.nodes, [r.nodeId]: { ...r.net.nodes[r.nodeId], floorId } } } : r.net;
      commit(withNet(net), { selection: { kind: 'node', id: r.nodeId }, ...(floorId ? { activeFloorId: floorId } : {}) });
    },
    placeFixtureAt: (p) => {
      const { doc, activeFloorId, fixtureType } = get();
      const r = placeFixture(doc, activeFloorId, fixtureType, p);
      if (r.fixtureId) commit(r.doc, { selection: { kind: 'fixture', id: r.fixtureId } });
    },
    rotateFixture: (id) => {
      const f = get().doc.fixtures[id];
      if (f) commit(moveFixture(get().doc, id, f, ((f.rotation + 90) % 360) as Rotation));
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
    // ドラッグ中（beginDrag 後）だけ有効。途中で Undo 等により終了したドラッグの続きは無視する
    dragNode: (nodeId, pos) => {
      if (get().dragBase && !get().doc.network.nodes[nodeId]?.fixtureId) set({ doc: withNet(moveNode(get().doc.network, nodeId, pos)) });
    },
    dragSegment: (segId, d) => {
      const base = get().dragBase;
      const s = base?.network.segments[segId];
      if (!base || !s) return;
      const ids = movable(base.network, [s.a, s.b]);
      if (ids.length) set({ doc: { ...get().doc, network: translateNodes(base.network, ids, d) } });
    },
    dragFixture: (id, p) => { if (get().dragBase) set({ doc: moveFixture(get().doc, id, p) }); },
    dropNode: (nodeId, target) => {
      const net = get().doc.network;
      if (!get().dragBase || !target || !net.nodes[nodeId]) return;
      const next = target.type === 'node' ? mergeNodes(net, target.id, nodeId) : connectNodeToSegment(net, nodeId, target.id);
      if (next !== net) set({ doc: withNet(next), selection: null });
    },
    dragCorner: (cornerId, p) => { if (get().dragBase) set({ doc: withBld(B.moveCorner(get().doc.building, cornerId, p)) }); },
    dragWall: (wallId, dx, dy) => {
      const base = get().dragBase;
      if (base) set({ doc: { ...get().doc, building: B.moveWall(base.building, wallId, dx, dy) } });
    },
    endDrag: () => {
      const { dragBase, doc, past } = get();
      if (!dragBase) return;
      const changed = dragBase.building !== doc.building || dragBase.network !== doc.network || dragBase.fixtures !== doc.fixtures;
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
      if (withWall) for (const [p0, p1] of r.cuts) b = B.addWall(b, b.rooms[r.roomIds[0]].floorId, p0, p1).b;
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
    updateFloor: (id, patch) => {
      const nb = B.updateFloor(get().doc.building, id, patch);
      if (nb === get().doc.building) return;
      const next = withFloors(nb);
      if (next) commit(next);
    },
    deleteFloor: (id) => {
      const nb = B.deleteFloor(get().doc.building, id);
      if (nb === get().doc.building) return;
      const next = withFloors(nb, id);
      if (next) commit(next, { activeFloorId: fixActiveFloor(next, get().activeFloorId), selection: null });
    },
    deleteSelected: () => {
      const sel = get().selection;
      if (!sel) return;
      const { building, network } = get().doc;
      let next: Doc | null = null;
      if (sel.kind === 'segment') next = withNet(deleteSegment(network, sel.id));
      else if (sel.kind === 'node') next = withNet(deleteFitting(network, sel.id));
      else if (sel.kind === 'fixture') next = deleteFixture(get().doc, sel.id);
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
      set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], revision: get().revision + 1, selection: null, pendingMerge: null, activeFloorId: fixActiveFloor(prev, get().activeFloorId) });
    },
    redo: () => {
      get().endDrag();
      const { past, doc, future } = get();
      const next = future[0];
      if (!next) return;
      set({ doc: next, past: [...past, doc], future: future.slice(1), revision: get().revision + 1, selection: null, pendingMerge: null, activeFloorId: fixActiveFloor(next, get().activeFloorId) });
    },
  };

});

const midpoint = (net: Network, a: string, b: string): Vec3 => {
  const p = net.nodes[a].pos, q = net.nodes[b].pos;
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: (p.z + q.z) / 2 };
};

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
