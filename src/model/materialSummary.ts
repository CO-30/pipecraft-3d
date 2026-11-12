/**
 * 材料集計表。積算の管・部品と器具・マスを、分け方（屋内・床下・屋外・地中／階ごと／新設・既設）の列に分けて数える。
 * 長さは積算の使用長（実測優先）なので、計は積算の数量表と一致する。
 */
import type { Building, Floor } from './building';
import type { Doc } from './doc';
import { computeEstimate, fittingSpec, pipeSpec } from './estimate';
import { FIXTURE_CATALOG, fixtureBaseZ, groundZAt, isManhole } from './fixtures';
import type { Segment, SystemType, Vec3 } from './network';
import { pointInPolygon } from './roomOps';
import { outlineLoop } from './sketch';

export type MatAxis = 'place' | 'floor' | 'status';
export const MAT_AXIS_LABEL: Record<MatAxis, string> = { place: '屋内・床下・屋外・地中', floor: '階ごと', status: '新設・既設' };
export type MatColumn = { key: string; label: string };
export type MatItem = { kind: 'pipe' | 'fitting' | 'fixture' | 'manhole'; name: string; spec: string; unit: 'm' | '個' | '台'; qty: Record<string, number>; total: number };
export type MatSection = { title: string; items: MatItem[] };
export type MatSummary = { axis: MatAxis; columns: MatColumn[]; sections: MatSection[]; /** 画面に出す注意 */ warnings: string[] };

const SECTIONS = ['給水・給湯', '排水・通気', 'その他', '器具'] as const;
const sectionOf = (s: SystemType): (typeof SECTIONS)[number] => (s === 'water' || s === 'hotWater' ? '給水・給湯' : s === 'drain' || s === 'sewage' || s === 'vent' ? '排水・通気' : 'その他');

const PLACE: MatColumn[] = [{ key: 'indoor', label: '屋内' }, { key: 'under', label: '床下' }, { key: 'outdoor', label: '屋外' }, { key: 'buried', label: '地中' }];
const STATUS: MatColumn[] = [{ key: 'new', label: '新設' }, { key: 'existing', label: '既設' }];

type Classifier = { columns: MatColumn[]; at: (p: Vec3, existing: boolean) => string; /** 区間を分ける所（外壁の輪・床・地面）の配管上の t */ cuts: (a: Vec3, b: Vec3) => number[]; warnings: string[] };

/** 平面で線分 a-b が線分 c-d を横切る a-b 上の t（端は含まない） */
function crossT(a: Vec3, b: Vec3, c: { x: number; y: number }, d: { x: number; y: number }): number | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den, u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1 ? t : null;
}

/** 点の列（分け方ごと） */
function classifier(doc: Doc, axis: MatAxis): Classifier {
  const b: Building = doc.building;
  const floors = [...b.floors].sort((x, y) => x.elevation - y.elevation);
  const f0: Floor | undefined = floors[0];
  if (axis === 'status') return { columns: STATUS, at: (_p, ex) => (ex ? 'existing' : 'new'), cuts: () => [], warnings: [] };
  const loop = f0 ? outlineLoop(b, f0.id) : null;
  const ring = loop ? loop.corners.map((id) => b.corners[id]) : null;
  const warnings = !ring && Object.keys(b.walls).length ? ['1 階の外壁が 1 周つながっていないため、屋内と屋外を分けられません。高さで分けています（地面より下＝地中、床より下＝床下）'] : [];
  const place = (p: Vec3) => {
    const below = p.z < groundZAt(b, doc.site, p) - 1;
    if (!ring) return below ? 'buried' : f0 && p.z < f0.elevation ? 'under' : 'indoor';
    if (pointInPolygon(p, ring)) return f0 && p.z < f0.elevation ? 'under' : 'indoor';
    return below ? 'buried' : 'outdoor';
  };
  /** 区間を分ける所: 外壁の輪をまたぐ所、各階の床・地面の高さをまたぐ所 */
  const levels = [...floors.map((f) => f.elevation), groundZAt(b, doc.site, { x: 0, y: 0 })];
  const cuts = (a: Vec3, c: Vec3) => {
    const ts: number[] = [];
    if (ring) ring.forEach((p, i) => { const t = crossT(a, c, p, ring[(i + 1) % ring.length]); if (t !== null) ts.push(t); });
    if (Math.abs(c.z - a.z) > 1e-9) for (const z of levels) { const t = (z - a.z) / (c.z - a.z); if (t > 1e-9 && t < 1 - 1e-9) ts.push(t); }
    return ts.sort((x, y) => x - y);
  };
  if (axis === 'floor') {
    // 床下（建物の中で 1 階の床より下）と地中（外で地面より下）は別の列。外の地面より上の管は 1 階
    const cols: MatColumn[] = [{ key: 'below', label: '床下・地中' }, ...floors.map((f) => ({ key: f.id, label: f.name }))];
    return { columns: cols, cuts, warnings, at: (p) => {
      const pl = place(p);
      if (!f0 || pl === 'under' || pl === 'buried') return 'below';
      let k = f0.id;
      for (const f of floors) if (p.z >= f.elevation - 1e-6) k = f.id;
      return k;
    } };
  }
  return { columns: PLACE, at: (p) => place(p), cuts, warnings };
}

export function materialSummary(doc: Doc, axis: MatAxis): MatSummary {
  const net = doc.network;
  const est = computeEstimate(doc);
  const { columns, at, cuts, warnings } = classifier(doc, axis);
  const segsAt = new Map<string, Segment[]>();
  for (const s of Object.values(net.segments)) for (const n of [s.a, s.b]) segsAt.set(n, [...(segsAt.get(n) ?? []), s]);
  /** 部品の点が既設: つながる区間が全部既設のとき（既設の管に新しく付けた分岐のチーズは新設） */
  const nodeExisting = (nid: string) => { const l = segsAt.get(nid) ?? []; return l.length > 0 && l.every((x) => x.existing); };
  const bySection = new Map<string, Map<string, MatItem>>();
  const add = (section: string, kind: MatItem['kind'], name: string, spec: string, unit: MatItem['unit'], col: string, n: number) => {
    if (!bySection.has(section)) bySection.set(section, new Map());
    const m = bySection.get(section)!;
    const k = `${kind}|${name}|${spec}`;
    const it = m.get(k) ?? { kind, name, spec, unit, qty: {}, total: 0 };
    it.qty[col] = (it.qty[col] ?? 0) + n;
    it.total += n;
    m.set(k, it);
  };
  const mid = (a: Vec3, b: Vec3): Vec3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

  // 管（外壁・床・地面をまたぐ所で区間を分け、使用長を按分。それぞれ中点の場所）
  const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  for (const p of est.pipes) for (const sid of p.segmentIds) {
    const s = net.segments[sid], A = s && net.nodes[s.a], B = s && net.nodes[s.b];
    if (!s || !A || !B) continue;
    const used = (est.measures[sid]?.usedLength ?? 0) / 1000;
    const ts = [0, ...cuts(A.pos, B.pos), 1];
    for (let i = 1; i < ts.length; i++) {
      const share = ts[i] - ts[i - 1];
      if (share <= 0) continue;
      add(sectionOf(p.system), 'pipe', p.name, pipeSpec(p), 'm', at(mid(lerp(A.pos, B.pos, ts[i - 1]), lerp(A.pos, B.pos, ts[i])), !!s.existing), used * share);
    }
  }
  // 部品（点の場所。点の無い分はいちばん多い列）
  for (const f of est.fittings) {
    const cnt: Record<string, number> = {};
    for (const nid of f.nodeIds) {
      const n = net.nodes[nid];
      if (!n) continue;
      const c = at(n.pos, nodeExisting(nid));
      cnt[c] = (cnt[c] ?? 0) + 1;
    }
    // 定尺の継ぎ足し（ソケット）は継ぎ目の場所
    for (const m of est.stockJointMarks) if (m.key === f.key) {
      const c = at(m.pos, !!net.segments[m.segId]?.existing);
      cnt[c] = (cnt[c] ?? 0) + 1;
    }
    const placed = Object.values(cnt).reduce((a, b) => a + b, 0);
    // それでも場所の分からない分（無いはず）は、いちばん多い列へ
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (f.count > placed && top) cnt[top] += f.count - placed;
    for (const [c, n] of Object.entries(cnt)) add(sectionOf(f.system), 'fitting', f.name, fittingSpec(f), '個', c, n);
  }
  // 器具・マス（器具の置き場所）
  for (const fx of Object.values(doc.fixtures)) {
    const floor = doc.building.floors.find((x) => x.id === fx.floorId);
    if (!floor) continue;
    const manhole = isManhole(fx.type);
    const z = manhole ? groundZAt(doc.building, doc.site, fx) : fixtureBaseZ(fx, floor);
    const c = at({ x: fx.x, y: fx.y, z }, !!fx.params?.existing);
    if (manhole) add('排水・通気', 'manhole', FIXTURE_CATALOG[fx.type].label, `${fx.params?.shape === 'square' ? '□' : 'φ'}${fx.params?.diameter ?? FIXTURE_CATALOG[fx.type].size.w}`, '個', c, 1);
    else add('器具', 'fixture', FIXTURE_CATALOG[fx.type].label, '', '台', c, 1);
  }

  const order: MatItem['kind'][] = ['pipe', 'fitting', 'manhole', 'fixture'];
  const sections = SECTIONS.filter((t) => bySection.has(t)).map((title) => ({
    title, items: [...bySection.get(title)!.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name, 'ja') || a.spec.localeCompare(b.spec, 'ja')),
  }));
  // 使った列だけ（階ごとは建物の階を全部出す）
  const used = new Set(sections.flatMap((s) => s.items.flatMap((i) => Object.keys(i.qty))));
  const cols = axis === 'floor' ? columns.filter((c) => c.key !== 'below' || used.has('below')) : columns.filter((c) => used.has(c.key));
  return { axis, columns: cols, sections, warnings };
}
