/**
 * 3D表示。共通ストアの Network から生成。ノードをドラッグすると同じ高さの水平面上で移動し、
 * 共通ストアを更新する（→ 2D平面図にも即時反映）。
 * 座標変換: 共通座標(mm, z=高さ) → three(m, y=上): (x, z, -y)/1000
 */
import { useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../state/store';
import type { Vec3 } from '../model/network';
import { SELECT_COLOR, systemColor } from './colors';

const toThree = (p: Vec3) => new THREE.Vector3(p.x / 1000, p.z / 1000, -p.y / 1000);
const UP = new THREE.Vector3(0, 1, 0);

function Pipe({ a, b, radius, color, selected, onSelect }: { a: Vec3; b: Vec3; radius: number; color: string; selected: boolean; onSelect: () => void }) {
  const { pos, quat, len } = useMemo(() => {
    const va = toThree(a), vb = toThree(b);
    const dir = vb.clone().sub(va);
    return { pos: va.clone().add(vb).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()), len: dir.length() };
  }, [a, b]);
  return (
    <mesh position={pos} quaternion={quat} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
      <cylinderGeometry args={[radius, radius, len, 12]} />
      <meshStandardMaterial color={selected ? SELECT_COLOR : color} emissive={selected ? SELECT_COLOR : '#000'} emissiveIntensity={selected ? 0.4 : 0} />
    </mesh>
  );
}

/** E2Eテスト用: ノードの画面座標を返す（技術検証版のみ） */
function TestHook() {
  const { camera, size } = useThree();
  (window as unknown as { __pc3d: unknown }).__pc3d = {
    project: (nodeId: string) => {
      const n = useStore.getState().network.nodes[nodeId];
      const v = toThree(n.pos).project(camera);
      return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
    },
  };
  return null;
}

function Scene({ setOrbit }: { setOrbit: (v: boolean) => void }) {
  const net = useStore((s) => s.network);
  const selSeg = useStore((s) => s.selectedSegmentId);
  const selNode = useStore((s) => s.selectedNodeId);
  const tool = useStore((s) => s.tool);
  const drag = useRef<{ nodeId: string; plane: THREE.Plane } | null>(null);
  const [dragging, setDragging] = useState(false);

  const startDrag = (e: ThreeEvent<PointerEvent>, nodeId: string) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    const st = useStore.getState();
    st.select({ nodeId });
    st.beginDrag();
    const h = st.network.nodes[nodeId].pos.z / 1000;
    drag.current = { nodeId, plane: new THREE.Plane(UP, -h) };
    setDragging(true);
    setOrbit(false);
    (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
  };
  const moveDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(drag.current.plane, hit)) return;
    const st = useStore.getState();
    const n = st.network.nodes[drag.current.nodeId];
    st.dragNode(drag.current.nodeId, { x: hit.x * 1000, y: -hit.z * 1000, z: n.pos.z });
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setOrbit(true);
    useStore.getState().endDrag();
  };

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 10, 5]} intensity={1} />
      <Grid args={[40, 40]} cellSize={1} sectionSize={5} infiniteGrid fadeDistance={60} cellColor="#d1d5db" sectionColor="#9ca3af" />
      {Object.values(net.segments).map((s) => (
        <Pipe key={s.id} a={net.nodes[s.a].pos} b={net.nodes[s.b].pos} radius={Math.max(0.015, s.diameter / 2000)}
          color={systemColor(s.system)} selected={s.id === selSeg}
          onSelect={() => useStore.getState().select({ segmentId: s.id })} />
      ))}
      {Object.values(net.nodes).map((n) => (
        <mesh key={n.id} position={toThree(n.pos)} onPointerDown={(e) => startDrag(e, n.id)}>
          <sphereGeometry args={[n.kind === 'tee' || n.kind === 'cross' ? 0.07 : 0.05, 16, 16]} />
          <meshStandardMaterial color={n.id === selNode ? SELECT_COLOR : n.kind === 'tee' ? '#111827' : '#f9fafb'} />
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

export function View3D() {
  const [orbit, setOrbit] = useState(true);
  return (
    <div className="view3d" data-testid="view3d">
      <Canvas camera={{ position: [4, 6, 8], fov: 50 }} gl={{ preserveDrawingBuffer: true }}
        onPointerMissed={() => useStore.getState().select({})}>
        <Scene setOrbit={setOrbit} />
        <TestHook />
        <OrbitControls makeDefault enabled={orbit} target={[2, 0, -1]} />
      </Canvas>
      <div className="overlay">3D（1本指:回転 2本指:拡大・移動／選択モードで点をドラッグ）</div>
    </div>
  );
}
