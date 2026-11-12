/**
 * 排水の管径の自動決定（純関数）。下流へ向かって、上流の器具の排水負荷単位を足し、次の大きい方にする:
 *  - 負荷単位の表（空気調和・衛生工学会 HASS 206 の排水横枝管の許容負荷単位）
 *  - 上流の器具の接続口・手で決めた管径（📌）のいちばん太いもの（下流ほど細くならない）
 *  - 大便器がつながる管は φ75 以上、建物の外（屋外・地中）は φ100 以上（下水道排水設備指針）
 * 太くするだけで細くはしない。器具につながっていない管・手で決めた管径（diameterPin）は変えない。
 */
import type { Doc } from '../doc';
import { FIXTURE_CATALOG, isManhole, type FixtureType } from '../fixtures';
import { insideBuilding, underfloorLevels } from '../underfloorSlope';
import { buildDrainTrees } from './tree';

/** 器具排水負荷単位（住宅用の値） */
export const FIXTURE_UNITS: Partial<Record<FixtureType, number>> = { toilet: 4, washbasin: 1, kitchen: 2, bathtub: 2, shower: 2, washer: 3 };
/** 管径 → 排水横枝管の許容負荷単位 */
const UNIT_TABLE: [number, number][] = [[40, 3], [50, 6], [65, 12], [75, 20], [100, 160], [125, 360], [150, 620], [200, 1400]];
export const diameterForUnits = (u: number) => UNIT_TABLE.find(([, max]) => u <= max)?.[0] ?? 250;
/** 建物の外の排水管の最小管径 */
export const OUTDOOR_MIN = 100;
/** 大便器がつながる管の最小管径 */
export const TOILET_MIN = 75;

export function autoDiameters(doc: Doc): Doc {
  const net = doc.network;
  const lv = underfloorLevels(doc);
  const segments = { ...net.segments };
  let changed = false;
  for (const t of buildDrainTrees(doc)) {
    // 上流から: 点ごとに（負荷単位の合計・太い管径・大便器の有無・器具の有無）
    type Acc = { units: number; maxDia: number; toilet: boolean; fixture: boolean };
    const acc = new Map<string, Acc>();
    const get = (id: string): Acc => acc.get(id) ?? { units: 0, maxDia: 0, toilet: false, fixture: false };
    const counted = new Set<string>();
    for (const n of [...t.order].reverse()) {
      if (n === t.root) continue;
      const sid = t.parent.get(n)!;
      const s = segments[sid];
      const p = s.a === n ? s.b : s.a;
      let a = get(n);
      const node = net.nodes[n];
      const f = node.fixtureId ? doc.fixtures[node.fixtureId] : undefined;
      if (f && !isManhole(f.type) && !counted.has(f.id)) {
        counted.add(f.id);
        const portDia = FIXTURE_CATALOG[f.type].ports.find((q) => q.id === node.portId)?.diameter ?? 0;
        a = { units: a.units + (FIXTURE_UNITS[f.type] ?? 1), maxDia: Math.max(a.maxDia, portDia), toilet: a.toilet || f.type === 'toilet', fixture: true };
      }
      if (a.fixture && !s.diameterPin) {
        const pa = net.nodes[s.a].pos, pb = net.nodes[s.b].pos;
        const outdoor = !!lv && !insideBuilding(lv, { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
        // 太くするだけで、細くはしない（描いた管径・以前の工事の管径を勝手に縮めない）
        const d = Math.max(diameterForUnits(a.units), a.maxDia, a.toilet ? TOILET_MIN : 0, outdoor ? OUTDOOR_MIN : 0, s.diameter);
        if (d !== s.diameter) { segments[sid] = { ...s, diameter: d }; changed = true; }
      }
      const used = segments[sid].diameter;
      const up: Acc = { ...a, maxDia: a.fixture || s.diameterPin ? Math.max(a.maxDia, used) : a.maxDia };
      const cur = get(p);
      acc.set(p, { units: cur.units + up.units, maxDia: Math.max(cur.maxDia, up.maxDia), toilet: cur.toilet || up.toilet, fixture: cur.fixture || up.fixture });
    }
  }
  return changed ? { ...doc, network: { ...net, segments } } : doc;
}
