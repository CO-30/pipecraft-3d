/**
 * 3D表示。共通ストアの Doc から生成（建物は buildingBoxes、配管はネットワーク）。
 * ノードをドラッグすると同じ高さの水平面上で移動し、共通ストアを更新する（→ 2D平面図にも即時反映）。
 * 座標変換: 共通座標(mm, z=高さ) → three(m, y=上): (x, z, -y)/1000
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useStore, type SelKind, type VisMode } from '../state/store';
import type { Vec3 } from '../model/network';
import { buildingBoxes, type Box } from '../model/building3d';
import { floorById } from '../model/building';
import { clampSection, sectionPlane } from '../model/section';
import { SELECT_COLOR, systemColor, useColors } from './colors';
import { fixtureBaseZ, fixtureSize, groundZ, isManhole, type Fixture } from '../model/fixtures';

/** 器具の簡易3D形状（箱）。表示モードと選択強調つき */
function FixtureMesh({ f, mode, selected, clip }: { f: Fixture; mode: VisMode; selected: boolean; clip: THREE.Plane[] }) {
  const floor = useStore((s) => s.doc.building.floors.find((x) => x.id === f.floorId));
  const site = useStore((s) => s.doc.site);
  if (mode === 'hide' || !floor) return null;
  const manhole = isManhole(f.type);
  const { w, d, h } = fixtureSize(f, floor, site);
  // マスは地面（GL）から下へ埋まる
  const z = manhole ? groundZ(floor, site) - h / 2 : fixtureBaseZ(f, floor) + h / 2;
  const ghost = mode === 'ghost';
  return (
    <mesh name={`fixture-${f.id}`} position={toThree({ x: f.x, y: f.y, z })} rotation={[0, (f.rotation * Math.PI) / 180, 0]} renderOrder={1}
      onClick={(e) => { e.stopPropagation(); useStore.getState().select({ kind: 'fixture', id: f.id }); }}
      raycast={ghost ? () => null : undefined}>
      {manhole && f.params?.shape !== 'square' ? <cylinderGeometry args={[w / 2000, w / 2000, h / 1000, 24]} /> : <boxGeometry args={[w / 1000, h / 1000, d / 1000]} />}
      <meshStandardMaterial color={selected ? SELECT_COLOR : manhole ? '#d6d3d1' : '#e0f2fe'} emissive={selected ? SELECT_COLOR : '#000'} emissiveIntensity={selected ? 0.3 : 0}
        transparent={ghost} opacity={ghost ? 0.3 : 1} clippingPlanes={clip} />
    </mesh>
  );
}

const GRID_SNAP = 50;
const snap = (v: number) => Math.round(v / GRID_SNAP) * GRID_SNAP;
const toThree = (p: Vec3) => new THREE.Vector3(p.x / 1000, p.z / 1000, -p.y / 1000);
const UP = new THREE.Vector3(0, 1, 0);

const CAT_COLOR: Record<Box['category'], string> = {
  exteriorWall: '#e7e5e4', interiorWall: '#f5f5f4', floor: '#d6d3d1', ceiling: '#fafaf9', door: '#a16207', window: '#7dd3fc', member: '#a8a29e',
};

function Pipe({ a, b, radius, color, selected, mode, onSelect, clip }: { a: Vec3; b: Vec3; radius: number; color: string; selected: boolean; mode: VisMode; onSelect: () => void; clip: THREE.Plane[] }) {
  const { pos, quat, len } = useMemo(() => {
    const va = toThree(a), vb = toThree(b);
    const dir = vb.clone().sub(va);
    return { pos: va.clone().add(vb).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()), len: dir.length() };
  }, [a, b]);
  if (mode === 'hide') return null;
  return (
    <mesh position={pos} quaternion={quat} onClick={(e) => { e.stopPropagation(); onSelect(); }} renderOrder={2}>
      <cylinderGeometry args={[selected ? radius * 1.6 : radius, selected ? radius * 1.6 : radius, len, 12]} />
      <meshStandardMaterial color={selected ? SELECT_COLOR : color} emissive={selected ? SELECT_COLOR : '#000'} emissiveIntensity={selected ? 0.5 : 0}
        transparent={mode === 'ghost'} opacity={mode === 'ghost' ? 0.3 : 1} clippingPlanes={clip} />
    </mesh>
  );
}

const BoxMesh = memo(function BoxMesh({ box, mode, selected, onSelect, onGrab, clip }: { box: Box; mode: VisMode; selected: boolean; onSelect?: () => void; onGrab?: (e: ThreeEvent<PointerEvent>) => void; clip: THREE.Plane[] }) {
  if (mode === 'hide') return null;
  const ghost = mode === 'ghost';
  return (
    <mesh position={toThree(box.center)} rotation={[0, box.rotationZ, 0]}
      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
      onPointerDown={onGrab}
      raycast={ghost ? () => null : clip.length ? function (this: THREE.Mesh, rc: THREE.Raycaster, hits: THREE.Intersection[]) {
        // 断面で切り取られて見えない部分はタップに反応させない
        const tmp: THREE.Intersection[] = [];
        THREE.Mesh.prototype.raycast.call(this, rc, tmp);
        hits.push(...tmp.filter((h) => clip.every((pl) => pl.distanceToPoint(h.point) >= 0)));
      } : undefined}>
      <boxGeometry args={[box.size.x / 1000, box.size.z / 1000, box.size.y / 1000]} />
      <meshStandardMaterial color={selected ? SELECT_COLOR : CAT_COLOR[box.category]} transparent={ghost} opacity={ghost ? 0.18 : 1} depthWrite={!ghost}
        clippingPlanes={clip} clipShadows side={clip.length ? THREE.DoubleSide : THREE.FrontSide} />
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
      projectPoint: (x: number, y: number, z: number) => {
        const v = toThree({ x, y, z }).project(camera);
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
  const section = useStore((s) => s.section);
  const floorFilter = useStore((s) => s.floorFilter);
  const activeFloorId = useStore((s) => s.activeFloorId);
  const fixtures = useStore((s) => s.doc.fixtures);
  useColors((c) => c.overrides);
  const allBoxes = useMemo(() => buildingBoxes(building), [building]);
  const boxes = useMemo(() => {
    if (floorFilter === 'all') return allBoxes;
    const idx = new Map(building.floors.map((f, i) => [f.id, i]));
    const act = idx.get(activeFloorId) ?? 0;
    return allBoxes.filter((b) => (floorFilter === 'activeOnly' ? idx.get(b.floorId) === act : (idx.get(b.floorId) ?? 0) <= act));
  }, [allBoxes, building.floors, floorFilter, activeFloorId]);
  const clip = useMemo(() => {
    const p = sectionPlane(clampSection(building, section));
    if (!p) return [];
    // 共通座標 → three: (x, z, -y)/1000
    return [new THREE.Plane(new THREE.Vector3(p.normal.x, p.normal.z, -p.normal.y), p.constant / 1000)];
  }, [section, building]);
  /** 階フィルタで見せる高さの範囲（配管にも適用。床下配管も含めるため下は1000mm余裕） */
  const zRange = useMemo((): [number, number] => {
    if (floorFilter === 'all') return [-Infinity, Infinity];
    const i = Math.max(0, building.floors.findIndex((f) => f.id === activeFloorId));
    const f = building.floors[i];
    if (!f) return [-Infinity, Infinity];
    return [floorFilter === 'activeOnly' ? f.elevation - 1000 : -Infinity, f.elevation + f.height];
  }, [floorFilter, building.floors, activeFloorId]);
  const zIn = (z: number) => z >= zRange[0] && z < zRange[1];
  const shownFloorIds = useMemo(() => new Set(boxes.map((b) => b.floorId)), [boxes]);
  type Drag =
    | { kind: 'node'; nodeId: string; plane: THREE.Plane }
    | { kind: 'wall'; wallId: string; plane: THREE.Plane; start: { x: number; y: number } }
    | { kind: 'corner'; cornerId: string; plane: THREE.Plane; offset: { x: number; y: number } };
  const drag = useRef<Drag | null>(null);
  const { camera, gl } = useThree();
  const controls = useThree((st) => st.controls) as unknown as { enabled: boolean } | null;
  /** カメラ操作を同期的に止める（再描画を待つと OrbitControls が先にポインタをつかんで回転してしまう） */
  const lockOrbit = (locked: boolean) => {
    if (controls) controls.enabled = !locked;
    setOrbit(!locked);
  };

  const stopListening = useRef<(() => void) | null>(null);
  // 表示が切り替わってドラッグ途中で消えた場合も、ウィンドウのリスナーを確実に外してドラッグを確定する
  useEffect(() => () => stopListening.current?.(), []);

  /** ドラッグ中はウィンドウでポインタを受ける（3D内の受け面の描画を待たないので取りこぼさない）。つかんだ指以外は無視 */
  const listen = (pointerId: number) => {
    const ray = new THREE.Raycaster();
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      moveDrag(ray.ray);
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      stopListening.current = null;
      endDrag();
    };
    const onUp = (ev: PointerEvent) => { if (ev.pointerId === pointerId) stop(); };
    stopListening.current = stop;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const modeFor = (cat: keyof typeof vis, id: string): VisMode => {
    if (hiddenIds.includes(id) || vis[cat] === 'hide') return 'hide';
    if (ghostIds.includes(id) || vis[cat] === 'ghost') return 'ghost';
    return 'show';
  };
  const selKindFor = (b: Box): SelKind | null =>
    b.category.endsWith('Wall') ? 'wall' : b.category === 'door' || b.category === 'window' ? 'opening' : b.category === 'member' ? 'member' : null;

  const startDrag = (e: ThreeEvent<PointerEvent>, nodeId: string) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    const st = useStore.getState();
    st.select({ kind: 'node', id: nodeId });
    st.beginDrag();
    drag.current = { kind: 'node', nodeId, plane: new THREE.Plane(UP, -st.doc.network.nodes[nodeId].pos.z / 1000) };
    lockOrbit(true);
    listen(e.pointerId);
  };
  /** 選択済みの壁・角だけをつかめる（未選択の上のドラッグは回転のまま） */
  const startBuildingDrag = (e: ThreeEvent<PointerEvent>, d: { kind: 'wall'; wallId: string } | { kind: 'corner'; cornerId: string }) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    const plane = new THREE.Plane(UP, -e.point.y);
    const st = useStore.getState();
    const hit = { x: e.point.x * 1000, y: -e.point.z * 1000 };
    if (d.kind === 'corner' && !st.doc.building.corners[d.cornerId]) return;
    st.beginDrag();
    if (d.kind === 'wall') drag.current = { ...d, plane, start: hit };
    else {
      // つかんだ位置と角の中心のずれを保つ（つかんだ瞬間に角が跳ねないように）
      const c = st.doc.building.corners[d.cornerId];
      drag.current = { ...d, plane, offset: { x: c.x - hit.x, y: c.y - hit.y } };
    }
    lockOrbit(true);
    listen(e.pointerId);
  };
  const moveDrag = (ray: THREE.Ray) => {
    const d = drag.current;
    if (!d) return;
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(d.plane, hit)) return;
    const st = useStore.getState();
    const p = { x: hit.x * 1000, y: -hit.z * 1000 };
    if (d.kind === 'node') {
      const n = st.doc.network.nodes[d.nodeId];
      if (n) st.dragNode(d.nodeId, { ...p, z: n.pos.z });
    } else if (d.kind === 'wall') {
      st.dragWall(d.wallId, snap(p.x - d.start.x), snap(p.y - d.start.y));
    } else {
      st.dragCorner(d.cornerId, { x: snap(p.x + d.offset.x), y: snap(p.y + d.offset.y) });
    }
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    lockOrbit(false);
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
        const selected = !!k && sel?.kind === k && sel.id === b.elementId;
        return (
          <BoxMesh key={b.key} box={b} mode={modeFor(b.category, b.elementId)} selected={selected} clip={clip}
            onSelect={k ? () => useStore.getState().select({ kind: k, id: b.elementId }) : undefined}
            onGrab={selected && k === 'wall' && tool === 'select' ? (e) => startBuildingDrag(e, { kind: 'wall', wallId: b.elementId }) : undefined} />
        );
      })}
      {tool === 'select' && sel?.kind === 'wall' && building.walls[sel.id] && shownFloorIds.has(building.walls[sel.id].floorId) && (() => {
        const w = building.walls[sel.id];
        const f = floorById(building, w.floorId);
        if (!f) return null;
        const h = f.height - f.slabThickness;
        return [w.a, w.b].map((cid) => {
          const c = building.corners[cid];
          return (
            <mesh key={cid} name={`corner-handle-${cid}`} position={toThree({ x: c.x, y: c.y, z: f.elevation + h / 2 })} renderOrder={4}
              onPointerDown={(e) => startBuildingDrag(e, { kind: 'corner', cornerId: cid })}>
              <cylinderGeometry args={[0.13, 0.13, h / 1000 + 0.1, 20]} />
              <meshStandardMaterial color={SELECT_COLOR} transparent opacity={0.85} />
            </mesh>
          );
        });
      })()}
      {Object.values(net.segments).filter((s) => zIn(net.nodes[s.a].pos.z) || zIn(net.nodes[s.b].pos.z)).map((s) => (
        <Pipe clip={clip} key={s.id} a={net.nodes[s.a].pos} b={net.nodes[s.b].pos} radius={Math.max(0.025, s.diameter / 1500)}
          color={systemColor(s.system)} selected={sel?.kind === 'segment' && sel.id === s.id} mode={pipeMode}
          onSelect={() => useStore.getState().select({ kind: 'segment', id: s.id })} />
      ))}
      {Object.values(fixtures).filter((f) => floorFilter === 'all' || shownFloorIds.has(f.floorId)).map((f) => (
        <FixtureMesh key={f.id} f={f} clip={clip} selected={sel?.kind === 'fixture' && sel.id === f.id} mode={modeFor('fixtures', f.id)} />
      ))}
      {pipeMode !== 'hide' && Object.values(net.nodes).filter((n) => zIn(n.pos.z)).map((n) => (
        <mesh key={n.id} position={toThree(n.pos)} onPointerDown={n.fixtureId ? undefined : (e) => startDrag(e, n.id)}
          onClick={n.fixtureId ? (e) => { e.stopPropagation(); useStore.getState().select({ kind: 'node', id: n.id }); } : undefined} renderOrder={3}>
          <sphereGeometry args={[n.kind === 'tee' || n.kind === 'cross' ? 0.07 : n.fixtureId ? 0.045 : 0.05, 16, 16]} />
          <meshStandardMaterial clippingPlanes={clip} color={sel?.kind === 'node' && sel.id === n.id ? SELECT_COLOR : n.kind === 'tee' || n.kind === 'cross' ? '#111827' : n.kind === 'valve' ? '#f97316' : n.fixtureId ? '#0e7490' : '#f9fafb'} />
        </mesh>
      ))}
    </>
  );
}

/** 建物全体が画面に収まるカメラ位置（南東の斜め上から。縦長の画面では離れる） */
function fitCamera(aspect: number, fovDeg: number): { pos: [number, number, number]; target: [number, number, number] } {
  const cs = Object.values(useStore.getState().doc.building.corners);
  const floors = useStore.getState().doc.building.floors;
  const topZ = floors.length ? (floors.at(-1)!.elevation + floors.at(-1)!.height) / 1000 : 3;
  if (!cs.length) return { pos: [6, 8, 10], target: [2, 0, -2] };
  const xs = cs.map((c) => c.x / 1000), ys = cs.map((c) => c.y / 1000);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const radius = Math.max(2, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), topZ) / 2);
  const vfov = (fovDeg * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.05;
  const dir = new THREE.Vector3(0.55, 0.65, 0.75).normalize();
  const t = new THREE.Vector3(cx, topZ / 2, -cy);
  const p = t.clone().addScaledVector(dir, dist);
  return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
}

const FOV = 50;
/** 初回表示時だけ、画面の縦横比に合わせて建物全体が入るようにする */
function AutoFit({ onTarget }: { onTarget: (t: [number, number, number]) => void }) {
  const { camera, size } = useThree();
  const done = useRef(false);
  useLayoutEffect(() => {
    if (done.current || size.width <= 0 || size.height <= 0) return;
    done.current = true;
    const c = fitCamera(size.width / size.height, FOV);
    camera.position.set(...c.pos);
    camera.lookAt(...c.target);
    onTarget(c.target);
  }, [camera, size.width, size.height, onTarget]);
  return null;
}

export function View3D() {
  const [orbit, setOrbit] = useState(true);
  const [target, setTarget] = useState<[number, number, number]>([0, 1, 0]);
  return (
    <div className="view3d" data-testid="view3d">
      <Canvas camera={{ position: [10, 10, 10], fov: FOV, near: 0.05, far: 500 }} gl={{ preserveDrawingBuffer: true, localClippingEnabled: true }}
        onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
        onPointerMissed={() => useStore.getState().select(null)}>
        <Scene setOrbit={setOrbit} />
        <AutoFit onTarget={setTarget} />
        <OrbitControls makeDefault enabled={orbit} target={target} />
        <TestHook />
      </Canvas>
      <div className="overlay">3D（1本指:回転 2本指:拡大・移動／選択ツール: 配管の点、選択した壁・角をドラッグで移動）</div>
    </div>
  );
}
