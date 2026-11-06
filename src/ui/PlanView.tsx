/**
 * 2D平面図。共通ストアの Network から描画し、編集結果も共通ストアへ書き込む。
 * 1本指: 描画 / 選択・ノード移動、2本指: 拡大縮小・移動（編集と干渉しない）。
 */
import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { hitTestPlan, orthoSnap, simplify, type Vec2 } from '../model/geometry';
import { SELECT_COLOR, systemColor } from './colors';

type ViewT = { scale: number; ox: number; oy: number }; // px/mm, 画面上の原点位置

const HIT_PX = 22; // 指で押しやすいヒット半径

export function PlanView({ orthoDeg }: { orthoDeg: number }) {
  const net = useStore((s) => s.network);
  const tool = useStore((s) => s.tool);
  const selSeg = useStore((s) => s.selectedSegmentId);
  const selNode = useStore((s) => s.selectedNodeId);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ViewT>({ scale: 0.08, ox: 40, oy: 360 });
  const [stroke, setStroke] = useState<Vec2[] | null>(null);
  const pointers = useRef(new Map<number, Vec2>());
  const gesture = useRef<
    | { kind: 'draw'; startNodeId?: string; branchSegId?: string }
    | { kind: 'drag'; nodeId: string }
    | { kind: 'pan'; last: Vec2 }
    | { kind: 'pinch'; dist: number; mid: Vec2; view: ViewT }
    | null
  >(null);

  const toWorld = (p: Vec2): Vec2 => ({ x: (p.x - view.ox) / view.scale, y: -(p.y - view.oy) / view.scale });
  const toScreen = (p: Vec2): Vec2 => ({ x: p.x * view.scale + view.ox, y: -p.y * view.scale + view.oy });
  const local = (e: React.PointerEvent): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const st = useStore.getState();
    if (pointers.current.size === 2) {
      // 2本指になったら編集を取り消して拡大縮小に切り替え
      if (gesture.current?.kind === 'drag') st.endDrag();
      setStroke(null);
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view };
      return;
    }
    if (pointers.current.size > 2) return;
    const w = toWorld(p);
    const hit = hitTestPlan(st.network, w, HIT_PX / view.scale);
    if (st.tool === 'draw') {
      if (hit?.type === 'node') {
        gesture.current = { kind: 'draw', startNodeId: hit.id };
        const n = st.network.nodes[hit.id].pos;
        setStroke([{ x: n.x, y: n.y }]);
      } else if (hit?.type === 'segment') {
        gesture.current = { kind: 'draw', branchSegId: hit.id };
        setStroke([w]);
      } else {
        gesture.current = { kind: 'draw' };
        setStroke([w]);
      }
    } else {
      if (hit?.type === 'node') {
        st.select({ nodeId: hit.id });
        st.beginDrag();
        gesture.current = { kind: 'drag', nodeId: hit.id };
      } else if (hit?.type === 'segment') {
        st.select({ segmentId: hit.id });
        gesture.current = null;
      } else {
        st.select({});
        gesture.current = { kind: 'pan', last: p };
      }
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = dist / g.dist;
      const scale = Math.min(2, Math.max(0.005, g.view.scale * k));
      const kk = scale / g.view.scale;
      setView({ scale, ox: mid.x - (g.mid.x - g.view.ox) * kk, oy: mid.y - (g.mid.y - g.view.oy) * kk });
    } else if (g.kind === 'pan') {
      setView((v) => ({ ...v, ox: v.ox + p.x - g.last.x, oy: v.oy + p.y - g.last.y }));
      g.last = p;
    } else if (g.kind === 'draw') {
      const w = toWorld(p);
      setStroke((s) => (s ? [...s, w] : s));
    } else if (g.kind === 'drag') {
      const st = useStore.getState();
      const n = st.network.nodes[g.nodeId];
      const w = toWorld(p);
      st.dragNode(g.nodeId, { x: w.x, y: w.y, z: n.pos.z });
    }
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
    if (g?.kind === 'drag') st.endDrag();
    if (g?.kind === 'draw' && stroke && stroke.length >= 2) {
      const tol = 8 / view.scale;
      let pts = orthoSnap(simplify(stroke, tol), orthoDeg);
      const last = pts[pts.length - 1];
      const endHit = hitTestPlan(st.network, last, HIT_PX / view.scale);
      const endNodeId = endHit?.type === 'node' && endHit.id !== g.startNodeId ? endHit.id : undefined;
      const lenPx = pts.reduce((acc, q, i) => (i ? acc + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) * view.scale : 0), 0);
      if (lenPx >= 12) {
        if (g.branchSegId) {
          const seg = st.network.segments[g.branchSegId];
          const z = (st.network.nodes[seg.a].pos.z + st.network.nodes[seg.b].pos.z) / 2;
          pts = pts.slice(1);
          st.branch(g.branchSegId, { x: stroke[0].x, y: stroke[0].y, z }, pts.map((q) => ({ ...q, z })));
        } else {
          const z = g.startNodeId ? st.network.nodes[g.startNodeId].pos.z : 0;
          st.drawPolyline(pts.map((q) => ({ ...q, z })), { startNodeId: g.startNodeId, endNodeId });
        }
      }
    }
    setStroke(null);
  };

  // グリッド(1m)
  const grid: React.ReactNode[] = [];
  const r = svgRef.current?.getBoundingClientRect();
  const W = r?.width ?? 1200, H = r?.height ?? 800;
  const tl = toWorld({ x: 0, y: 0 }), br = toWorld({ x: W, y: H });
  if (view.scale * 1000 > 8) {
    for (let x = Math.floor(tl.x / 1000) * 1000; x <= br.x; x += 1000) {
      const sx = toScreen({ x, y: 0 }).x;
      grid.push(<line key={'gx' + x} x1={sx} x2={sx} y1={0} y2={H} stroke="#e5e7eb" strokeWidth={x === 0 ? 2 : 1} />);
    }
    for (let y = Math.floor(br.y / 1000) * 1000; y <= tl.y; y += 1000) {
      const sy = toScreen({ x: 0, y }).y;
      grid.push(<line key={'gy' + y} y1={sy} y2={sy} x1={0} x2={W} stroke="#e5e7eb" strokeWidth={y === 0 ? 2 : 1} />);
    }
  }

  const strokePath = stroke?.map((p) => toScreen(p)).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');

  return (
    <svg
      ref={svgRef}
      data-testid="plan"
      className="plan"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onWheel={(e) => {
        const p = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
        const k = Math.exp(-e.deltaY * 0.001);
        setView((v) => {
          const scale = Math.min(2, Math.max(0.005, v.scale * k));
          const kk = scale / v.scale;
          return { scale, ox: p.x - (p.x - v.ox) * kk, oy: p.y - (p.y - v.oy) * kk };
        });
      }}
    >
      {grid}
      {Object.values(net.segments).map((s) => {
        const a = toScreen(net.nodes[s.a].pos), b = toScreen(net.nodes[s.b].pos);
        const sel = s.id === selSeg;
        return (
          <g key={s.id} data-seg={s.id}>
            {sel && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={SELECT_COLOR} strokeWidth={14} strokeLinecap="round" opacity={0.6} />}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={systemColor(s.system)} strokeWidth={Math.max(3, s.diameter * view.scale * 3)} strokeLinecap="round" />
          </g>
        );
      })}
      {Object.values(net.nodes).map((n) => {
        const p = toScreen(n.pos);
        const big = n.kind === 'tee' || n.kind === 'cross';
        return (
          <circle key={n.id} data-node={n.id} data-kind={n.kind} cx={p.x} cy={p.y} r={big ? 7 : 5}
            fill={n.id === selNode ? SELECT_COLOR : big ? '#111827' : '#fff'} stroke="#111827" strokeWidth={2} />
        );
      })}
      {strokePath && <path d={strokePath} fill="none" stroke="#111827" strokeDasharray="6 4" strokeWidth={2} />}
      <text x={8} y={18} fontSize={12} fill="#6b7280">平面図（1目盛=1m） {tool === 'draw' ? '指でなぞって配管を描く／既存配管から描くと分岐' : 'タップで選択・点をドラッグで移動'}</text>
    </svg>
  );
}
