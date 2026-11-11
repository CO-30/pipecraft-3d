/**
 * 給水・給湯の管種（材質）。屋内・床下はブリヂストン「プッシュマスター」のポリブテン管（PB）、屋外は HIVP/HTVP。
 * 「自動」で描いた配管は、建物の外周の内か外かで管種を決め、外周をまたぐ配管は外壁の外で分けて
 * つなぎ目を「HIVP変換継手」にする。純粋関数。
 */
import type { Building } from './building';
import { wallsOnFloor } from './building';
import { membersOf } from './members';
import { pointInPolygon } from './roomOps';
import { floorIndexForZ } from './pipeFloors';
import { outlineLoop } from './sketch';
import { splitSegment, type Network, type SystemType, type Vec3 } from './network';

type Vec2 = { x: number; y: number };

/** プッシュマスターのポリブテン管（らく楽パイプ）。管の名前に「PB」を含めるとこの扱い */
export const PB_MATERIALS = ['PB保温5mm', 'PB保温10mm', 'PB', 'PBさや管付'] as const;
export const PB_MATERIAL_LABEL: Record<(typeof PB_MATERIALS)[number], string> = {
  PB保温5mm: 'PB 保温5mm（プッシュマスター）',
  PB保温10mm: 'PB 保温10mm（プッシュマスター）',
  PB: 'PB 裸管（プッシュマスター）',
  PBさや管付: 'PB さや管付（らく楽コルゲート）',
};
/** 給水・給湯で選べる管種（先頭の '' は「自動」） */
export const WATER_MATERIAL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '自動（屋内PB・屋外HI）' },
  ...PB_MATERIALS.map((m) => ({ value: m, label: PB_MATERIAL_LABEL[m] })),
  { value: 'HIVP', label: 'HIVP（耐衝撃塩ビ）' },
  { value: 'HTVP', label: 'HTVP（耐熱塩ビ）' },
];

export const isPB = (m?: string) => !!m && m.trim().toUpperCase().startsWith('PB');
/** 図面に書く管種（PB の保温・さや管の違いは書かない） */
export const drawingMaterial = (m?: string) => (isPB(m) ? 'PB' : m ?? '');
/** つなぎ目の部品を決めるための管の系列（PB の保温違いは同じ管） */
export const materialFamily = (m?: string) => (isPB(m) ? 'PB' : (m ?? '').trim());

/** 自動のときの管種 */
export const AUTO_MATERIAL: Record<'indoor' | 'outdoor', Partial<Record<SystemType, string>>> = {
  indoor: { water: 'PB保温5mm', hotWater: 'PB保温10mm' },
  outdoor: { water: 'HIVP', hotWater: 'HTVP' },
};
/** 外周をまたぐ配管の、PB から HIVP へ替える位置（外壁の芯から外へ mm） */
export const TRANSITION_OUT = 300;
/** これより短い屋外部分は分けない（mm） */
const MIN_PART = 50;

const FAR = 100_000;
function segX(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number | null {
  // p→q と a→b の交点の p からの割合（0〜1）。交わらなければ null
  const r = { x: q.x - p.x, y: q.y - p.y }, s = { x: b.x - a.x, y: b.y - a.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - p.x) * s.y - (a.y - p.y) * s.x) / den;
  const u = ((a.x - p.x) * r.y - (a.y - p.y) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

export type Outline = { inside(p: Vec2): boolean; edges: [Vec2, Vec2][] };

/**
 * その階の建物の外周。外壁が 1 周つながっていればその多角形、つながっていなければ
 * 「東西南北どちらを見ても壁か基礎の立上りに当たる」点を建物の中とする。壁が無ければ null
 */
export function buildingOutline(b: Building, floorId: string): Outline | null {
  const loop = outlineLoop(b, floorId);
  if (loop) {
    const poly = loop.corners.map((id) => ({ x: b.corners[id].x, y: b.corners[id].y }));
    return { inside: (p) => pointInPolygon(p, poly), edges: poly.map((p, i) => [p, poly[(i + 1) % poly.length]]) };
  }
  const lines: [Vec2, Vec2][] = [
    ...wallsOnFloor(b, floorId).map((w) => [b.corners[w.a], b.corners[w.b]] as [Vec2, Vec2]),
    ...membersOf(b).filter((m) => m.kind === 'footing' && m.floorId === floorId).map((m) => [m.a, m.b] as [Vec2, Vec2]),
  ];
  if (lines.length < 3) return null;
  const inside = (p: Vec2) => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => lines.some(([a, c]) => segX(p, { x: p.x + dx * FAR, y: p.y + dy * FAR }, a, c) !== null));
  return { inside, edges: lines };
}

/**
 * 「自動」の給水・給湯の配管（material 未設定）に管種を付ける。segIds だけが対象。
 * 外周をまたぐ配管は外壁の外 TRANSITION_OUT の所で分け、内を PB・外を HIVP/HTVP にする。
 */
export function assignAutoMaterials(net: Network, b: Building, segIds: string[]): Network {
  if (!b.floors.length) return net;
  const outlines = new Map<string, Outline | null>();
  const outlineFor = (z: number) => {
    const f = b.floors[floorIndexForZ(b.floors, z)];
    if (!outlines.has(f.id)) outlines.set(f.id, buildingOutline(b, f.id));
    return outlines.get(f.id) ?? null;
  };
  const set = (n: Network, id: string, inside: boolean): Network => {
    const s = n.segments[id];
    const m = AUTO_MATERIAL[inside ? 'indoor' : 'outdoor'][s.system];
    return m ? { ...n, segments: { ...n.segments, [id]: { ...s, material: m } } } : n;
  };
  let out = net;
  for (const id of segIds) {
    const s = out.segments[id];
    if (!s || s.material?.trim() || (s.system !== 'water' && s.system !== 'hotWater')) continue;
    const pa = out.nodes[s.a].pos, pb = out.nodes[s.b].pos;
    const ol = outlineFor(Math.max(pa.z, pb.z));
    if (!ol) continue; // 建物が無い現場は従来どおり（未設定 = HIVP/HTVP 扱い）
    const ia = ol.inside(pa), ib = ol.inside(pb);
    if (ia === ib) { out = set(out, id, ia); continue; }
    // 外周をまたぐ: 外側の端に近い交点の、さらに外へ TRANSITION_OUT の所で分ける
    const [pin, pout] = ia ? [pa, pb] : [pb, pa];
    const len = Math.hypot(pout.x - pin.x, pout.y - pin.y);
    const ts = ol.edges.map(([a, c]) => segX(pin, pout, a, c)).filter((t): t is number => t !== null);
    const tx = ts.length ? Math.max(...ts) : 0.5;
    const outLen = (1 - tx) * len;
    if (len < 1 || outLen < MIN_PART) { out = set(out, id, true); continue; }
    const t = Math.min(1 - MIN_PART / len, tx + Math.min(TRANSITION_OUT, outLen / 2) / len);
    const p: Vec3 = { x: Math.round(pin.x + (pout.x - pin.x) * t), y: Math.round(pin.y + (pout.y - pin.y) * t), z: pin.z + (pout.z - pin.z) * t };
    const inNode = ia ? s.a : s.b;
    const r = splitSegment(out, id, p);
    out = r.net;
    // 内側の端を含む方が屋内（中点で決めると、壁ぎわの器具から出る短い配管を屋外と取り違える）
    for (const sid of r.segmentIds) {
      const q = out.segments[sid];
      out = set(out, sid, r.segmentIds.length === 1 || q.a === inNode || q.b === inNode);
    }
  }
  return out;
}
