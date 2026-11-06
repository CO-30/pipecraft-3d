/**
 * 3D表示。共通ストアの Doc から生成（建物は buildingBoxes、配管はネットワーク）。
 * ノードをドラッグすると同じ高さの水平面上で移動し、共通ストアを更新する（→ 2D平面図にも即時反映）。
 * 座標変換: 共通座標(mm, z=高さ) → three(m, y=上): (x, z, -y)/1000
 */
import { memo, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useStore, type SelKind, type VisMode } from '../state/store';
import type { Vec3 } from '../model/network';
import { buildingBoxes, type Box } from '../model/building3d';
import { SELECT_COLOR, systemColor } from './colors';

const toThree = (p: Vec3) => new THREE.Vector3(p.x / 1000, p.z / 1000, -p.y / 1000);
const UP = new THREE.Vector3(0, 1, 0);

const CAT_COLOR: Record<Box['category'], string> = {
  exteriorWall: '#e7e5e4', interiorWall: '#f5f5f4', floor: '#d6d3d1', ceiling: '#fafaf9', door: '#a16207', window: '#7dd3fc',
};

function Pipe({ a, b, radius, color, selected, mode, onSelect }: { a: Vec3; b: Vec3; radius: number; color: string; selected: boolean; mode: VisMode; onSelect: () => void }) {
  const { pos, quat, len } = useMemo(() => {
    const va = toThree(a), vb = toThree(b);
    const dir = vb.clone().sub(va);
    return { pos: va.clone().add(vb).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()), len: dir.length() };
  }, [a, b]);
  if (mode === 'hide') return null;
  return (
    <mesh position={pos} quaternion={quat} onClick={(e) => { e.stopPropagation(); onSelect(); }} renderOrder={2}>
      <cylinderGeometry args={[radius, radius, len, 12]} />
      <meshStandardMaterial color={selected ? SELECT_COLOR : color} emissive={selected ? SELECT_COLOR : '#000'} emissiveIntensity={selected ? 0.5 : 0}
        transparent={mode === 'ghost'} opacity={mode === 'ghost' ? 0.3 : 1} />
    </mesh>
  );
}

const BoxMesh = memo(function BoxMesh({ box, mode, selected, onSelect }: { box: Box; mode: VisMode; selected: boolean; onSelect?: () => void }) {
  if (mode === 'hide') return null;
  const ghost = mode === 'ghost';
  return (
    <mesh position={toThree(box.center)} rotation={[0, box.rotationZ, 0]}
      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
      raycast={ghost ? () => null : undefined}>
      <boxGeometry args={[box.size.x / 1000, box.size.z / 1000, box.size.y / 1000]} />
      <meshStandardMaterial color={selected ? SELECT_COLOR : CAT_COLOR[box.category]} transparent={ghost} opacity={ghost ? 0.18 : 1} depthWrite={!ghost} />
    </mesh>
  );
});

/** E2Eテスト用フック（e2e ビルドのみ） */
function TestHook() {
  const { camera, size } = useThree();
  if (import.meta.env.MODE === 'e2e') {
    (window as unknown as { __pc3d: unknown }).__pc3d = {
      project: (nodeId: string) => {
        const n = useStore.getState().doc.network.nodes[nodeId];
        const v = toThree(n.pos).project(camera);
        return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
      },
    };
  }
  return null;
}

function Scene({ setOrbit }: { setOrbit: (v: boolean) => void }) {
  const net = useStore((s) => s.doc.network);
  const building = useStore((s) => s.doc.building);
  const sel = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const vis = useStore((s) => s.visibility);
  const hiddenIds = useStore((s) => s.hiddenIds);
  const ghostIds = useStore((s) => s.ghostIds);
  const boxes = useMemo(() => buildingBoxes(building), [building]);
  const drag = useRef<{ nodeId: string; plane: THREE.Plane } | null>(null);
  const [dragging, setDragging] = useState(false);

  const modeFor = (cat: keyof typeof vis, id: string): VisMode => {
    if (hiddenIds.includes(id) || vis[cat] === 'hide') return 'hide';
    if (ghostIds.includes(id) || vis[cat] === 'ghost') return 'ghost';
    return 'show';
  };
  const selKindFor = (b: Box): SelKind | null =>
    b.category.endsWith('Wall') ? 'wall' : b.category === 'door' || b.category === 'window' ? 'opening' : null;

  const startDrag = (e: ThreeEvent<PointerEvent>, nodeId: string) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    const st = useStore.getState();
    st.select({ kind: 'node', id: nodeId });
    st.beginDrag();
    drag.current = { nodeId, plane: new THREE.Plane(UP, -st.doc.network.nodes[nodeId].pos.z / 1000) };
    setDragging(true);
    setOrbit(false);
  };
  const moveDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(drag.current.plane, hit)) return;
    const st = useStore.getState();
    const n = st.doc.network.nodes[drag.current.nodeId];
    if (n) st.dragNode(drag.current.nodeId, { x: hit.x * 1000, y: -hit.z * 1000, z: n.pos.z });
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setOrbit(true);
    useStore.getState().endDrag();
  };

  const pipeMode = vis.pipes;
  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[8, 14, 6]} intensity={1.1} />
      <directionalLight position={[-6, 8, -8]} intensity={0.35} />
      <Grid args={[60, 60]} cellSize={1} sectionSize={5} infiniteGrid fadeDistance={80} cellColor="#d1d5db" sectionColor="#9ca3af" position={[0, -0.001, 0]} />
      {boxes.map((b) => {
        const k = selKindFor(b);
        return (
          <BoxMesh key={b.key} box={b} mode={modeFor(b.category, b.elementId)}
            selected={!!k && sel?.kind === k && sel.id === b.elementId}
            onSelect={k ? () => useStore.getState().select({ kind: k, id: b.elementId }) : undefined} />
        );
      })}
      {Object.values(net.segments).map((s) => (
        <Pipe key={s.id} a={net.nodes[s.a].pos} b={net.nodes[s.b].pos} radius={Math.max(0.02, s.diameter / 1500)}
          color={systemColor(s.system)} selected={sel?.kind === 'segment' && sel.id === s.id} mode={pipeMode}
          onSelect={() => useStore.getState().select({ kind: 'segment', id: s.id })} />
      ))}
      {pipeMode !== 'hide' && Object.values(net.nodes).map((n) => (
        <mesh key={n.id} position={toThree(n.pos)} onPointerDown={(e) => startDrag(e, n.id)} renderOrder={3}>
          <sphereGeometry args={[n.kind === 'tee' || n.kind === 'cross' ? 0.07 : 0.05, 16, 16]} />
          <meshStandardMaterial color={sel?.kind === 'node' && sel.id === n.id ? SELECT_COLOR : n.kind === 'tee' ? '#111827' : '#f9fafb'} />
        </mesh>
      ))}
      {/* ドラッグ中だけ全面のキャッチ面を出してポインタを受ける */}
      {dragging && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  );
}

function initialCamera(): { pos: [number, number, number]; target: [number, number, number] } {
  const cs = Object.values(useStore.getState().doc.building.corners);
  if (!cs.length) return { pos: [6, 8, 10], target: [2, 0, -2] };
  const xs = cs.map((c) => c.x / 1000), ys = cs.map((c) => c.y / 1000);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const r = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 4);
  return { pos: [cx + r * 0.9, r * 1.1, -cy + r * 1.3], target: [cx, 1, -cy] };
}

export function View3D() {
  const [orbit, setOrbit] = useState(true);
  const cam = useMemo(initialCamera, []);
  return (
    <div className="view3d" data-testid="view3d">
      <Canvas camera={{ position: cam.pos, fov: 50, near: 0.05, far: 500 }} gl={{ preserveDrawingBuffer: true }}
        onPointerMissed={() => useStore.getState().select(null)}>
        <Scene setOrbit={setOrbit} />
        <OrbitControls makeDefault enabled={orbit} target={cam.target} />
        <TestHook />
      </Canvas>
      <div className="overlay">3D（1本指:回転 2本指:拡大・移動／選択ツールで配管の点をドラッグ）</div>
    </div>
  );
}
