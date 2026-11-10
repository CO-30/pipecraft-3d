/**
 * 共通ストア。2D/3D の両ビューはここだけを読み書きする（データの二重管理なし）。
 * 建物と配管は1つの Doc として、1本の Undo/Redo 履歴で管理する。
 */
import { create } from 'zustand';
import {
  addPolyline, addRiser, branchFromSegment, collectBranch, connectNodeToSegment, connectedComponent, cutSegment, deleteBranch,
  deleteFitting, deleteSegment, deleteSegments, detachNode, duplicateSegments, emptyNetwork, insertValve, mergeNodes, moveNode,
  setSegmentLength as setSegLen, translateNodes, validateNetwork, projectOnSegment, splitSegment,
  detachSegmentEnd as detachSegEnd, type Network, type Segment, type SegmentAttrs, type SystemType, type Vec3,
} from '../model/network';
import type { Doc, SiteSettings } from '../model/doc';
import { DEFAULT_DROP_DEPTH, DROP_MAX, DROP_MIN, dropFixturePipes as dropPipes } from '../model/dropPipes';
import { routeDrainsOut as routeDrains } from '../model/drainRoute';
import { deleteFixture, isManhole, moveFixture, placeFixture, syncAllFixturePorts, type FixtureParams, type FixtureType, type Rotation } from '../model/fixtures';
import { floorIndexForZ, followFloors, tagNodeFloors } from '../model/pipeFloors';
import * as B from '../model/building';
import type { Building, OpeningType, Vec2 } from '../model/building';
import { mergeRooms, splitRoom } from '../model/roomOps';
import { clampSection, defaultSectionValue, type Section, type SectionMode } from '../model/section';
import { estimateSchema, SCHEMA_VERSION, type ProjectData } from '../model/schema';
import type { BoxCategory } from '../model/building3d';
import { defaultEstimate, type EstimateSettings, type ExtraItem, type PriceItem } from '../model/estimate';
import { newId } from '../model/id';
import type { FittingChoice } from '../model/fittings';
import { applySlope, defaultSlope, downstreamEnd, isDrain, planLength, propagateLockedSlopes, setSlopeRatio } from '../model/slope';
import { connectToCandidate, findConnectCandidate } from '../model/connect';
import { portCandidates, routeToPort } from '../model/portRoute';
import { canJoin, conflictAt, conflictBetween, conflictMessage, nodeAttrs, SYSTEM_NAME } from '../model/systems';
import { MAX_UNDERLAY_SRC, MAX_UNDERLAYS_TOTAL, applyPaperScale, rescaleByTwoPoints, type Underlay } from '../model/underlay';
import { applyMount, elevationFromWall, elevToWorld, pipeDepth, worldToElev, type Elevation, type UV } from '../model/elevation';
import { isWire } from '../model/fittings';
import { elevationSchema } from '../model/schema';
import { applyDetour, findHits, markPenetration, type DetourStyle } from '../model/obstacles';
import { addFaceMember, addFaceStair, bumpFace, deleteMember, faceWallAt, MEMBER_LABEL, updateMember, type FaceRect, type Member, type MemberKind } from '../model/members';
import { addOutlineWalls, applyOutlineLength, copyOutlineToEmptyFloors, outlineLoop, straightenOutline, type FixedEnd, type OutlineLengthResult } from '../model/sketch';

export type { Doc };
export type Tool = 'select' | 'outline' | 'pipe' | 'wall' | 'room' | 'split' | 'door' | 'window' | 'fixture' | 'underlay';
export type SelKind = 'segment' | 'node' | 'wall' | 'corner' | 'opening' | 'room' | 'fixture' | 'member';
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
  { id: 'ceiling', label: '天井' }, { id: 'door', label: 'ドア' }, { id: 'window', label: '窓' }, { id: 'member', label: '梁・軒・バルコニー・階段' }, { id: 'pipes', label: '配管・配線' },
  { id: 'fixtures', label: '設備機器' },
];
export type VisPreset = 'all' | 'building' | 'pipes' | 'fixtures';
/** 表示のプリセット（「配管だけ」など）。見たいものを表示、その他は半透明（建物だけは配管・器具を隠す）。天井はいつも非表示 */
export function presetVisibility(p: VisPreset): Record<VisCategory, VisMode> {
  const v = defaultVisibility();
  if (p === 'all') return v;
  const building: VisCategory[] = ['exteriorWall', 'interiorWall', 'floor', 'door', 'window', 'member'];
  const out = { ...v };
  for (const c of building) out[c] = p === 'building' ? 'show' : 'ghost';
  out.pipes = p === 'pipes' ? 'show' : p === 'building' ? 'hide' : 'ghost';
  out.fixtures = p === 'fixtures' ? 'show' : p === 'building' ? 'hide' : 'ghost';
  return out;
}
const defaultVisibility = (): Record<VisCategory, VisMode> => ({
  exteriorWall: 'show', interiorWall: 'show', floor: 'show', ceiling: 'hide', door: 'show', window: 'show', member: 'show', pipes: 'show', fixtures: 'show',
});

/** 勾配の下流判定に使う流末: 公共マスの接続口（無ければ他のマス） */
const manholeAt = (doc: Doc, nodeId: string) => {
  const fid = doc.network.nodes[nodeId]?.fixtureId;
  const f = fid ? doc.fixtures[fid] : undefined;
  return f && isManhole(f.type) ? f : undefined;
};
const isOutletNode = (doc: Doc, nodeId: string): boolean => {
  const f = manholeAt(doc, nodeId);
  if (!f) return false;
  // 公共マスがどこかにあれば公共マスだけを流末にする（マス間の区間で向きが決まるように）
  const hasPublic = Object.values(doc.fixtures).some((x) => x.type.startsWith('public'));
  return hasPublic ? f.type.startsWith('public') : true;
};
const defaultSlopeFor = (diameter: number) => defaultSlope(diameter);
const lockedCount = (net: Network) => Object.values(net.segments).filter((x) => x.slopeLocked).length;
const UNLOCK_NOTICE = '勾配を保てない区間の固定を外しました（区間を選ぶと勾配を付け直せます）';

export const emptyDoc = (): Doc => ({ building: B.addFloor(B.emptyBuilding()).b, network: emptyNetwork(), fixtures: {}, estimate: defaultEstimate(), underlays: {}, elevations: {}, site: {} });

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

  // 立面（外壁）
  /** 表示中の立面（null = 平面図） */
  activeElevationId: string | null;
  openElevation(id: string | null): void;
  /** 立面を追加して開く。だめなら理由 */
  /** createWall: 壁がない現場で、この寸法の外壁を1枚作ってその外側の立面にする（履歴1件） */
  addElevation(el: Elevation, opts?: { createWall?: boolean }): string | null;
  /** 取付を変えたら、その面に描いた配管の位置・支持金具も変える */
  updateElevation(id: string, patch: Partial<Pick<Elevation, 'label' | 'width' | 'height' | 'mount' | 'opacity' | 'photo'>>): string | null;
  deleteElevation(id: string): void;
  /** 立面上の折れ線（u,v）を壁の外側に配管として描く */
  drawOnFace(elId: string, pts: UV[], opts?: { startNodeId?: string; startSegId?: string; endNodeId?: string; endSegId?: string }): void;
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
  /** 図面から読んだ器具の候補をまとめて置く（1 回の取り消しで戻せる）。置けた数を返す */
  placeFixtureCandidates(list: { floorId: string; type: FixtureType; x: number; y: number; rotation: Rotation }[]): number;
  /** 器具の真下に配管を落とす（床から depth mm 下。屋外の器具は地中）。作った本数を返す */
  dropFixturePipes(depth?: number): number;
  /** 床下へ落とした排水を、外壁の外に置いた汚水マスまでつなぐ（案）。つないだ本数を返す */
  routeDrainsOut(): number;
  // 設備機器
  placeFixtureAt(p: Vec2): void;
  rotateFixture(id: string): void;
  setNodeHeight(nodeId: string, z: number): void;
  updateSegment(segId: string, patch: Partial<SegmentAttrs>): void;
  deleteSelectedBranch(): void;

  /** 画面に短く出すお知らせ（つなげない配管など）。表示専用 */
  notice: string | null;
  clearNotice(): void;
  // 下敷き
  /** 操作対象の下敷き（表示状態。保存しない） */
  activeUnderlayId: string | null;
  /** 下敷きを表示するか（表示専用） */
  showUnderlays: boolean;
  setShowUnderlays(v: boolean): void;
  /** 2点で縮尺: 指定済みの点（図面座標） */
  scalePick: { id: string; pts: Vec2[] } | null;
  setActiveUnderlay(id: string | null): void;
  addUnderlay(u: Omit<Underlay, 'id'>): string;
  updateUnderlay(id: string, patch: Partial<Pick<Underlay, 'label' | 'opacity' | 'rotation' | 'center' | 'mmPerPx'>>): void;
  /** PDF 図面の縮尺（1/n）を選び直す */
  setUnderlayPaperScale(id: string, n: number): void;
  deleteUnderlay(id: string): void;
  dragUnderlay(id: string, dx: number, dy: number): void;
  /** スライダー操作中の見た目だけの変更（beginDrag〜endDrag で履歴1件） */
  dragUnderlayOpacity(id: string, opacity: number): void;
  startScalePick(id: string): void;
  addScalePoint(p: Vec2): void;
  cancelScalePick(): void;
  /** 2点の実寸(mm)で縮尺を確定 */
  applyScale(realMm: number): boolean;
  /** 建物外形（外壁）と下敷きを1操作で取り込む。外壁が作れなかった辺の数を返す */
  importSite(opts: { polygon?: Vec2[]; underlay?: Omit<Underlay, 'id'> }): { walls: number; failed: number } | null;
  /** 写真から作った開口部を1操作で追加。作れなかった数を返す */
  addOpeningsBatch(wallId: string, list: { type: OpeningType; offset: number; width: number; height: number; sill: number }[]): { added: number; failed: number; failedIdx: number[] };

  // 積算
  /** 実測長(mm)。undefined で削除（モデル長に戻す） */
  setSegmentMeasured(segId: string, mm: number | undefined): void;
  /** 区間ごとの余長率。undefined で現場の既定値に戻す */
  setSegmentExtraRate(segId: string, rate: number | undefined): void;
  /** 部品の確定。undefined で自動判定に戻す */
  setNodeFitting(nodeId: string, type: FittingChoice | undefined): void;
  /** 選んだ端点・接続口を一番近いつなげる配管へつなぐ（履歴1件） */
  connectNearest(nodeId: string): void;
  /** 区間の片方の端だけを外す */
  detachSegmentEnd(segId: string, end: 'a' | 'b'): void;
  /** 排水: この点を流末にして勾配をつける（'auto' = 管径別の最小勾配）。履歴1件 */
  setSlopeFromOutlet(nodeId: string, slope: number | 'auto'): void;
  // 申請図面
  /** 現場設定（設計GL・自治体プロファイル）。履歴1件 */
  updateSite(patch: Partial<SiteSettings>): void;
  /** 区間の設計勾配 1/denominator を設定して固定し、下流端の高さを決める。だめならお知らせ */
  setSegmentSlope(segId: string, denominator: number): void;
  setSegmentSlopeLocked(segId: string, locked: boolean): void;
  /** マスの口径・形状・管底高。履歴1件（管底高の変更は接続口と配管の端を動かす） */
  updateFixtureParams(id: string, patch: Partial<FixtureParams>): void;
  /** 区間の支持金具・取付下地（undefined = 自動・現場の既定） */
  setSegmentSupport(segId: string, patch: { support?: 'saddle' | 'levelBand' | 'tBracket' | 'none' | null; substrate?: 'concrete' | 'wood' | null }): void;
  updateEstimate(patch: Partial<Omit<EstimateSettings, 'prices' | 'extras'>>): void;
  setPrice(key: string, item: PriceItem | undefined): void;
  addExtraItem(): void;
  updateExtraItem(id: string, patch: Partial<Omit<ExtraItem, 'id'>>): void;
  removeExtraItem(id: string): void;

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
  /** ドラッグを取り消して開始前に戻す（ピンチへの切替・ジェスチャーのキャンセル） */
  cancelDrag(): void;

  // 建物
  addWall(p: Vec2, q: Vec2): void;
  /** 手描きの外形から外壁（寸法未確定）を作り、壁のない他の階にもコピー。成功で寸法入力を開く */
  sketchOutline(raw: Vec2[], tolerance: number): boolean;
  /** 外形の辺に実測の長さを入れる（確定済みの辺を保護。force で強行） */
  setOutlineLength(wallId: string, mm: number, fixed: FixedEnd, force?: boolean): OutlineLengthResult;
  /** 立面で描く対象: 配管 / 建物（窓・ドア・梁・軒・バルコニー・張り出し・階段） */
  elevDraw: 'pipe' | 'build';
  setElevDraw(m: 'pipe' | 'build'): void;
  /** 壁を正面に向けた立面を開く（なければ作る） */
  openWallFace(wallId: string, mode?: 'pipe' | 'build'): string | null;
  /** 立面の四角から 窓・ドア／梁・軒・バルコニー／張り出し・押し込み を作る。失敗はメッセージ */
  addFromFace(elId: string, what: 'door' | 'window' | Exclude<MemberKind, 'stair'> | 'bump' | 'setback', r: FaceRect, size: number): string | null;
  /** 立面の斜め線から外階段 */
  addStairFromFace(elId: string, p: UV, q: UV): string | null;
  updateMember(id: string, patch: Partial<Pick<Member, 'width' | 'z0' | 'z1'>>): void;
  /** 部材にぶつかった区間を迂回する（A 90°×4 / B 45°×4）。失敗はメッセージ */
  avoidObstacle(segId: string, memberId: string, style: DetourStyle): string | null;
  /** 貫通（スリーブ）の印を付け外しする */
  setPenetration(segId: string, memberId: string, on: boolean): void;
  /** 寸法入力（外形の辺を順に）。null で閉じる */
  dimWizard: { floorId: string; index: number } | null;
  openDimWizard(floorId?: string, wallId?: string): boolean;
  setDimIndex(index: number): void;
  closeDimWizard(): void;
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
  /** 配管の端（または接続口）から、つながっていない器具の接続口へ仮のルートでつなぐ（別の階も可） */
  connectToPort(fromId: string, toId: string): void;
  setVisibilityPreset(p: VisPreset): void;
  setElementVisibility(id: string, mode: VisMode): void;
  resetElementVisibility(): void;

  undo(): void;
  redo(): void;
};

export const useStore = create<State>((set, get) => {
  /** 新しい Doc を履歴付きで確定。変化がなければ何もしない */
  const commit = (next: Doc, extra: Partial<State> = {}) => {
    const { doc, past } = get();
    if (next.building === doc.building && next.network === doc.network && next.fixtures === doc.fixtures && next.estimate === doc.estimate && next.underlays === doc.underlays && next.elevations === doc.elevations && next.site === doc.site) return false;
    set({ doc: next, past: [...past, doc].slice(-HISTORY_LIMIT), future: [], revision: get().revision + 1, ...extra });
    // 新しく描いた・動かした配管が梁・軒などにぶつかったらお知らせ
    if (next.network !== doc.network && next.building.members && Object.keys(next.building.members).length) {
      const changed = Object.values(next.network.segments).filter((x) => {
        const o = doc.network.segments[x.id];
        if (!o) return true;
        const pa = doc.network.nodes[o.a]?.pos, pb = doc.network.nodes[o.b]?.pos, qa = next.network.nodes[x.a].pos, qb = next.network.nodes[x.b].pos;
        return !pa || !pb || pa.x !== qa.x || pa.y !== qa.y || pa.z !== qa.z || pb.x !== qb.x || pb.y !== qb.y || pb.z !== qb.z;
      }).map((x) => x.id);
      const hits = changed.length ? findHits(next, changed) : [];
      if (hits.length) {
        const kinds = [...new Set(hits.map((h) => MEMBER_LABEL[h.kind]))].join('・');
        const msg = `配管が${kinds}にぶつかっています（区間を選ぶと避け方を選べます）`;
        const cur = get().notice;
        if (!cur?.includes(msg)) set({ notice: [cur, msg].filter(Boolean).join('。') });
      }
    }
    if (get().activeElevationId && !next.elevations?.[get().activeElevationId!]) set({ activeElevationId: null });
    return true;
  };
  /** 新しいノードには所属階を付ける（つながった同じ高さのノード → 現在の階 → 高さから判定） */
  const withNet = (network: Network): Doc => {
    const { doc, activeFloorId } = get();
    return network === doc.network ? doc : { ...doc, network: tagNodeFloors(network, doc.building.floors, activeFloorId) };
  };
  /** 配管ノードのうち、設備の接続口でないもの（接続口は器具と一緒にしか動かさない） */
  const movable = (net: Network, ids: string[]) => ids.filter((id) => net.nodes[id] && !net.nodes[id].fixtureId);
  /** 下敷きを追加できるか（大きさ・合計）。だめなら理由 */
  const underlayRoom = (src: string, excludeElevationId?: string): string | null => {
    if (src.length > MAX_UNDERLAY_SRC) return '画像が大きすぎて保存できません';
    const total = Object.values(get().doc.underlays ?? {}).reduce((a, x) => a + x.src.length, 0)
      + Object.values(get().doc.elevations ?? {}).reduce((a, x) => a + (x.id === excludeElevationId ? 0 : x.photo?.src.length ?? 0), 0);
    return total + src.length > MAX_UNDERLAYS_TOTAL ? 'この現場の下敷きが多すぎます。不要な下敷きを削除してください' : null;
  };
  /** 描画の終点を既存の配管につなぐ前に種類を確認。つなげないなら接続しない */
  const checkEnd = (system: SystemType, endNodeId?: string, endSegId?: string): { endNodeId?: string; endSegId?: string; notice?: string } => {
    const { network: net, fixtures } = get().doc;
    if (endNodeId) {
      const c = conflictAt(net, fixtures, endNodeId, system);
      if (c) return { notice: `${conflictMessage(system, c)}（終点は接続していません）` };
    }
    if (endSegId && net.segments[endSegId] && !canJoin(net.segments[endSegId].system, system)) {
      return { endNodeId, notice: `${conflictMessage(system, net.segments[endSegId].system)}（終点は接続していません）` };
    }
    return { endNodeId, endSegId };
  };
  const connectEnd = (net: Network, endNodeId: string | undefined, endSegId?: string) =>
    endNodeId && endSegId && net.segments[endSegId] ? connectNodeToSegment(net, endNodeId, endSegId) : net;
  /** 建物の階が変わったときに配管・器具を追従させる。配管が壊れる場合は null */
  const withFloors = (nextBld: Building, removedFloorId?: string): Doc | null => {
    let doc: Doc = get().doc;
    if (removedFloorId) {
      for (const f of Object.values(doc.fixtures)) if (f.floorId === removedFloorId) doc = deleteFixture(doc, f.id);
      if (doc.underlays) doc = { ...doc, underlays: Object.fromEntries(Object.entries(doc.underlays).filter(([, u]) => u.floorId !== removedFloorId)) };
      if (doc.elevations) doc = { ...doc, elevations: Object.fromEntries(Object.entries(doc.elevations).filter(([, e]) => e.floorId !== removedFloorId)) };
    }
    const network = followFloors(doc.network, doc.building.floors, nextBld.floors);
    const next = syncAllFixturePorts({ ...doc, building: nextBld, network });
    return validateNetwork(next.network).length ? null : next;
  };
  /** 折れ線を配管として描く（既存の配管から始めるときは種類の確認・引き継ぎ、終点の接続確認つき）。extra: 区間に付ける追加の属性 */
  const drawCore = (points: Vec3[], base: SegmentAttrs, opts?: { startNodeId?: string; endNodeId?: string; endSegId?: string }, extra: Partial<Segment> = {}, startNet?: Network) => {
    if (points.length < 2) return;
    const doc0 = get().doc;
    const doc = startNet ? { ...doc0, network: startNet } : doc0;
    let attrs = base;
    let notice: string | null = null;
    // 既存の配管・接続口から描き始めたら、つながらない種類のときはその配管の種類で描く
    if (opts?.startNodeId) {
      const na = nodeAttrs(doc.network, doc.fixtures, opts.startNodeId);
      const bad = na.systems.find((x) => !canJoin(x, attrs.system));
      if (bad && na.attrs) {
        notice = `${SYSTEM_NAME[attrs.system]}は${SYSTEM_NAME[bad]}につなげないため、${SYSTEM_NAME[na.attrs.system]}として描きました`;
        attrs = na.attrs;
      }
    }
    const end = checkEnd(attrs.system, opts?.endNodeId, opts?.endSegId);
    const r = addPolyline(doc.network, points, { ...attrs, ...extra } as SegmentAttrs, { startNodeId: opts?.startNodeId, endNodeId: end.endNodeId });
    const last = r.segmentIds.at(-1);
    if (!last) return;
    const net = connectEnd(r.net, r.nodeIds.at(-1), end.endSegId);
    commit(withNet(net), { selection: net.segments[last] ? { kind: 'segment', id: last } : null, notice: [notice, end.notice].filter(Boolean).join('。') || null });
  };
  const withBld = (building: Building): Doc => ({ ...get().doc, building });
  /** 表示中の立面が（Undo・階の削除などで）無くなったら平面図へ */
  /** Undo/Redo 後も外壁が1周つながっていれば寸法入力を続ける（その辺を選び直す） */
  const fixDim = (doc: Doc): Partial<State> => {
    const w = get().dimWizard;
    const loop = w && outlineLoop(doc.building, w.floorId);
    if (!w || !loop) return { dimWizard: null };
    const index = Math.min(w.index, loop.walls.length - 1);
    return { dimWizard: { ...w, index }, selection: { kind: 'wall', id: loop.walls[index] } };
  };
  const fixElev = (doc: Doc) => { const id = get().activeElevationId; return id && doc.elevations?.[id] ? id : null; };
  const fixActiveFloor = (doc: Doc, preferred: string) =>
    doc.building.floors.some((f) => f.id === preferred) ? preferred : doc.building.floors[0]?.id ?? '';
  const resetView = (doc: Doc): Partial<State> => ({
    past: [], future: [], dragBase: null, selection: null, hiddenIds: [], ghostIds: [], pendingMerge: null,
    section: { mode: 'off', value: 0 }, floorFilter: 'all', activeUnderlayId: null, scalePick: null, activeElevationId: null,
    activeFloorId: doc.building.floors[0]?.id ?? '', tool: 'select', revision: get().revision + 1, dimWizard: null,
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
    dimWizard: null,
    elevDraw: 'pipe',
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
      const doc = { building: p.building, network: p.network, fixtures: p.fixtures, estimate: p.estimate, underlays: p.underlays, elevations: p.elevations ?? {}, site: p.site ?? {} };
      set({ doc, meta: { id: p.id, name: p.name, address: p.address, createdAt: p.createdAt }, ...resetView(doc) });
    },
    newDoc: (doc, meta) => set({ doc: { underlays: {}, elevations: {}, site: {}, ...doc }, meta, ...resetView(doc) }),
    closeProject: () => set({ meta: null, selection: null, dragBase: null, activeElevationId: null }),
    toProjectData: () => {
      const { meta, doc } = get();
      if (!meta) return null;
      return { schemaVersion: SCHEMA_VERSION, ...meta, updatedAt: Date.now(), building: doc.building, network: doc.network, fixtures: doc.fixtures, estimate: doc.estimate ?? defaultEstimate(), underlays: doc.underlays ?? {}, elevations: doc.elevations ?? {}, site: doc.site ?? {} };
    },
    renameProject: (name, address) => {
      const m = get().meta;
      if (m) set({ meta: { ...m, name, address }, revision: get().revision + 1 });
    },

    setTool: (tool) => set({ tool, pendingMerge: null, ...(tool === 'pipe' ? { elevDraw: 'pipe' as const } : {}), ...(tool !== 'underlay' ? { scalePick: null } : {}) }),
    setDrawAttrs: (a) => set({ drawAttrs: { ...get().drawAttrs, ...a } }),
    setDrawHeight: (drawHeight) => set({ drawHeight }),
    setOrthoSnap: (orthoSnap) => set({ orthoSnap }),
    select: (selection) => set({ selection }),
    setActiveFloor: (activeFloorId) => set({ activeFloorId, selection: null, pendingMerge: null, ...(get().dimWizard?.floorId !== activeFloorId ? { dimWizard: null } : {}) }),

    drawPolyline: (points, opts) => drawCore(points, get().drawAttrs, opts),
    activeElevationId: null,
    openElevation: (id) => { const ok = !!(id && get().doc.elevations?.[id]); set({ activeElevationId: ok ? id : null, selection: null, pendingMerge: null, ...(ok ? { tool: 'pipe' as Tool, elevDraw: 'pipe' as const } : {}) }); },
    addElevation: (el0, opts) => {
      let el = el0;
      if (!elevationSchema.safeParse(el).success) return '立面の寸法が正しくありません';
      if (!get().doc.building.floors.some((f) => f.id === el.floorId)) return '階が見つかりません';
      if (el.photo) { const r = underlayRoom(el.photo.src); if (r) return r; }
      const doc = get().doc;
      let building = doc.building;
      if (opts?.createWall) {
        const r = B.addWall(building, el.floorId, { x: 0, y: 0 }, { x: el.width, y: 0 }, { kind: 'exterior' });
        if (!r.wallIds[0]) return '外壁を作れませんでした（既存の壁と重なっています）';
        building = r.b;
        const g = elevationFromWall(building, r.wallIds[0], { width: el.width, height: el.height });
        el = { ...el, wallId: g.wallId, origin: g.origin, dir: g.dir, normal: g.normal, faceOffset: g.faceOffset, baseZ: g.baseZ, label: g.label };
      }
      commit({ ...doc, building, elevations: { ...(doc.elevations ?? {}), [el.id]: el } }, { activeElevationId: el.id, selection: null, tool: 'pipe', elevDraw: 'pipe' });
      return null;
    },
    updateElevation: (id, patch) => {
      const doc = get().doc;
      const cur = doc.elevations?.[id];
      if (!cur) return '立面が見つかりません';
      const next = { ...cur, ...patch };
      if (!elevationSchema.safeParse(next).success) return '値が正しくありません';
      if (patch.photo && patch.photo.src !== cur.photo?.src) { const r = underlayRoom(patch.photo.src, id); if (r) return r; }
      const elevations = { ...doc.elevations, [id]: next };
      const mountChanged = patch.mount && (patch.mount.type !== cur.mount.type || patch.mount.standoff !== cur.mount.standoff);
      const network = mountChanged ? applyMount(doc.network, next) : doc.network;
      if (!network) return 'この取付にすると配管どうしが重なるため変更できません';
      commit({ ...withNet(network), elevations });
      return null;
    },
    deleteElevation: (id) => {
      const doc = get().doc;
      if (!doc.elevations?.[id]) return;
      const elevations = { ...doc.elevations };
      delete elevations[id];
      // その面で描いた配管は残し、面とのひも付けだけ外す
      let segments = doc.network.segments;
      for (const s of Object.values(segments)) if (s.face === id) {
        if (segments === doc.network.segments) segments = { ...segments };
        const t = { ...s }; delete t.face; segments[s.id] = t;
      }
      const network = segments === doc.network.segments ? doc.network : { ...doc.network, segments };
      commit({ ...doc, network, elevations }, { activeElevationId: get().activeElevationId === id ? null : get().activeElevationId, selection: null });
    },
    drawOnFace: (elId, pts, opts) => {
      const el = get().doc.elevations?.[elId];
      if (!el || pts.length < 2) return;
      const attrs = get().drawAttrs;
      const net = get().doc.network;
      // 既存の配管につなぐときは、その配管と同じ壁からの距離で描く（口径が違っても斜めにしない）
      const startPos = opts?.startNodeId ? net.nodes[opts.startNodeId]?.pos : opts?.startSegId && net.segments[opts.startSegId] ? net.nodes[net.segments[opts.startSegId].a].pos : undefined;
      const depth = startPos ? worldToElev(el, startPos).depth : pipeDepth(el, attrs.diameter);
      const points = pts.map((p) => elevToWorld(el, p.u, p.v, attrs.diameter, depth));
      // 配線は支持金具の対象外（取付の自動判定に任せる）
      const extra = isWire(attrs.system) ? { face: el.id } : { face: el.id, support: el.mount.type };
      // 既存の配管の途中から描き始めたら、そこで分けて分岐にする（履歴は1件）
      if (opts?.startSegId && net.segments[opts.startSegId]) {
        const at = projectOnSegment(net, opts.startSegId, points[0]);
        if (at.t > 0.001 && at.t < 0.999) {
          const sp = splitSegment(net, opts.startSegId, at.pos);
          points[0] = sp.net.nodes[sp.nodeId].pos;
          drawCore(points, attrs, { ...opts, startNodeId: sp.nodeId }, extra, sp.net);
          return;
        }
      }
      drawCore(points, attrs, opts, extra);
    },
    branch: (segId, at, path, opts) => {
      const base = get().doc.network.segments[segId];
      if (!base || path.length < 1) return;
      const end = checkEnd(base.system, opts?.endNodeId, opts?.endSegId);
      const r = branchFromSegment(get().doc.network, segId, at, path);
      const last = r.branchSegmentIds.at(-1);
      if (!last) return;
      let net = r.net;
      const endId = net.segments[last].b; // addPolyline は前のノード→新しいノードの順で区間を作る
      if (end.endNodeId && net.nodes[end.endNodeId] && endId !== end.endNodeId) net = mergeNodes(net, end.endNodeId, endId);
      else net = connectEnd(net, endId, end.endSegId);
      commit(withNet(net), { selection: net.segments[last] ? { kind: 'segment', id: last } : null, notice: end.notice });
    },
    notice: null,
    clearNotice: () => set({ notice: null }),
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
      // 立て管は元の配管（接続口）と同じ種類・口径で作る
      const r = addRiser(doc.network, nodeId, z, nodeAttrs(doc.network, doc.fixtures, nodeId).attrs ?? drawAttrs);
      if (!r) return;
      const net = floorId ? { ...r.net, nodes: { ...r.net.nodes, [r.nodeId]: { ...r.net.nodes[r.nodeId], floorId } } } : r.net;
      commit(withNet(net), { selection: { kind: 'node', id: r.nodeId }, ...(floorId ? { activeFloorId: floorId } : {}) });
    },
    placeFixtureCandidates: (list) => {
      let doc = get().doc, n = 0;
      for (const c of list) {
        const r = placeFixture(doc, c.floorId, c.type, { x: c.x, y: c.y }, c.rotation);
        if (r.fixtureId) { doc = r.doc; n++; }
      }
      if (n) commit(doc, { selection: null, notice: `器具を ${n} 個置きました。位置は目安です。下の図面の絵に合わせてドラッグで動かしてください` });
      return n;
    },
    dropFixturePipes: (depth) => {
      const d = Math.max(DROP_MIN, Math.min(DROP_MAX, Math.round(depth ?? DEFAULT_DROP_DEPTH)));
      const r = dropPipes(get().doc, d);
      // withNet: 新しい点にどの階の配管かを付ける（他の配管の操作と同じ）
      if (r.pipes) commit(withNet(r.doc.network), { selection: null, notice: `${r.fixtures} 個の器具から ${r.pipes} 本の配管を真下（床から ${d}mm 下）へ落としました。3D では表示（スマホは 👁）を「配管だけ」「設備だけ」にすると床下が見えます` });
      else set({ notice: '落とせる配管がありません（器具が無いか、すでに配管がつながっています）' });
      return r.pipes;
    },
    routeDrainsOut: () => {
      const r = routeDrains(get().doc);
      if (!r.pipes) {
        set({ notice: r.skipped ? '出口を決められませんでした（外壁が途切れている・器具が建物の外にある・置いてあるマスの管底が配管より高い、など）。配管の道具でつないでください' : 'つなぐ排水がありません。先に「器具の真下に配管を落とす」を押してください' });
        return 0;
      }
      const parts = [`排水 ${r.pipes} 本を外の汚水マス${r.manholes ? `（新しく ${r.manholes} 個）` : ''}へつなぎました（案）`, r.sleeves ? `基礎の立上りの貫通 ${r.sleeves} か所` : '', r.skipped ? `${r.skipped} 本は出口を決められず、そのままです` : '', 'マスの位置（敷地境界・他の設備との離れ）・マスどうしの接続・勾配は現場に合わせて直してください'];
      commit({ ...r.doc, network: tagNodeFloors(r.doc.network, r.doc.building.floors, get().activeFloorId) }, { selection: null, notice: parts.filter(Boolean).join('。') });
      return r.pipes;
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
      const net = get().doc.network, n = net.nodes[nodeId];
      // 設備の接続口の高さは器具で決まるので単独では変えない
      if (!n || n.fixtureId) return;
      const next = propagateLockedSlopes(net, moveNode(net, nodeId, { ...n.pos, z }), nodeId);
      commit(withNet(next), lockedCount(next) < lockedCount(net) ? { notice: UNLOCK_NOTICE } : {});
    },
    updateSite: (patch) => {
      const doc = get().doc;
      let next: Doc = { ...doc, site: { ...doc.site, ...patch } };
      // 設計GL が変わると、管底高が既定（GL−600）のマスの接続口が動く。固定勾配の区間も追従させる
      if ('designGL' in patch && patch.designGL !== doc.site?.designGL) {
        next = syncAllFixturePorts(next);
        let network = next.network;
        for (const n of Object.values(network.nodes)) if (n.fixtureId && n.pos.z !== doc.network.nodes[n.id]?.pos.z) network = propagateLockedSlopes(doc.network, network, n.id);
        next = network === next.network ? next : { ...next, network };
      }
      commit(next, lockedCount(next.network) < lockedCount(doc.network) ? { notice: UNLOCK_NOTICE } : {});
    },
    updateFixtureParams: (id, patch) => {
      const doc = get().doc, f = doc.fixtures[id];
      if (!f) return;
      if (patch.diameter !== undefined && !(patch.diameter > 0)) return;
      const next = moveFixture(doc, id, f, undefined, patch);
      if (next === doc) { set({ notice: '管底高を変えると配管がつながらなくなります' }); return; }
      // 管底が動いたら、固定勾配の区間の上流端も追従させる
      let network = next.network;
      // 管底（または落差）が変わったら、固定勾配の区間の上流端も追従させる
      for (const n of Object.values(next.network.nodes)) if (n.fixtureId === id && (n.pos.z !== doc.network.nodes[n.id]?.pos.z || n.dropIn !== doc.network.nodes[n.id]?.dropIn)) network = propagateLockedSlopes(doc.network, network, n.id);
      commit(network === next.network ? next : { ...next, network }, lockedCount(network) < lockedCount(doc.network) ? { notice: UNLOCK_NOTICE } : {});
    },
    setSegmentSlope: (segId, denominator) => {
      const net = get().doc.network;
      if (!net.segments[segId] || !(denominator > 0)) return;
      const doc = get().doc, ratio = 1 / denominator;
      const isOutlet = (id: string) => isOutletNode(doc, id);
      const next = setSlopeRatio(net, segId, ratio, isOutlet);
      if (next !== net) {
        // 動いた端から下流へ固定区間を連鎖させる
        const seg0 = net.segments[segId];
        let out = next;
        for (const id of [seg0.a, seg0.b]) if (out.nodes[id].pos.z !== net.nodes[id].pos.z) out = propagateLockedSlopes(net, out, id, { skip: [segId] });
        commit(withNet(out), lockedCount(out) < lockedCount(net) ? { notice: UNLOCK_NOTICE } : {});
        return;
      }
      // 上流端がマス（管底高は器具で決まる）: そのマスの管底高を 下流端 + 勾配×距離 に変える
      const seg = net.segments[segId];
      const down = downstreamEnd(net, seg, isOutlet);
      const upId = down === 'a' ? seg.b : seg.a, downId = down === 'a' ? seg.a : seg.b;
      const upMh = manholeAt(doc, upId);
      if (upMh) {
        const z = Math.round((net.nodes[downId].pos.z + ratio * planLength(net, seg)) * 10) / 10;
        const moved = moveFixture(doc, upMh.id, upMh, undefined, { invertZ: z });
        if (moved !== doc) {
          let mnet: Network = { ...moved.network, segments: { ...moved.network.segments, [segId]: { ...moved.network.segments[segId], slope: ratio, slopeLocked: true } } };
          // 動いたマスの管底につながる他の固定区間も追従させる
          for (const n of Object.values(mnet.nodes)) if (n.fixtureId === upMh.id && n.pos.z !== net.nodes[n.id]?.pos.z) mnet = propagateLockedSlopes(net, mnet, n.id, { skip: [segId] });
          commit({ ...moved, network: mnet }, lockedCount(mnet) < lockedCount(net) ? { notice: UNLOCK_NOTICE } : {});
          return;
        }
      }
      set({ notice: '勾配をつけると配管がつながらなくなります（端の高さを確認してください）' });
    },
    setSegmentSlopeLocked: (segId, locked) => {
      const net = get().doc.network, s = net.segments[segId];
      if (!s || !!s.slopeLocked === locked) return;
      if (locked) { get().setSegmentSlope(segId, s.slope ? Math.round(1 / s.slope) : Math.round(1 / defaultSlopeFor(s.diameter))); return; }
      commit(withNet({ ...net, segments: { ...net.segments, [segId]: { ...s, slopeLocked: false } } }));
    },
    updateSegment: (segId, patch) => {
      const net = get().doc.network;
      const s = net.segments[segId];
      if (!s || (patch.diameter !== undefined && !(patch.diameter > 0))) return;
      commit(withNet({ ...net, segments: { ...net.segments, [segId]: { ...s, ...patch } } }));
    },
    activeUnderlayId: null,
    showUnderlays: true,
    setShowUnderlays: (showUnderlays) => set({ showUnderlays }),
    scalePick: null,
    setActiveUnderlay: (activeUnderlayId) => set({ activeUnderlayId, scalePick: null }),
    addUnderlay: (u) => {
      const id = newId('u');
      const doc = get().doc;
      const room = underlayRoom(u.src);
      if (room) { set({ notice: room }); return ''; }
      commit({ ...doc, underlays: { ...(doc.underlays ?? {}), [id]: { ...u, id } } }, { activeUnderlayId: id });
      return id;
    },
    updateUnderlay: (id, patch) => {
      const doc = get().doc;
      const u = doc.underlays?.[id];
      if (!u) return;
      const n = { ...u, ...patch };
      if (!(n.mmPerPx > 0) || !(n.opacity >= 0 && n.opacity <= 1) || !Number.isFinite(n.rotation)) return;
      if (Object.keys(patch).every((k) => (patch as Record<string, unknown>)[k] === (u as Record<string, unknown>)[k])) return;
      commit({ ...doc, underlays: { ...doc.underlays, [id]: n } });
    },
    setUnderlayPaperScale: (id, n) => {
      const doc = get().doc;
      const u = doc.underlays?.[id];
      const next = u && applyPaperScale(u, n);
      if (!next || (next.mmPerPx === u.mmPerPx && u.scaled)) return;
      commit({ ...doc, underlays: { ...doc.underlays, [id]: next } }, { scalePick: null });
    },
    deleteUnderlay: (id) => {
      const doc = get().doc;
      if (!doc.underlays?.[id]) return;
      const underlays = { ...doc.underlays };
      delete underlays[id];
      commit({ ...doc, underlays }, { activeUnderlayId: get().activeUnderlayId === id ? null : get().activeUnderlayId, scalePick: null });
    },
    dragUnderlay: (id, dx, dy) => {
      const base = get().dragBase;
      const u = base?.underlays?.[id];
      if (!base || !u) return;
      set({ doc: { ...get().doc, underlays: { ...get().doc.underlays, [id]: { ...u, center: { x: u.center.x + dx, y: u.center.y + dy } } } } });
    },
    dragUnderlayOpacity: (id, opacity) => {
      const base = get().dragBase;
      const u = get().doc.underlays?.[id];
      if (!base || !u || !(opacity >= 0 && opacity <= 1)) return;
      set({ doc: { ...get().doc, underlays: { ...get().doc.underlays, [id]: { ...u, opacity } } } });
    },
    startScalePick: (id) => { if (get().doc.underlays?.[id]) set({ scalePick: { id, pts: [] }, activeUnderlayId: id, tool: 'underlay' }); },
    addScalePoint: (p) => {
      const sp = get().scalePick;
      if (sp) set({ scalePick: { ...sp, pts: sp.pts.length >= 2 ? [p] : [...sp.pts, p] } });
    },
    cancelScalePick: () => set({ scalePick: null }),
    applyScale: (realMm) => {
      const sp = get().scalePick;
      const doc = get().doc;
      const u = sp && doc.underlays?.[sp.id];
      if (!sp || !u || sp.pts.length !== 2) return false;
      const n = rescaleByTwoPoints(u, sp.pts[0], sp.pts[1], realMm);
      if (!n) return false;
      commit({ ...doc, underlays: { ...doc.underlays, [u.id]: n } }, { scalePick: null });
      return true;
    },
    importSite: ({ polygon, underlay }) => {
      const doc = get().doc;
      const floorId = get().activeFloorId;
      let b = doc.building, walls = 0, failed = 0;
      if (polygon) {
        polygon.forEach((p, i) => {
          const r = B.addWall(b, floorId, p, polygon[(i + 1) % polygon.length], { kind: 'exterior' });
          if (r.wallIds.length) { b = r.b; walls += r.wallIds.length; } else failed++;
        });
      }
      let underlays = doc.underlays ?? {};
      let activeUnderlayId = get().activeUnderlayId;
      if (underlay) {
        const room = underlayRoom(underlay.src);
        if (room) { set({ notice: room }); return null; }
        const id = newId('u');
        underlays = { ...underlays, [id]: { ...underlay, id } };
        activeUnderlayId = id;
      }
      if (!walls && !underlay) return null;
      commit({ ...doc, building: b, underlays }, { activeUnderlayId, selection: null });
      return { walls, failed };
    },
    addOpeningsBatch: (wallId, list) => {
      let b = get().doc.building, added = 0;
      const failedIdx: number[] = [];
      list.forEach((o, i) => {
        const r = B.addOpening(b, wallId, o.type, o.offset, { width: o.width, height: o.height, sill: o.sill });
        if (r.openingId) { b = r.b; added++; } else failedIdx.push(i);
      });
      if (added) commit(withBld(b), { selection: { kind: 'wall', id: wallId } });
      return { added, failed: failedIdx.length, failedIdx };
    },
    setSegmentMeasured: (segId, mm) => {
      const net = get().doc.network;
      const s = net.segments[segId];
      if (!s || (mm !== undefined && !(Number.isFinite(mm) && mm > 0))) return;
      const { measuredLength: _m, measuredApprox: _a, ...rest } = s;
      if (mm === s.measuredLength && !s.measuredApprox) return;
      const seg: Segment = mm === undefined ? rest : { ...rest, measuredLength: mm };
      commit({ ...get().doc, network: { ...net, segments: { ...net.segments, [segId]: seg } } });
    },
    setSegmentExtraRate: (segId, rate) => {
      const net = get().doc.network;
      const s = net.segments[segId];
      if (!s || (rate !== undefined && !(Number.isFinite(rate) && rate >= 0 && rate <= 10)) || s.extraRate === rate) return;
      const { extraRate: _e, ...rest } = s;
      commit({ ...get().doc, network: { ...net, segments: { ...net.segments, [segId]: rate === undefined ? rest : { ...rest, extraRate: rate } } } });
    },
    setNodeFitting: (nodeId, type) => {
      const net = get().doc.network;
      const n = net.nodes[nodeId];
      if (!n) return;
      const degree = Object.values(net.segments).filter((s) => s.a === nodeId || s.b === nodeId).length;
      const { fitting: _f, ...rest } = n;
      const node = type === undefined ? rest : { ...rest, fitting: { type, degree } };
      if (type === undefined && !n.fitting) return;
      commit({ ...get().doc, network: { ...net, nodes: { ...net.nodes, [nodeId]: node } } });
    },
    connectNearest: (nodeId) => {
      const { network, fixtures } = get().doc;
      const c = findConnectCandidate(network, fixtures, nodeId);
      if (!c) { set({ notice: '近く（60cm以内）につなげる同じ種類の配管がありません' }); return; }
      const next = connectToCandidate(network, nodeId, c);
      if (next === network) { set({ notice: 'この位置ではつなげません（配管が重なる・短すぎるなど）' }); return; }
      commit(withNet(next), { selection: null, notice: c.type === 'segment' ? '配管の途中につなぎました（分岐）' : '配管の端どうしをつなぎました' });
    },
    detachSegmentEnd: (segId, end) => {
      const net = get().doc.network;
      const next = detachSegEnd(net, segId, end);
      if (next === net) { set({ notice: 'この端は外せません（区間が短すぎる・他につながっていない）' }); return; }
      commit(withNet(next), { selection: { kind: 'segment', id: segId } });
    },
    setSlopeFromOutlet: (nodeId, slope) => {
      const r = applySlope(get().doc.network, nodeId, slope);
      if (!r) { set({ notice: '流末には排水の横管の端（立て管・器具とのつなぎ目を含む）を選んでください。横管の途中の点や、配管が重なる場合は変更できません' }); return; }
      commit(withNet(r.net), { notice: `${r.segments}区間に勾配をつけ、${r.nodes}点の高さを変えました` });
    },
    setSegmentSupport: (segId, patch) => {
      const net = get().doc.network;
      const s0 = net.segments[segId];
      if (!s0) return;
      const s = { ...s0 };
      if (patch.support !== undefined) { if (patch.support === null) delete s.support; else s.support = patch.support; }
      if (patch.substrate !== undefined) { if (patch.substrate === null) delete s.substrate; else s.substrate = patch.substrate; }
      if (s.support === s0.support && s.substrate === s0.substrate) return;
      commit({ ...get().doc, network: { ...net, segments: { ...net.segments, [segId]: s } } });
    },
    updateEstimate: (patch) => {
      const doc = get().doc;
      const next = { ...(doc.estimate ?? defaultEstimate()), ...patch };
      // 保存形式の範囲外は受け付けない（保存失敗を防ぐ）
      if (!estimateSchema.safeParse(next).success) return;
      commit({ ...doc, estimate: next });
    },
    setPrice: (key, item) => {
      if (item && !estimateSchema.shape.prices.valueType.safeParse(item).success) return;
      const doc = get().doc;
      const e = doc.estimate ?? defaultEstimate();
      const prices = { ...e.prices };
      if (item) prices[key] = item;
      else delete prices[key];
      commit({ ...doc, estimate: { ...e, prices } });
    },
    addExtraItem: () => {
      const doc = get().doc;
      const e = doc.estimate ?? defaultEstimate();
      commit({ ...doc, estimate: { ...e, extras: [...e.extras, { id: newId('x'), name: 'その他', quantity: 1, unit: '式', unitPrice: 0 }] } });
    },
    updateExtraItem: (id, patch) => {
      const doc = get().doc;
      const e = doc.estimate ?? defaultEstimate();
      if ((patch.quantity !== undefined && !Number.isFinite(patch.quantity)) || (patch.unitPrice !== undefined && !Number.isFinite(patch.unitPrice))) return;
      commit({ ...doc, estimate: { ...e, extras: e.extras.map((x) => (x.id === id ? { ...x, ...patch } : x)) } });
    },
    removeExtraItem: (id) => {
      const doc = get().doc;
      const e = doc.estimate ?? defaultEstimate();
      commit({ ...doc, estimate: { ...e, extras: e.extras.filter((x) => x.id !== id) } });
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
      const base = get().dragBase;
      if (base && !get().doc.network.nodes[nodeId]?.fixtureId) set({ doc: withNet(propagateLockedSlopes(base.network, moveNode(get().doc.network, nodeId, pos), nodeId)) });
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
      const { network: net, fixtures } = get().doc;
      if (!get().dragBase || !target || !net.nodes[nodeId]) return;
      const bad = target.type === 'node'
        ? conflictBetween(net, fixtures, target.id, nodeId)
        : (() => { const t = net.segments[target.id]; const c = t && conflictAt(net, fixtures, nodeId, t.system); return c && t ? [c, t.system] as const : null; })();
      if (bad) { set({ notice: conflictMessage(bad[0], bad[1]) }); return; }
      const next = target.type === 'node' ? mergeNodes(net, target.id, nodeId) : connectNodeToSegment(net, nodeId, target.id);
      if (next !== net) set({ doc: withNet(next), selection: null });
    },
    dragCorner: (cornerId, p) => { if (get().dragBase) set({ doc: withBld(B.moveCorner(get().doc.building, cornerId, p)) }); },
    dragWall: (wallId, dx, dy) => {
      const base = get().dragBase;
      if (base) set({ doc: { ...get().doc, building: B.moveWall(base.building, wallId, dx, dy) } });
    },
    cancelDrag: () => {
      const base = get().dragBase;
      if (base) set({ doc: base, dragBase: null });
    },
    endDrag: () => {
      const { dragBase, doc, past } = get();
      if (!dragBase) return;
      const changed = dragBase.building !== doc.building || dragBase.network !== doc.network || dragBase.fixtures !== doc.fixtures || dragBase.underlays !== doc.underlays || dragBase.elevations !== doc.elevations || dragBase.site !== doc.site;
      set({ dragBase: null, ...(changed ? { past: [...past, dragBase].slice(-HISTORY_LIMIT), future: [], revision: get().revision + 1 } : {}), ...(changed && lockedCount(doc.network) < lockedCount(dragBase.network) ? { notice: UNLOCK_NOTICE } : {}) });
    },

    sketchOutline: (raw, tolerance) => {
      const st = get(), floorId = st.activeFloorId, b0 = st.doc.building;
      if (B.wallsOnFloor(b0, floorId).some((w) => w.kind === 'exterior')) {
        set({ notice: 'この階にはもう外壁があります。描き直すときは外壁を消してからなぞってください' });
        return false;
      }
      const poly = straightenOutline(raw, { tolerance, ortho: st.orthoSnap });
      if (!poly) { set({ notice: '形になりませんでした。建物の外周を1周なぞってください' }); return false; }
      const r = addOutlineWalls(b0, floorId, poly);
      if (!r.wallIds.length) { set({ notice: '外壁を作れませんでした（既存の壁と重なっています）' }); return false; }
      const b = copyOutlineToEmptyFloors(r.b, floorId);
      const copied = b.floors.filter((f) => f.id !== floorId && B.wallsOnFloor(r.b, f.id).length === 0 && B.wallsOnFloor(b, f.id).length > 0).length;
      commit(withBld(b), {
        tool: 'select', selection: null,
        notice: `外形を作りました${copied ? `（${copied}つの上の階にも同じ外壁）` : ''}。実測の寸法を入れましょう`,
      });
      get().openDimWizard(floorId);
      return true;
    },
    setOutlineLength: (wallId, mm, fixed, force = false) => {
      const r = applyOutlineLength(get().doc, wallId, mm, fixed, force);
      if (r.ok) commit(r.doc, { selection: { kind: 'wall', id: wallId } });
      return r;
    },
    openDimWizard: (floorId, wallId) => {
      const f = floorId ?? get().activeFloorId;
      const loop = outlineLoop(get().doc.building, f);
      if (!loop) { set({ notice: '外壁が1周つながっていないため、順番に寸法を入れられません' }); return false; }
      const index = Math.max(0, wallId ? loop.walls.indexOf(wallId) : loop.walls.findIndex((id) => get().doc.building.walls[id].lengthSet === false));
      set({ dimWizard: { floorId: f, index }, activeFloorId: f, tool: 'select', selection: { kind: 'wall', id: loop.walls[index] } });
      return true;
    },
    setDimIndex: (index) => {
      const w = get().dimWizard;
      const loop = w && outlineLoop(get().doc.building, w.floorId);
      if (!w || !loop) { set({ dimWizard: null }); return; }
      const i = ((index % loop.walls.length) + loop.walls.length) % loop.walls.length;
      set({ dimWizard: { ...w, index: i }, selection: { kind: 'wall', id: loop.walls[i] } });
    },
    closeDimWizard: () => set({ dimWizard: null }),
    setElevDraw: (elevDraw) => set({ elevDraw, tool: elevDraw === 'pipe' ? 'pipe' : 'select', selection: null }),
    openWallFace: (wallId, mode = 'build') => {
      const doc = get().doc;
      if (!doc.building.walls[wallId]) return '壁が見つかりません';
      const ex = Object.values(doc.elevations ?? {}).find((e) => e.wallId === wallId);
      if (ex) get().openElevation(ex.id);
      else { const err = get().addElevation(elevationFromWall(doc.building, wallId)); if (err) return err; }
      get().setElevDraw(mode);
      return null;
    },
    addFromFace: (elId, what, r, size) => {
      const doc = get().doc, el = doc.elevations?.[elId];
      if (!el) return '立面が見つかりません';
      const b = doc.building;
      if (what === 'door' || what === 'window') {
        const u0 = Math.min(r.u0, r.u1), u1 = Math.max(r.u0, r.u1), v0 = Math.min(r.v0, r.v1), v1 = Math.max(r.v0, r.v1);
        const fw = faceWallAt(b, el, (u0 + u1) / 2, v0 + 1);
        if (!fw) return '四角を外壁の上に描いてください';
        const f = B.floorById(b, fw.floorId)!;
        const sill = what === 'door' ? 0 : Math.max(0, Math.round(el.baseZ + v0 - f.elevation));
        const height = Math.round(v1 - (what === 'door' ? f.elevation - el.baseZ : v0));
        const res = B.addOpening(b, fw.wall.id, what, fw.offset, { width: Math.round(u1 - u0), height, sill });
        if (!res.openingId) return `${what === 'door' ? 'ドア' : '窓'}を付けられません（壁からはみ出す・天井より高い・他と重なる）`;
        commit(withBld(res.b), { selection: { kind: 'opening', id: res.openingId } });
        return null;
      }
      const res = what === 'bump' || what === 'setback'
        ? bumpFace(b, el, r, what === 'bump' ? size : -size)
        : addFaceMember(b, el, what, r, size);
      if (!res.ok) return res.error;
      let elevations = doc.elevations;
      if (what === 'bump' || what === 'setback') {
        // 立面の元の壁が分割・移動したら、立面をこの面の上の壁に付け替える（面の位置も合わせる）
        const nb = res.b;
        const own = el.wallId ? nb.walls[el.wallId] : undefined;
        let next = el;
        if (own && el.wallId) {
          const g = elevationFromWall(nb, el.wallId);
          next = { ...el, origin: g.origin, dir: g.dir, normal: g.normal };
        } else if (el.wallId) {
          const onFace = B.wallsOnFloor(nb, el.floorId).find((w) => {
            if (w.kind !== 'exterior') return false;
            const da = worldToElev(el, { ...nb.corners[w.a], z: 0 }).depth, db = worldToElev(el, { ...nb.corners[w.b], z: 0 }).depth;
            return Math.abs(da + el.faceOffset) <= 60 && Math.abs(db + el.faceOffset) <= 60;
          });
          next = { ...el, wallId: onFace?.id };
          if (!onFace) delete next.wallId;
        }
        if (next !== el) elevations = { ...elevations, [el.id]: next };
      }
      commit({ ...withBld(res.b), elevations }, { selection: what === 'bump' || what === 'setback' ? null : { kind: 'member', id: res.ids[0] } });
      return null;
    },
    addStairFromFace: (elId, p, q) => {
      const doc = get().doc, el = doc.elevations?.[elId];
      if (!el) return '立面が見つかりません';
      const res = addFaceStair(doc.building, el, p, q);
      if (!res.ok) return res.error;
      commit(withBld(res.b), { selection: { kind: 'member', id: res.ids[0] } });
      return null;
    },
    updateMember: (id, patch) => commit(withBld(updateMember(get().doc.building, id, patch))),
    avoidObstacle: (segId, memberId, style) => {
      const doc = get().doc;
      const hit = findHits(doc, [segId]).find((h) => h.memberId === memberId);
      if (!hit) return 'ぶつかっていません';
      const r = applyDetour(doc, hit, style);
      if (!r.ok) return r.error;
      commit(r.doc, { selection: { kind: 'segment', id: r.segIds[2] ?? r.segIds[0] }, notice: style === 'square' ? '90°エルボ4つで回りました' : '45°エルボ4つで回りました' });
      return null;
    },
    setPenetration: (segId, memberId, on) => {
      const doc = get().doc;
      const s = doc.network.segments[segId];
      if (!s) return;
      const m = doc.building.members?.[memberId];
      commit(markPenetration(doc, { segId, memberId, kind: m?.kind ?? 'beam', t0: 0, t1: 0 }, on), { notice: on ? '貫通（スリーブ）にしました。構造の確認が必要です（積算の要確認に出ます）' : null });
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
      else if (sel.kind === 'member') next = withBld(deleteMember(building, sel.id));
      if (next) commit(next, { selection: null });
    },

    setVisibility: (cat, mode) => set({ visibility: { ...get().visibility, [cat]: mode } }),
    setVisibilityPreset: (p) => set({ visibility: presetVisibility(p) }),
    connectToPort: (fromId, toId) => {
      const { doc } = get();
      if (!portCandidates(doc, fromId, Infinity).some((c) => c.nodeId === toId)) {
        set({ notice: 'この接続口にはつなげません（同じ器具・種類や向きが合わない・すでにつながっている）' });
        return;
      }
      const attrs = nodeAttrs(doc.network, doc.fixtures, fromId).attrs;
      if (!attrs) return;
      const prev = get().selection;
      drawCore(routeToPort(doc.network.nodes[fromId].pos, doc.network.nodes[toId].pos), attrs, { startNodeId: fromId, endNodeId: toId });
      if (get().doc.network === doc.network) {
        if (!get().notice) set({ notice: 'ルートを作れませんでした。配管ツールでなぞってつないでください' });
        return;
      }
      // 器具のパネルからつないだときは器具を選んだままにする（続けて別の接続口もつなげるように）
      const toPort = portCandidates(doc, fromId, Infinity).find((c) => c.nodeId === toId);
      const dia = toPort?.diameterNote ? `。口径が違います（${toPort.diameterNote}）。径違いの継手を確認してください` : '';
      const slope = isDrain(attrs.system) ? '。排水は区間を選んで「勾配」を設定してください' : '';
      set({ notice: `仮のルートでつなぎました。点をドラッグすると経路を直せます${dia}${slope}`, ...(prev?.kind === 'fixture' ? { selection: prev } : {}) });
    },
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
      set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], revision: get().revision + 1, selection: null, pendingMerge: null, activeFloorId: fixActiveFloor(prev, get().activeFloorId), activeElevationId: fixElev(prev), ...fixDim(prev) });
    },
    redo: () => {
      get().endDrag();
      const { past, doc, future } = get();
      const next = future[0];
      if (!next) return;
      set({ doc: next, past: [...past, doc], future: future.slice(1), revision: get().revision + 1, selection: null, pendingMerge: null, activeFloorId: fixActiveFloor(next, get().activeFloorId), activeElevationId: fixElev(next), ...fixDim(next) });
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
