/**
 * 2D平面図。共通ストアの Doc（建物＋配管）から描画し、編集結果も共通ストアへ書き込む。
 * 1本指: ツールに応じた作図・選択・移動 / 2本指: 拡大縮小・移動（編集と干渉しない）。
 */
import { useEffect, useRef, useState } from 'react';
import { activeFloorElevation, useStore } from '../state/store';
import { hitTestPlan, orthoSnap, simplify, type HitFilter, type Vec2 } from '../model/geometry';
import { hitTestBuilding } from '../model/buildingHit';
import { floorById, roomArea, wallLength } from '../model/building';
import { pointInPolygon } from '../model/roomOps';
import { connectedComponent, segmentLength, segmentsAt, type Network } from '../model/network';
import { FIXTURE_CATALOG, fixtureCorners } from '../model/fixtures';
import { SELECT_COLOR, systemColor, useColors } from './colors';
import { underlayCorners } from '../model/underlay';
import { pointInRing } from '../model/geo';
import { findConnectCandidate } from '../model/connect';

type ViewT = { scale: number; ox: number; oy: number }; // px/mm, 画面上の原点位置
type Gesture =
  | { kind: 'stroke'; tool: 'pipe' | 'wall'; startNodeId?: string; branchSegId?: string }
  | { kind: 'room'; start: Vec2 }
  | { kind: 'split'; start: Vec2 }
  | { kind: 'dragNode'; nodeId: string; startPx: Vec2 }
  | { kind: 'dragSeg'; segId: string; start: Vec2 }
  | { kind: 'dragFixture'; fixtureId: string; offset: Vec2 }
  | { kind: 'dragCorner'; cornerId: string }
  | { kind: 'dragWall'; wallId: string; start: Vec2 }
  | { kind: 'dragUnderlay'; id: string; start: Vec2 }
  | { kind: 'pan'; last: Vec2 }
  | { kind: 'pinch'; dist: number; mid: Vec2; view: ViewT };

const HIT_PX = 22; // 指で押しやすいヒット半径
const GRID_SNAP = 50; // 壁・部屋の座標を50mm単位に丸める
const snapGrid = (p: Vec2): Vec2 => ({ x: Math.round(p.x / GRID_SNAP) * GRID_SNAP, y: Math.round(p.y / GRID_SNAP) * GRID_SNAP });
/** 縦の区間（立て管）か（平面上の長さがほぼ0） */
const isVertical = (net: Network, segId: string) => {
  const s = net.segments[segId];
  const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos;
  return Math.hypot(a.x - b.x, a.y - b.y) < 1;
};
/** 高さがこの差(mm)以内の配管にだけ自動で接続する（平面で交差する別高さの配管にはつながない） */
export const CONNECT_Z_TOL = 150;
const nearZ = (zRange: NonNullable<HitFilter['zRange']>, z: number) => (z0: number, z1: number) =>
  zRange(z0, z1) && z1 >= z - CONNECT_Z_TOL && z0 <= z + CONNECT_Z_TOL;
/** ドラッグ中のノードを落とせる相手を探す（自分・直接つながった相手・高さが違う配管は除く） */
function dropTargetFor(net: Network, nodeId: string, w: Vec2, tol: number, zRange: NonNullable<HitFilter['zRange']>) {
  const segs = segmentsAt(net, nodeId);
  const excludeNodes = new Set([nodeId, ...segs.map((s) => (s.a === nodeId ? s.b : s.a))]);
  const excludeSegments = new Set(segs.map((s) => s.id));
  const hit = hitTestPlan(net, w, tol, { zRange: nearZ(zRange, net.nodes[nodeId].pos.z), excludeNodes, excludeSegments });
  return hit && segZOk(net, hit, w, net.nodes[nodeId].pos.z) ? hit : null;
}
/** 区間に接続する場合、接続点での区間の高さが z に近いか（斜めの区間も考慮） */
function segZOk(net: Network, hit: NonNullable<ReturnType<typeof hitTestPlan>>, w: Vec2, z: number) {
  if (hit.type === 'node') return Math.abs(net.nodes[hit.id].pos.z - z) <= CONNECT_Z_TOL;
  const s = net.segments[hit.id];
  const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos;
  const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = L2 ? Math.max(0, Math.min(1, ((w.x - a.x) * (b.x - a.x) + (w.y - a.y) * (b.y - a.y)) / L2)) : 0.5;
  return Math.abs(a.z + (b.z - a.z) * t - z) <= CONNECT_Z_TOL;
}

/** 表示範囲に建物全体が入る初期ビュー */
function fitView(w: number, h: number, bounds: { x0: number; y0: number; x1: number; y1: number } | null): ViewT {
  const bx = bounds ?? { x0: 0, y0: 0, x1: 8000, y1: 6000 };
  const pad = 40;
  const scale = Math.min((w - pad * 2) / Math.max(1000, bx.x1 - bx.x0), (h - pad * 2) / Math.max(1000, bx.y1 - bx.y0), 0.3);
  return { scale, ox: pad - bx.x0 * scale + (w - pad * 2 - (bx.x1 - bx.x0) * scale) / 2, oy: h - pad + bx.y0 * scale - (h - pad * 2 - (bx.y1 - bx.y0) * scale) / 2 };
}

export function PlanView() {
  const building = useStore((s) => s.doc.building);
  const net = useStore((s) => s.doc.network);
  const tool = useStore((s) => s.tool);
  const sel = useStore((s) => s.selection);
  const floorId = useStore((s) => s.activeFloorId);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ViewT | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [stroke, setStroke] = useState<Vec2[] | null>(null);
  const [roomPreview, setRoomPreview] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [splitPreview, setSplitPreview] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const pendingMerge = useStore((s) => s.pendingMerge);
  const underlays = useStore((s) => s.doc.underlays);
  const showUnderlays = useStore((s) => s.showUnderlays);
  const activeUnderlayId = useStore((s) => s.activeUnderlayId);
  const scalePick = useStore((s) => s.scalePick);
  const fixtures = useStore((s) => s.doc.fixtures);
  useColors((c) => c.overrides);
  const [dropHit, setDropHit] = useState<ReturnType<typeof hitTestPlan>>(null);
  const pointers = useRef(new Map<number, Vec2>());
  const gesture = useRef<Gesture | null>(null);

  // サイズ監視と初期フィット
  useEffect(() => {
    const el = svgRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
      setView((v) => {
        if (v) return v;
        const cs = Object.values(useStore.getState().doc.building.corners);
        const bounds = cs.length ? { x0: Math.min(...cs.map((c) => c.x)), y0: Math.min(...cs.map((c) => c.y)), x1: Math.max(...cs.map((c) => c.x)), y1: Math.max(...cs.map((c) => c.y)) } : null;
        return fitView(r.width, r.height, bounds);
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const vw = view ?? { scale: 0.08, ox: 40, oy: 400 };
  // 選んだ点・区間が（下のパネルが伸びるなどで）画面の外に出たら、見える位置まで表示を寄せる
  const selPoint = (() => {
    if (sel?.kind === 'node' && net.nodes[sel.id]) return net.nodes[sel.id].pos;
    if (sel?.kind === 'segment' && net.segments[sel.id]) {
      const a = net.nodes[net.segments[sel.id].a].pos, b = net.nodes[net.segments[sel.id].b].pos;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    return null;
  })();
  useEffect(() => {
    if (!selPoint || !view) return;
    const sx = selPoint.x * view.scale + view.ox, sy = -selPoint.y * view.scale + view.oy;
    const m = 40;
    if (sx >= m && sx <= size.w - m && sy >= m && sy <= size.h - m) return;
    setView({ ...view, ox: view.ox + (size.w / 2 - sx), oy: view.oy + (size.h / 2 - sy) });
  }, [selPoint?.x, selPoint?.y, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const toWorld = (p: Vec2): Vec2 => ({ x: (p.x - vw.ox) / vw.scale, y: -(p.y - vw.oy) / vw.scale });
  const toScreen = (p: Vec2): Vec2 => ({ x: p.x * vw.scale + vw.ox, y: -p.y * vw.scale + vw.oy });
  const local = (e: React.PointerEvent): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const tol = HIT_PX / vw.scale;
  // 現在の階に表示されている配管だけをタップ対象にする（他の階の配管は薄く表示・当たり判定なし）
  const curFloor = floorById(building, floorId);
  const zLo = (curFloor?.elevation ?? 0) - 1000, zHi = (curFloor?.elevation ?? 0) + (curFloor?.height ?? 3000);
  const zRange = (z0: number, z1: number) => z1 >= zLo && z0 < zHi;
  const hitPipe = (w: Vec2) => hitTestPlan(useStore.getState().doc.network, w, tol, { zRange });
  /** 器具のヒット（小さい器具も指で押せるよう、外形の外でも中心から許容半径内なら当たり） */
  const hitFixture = (w: Vec2) => {
    const fs = Object.values(useStore.getState().doc.fixtures).filter((f) => f.floorId === floorId);
    return fs.find((f) => pointInPolygon(w, fixtureCorners(f)))
      ?? fs.map((f) => ({ f, d: Math.hypot(f.x - w.x, f.y - w.y) })).filter((x) => x.d <= tol).sort((p, q) => p.d - q.d)[0]?.f;
  };
  if (import.meta.env.MODE === 'e2e') {
    (window as unknown as { __plan: unknown }).__plan = {
      toScreen: (x: number, y: number) => {
        const r = svgRef.current!.getBoundingClientRect();
        const s = toScreen({ x, y });
        return { x: r.left + s.x, y: r.top + s.y };
      },
    };
  }

  const onDown = (e: React.PointerEvent) => {
    svgRef.current?.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const st = useStore.getState();
    if (pointers.current.size === 2) {
      // 2本指になったら作図・移動を取り消して拡大縮小へ
      if (gesture.current && gesture.current.kind.startsWith('drag')) st.cancelDrag();
      setDropHit(null);
      setStroke(null);
      setRoomPreview(null);
      setSplitPreview(null);
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: vw };
      return;
    }
    if (pointers.current.size > 2) return;
    const w = toWorld(p);
    const b = st.doc.building;

    if (st.tool === 'fixture') {
      const f = hitFixture(w);
      if (f) st.select({ kind: 'fixture', id: f.id });
      else st.placeFixtureAt(snapGrid(w));
      gesture.current = null;
      return;
    }
    if (st.tool === 'pipe') {
      const hit = hitPipe(w);
      if (hit?.type === 'node') {
        const n = st.doc.network.nodes[hit.id].pos;
        gesture.current = { kind: 'stroke', tool: 'pipe', startNodeId: hit.id };
        setStroke([{ x: n.x, y: n.y }]);
      } else if (hit?.type === 'segment') {
        gesture.current = { kind: 'stroke', tool: 'pipe', branchSegId: hit.id };
        setStroke([w]);
      } else {
        gesture.current = { kind: 'stroke', tool: 'pipe' };
        setStroke([w]);
      }
      return;
    }
    if (st.tool === 'wall') {
      const h = hitTestBuilding(b, st.activeFloorId, w, tol);
      const start = h?.kind === 'corner' ? { x: b.corners[h.id].x, y: b.corners[h.id].y } : snapGrid(w);
      gesture.current = { kind: 'stroke', tool: 'wall' };
      setStroke([start]);
      return;
    }
    if (st.tool === 'room') {
      const s0 = snapGrid(w);
      gesture.current = { kind: 'room', start: s0 };
      setRoomPreview({ a: s0, b: s0 });
      return;
    }
    if (st.tool === 'split') {
      const s0 = snapGrid(w);
      gesture.current = { kind: 'split', start: s0 };
      setSplitPreview({ a: s0, b: s0 });
      return;
    }
    if (st.tool === 'underlay') {
      // 2点で縮尺: タップした点を記録 / それ以外: 下敷きをつかんで移動（何もない所はパン）
      if (st.scalePick) { st.addScalePoint(w); gesture.current = null; return; }
      const us = Object.values(st.doc.underlays ?? {}).filter((u) => u.floorId === st.activeFloorId);
      const act = us.find((u) => u.id === st.activeUnderlayId && pointInRing(w, underlayCorners(u)));
      const hit = act ?? [...us].reverse().find((u) => pointInRing(w, underlayCorners(u)));
      if (hit) {
        if (hit.id !== st.activeUnderlayId) st.setActiveUnderlay(hit.id);
        st.beginDrag();
        gesture.current = { kind: 'dragUnderlay', id: hit.id, start: w };
      } else gesture.current = { kind: 'pan', last: p };
      return;
    }
    if (st.tool === 'door' || st.tool === 'window') {
      const h = hitTestBuilding(b, st.activeFloorId, w, tol, false);
      if (h?.kind === 'wall') st.addOpening(h.id, st.tool, h.offset);
      else if (h?.kind === 'opening') st.select({ kind: 'opening', id: h.id });
      gesture.current = null;
      return;
    }
    // 選択ツール: 配管 > 器具 > 建物
    const ph = hitPipe(w);
    if (ph?.type === 'node') {
      const fid = st.doc.network.nodes[ph.id].fixtureId;
      const fx = fid ? st.doc.fixtures[fid] : undefined;
      if (fx) {
        // 器具の接続口をタップ → 器具を選択・ドラッグ（接続口の個別操作は器具のパネルから）
        st.select({ kind: 'fixture', id: fx.id });
        st.beginDrag();
        gesture.current = { kind: 'dragFixture', fixtureId: fx.id, offset: { x: fx.x - w.x, y: fx.y - w.y } };
        return;
      }
      st.select({ kind: 'node', id: ph.id });
      st.beginDrag();
      gesture.current = { kind: 'dragNode', nodeId: ph.id, startPx: p };
      return;
    }
    if (ph?.type === 'segment') {
      const net0 = st.doc.network, sg = net0.segments[ph.id];
      const at = { ...w, z: (net0.nodes[sg.a].pos.z + net0.nodes[sg.b].pos.z) / 2 };
      // 選択済みの区間をもう一度つかむとドラッグで移動（未選択ならまず選択だけ）
      if (st.selection?.kind === 'segment' && st.selection.id === ph.id) {
        st.select({ kind: 'segment', id: ph.id, at });
        st.beginDrag();
        gesture.current = { kind: 'dragSeg', segId: ph.id, start: w };
      } else {
        st.select({ kind: 'segment', id: ph.id, at });
        gesture.current = null;
      }
      return;
    }
    const fx = hitFixture(w);
    if (fx) {
      st.select({ kind: 'fixture', id: fx.id });
      st.beginDrag();
      gesture.current = { kind: 'dragFixture', fixtureId: fx.id, offset: { x: fx.x - w.x, y: fx.y - w.y } };
      return;
    }
    if (st.pendingMerge) {
      const target = Object.values(b.rooms).find((r) => r.floorId === st.activeFloorId && r.id !== st.pendingMerge && pointInPolygon(w, r.polygon));
      if (target) st.mergeRoomWith(target.id);
      else st.cancelMerge();
      gesture.current = { kind: 'pan', last: p };
      return;
    }
    const bh = hitTestBuilding(b, st.activeFloorId, w, tol);
    if (bh?.kind === 'corner') {
      st.select({ kind: 'corner', id: bh.id });
      st.beginDrag();
      gesture.current = { kind: 'dragCorner', cornerId: bh.id };
    } else if (bh?.kind === 'wall') {
      st.select({ kind: 'wall', id: bh.id });
      st.beginDrag();
      gesture.current = { kind: 'dragWall', wallId: bh.id, start: w };
    } else if (bh?.kind === 'opening' || bh?.kind === 'room') {
      st.select({ kind: bh.kind, id: bh.id });
      gesture.current = { kind: 'pan', last: p };
    } else {
      st.select(null);
      gesture.current = { kind: 'pan', last: p };
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    const st = useStore.getState();
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = Math.min(2, Math.max(0.005, g.view.scale * (dist / g.dist)));
      const kk = scale / g.view.scale;
      setView({ scale, ox: mid.x - (g.mid.x - g.view.ox) * kk, oy: mid.y - (g.mid.y - g.view.oy) * kk });
    } else if (g.kind === 'pan') {
      setView({ ...vw, ox: vw.ox + p.x - g.last.x, oy: vw.oy + p.y - g.last.y });
      g.last = p;
    } else if (g.kind === 'stroke') {
      const w = toWorld(p);
      setStroke((s) => (s ? [...s, w] : s));
    } else if (g.kind === 'room') {
      setRoomPreview({ a: g.start, b: snapGrid(toWorld(p)) });
    } else if (g.kind === 'split') {
      let q = snapGrid(toWorld(p));
      // 直角補正: ほぼ水平・垂直なら揃える
      if (st.orthoSnap) q = Math.abs(q.x - g.start.x) > Math.abs(q.y - g.start.y) ? { x: q.x, y: g.start.y } : { x: g.start.x, y: q.y };
      setSplitPreview({ a: g.start, b: q });
    } else if (g.kind === 'dragNode') {
      const n = st.doc.network.nodes[g.nodeId];
      const w = toWorld(p);
      if (n) st.dragNode(g.nodeId, { ...w, z: n.pos.z });
      if (n && segmentsAt(st.doc.network, g.nodeId).length === 1) setDropHit(dropTargetFor(useStore.getState().doc.network, g.nodeId, w, tol, zRange));
    } else if (g.kind === 'dragSeg') {
      const w = toWorld(p);
      st.dragSegment(g.segId, { x: Math.round((w.x - g.start.x) / GRID_SNAP) * GRID_SNAP, y: Math.round((w.y - g.start.y) / GRID_SNAP) * GRID_SNAP, z: 0 });
    } else if (g.kind === 'dragFixture') {
      const w = toWorld(p);
      st.dragFixture(g.fixtureId, snapGrid({ x: w.x + g.offset.x, y: w.y + g.offset.y }));
    } else if (g.kind === 'dragUnderlay') {
      const w = toWorld(p);
      st.dragUnderlay(g.id, w.x - g.start.x, w.y - g.start.y);
    } else if (g.kind === 'dragCorner') {
      st.dragCorner(g.cornerId, snapGrid(toWorld(p)));
    } else if (g.kind === 'dragWall') {
      const w = toWorld(p);
      st.dragWall(g.wallId, Math.round((w.x - g.start.x) / GRID_SNAP) * GRID_SNAP, Math.round((w.y - g.start.y) / GRID_SNAP) * GRID_SNAP);
    }
  };

  /** ジェスチャーがキャンセルされた（着信・OSのジェスチャー等）: 確定せずに元に戻す */
  const onCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'pinch' && pointers.current.size > 0) return;
    gesture.current = null;
    if (g?.kind.startsWith('drag')) useStore.getState().cancelDrag();
    setDropHit(null);
    setStroke(null);
    setRoomPreview(null);
    setSplitPreview(null);
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    const st = useStore.getState();
    if (g?.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    if (g?.kind === 'dragNode') {
      // 端点を別の配管のノード・区間の上で離すと接続（ドラッグと合わせて履歴1件）
      const up = local(e);
      const w = toWorld(up);
      // タップしただけ（ほとんど動かしていない）なら接続しない（選択だけ）
      const movedPx = Math.hypot(up.x - g.startPx.x, up.y - g.startPx.y);
      if (movedPx >= 6 && segmentsAt(st.doc.network, g.nodeId).length === 1) st.dropNode(g.nodeId, dropTargetFor(st.doc.network, g.nodeId, w, tol, zRange));
      setDropHit(null);
    }
    if (g?.kind.startsWith('drag')) st.endDrag();
    if (g?.kind === 'room' && roomPreview) st.addRoom(roomPreview.a, roomPreview.b);
    if (g?.kind === 'split' && splitPreview) finishSplit(splitPreview.a, splitPreview.b);
    if (g?.kind === 'stroke' && stroke && stroke.length >= 2) finishStroke(g, stroke);
    setStroke(null);
    setRoomPreview(null);
    setSplitPreview(null);
  };

  /** 線の始点・中点・終点を含む部屋を優先して分割 */
  const finishSplit = (a: Vec2, q: Vec2) => {
    const st = useStore.getState();
    if (Math.hypot(a.x - q.x, a.y - q.y) * vw.scale < 12) return;
    const rooms = Object.values(st.doc.building.rooms).filter((r) => r.floorId === st.activeFloorId);
    const mid = { x: (a.x + q.x) / 2, y: (a.y + q.y) / 2 };
    // 線の始点・中点・終点のどれかが内側にある部屋だけを対象にする（線の延長上の別の部屋は切らない）
    const ordered = rooms.filter((r) => score(r) > 0).sort((r1, r2) => score(r2) - score(r1));
    function score(r: (typeof rooms)[number]) { return [a, mid, q].filter((p) => pointInPolygon(p, r.polygon)).length; }
    for (const r of ordered) {
      const rev = useStore.getState().revision;
      st.splitRoomAt(r.id, a, q, st.splitWithWall);
      if (useStore.getState().revision !== rev) return;
    }
  };

  const finishStroke = (g: Extract<Gesture, { kind: 'stroke' }>, raw: Vec2[]) => {
    const st = useStore.getState();
    let pts = orthoSnap(simplify(raw, 8 / vw.scale), st.orthoSnap ? 15 : 0);
    const lenPx = pts.reduce((acc, q, i) => (i ? acc + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) * vw.scale : 0), 0);
    if (lenPx < 12) return;
    if (g.tool === 'wall') {
      pts = pts.map((q, i) => (i === 0 ? q : snapGrid(q)));
      for (let i = 1; i < pts.length; i++) st.addWall(pts[i - 1], pts[i]);
      return;
    }
    const net = st.doc.network;
    const drawZ = g.branchSegId
      ? (net.nodes[net.segments[g.branchSegId].a].pos.z + net.nodes[net.segments[g.branchSegId].b].pos.z) / 2
      : g.startNodeId ? net.nodes[g.startNodeId].pos.z : activeFloorElevation() + st.drawHeight;
    // 終点の接続先は描く高さに近い配管だけ（高さが違う配管とは交差するだけでつながない）
    const endW = pts[pts.length - 1];
    const eh = hitTestPlan(net, endW, tol, { zRange: nearZ(zRange, drawZ) });
    const endHit = eh && segZOk(net, eh, endW, drawZ) ? eh : null;
    const endNodeId = endHit?.type === 'node' && endHit.id !== g.startNodeId ? endHit.id : undefined;
    // 終点が既存の区間の上なら、その区間の途中に接続（始点の区間・始点ノードにつながる区間は除く）
    const startSegs = g.startNodeId ? segmentsAt(net, g.startNodeId).map((s) => s.id) : [];
    const endSegId = endHit?.type === 'segment' && endHit.id !== g.branchSegId && !startSegs.includes(endHit.id) ? endHit.id : undefined;
    if (endNodeId || endSegId) {
      const ep = endNodeId ? net.nodes[endNodeId].pos : null;
      if (ep) pts[pts.length - 1] = { x: ep.x, y: ep.y };
    }
    if (g.branchSegId) {
      const seg = net.segments[g.branchSegId];
      const z = (net.nodes[seg.a].pos.z + net.nodes[seg.b].pos.z) / 2;
      st.branch(g.branchSegId, { ...raw[0], z }, pts.slice(1).map((q) => ({ ...q, z })), { endNodeId, endSegId });
    } else {
      const z = g.startNodeId ? net.nodes[g.startNodeId].pos.z : activeFloorElevation() + st.drawHeight;
      st.drawPolyline(pts.map((q) => ({ ...q, z })), { startNodeId: g.startNodeId, endNodeId, endSegId });
    }
  };

  // ---------- 描画 ----------
  const W = size.w, H = size.h;
  const grid: React.ReactNode[] = [];
  const tl = toWorld({ x: 0, y: 0 }), br = toWorld({ x: W, y: H });
  if (vw.scale * 1000 > 8) {
    for (let x = Math.floor(tl.x / 1000) * 1000; x <= br.x; x += 1000) {
      const sx = toScreen({ x, y: 0 }).x;
      grid.push(<line key={'gx' + x} x1={sx} x2={sx} y1={0} y2={H} stroke="#e5e7eb" strokeWidth={x === 0 ? 2 : 1} />);
    }
    for (let y = Math.floor(br.y / 1000) * 1000; y <= tl.y; y += 1000) {
      const sy = toScreen({ x: 0, y }).y;
      grid.push(<line key={'gy' + y} y1={sy} y2={sy} x1={0} x2={W} stroke="#e5e7eb" strokeWidth={y === 0 ? 2 : 1} />);
    }
  }

  const floor = curFloor;
  const onThisFloor = (z: number) => zRange(z, z); // 床下配管も含める
  const segHere = (sid: string) => {
    const s = net.segments[sid];
    const za = net.nodes[s.a].pos.z, zb = net.nodes[s.b].pos.z;
    return zRange(Math.min(za, zb), Math.max(za, zb));
  };
  const run = sel?.kind === 'segment' && net.segments[sel.id] ? new Set(connectedComponent(net, sel.id).segmentIds) : null;
  const isSel = (kind: string, id: string) => sel?.kind === kind && sel.id === id;

  const rooms = Object.values(building.rooms).filter((r) => r.floorId === floorId);
  // 端点を選んでいる時は、つなげる先を緑の点線で示す
  const connectPreview = (() => {
    if (sel?.kind !== 'node' || !net.nodes[sel.id]) return null;
    const c = findConnectCandidate(net, fixtures, sel.id);
    return c ? { from: net.nodes[sel.id].pos, to: c.point } : null;
  })();
  const unders = showUnderlays ? Object.values(underlays ?? {}).filter((u) => u.floorId === floorId) : [];
  const attributions = [...new Set(unders.map((u) => u.attribution).filter(Boolean))] as string[];
  const walls = Object.values(building.walls).filter((w) => w.floorId === floorId);

  const strokePath = stroke?.map(toScreen).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');

  return (
    <svg ref={svgRef} data-testid="plan" className="plan"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
      onWheel={(e) => {
        const p = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
        const scale = Math.min(2, Math.max(0.005, vw.scale * Math.exp(-e.deltaY * 0.001)));
        const kk = scale / vw.scale;
        setView({ scale, ox: p.x - (p.x - vw.ox) * kk, oy: p.y - (p.y - vw.oy) * kk });
      }}>
      {unders.map((u) => {
        const c = toScreen(u.center), k = u.mmPerPx * vw.scale;
        return (
          <g key={u.id} data-underlay={u.id} opacity={u.opacity} pointerEvents="none"
            transform={`translate(${c.x} ${c.y}) rotate(${-u.rotation}) scale(${k})`}>
            <image href={u.src} x={-u.widthPx / 2} y={-u.heightPx / 2} width={u.widthPx} height={u.heightPx} preserveAspectRatio="none" />
          </g>
        );
      })}
      {grid}
      {tool === 'underlay' && unders.filter((u) => u.id === activeUnderlayId).map((u) => (
        <polygon key={'uo' + u.id} points={underlayCorners(u).map(toScreen).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />
      ))}
      {scalePick && scalePick.pts.map((q, i) => {
        const p = toScreen(q);
        return <g key={'sp' + i} pointerEvents="none"><circle cx={p.x} cy={p.y} r={7} fill="none" stroke="#dc2626" strokeWidth={2} /><line x1={p.x - 10} x2={p.x + 10} y1={p.y} y2={p.y} stroke="#dc2626" /><line y1={p.y - 10} y2={p.y + 10} x1={p.x} x2={p.x} stroke="#dc2626" /></g>;
      })}
      {scalePick?.pts.length === 2 && (() => { const a = toScreen(scalePick.pts[0]), b = toScreen(scalePick.pts[1]); return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#dc2626" strokeWidth={2} pointerEvents="none" />; })()}
      {rooms.map((r) => {
        const pts = r.polygon.map(toScreen);
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        return (
          <g key={r.id} data-room={r.id}>
            <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill={isSel('room', r.id) ? '#fde68a' : '#f1f5f9'} fillOpacity={unders.length ? 0.35 : 1} stroke="#cbd5e1" strokeDasharray="4 3" />
            <text x={cx} y={cy} textAnchor="middle" fontSize={12} fill="#475569">{r.name}</text>
            <text x={cx} y={cy + 14} textAnchor="middle" fontSize={10} fill="#94a3b8">{roomArea(r).toFixed(2)}㎡</text>
          </g>
        );
      })}
      {walls.map((w) => {
        const a = toScreen(building.corners[w.a]), b = toScreen(building.corners[w.b]);
        const selected = isSel('wall', w.id);
        return (
          <g key={w.id} data-wall={w.id}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selected ? SELECT_COLOR : w.kind === 'exterior' ? '#334155' : '#64748b'}
              strokeWidth={Math.max(3, w.thickness * vw.scale)} strokeLinecap="square" />
            {selected && (
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 10} textAnchor="middle" fontSize={12} fill="#b45309" fontWeight="bold">
                {Math.round(wallLength(building, w.id))}mm
              </text>
            )}
          </g>
        );
      })}
      {Object.values(building.openings).filter((o) => building.walls[o.wallId]?.floorId === floorId).map((o) => {
        const w = building.walls[o.wallId];
        const A = building.corners[w.a], B = building.corners[w.b];
        const L = wallLength(building, w.id);
        const u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
        const p0 = toScreen({ x: A.x + u.x * (o.offset - o.width / 2), y: A.y + u.y * (o.offset - o.width / 2) });
        const p1 = toScreen({ x: A.x + u.x * (o.offset + o.width / 2), y: A.y + u.y * (o.offset + o.width / 2) });
        return (
          <line key={o.id} data-opening={o.id} data-type={o.type} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
            stroke={isSel('opening', o.id) ? SELECT_COLOR : o.type === 'door' ? '#fff' : '#bae6fd'}
            strokeWidth={Math.max(3, w.thickness * vw.scale) - 1} strokeLinecap="butt" />
        );
      })}
      {tool === 'select' && Object.values(building.corners).filter((c) => c.floorId === floorId).map((c) => {
        const p = toScreen(c);
        return <rect key={c.id} data-corner={c.id} x={p.x - 4} y={p.y - 4} width={8} height={8} fill={isSel('corner', c.id) ? SELECT_COLOR : '#fff'} stroke="#334155" />;
      })}
      {Object.values(fixtures).filter((f) => f.floorId === floorId).map((f) => {
        const pts = fixtureCorners(f).map(toScreen);
        const c = toScreen(f);
        const selected = isSel('fixture', f.id);
        return (
          <g key={f.id} data-fixture={f.id} data-type={f.type}>
            <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill={selected ? '#fde68a' : '#ecfeff'} stroke={selected ? SELECT_COLOR : '#0e7490'} strokeWidth={selected ? 3 : 1.5} />
            <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize={11} fill="#0e7490" pointerEvents="none">{FIXTURE_CATALOG[f.type].label}</text>
          </g>
        );
      })}
      {Object.values(net.segments).map((s) => {
        const na = net.nodes[s.a].pos, nb = net.nodes[s.b].pos;
        const here = segHere(s.id);
        const a = toScreen(na), b = toScreen(nb);
        const selected = isSel('segment', s.id);
        const drop = dropHit?.type === 'segment' && dropHit.id === s.id;
        return (
          <g key={s.id} data-seg={s.id} opacity={here ? 1 : 0.2}>
            {(selected || drop) && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={drop ? '#16a34a' : SELECT_COLOR} strokeWidth={14} strokeLinecap="round" opacity={0.6} />}
            {!selected && run?.has(s.id) && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={SELECT_COLOR} strokeWidth={9} strokeLinecap="round" opacity={0.25} />}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={systemColor(s.system)} strokeWidth={Math.max(3, s.diameter * vw.scale * 3)} strokeLinecap="round" />
            {selected && !isVertical(net, s.id) && (
              <text data-testid="seg-label" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 12} textAnchor="middle" fontSize={12} fill="#b45309" fontWeight="bold">{Math.round(segmentLength(net, s.id))}mm</text>
            )}
          </g>
        );
      })}
      {Object.keys(net.segments).filter((id) => isVertical(net, id)).map((id) => {
        // 立て管: 通っている階すべてで ◎ を表示
        const s = net.segments[id];
        const p = toScreen(net.nodes[s.a].pos);
        const here = segHere(id);
        const selected = isSel('segment', id);
        return (
          <g key={'r' + id} data-riser={id} opacity={here ? 1 : 0.2} pointerEvents="none">
            <circle cx={p.x} cy={p.y} r={12} fill="none" stroke={selected ? SELECT_COLOR : systemColor(s.system)} strokeWidth={3} />
            <text x={p.x + 14} y={p.y - 10} fontSize={10} fill="#334155">立管</text>
          </g>
        );
      })}
      {Object.values(net.nodes).map((n) => {
        const p = toScreen(n.pos);
        const big = n.kind === 'tee' || n.kind === 'cross';
        const drop = dropHit?.type === 'node' && dropHit.id === n.id;
        const port = !!n.fixtureId;
        return (
          <circle key={n.id} data-node={n.id} data-kind={n.kind} cx={p.x} cy={p.y} r={drop ? 10 : big ? 7 : port ? 6 : 5} opacity={onThisFloor(n.pos.z) ? 1 : 0.2}
            fill={isSel('node', n.id) ? SELECT_COLOR : drop ? '#16a34a' : n.kind === 'valve' ? '#f97316' : big ? '#111827' : port ? '#0e7490' : '#fff'}
            stroke="#111827" strokeWidth={2} />
        );
      })}
      {strokePath && <path d={strokePath} fill="none" stroke="#111827" strokeDasharray="6 4" strokeWidth={2} />}
      {splitPreview && (() => {
        const a = toScreen(splitPreview.a), b = toScreen(splitPreview.b);
        return <line data-testid="split-preview" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#dc2626" strokeWidth={2} strokeDasharray="8 4" />;
      })()}
      {roomPreview && (() => {
        const a = toScreen(roomPreview.a), b = toScreen(roomPreview.b);
        return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)} fill="rgba(37,99,235,0.1)" stroke="#2563eb" strokeDasharray="6 4" />;
      })()}
      <text x={8} y={18} fontSize={12} fill={pendingMerge ? '#b45309' : '#6b7280'} fontWeight={pendingMerge ? 'bold' : undefined}>
        {floor?.name ?? ''} 平面図（1目盛=1m） {pendingMerge ? '結合する隣の部屋をタップ（他をタップで取消）' : HINTS[tool]}
      </text>
      {connectPreview && (() => {
        const a = toScreen(connectPreview.from), b = toScreen(connectPreview.to);
        return (
          <g pointerEvents="none" data-testid="connect-preview">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#16a34a" strokeWidth={3} strokeDasharray="6 4" />
            <circle cx={b.x} cy={b.y} r={9} fill="none" stroke="#16a34a" strokeWidth={3} />
          </g>
        );
      })()}
      {attributions.length > 0 && (
        <text x={8} y={H - 8} fontSize={11} fill="#334155" stroke="#fff" strokeWidth={3} paintOrder="stroke" pointerEvents="none" data-testid="attribution">{attributions.join('　')}</text>
      )}
    </svg>
  );
}

const HINTS: Record<string, string> = {
  select: 'タップで選択・ドラッグで移動',
  pipe: '指でなぞって配管／既存配管からなぞると分岐',
  wall: '指でなぞって壁を描く',
  room: '対角にドラッグして部屋を作る',
  split: '部屋を横切る線を引いて分割',
  door: '壁をタップしてドアを付ける',
  window: '壁をタップして窓を付ける',
  fixture: '図面をタップして器具を置く',
};
