/**
 * 立面図（外壁を外から見た図）。補正した外壁の写真を実寸で敷き、その上で配管を描く。
 * 1本指: 配管ツールでなぞって描く／選択ツールでタップ・ドラッグ／2本指・ホイール: 拡大縮小・移動。
 * 描いた配管は共通ストアの普通の配管（3D・平面図・積算にそのまま出る）。
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { orthoSnap, simplify } from '../model/geometry';
import { segmentLength, segmentsAt, type Network } from '../model/network';
import { elevToWorld, faceNodes, MOUNT_LABEL, worldToElev, type Elevation, type UV } from '../model/elevation';
import { SELECT_COLOR, systemColor, useColors } from './colors';
import { MountFields } from './ElevationDialog';
import { PhotoRectify } from './PhotoRectify';

type ViewT = { scale: number; ox: number; oy: number };
type P = { x: number; y: number };
type Hit = { type: 'node' | 'segment'; id: string } | null;
type Gesture =
  | { kind: 'stroke'; startNodeId?: string; startSegId?: string }
  | { kind: 'dragNode'; nodeId: string; depth: number }
  | { kind: 'pan'; last: P }
  | { kind: 'pinch'; dist: number; mid: P; view: ViewT };

const HIT_PX = 22;
const r10 = (v: number) => Math.round(v / 10) * 10;

function fit(w: number, h: number, el: Elevation): ViewT {
  const pad = Math.min(40, w / 8, h / 8);
  const scale = Math.max(0.001, Math.min((w - pad * 2) / Math.max(1000, el.width), (h - pad * 2) / Math.max(1000, el.height)));
  return { scale, ox: (w - el.width * scale) / 2, oy: h - (h - el.height * scale) / 2 };
}

/** この面に見える配管（両端が面の近くにある区間）と、面の近くのノードの立面座標 */
function facePipes(net: Network, el: Elevation) {
  const uv = new Map<string, UV & { depth: number }>();
  for (const n of faceNodes(net, el)) uv.set(n.id, worldToElev(el, n.pos));
  const segs = Object.values(net.segments).filter((s) => uv.has(s.a) && uv.has(s.b));
  return { uv, segs };
}

function hitUV(net: Network, el: Elevation, p: UV, tol: number): Hit {
  const { uv, segs } = facePipes(net, el);
  let best: Hit = null, bd = tol;
  for (const [id, q] of uv) {
    const d = Math.hypot(q.u - p.u, q.v - p.v);
    if (d <= bd && segmentsAt(net, id).length) { bd = d; best = { type: 'node', id }; }
  }
  if (best) return best;
  bd = tol;
  for (const s of segs) {
    const a = uv.get(s.a)!, b = uv.get(s.b)!;
    const L2 = (b.u - a.u) ** 2 + (b.v - a.v) ** 2;
    const t = L2 ? Math.max(0, Math.min(1, ((p.u - a.u) * (b.u - a.u) + (p.v - a.v) * (b.v - a.v)) / L2)) : 0;
    const d = Math.hypot(a.u + (b.u - a.u) * t - p.u, a.v + (b.v - a.v) * t - p.v);
    if (d <= bd) { bd = d; best = { type: 'segment', id: s.id }; }
  }
  return best;
}

export function ElevationView() {
  const id = useStore((s) => s.activeElevationId);
  const el = useStore((s) => (s.activeElevationId ? s.doc.elevations?.[s.activeElevationId] : undefined));
  const net = useStore((s) => s.doc.network);
  const building = useStore((s) => s.doc.building);
  const tool = useStore((s) => s.tool);
  const sel = useStore((s) => s.selection);
  useColors((c) => c.overrides);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<ViewT | null>(null);
  const [stroke, setStroke] = useState<UV[] | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [previewOpacity, setPreviewOpacity] = useState<number | null>(null);
  const pointers = useRef(new Map<number, P>());
  const gesture = useRef<Gesture | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(() => {
      const r = svg.getBoundingClientRect();
      // 拡大・移動するまでは大きさの変化に合わせて全体が入るように表示する
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setView(null); }, [id]);

  if (!el) return null;
  const vw = view ?? fit(size.w, size.h, el);
  const toUV = (p: P): UV => ({ u: (p.x - vw.ox) / vw.scale, v: -(p.y - vw.oy) / vw.scale });
  const toS = (q: UV): P => ({ x: q.u * vw.scale + vw.ox, y: -q.v * vw.scale + vw.oy });
  const local = (e: React.PointerEvent | React.WheelEvent): P => { const r = svgRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const tol = HIT_PX / vw.scale;
  const st = useStore.getState();
  if (import.meta.env.MODE === 'e2e') {
    (window as unknown as { __elev: unknown }).__elev = {
      toScreen: (u: number, v: number) => { const r = svgRef.current!.getBoundingClientRect(); const q = toS({ u, v }); return { x: r.left + q.x, y: r.top + q.y }; },
    };
  }

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const s = useStore.getState();
    if (pointers.current.size === 2) {
      if (gesture.current?.kind === 'dragNode') s.cancelDrag();
      setStroke(null);
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: vw };
      return;
    }
    if (pointers.current.size > 2) return;
    const q = toUV(p);
    const hit = hitUV(s.doc.network, el, q, tol);
    if (s.tool === 'pipe') {
      if (hit?.type === 'node') {
        const n = worldToElev(el, s.doc.network.nodes[hit.id].pos);
        gesture.current = { kind: 'stroke', startNodeId: hit.id };
        setStroke([{ u: n.u, v: n.v }]);
      } else {
        gesture.current = { kind: 'stroke', startSegId: hit?.type === 'segment' ? hit.id : undefined };
        setStroke([{ u: r10(q.u), v: r10(q.v) }]);
      }
      return;
    }
    if (hit?.type === 'node') {
      const n = s.doc.network.nodes[hit.id];
      s.select({ kind: 'node', id: hit.id });
      if (!n.fixtureId) { s.beginDrag(); gesture.current = { kind: 'dragNode', nodeId: hit.id, depth: worldToElev(el, n.pos).depth }; }
      else gesture.current = null;
      return;
    }
    if (hit?.type === 'segment') {
      const sg = s.doc.network.segments[hit.id];
      const a = s.doc.network.nodes[sg.a].pos, b = s.doc.network.nodes[sg.b].pos;
      s.select({ kind: 'segment', id: hit.id, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 } });
      gesture.current = null;
      return;
    }
    s.select(null);
    gesture.current = { kind: 'pan', last: p };
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
      const scale = Math.min(2, Math.max(0.0005, g.view.scale * (dist / g.dist)));
      const k = scale / g.view.scale;
      setView({ scale, ox: mid.x - (g.mid.x - g.view.ox) * k, oy: mid.y - (g.mid.y - g.view.oy) * k });
    } else if (g.kind === 'pan') {
      setView({ ...vw, ox: vw.ox + p.x - g.last.x, oy: vw.oy + p.y - g.last.y });
      g.last = p;
    } else if (g.kind === 'stroke') {
      const q = toUV(p);
      setStroke((s) => (s ? [...s, q] : s));
    } else if (g.kind === 'dragNode') {
      const q = toUV(p);
      const s = useStore.getState();
      const n = s.doc.network.nodes[g.nodeId];
      if (n) s.dragNode(g.nodeId, elevToWorld(el, r10(q.u), r10(q.v), 0, g.depth));
    }
  };

  const end = (e: React.PointerEvent, cancel: boolean) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'pinch') { if (pointers.current.size === 0) gesture.current = null; return; }
    gesture.current = null;
    const s = useStore.getState();
    if (g?.kind === 'dragNode') { if (cancel) s.cancelDrag(); else s.endDrag(); }
    if (!cancel && g?.kind === 'stroke' && stroke && stroke.length >= 2) finish(g, stroke);
    setStroke(null);
  };

  const finish = (g: Extract<Gesture, { kind: 'stroke' }>, raw: UV[]) => {
    const s = useStore.getState();
    const xy = raw.map((q) => ({ x: q.u, y: q.v }));
    let pts = orthoSnap(simplify(xy, 8 / vw.scale), s.orthoSnap ? 15 : 0).map((q, i) => (i === 0 ? { u: q.x, v: q.y } : { u: r10(q.x), v: r10(q.y) }));
    const lenPx = pts.reduce((acc, q, i) => (i ? acc + Math.hypot(q.u - pts[i - 1].u, q.v - pts[i - 1].v) * vw.scale : 0), 0);
    if (lenPx < 12) return;
    const net0 = s.doc.network;
    const last = pts[pts.length - 1];
    const eh = hitUV(net0, el, last, tol);
    const startSegs = g.startNodeId ? segmentsAt(net0, g.startNodeId).map((x) => x.id) : [];
    const endNodeId = eh?.type === 'node' && eh.id !== g.startNodeId ? eh.id : undefined;
    const endSegId = eh?.type === 'segment' && eh.id !== g.startSegId && !startSegs.includes(eh.id) ? eh.id : undefined;
    if (endNodeId) { const q = worldToElev(el, net0.nodes[endNodeId].pos); pts = [...pts.slice(0, -1), { u: q.u, v: q.v }]; }
    s.drawOnFace(el.id, pts, { startNodeId: g.startNodeId, startSegId: g.startSegId, endNodeId, endSegId });
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = local(e);
    const scale = Math.min(2, Math.max(0.0005, vw.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const k = scale / vw.scale;
    setView({ scale, ox: p.x - (p.x - vw.ox) * k, oy: p.y - (p.y - vw.oy) * k });
  };

  // ---- 描画 ----
  const { uv, segs } = facePipes(net, el);
  const o = toS({ u: 0, v: el.height });
  const W = el.width * vw.scale, H = el.height * vw.scale;
  // 階の床の線
  const floorLines = building.floors.map((f) => ({ f, v: f.elevation - el.baseZ })).filter((x) => x.v > 0 && x.v < el.height);
  // この面にある壁の窓・ドア（壁芯が面の上にある壁）
  const openings = Object.values(building.openings).flatMap((op) => {
    const w = building.walls[op.wallId];
    const A = w && building.corners[w.a], B = w && building.corners[w.b];
    const f = w && building.floors.find((x) => x.id === w.floorId);
    if (!A || !B || !f) return [];
    const ea = worldToElev(el, { x: A.x, y: A.y, z: 0 }), eb = worldToElev(el, { x: B.x, y: B.y, z: 0 });
    if (Math.abs(ea.depth + el.faceOffset) > 60 || Math.abs(eb.depth + el.faceOffset) > 60) return [];
    const sign = eb.u >= ea.u ? 1 : -1;
    const cu = ea.u + sign * op.offset;
    return [{ id: op.id, type: op.type, u0: cu - op.width / 2, u1: cu + op.width / 2, v0: f.elevation - el.baseZ + op.sill, v1: f.elevation - el.baseZ + op.sill + op.height }];
  });
  const strokePath = stroke?.map(toS).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const selSeg = sel?.kind === 'segment' ? sel.id : null, selNode = sel?.kind === 'node' ? sel.id : null;

  return (
    <div className="elev-wrap" data-testid="elev-view">
      <div className="elev-bar">
        <button data-testid="elev-close" onClick={() => st.openElevation(null)}>‹ 平面図</button>
        <strong data-testid="elev-title">立面 {el.label}</strong>
        <span className="small muted" data-testid="elev-size">{Math.round(el.width)}×{Math.round(el.height)}</span>
        <button data-testid="elev-settings" className={showSettings ? 'on' : ''} onClick={() => setShowSettings(!showSettings)}>
          ⚙ {el.mount.type === 'tBracket' ? `T字 ${el.mount.standoff}mm` : 'サドル直付け'}
        </button>
        {msg && <span className="small" data-testid="elev-msg" role="status">{msg}</span>}
      </div>
      {showSettings && (
        <div className="elev-bar elev-settings" data-testid="elev-settings-panel">
          <MountFields key={`${el.mount.type}-${el.mount.standoff}`} mount={el.mount} onChange={(m) => { const r = st.updateElevation(el.id, { mount: m }); setMsg(r ?? `取付を「${MOUNT_LABEL[m.type]}${m.type === 'tBracket' ? ` ${m.standoff}mm` : ''}」にしました（この面の配管に反映）`); }} />
          {el.photo && (
            <label className="field inline small">写真の濃さ
              <OpacitySlider value={el.opacity} onPreview={setPreviewOpacity} onCommit={(v) => st.updateElevation(el.id, { opacity: v })} />
            </label>
          )}
          <button data-testid="elev-photo" onClick={() => setPhotoOpen(true)}>📷 {el.photo ? '写真を変える' : '写真を敷く'}</button>
          <button className="danger" data-testid="elev-delete" onClick={() => { if (window.confirm(`立面「${el.label}」を削除します（描いた配管は残ります）`)) st.deleteElevation(el.id); }}>立面を削除</button>
        </div>
      )}
      <svg ref={svgRef} className="plan elev-svg" data-testid="elev-svg" style={{ touchAction: 'none' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={(e) => end(e, false)} onPointerCancel={(e) => end(e, true)} onWheel={onWheel}>
        <rect x={0} y={0} width={size.w} height={size.h} fill="#f8fafc" />
        <rect x={o.x} y={o.y} width={W} height={H} fill="#e2e8f0" stroke="#334155" strokeWidth={2} data-testid="elev-face" />
        {el.photo && <image href={el.photo.src} x={o.x} y={o.y} width={W} height={H} preserveAspectRatio="none" opacity={previewOpacity ?? el.opacity} pointerEvents="none" data-testid="elev-photo-img" />}
        {floorLines.map(({ f, v }) => { const a = toS({ u: 0, v }); return (
          <g key={f.id} pointerEvents="none">
            <line x1={a.x} x2={a.x + W} y1={a.y} y2={a.y} stroke="#64748b" strokeDasharray="8 6" />
            <text x={a.x + 4} y={a.y - 4} fontSize={12} fill="#334155" stroke="#fff" strokeWidth={3} paintOrder="stroke">{f.name} 床 +{Math.round(v)}</text>
          </g>
        ); })}
        <text x={o.x + 4} y={o.y + H + 14} fontSize={12} fill="#334155" pointerEvents="none">± 0（{building.floors.find((f) => f.id === el.floorId)?.name ?? ''}床）</text>
        {openings.map((op) => { const a = toS({ u: op.u0, v: op.v1 }); return (
          <rect key={op.id} x={a.x} y={a.y} width={(op.u1 - op.u0) * vw.scale} height={(op.v1 - op.v0) * vw.scale} fill={op.type === 'door' ? 'rgba(180,83,9,0.15)' : 'rgba(2,132,199,0.15)'} stroke={op.type === 'door' ? '#b45309' : '#0284c7'} strokeDasharray="4 3" pointerEvents="none" />
        ); })}
        {segs.map((s) => {
          const a = toS(uv.get(s.a)!), b = toS(uv.get(s.b)!);
          const selected = selSeg === s.id;
          const len = segmentLength(net, s.id);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          return (
            <g key={s.id} data-seg={s.id}>
              {selected && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={SELECT_COLOR} strokeWidth={14} strokeLinecap="round" opacity={0.6} />}
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={systemColor(s.system)} strokeWidth={Math.max(3, s.diameter * vw.scale)} strokeLinecap="round" />
              {Math.hypot(a.x - b.x, a.y - b.y) > 60 && <text x={mid.x + 6} y={mid.y - 6} fontSize={11} fill="#111827" stroke="#fff" strokeWidth={3} paintOrder="stroke" pointerEvents="none">{Math.round(len)}</text>}
            </g>
          );
        })}
        {[...uv.entries()].filter(([nid]) => segmentsAt(net, nid).length).map(([nid, q]) => {
          const p = toS(q);
          const deg = segmentsAt(net, nid).length;
          const inFace = segmentsAt(net, nid).some((s) => uv.has(s.a === nid ? s.b : s.a));
          const through = segmentsAt(net, nid).some((s) => { const other = uv.get(s.a === nid ? s.b : s.a); return !other || Math.hypot(other.u - q.u, other.v - q.v) < 1; });
          if (!inFace && !through) return null;
          return <circle key={nid} data-node={nid} cx={p.x} cy={p.y} r={through ? 7 : deg === 1 ? 5 : 4} fill={selNode === nid ? SELECT_COLOR : through ? '#fff' : '#111827'} stroke="#111827" strokeWidth={through ? 2 : 1} />;
        })}
        {strokePath && <path d={strokePath} fill="none" stroke="#111827" strokeDasharray="6 4" strokeWidth={2} pointerEvents="none" />}
        <text x={8} y={size.h - 8} fontSize={11} fill="#334155" stroke="#fff" strokeWidth={3} paintOrder="stroke" pointerEvents="none">
          {tool === 'pipe' ? '写真の上を指でなぞると、壁の外側に配管を描きます' : '「配管」を選んで壁の上をなぞると描けます'}（{MOUNT_LABEL[el.mount.type]}{el.mount.type === 'tBracket' ? ` ${el.mount.standoff}mm` : ''}）
        </text>
      </svg>
      {photoOpen && (
        <div className="modal-back" onClick={() => setPhotoOpen(false)}>
          <div className="modal wide-modal" data-testid="elev-photo-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>外壁の写真（{Math.round(el.width)}×{Math.round(el.height)}mm）</h2>
            <PhotoRectify aspectW={el.width} aspectH={el.height} maxPx={1600} quality={0.8}
              intro="外壁を撮った写真を選び、四隅を壁の角（横幅・高さの範囲）に合わせます。"
              onDone={(f) => { const r = st.updateElevation(el.id, { photo: { src: f.url, w: f.w, h: f.h } }); if (r) setMsg(r); setPhotoOpen(false); }} />
            <div className="modal-btns">
              {el.photo && <button className="danger" onClick={() => { st.updateElevation(el.id, { photo: undefined }); setPhotoOpen(false); }}>写真を外す</button>}
              <button onClick={() => setPhotoOpen(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 写真の濃さ（動かしている間は見た目だけ、離したら1回だけ保存＝履歴1件） */
function OpacitySlider({ value, onPreview, onCommit }: { value: number; onPreview: (v: number | null) => void; onCommit: (v: number) => void }) {
  const [v, setV0] = useState<number | null>(null);
  const setV = (x: number | null) => { setV0(x); onPreview(x); };
  const done = () => { if (v !== null && v !== value) onCommit(v); setV(null); };
  return (
    <input type="range" min={0.1} max={1} step={0.05} value={v ?? value} data-testid="elev-opacity"
      onChange={(e) => setV(Number(e.target.value))} onPointerUp={done} onKeyUp={done} onBlur={done} />
  );
}
