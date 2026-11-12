/**
 * 材料集計表。積算の管・部品と器具・マスを、分け方（屋内・床下・屋外・地中／階ごと／新設・既設）の列に分けて数える。
 * 長さは積算の使用長（実測優先）なので、計は積算の数量表と一致する。
 */
import type { Building, Floor } from './building';
import type { Doc } from './doc';
import { computeEstimate, fittingSpec, pipeSpec } from './estimate';
import { FIXTURE_CATALOG, fixtureBaseZ, groundZAt, isManhole } from './fixtures';
import type { SystemType, Vec3 } from './network';
import { pointInPolygon } from './roomOps';
import { outlineLoop } from './sketch';

export type MatAxis = 'place' | 'floor' | 'status';
export const MAT_AXIS_LABEL: Record<MatAxis, string> = { place: '屋内・床下・屋外・地中', floor: '階ごと', status: '新設・既設' };
export type MatColumn = { key: string; label: string };
export type MatItem = { kind: 'pipe' | 'fitting' | 'fixture' | 'manhole'; name: string; spec: string; unit: 'm' | '個' | '台'; qty: Record<string, number>; total: number };
export type MatSection = { title: string; items: MatItem[] };
export type MatSummary = { axis: MatAxis; columns: MatColumn[]; sections: MatSection[] };

const SECTIONS = ['給水・給湯', '排水・通気', 'その他', '器具'] as const;
const sectionOf = (s: SystemType): (typeof SECTIONS)[number] => (s === 'water' || s === 'hotWater' ? '給水・給湯' : s === 'drain' || s === 'sewage' || s === 'vent' ? '排水・通気' : 'その他');

const PLACE: MatColumn[] = [{ key: 'indoor', label: '屋内' }, { key: 'under', label: '床下' }, { key: 'outdoor', label: '屋外' }, { key: 'buried', label: '地中' }];
const STATUS: MatColumn[] = [{ key: 'new', label: '新設' }, { key: 'existing', label: '既設' }];

/** 点の列（分け方ごと） */
function classifier(doc: Doc, axis: MatAxis): { columns: MatColumn[]; at: (p: Vec3, existing: boolean) => string } {
  const b: Building = doc.building;
  const floors = [...b.floors].sort((x, y) => x.elevation - y.elevation);
  const f0: Floor | undefined = floors[0];
  if (axis === 'status') return { columns: STATUS, at: (_p, ex) => (ex ? 'existing' : 'new') };
  const loop = f0 ? outlineLoop(b, f0.id) : null;
  const ring = loop ? loop.corners.map((id) => b.corners[id]) : null;
  const place = (p: Vec3) => {
    const inside = !ring || pointInPolygon(p, ring);
    if (inside) return f0 && p.z < f0.elevation ? 'under' : 'indoor';
    return p.z < groundZAt(b, doc.site, p) - 1 ? 'buried' : 'outdoor';
  };
  if (axis === 'floor') {
    // 床下（建物の中で 1 階の床より下）と地中（外で地面より下）は別の列。外の地面より上の管は 1 階
    const cols: MatColumn[] = [{ key: 'below', label: '床下・地中' }, ...floors.map((f) => ({ key: f.id, label: f.name }))];
    return { columns: cols, at: (p) => {
      const pl = place(p);
      if (!f0 || pl === 'under' || pl === 'buried') return 'below';
      let k = f0.id;
      for (const f of floors) if (p.z >= f.elevation - 1e-6) k = f.id;
      return k;
    } };
  }
  return { columns: PLACE, at: (p) => place(p) };
}

export function materialSummary(doc: Doc, axis: MatAxis): MatSummary {
  const net = doc.network;
  const est = computeEstimate(doc);
  const { columns, at } = classifier(doc, axis);
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

  // 管（区間ごとに中点の場所）
  for (const p of est.pipes) for (const sid of p.segmentIds) {
    const s = net.segments[sid], A = s && net.nodes[s.a], B = s && net.nodes[s.b];
    if (!s || !A || !B) continue;
    add(sectionOf(p.system), 'pipe', p.name, pipeSpec(p), 'm', at(mid(A.pos, B.pos), !!s.existing), (est.measures[sid]?.usedLength ?? 0) / 1000);
  }
  // 部品（点の場所。点の無い分はいちばん多い列）
  for (const f of est.fittings) {
    const cnt: Record<string, number> = {};
    for (const nid of f.nodeIds) {
      const n = net.nodes[nid];
      if (!n) continue;
      const ex = Object.values(net.segments).some((s) => (s.a === nid || s.b === nid) && s.existing);
      const c = at(n.pos, ex);
      cnt[c] = (cnt[c] ?? 0) + 1;
    }
    const placed = Object.values(cnt).reduce((a, b) => a + b, 0);
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] ?? columns[0].key;
    if (f.count > placed) cnt[top] = (cnt[top] ?? 0) + (f.count - placed);
    for (const [c, n] of Object.entries(cnt)) add(sectionOf(f.system), 'fitting', f.name, fittingSpec(f), '個', c, n);
  }
  // 器具・マス（器具の置き場所）
  for (const fx of Object.values(doc.fixtures)) {
    const floor = doc.building.floors.find((x) => x.id === fx.floorId);
    if (!floor) continue;
    const manhole = isManhole(fx.type);
    const z = manhole ? groundZAt(doc.building, doc.site, fx) : fixtureBaseZ(fx, floor);
    const c = at({ x: fx.x, y: fx.y, z }, !!fx.params?.existing);
    if (manhole) add('排水・通気', 'manhole', FIXTURE_CATALOG[fx.type].label, `φ${fx.params?.diameter ?? FIXTURE_CATALOG[fx.type].size.w}`, '個', c, 1);
    else add('器具', 'fixture', FIXTURE_CATALOG[fx.type].label, '', '台', c, 1);
  }

  const order: MatItem['kind'][] = ['pipe', 'fitting', 'manhole', 'fixture'];
  const sections = SECTIONS.filter((t) => bySection.has(t)).map((title) => ({
    title, items: [...bySection.get(title)!.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name, 'ja') || a.spec.localeCompare(b.spec, 'ja')),
  }));
  // 使った列だけ（階ごとは建物の階を全部出す）
  const used = new Set(sections.flatMap((s) => s.items.flatMap((i) => Object.keys(i.qty))));
  const cols = axis === 'floor' ? columns.filter((c) => c.key !== 'below' || used.has('below')) : columns.filter((c) => used.has(c.key));
  return { axis, columns: cols, sections };
}
