/**
 * 部材図（施工用）のデータ。見積とは別に、サドル・継手・ネジ継手・器具などの「どこに何を付けるか」を
 * 階ごとの平面図と立面図（外配管）に記号で描くためのもの。金額は含めない。
 * computeEstimate の結果（部品判定・支持金具の位置・継ぎ足しソケットの位置）から作るので、数量表と個数が一致する。
 */
import type { Doc } from '../model/doc';
import { floorById, type Floor } from '../model/building';
import { computeEstimate, fittingSpec, pipeSpec, SYSTEM_LABEL, type Estimate } from '../model/estimate';
import { fittingName, type FittingType } from '../model/fittings';
import { FIXTURE_CATALOG, fixtureCorners } from '../model/fixtures';
import { worldToElev } from '../model/elevation';
import { SUPPORT_LABEL, type SupportKind } from '../model/supports';
import type { SystemType, Vec3 } from '../model/network';

export type P2 = { x: number; y: number };
export type MarkKind = 'fitting' | 'confirm' | 'support';
export type DrawMark = { p: P2; code: string; kind: MarkKind; support?: SupportKind; /** 支持金具の向き（配管の向き） */ dir?: P2 };
export type DrawPipe = { a: P2; b: P2; system: SystemType; diameter: number };
export type LegendRow = { code: string; name: string; spec: string; count: number; kind: MarkKind; support?: SupportKind };
export type DrawPage = {
  kind: 'plan' | 'elevation';
  title: string;
  /** 図の範囲（mm、平面は y 下向き、立面は v 上向きを y 下向きに反転済み） */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  walls: { a: P2; b: P2; thickness: number }[];
  /** 立面の外形 */
  frame?: { w: number; h: number };
  fixtures: { corners: P2[]; label: string }[];
  pipes: DrawPipe[];
  /** 縦管（平面図では点） */
  risers: { p: P2; system: SystemType; diameter: number }[];
  marks: DrawMark[];
  legend: LegendRow[];
};
export type PartsRow = { group: string; name: string; spec: string; qty: number | string; unit: string; note: string };
export type Drawing = { pages: DrawPage[]; parts: PartsRow[]; est: Estimate };

/** 継手の記号（図の上の短い文字） */
export const FITTING_CODE: Record<FittingType, string> = {
  elbow90: 'L', elbow45: '45', elbow: 'L*', socket: 'S', reducer: 'RS', tee: 'T', wye: 'Y', cross: '+',
  valve: 'V', adapter: 'A', junctionBox: 'J', cap: 'C', other: '?', faucetElbow: 'WL', faucetSocket: 'WS', threadSocket: 'VS',
};
export const SUPPORT_CODE: Record<SupportKind, string> = { saddle: 'SB', levelBand: 'LB', tBracket: 'TB' };

const onFloor = (b: Doc['building'], f: Floor, z: number) => {
  const last = b.floors.at(-1)?.id === f.id;
  return z >= f.elevation - 1 && (z < f.elevation + f.height - 1 || (last && z <= f.elevation + f.height + 1));
};

function bounds(ps: P2[], pad: number) {
  if (ps.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  return { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad };
}

function legendOf(marks: (DrawMark & { name: string; spec: string })[]): LegendRow[] {
  const m = new Map<string, LegendRow>();
  for (const k of marks) {
    const key = `${k.kind}|${k.code}|${k.name}|${k.spec}`;
    const r = m.get(key);
    if (r) r.count++; else m.set(key, { code: k.code, name: k.name, spec: k.spec, count: 1, kind: k.kind, support: k.support });
  }
  return [...m.values()].sort((a, b) => (a.kind === b.kind ? a.code.localeCompare(b.code) || a.spec.localeCompare(b.spec, 'ja') : a.kind.localeCompare(b.kind)));
}

export function buildDrawing(doc: Doc, est: Estimate = computeEstimate(doc)): Drawing {
  const b = doc.building, net = doc.network;
  // 図に載せる記号（世界座標）
  type WMark = { pos: Vec3; segId?: string; nodeId?: string; code: string; kind: MarkKind; support?: SupportKind; name: string; spec: string; dir?: Vec3 };
  const wmarks: WMark[] = [];
  const segOf = (id: string) => net.segments[id];
  for (const f of est.nodeFittings) {
    if (f.type === 'none' && !f.needsConfirm) continue;
    const n = net.nodes[f.nodeId];
    if (!n) continue;
    if (f.needsConfirm) { wmarks.push({ pos: n.pos, nodeId: n.id, code: '!', kind: 'confirm', name: '要確認の点', spec: f.reason ?? '' }); continue; }
    if (f.type === 'none') continue;
    wmarks.push({ pos: n.pos, nodeId: n.id, code: FITTING_CODE[f.type], kind: 'fitting', name: fittingName(f.type, f.size), spec: fittingSpec({ system: f.main.system, material: est.fittings.find((l) => l.nodeIds.includes(f.nodeId))?.material ?? '', size: f.size }) });
  }
  for (const j of est.stockJointMarks) {
    const line = est.fittings.find((l) => l.key === j.key);
    wmarks.push({ pos: j.pos, segId: j.segId, code: 'S', kind: 'fitting', name: '定尺の継ぎ足しソケット', spec: line ? fittingSpec(line) : '' });
  }
  for (const s of est.supportMarks) {
    const seg = segOf(s.segId);
    const pa = seg ? net.nodes[seg.a].pos : s.pos, pb = seg ? net.nodes[seg.b].pos : s.pos;
    wmarks.push({ pos: s.pos, segId: s.segId, code: SUPPORT_CODE[s.kind], kind: 'support', support: s.kind, name: SUPPORT_LABEL[s.kind], spec: `φ${s.diameter}`, dir: { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z } });
  }

  const pages: DrawPage[] = [];
  // ---- 階ごとの平面図 ----
  for (const f of b.floors) {
    const walls = Object.values(b.walls).filter((w) => w.floorId === f.id).map((w) => ({ a: b.corners[w.a], b: b.corners[w.b], thickness: w.thickness }));
    const fixtures = Object.values(doc.fixtures).filter((x) => x.floorId === f.id).map((x) => ({ corners: fixtureCorners(x), label: FIXTURE_CATALOG[x.type].label }));
    const pipes: DrawPipe[] = [], risers: DrawPage['risers'] = [];
    for (const s of Object.values(net.segments)) {
      const A = net.nodes[s.a].pos, B = net.nodes[s.b].pos;
      const inA = onFloor(b, f, A.z), inB = onFloor(b, f, B.z);
      // 縦管は、この階を通っていれば点で描く
      if (Math.hypot(B.x - A.x, B.y - A.y) < 1) {
        const lo = Math.min(A.z, B.z), hi = Math.max(A.z, B.z);
        if (hi >= f.elevation && lo < f.elevation + f.height) risers.push({ p: { x: A.x, y: A.y }, system: s.system, diameter: s.diameter });
        continue;
      }
      if (inA || inB) pipes.push({ a: { x: A.x, y: A.y }, b: { x: B.x, y: B.y }, system: s.system, diameter: s.diameter });
    }
    const ms = wmarks.filter((m) => onFloor(b, f, m.pos.z));
    if (walls.length === 0 && pipes.length === 0 && risers.length === 0 && fixtures.length === 0) continue;
    const marks = ms.map((m) => ({ ...m, p: { x: m.pos.x, y: m.pos.y }, dir: m.dir ? { x: m.dir.x, y: m.dir.y } : undefined }));
    const pts: P2[] = [...walls.flatMap((w) => [w.a, w.b]), ...pipes.flatMap((p) => [p.a, p.b]), ...risers.map((r) => r.p), ...fixtures.flatMap((x) => x.corners)];
    pages.push({ kind: 'plan', title: `${f.name} 平面`, bounds: bounds(pts, 600), walls, fixtures, pipes, risers, marks, legend: legendOf(marks) });
  }

  // ---- 立面図（外配管） ----
  for (const el of Object.values(doc.elevations ?? {})) {
    const segs = Object.values(net.segments).filter((s) => s.face === el.id);
    if (segs.length === 0) continue;
    const uv = (p: Vec3): P2 => { const r = worldToElev(el, p); return { x: r.u, y: el.height - (p.z - el.baseZ) }; };
    const ids = new Set(segs.map((s) => s.id));
    const nodeIds = new Set(segs.flatMap((s) => [s.a, s.b]));
    const pipes = segs.map((s) => ({ a: uv(net.nodes[s.a].pos), b: uv(net.nodes[s.b].pos), system: s.system, diameter: s.diameter }));
    const ms = wmarks.filter((m) => (m.segId && ids.has(m.segId)) || (m.nodeId && nodeIds.has(m.nodeId)));
    const marks = ms.map((m) => {
      let dir: P2 | undefined;
      if (m.dir) { const p0 = uv({ x: 0, y: 0, z: el.baseZ }), p1 = uv({ x: m.dir.x, y: m.dir.y, z: el.baseZ + m.dir.z }); dir = { x: p1.x - p0.x, y: p1.y - p0.y }; }
      return { ...m, p: uv(m.pos), dir };
    });
    const floor = floorById(b, el.floorId);
    pages.push({
      kind: 'elevation', title: `${el.label} 立面（外配管）${floor ? `・${floor.name}基準` : ''}`,
      bounds: bounds([{ x: 0, y: 0 }, { x: el.width, y: el.height }, ...pipes.flatMap((p) => [p.a, p.b])], 500),
      walls: [], frame: { w: el.width, h: el.height }, fixtures: [], pipes, risers: [], marks, legend: legendOf(marks),
    });
  }

  // ---- 部材一覧（金額なし） ----
  const parts: PartsRow[] = [];
  for (const p of est.pipes) parts.push({ group: '配管・配線', name: p.name, spec: pipeSpec(p), qty: p.orderQty, unit: p.orderUnit, note: `使用長 ${Math.round(p.usedLength / 10) / 100}m` });
  for (const l of est.fittings) parts.push({ group: '継手', name: `[${FITTING_CODE[l.type]}] ${l.name}`, spec: fittingSpec(l), qty: l.count, unit: '個', note: l.stockJoints ? `継ぎ足し ${l.stockJoints}個を含む` : '' });
  for (const l of est.supports) {
    const kind = l.key.split('|')[1] as SupportKind;
    parts.push({ group: '支持金具・ビス', name: SUPPORT_CODE[kind] ? `[${SUPPORT_CODE[kind]}] ${l.name}` : l.name, spec: l.spec, qty: l.count, unit: l.unit, note: l.note });
  }
  for (const l of est.consumables) parts.push({ group: '消耗品', name: l.name, spec: l.spec, qty: l.count, unit: l.unit, note: l.note });
  const fx = new Map<string, number>();
  for (const x of Object.values(doc.fixtures)) fx.set(FIXTURE_CATALOG[x.type].label, (fx.get(FIXTURE_CATALOG[x.type].label) ?? 0) + 1);
  for (const [name, n] of fx) parts.push({ group: '器具', name, spec: '', qty: n, unit: '台', note: '' });
  return { pages, parts, est };
}

export const systemName = (s: SystemType) => SYSTEM_LABEL[s];
