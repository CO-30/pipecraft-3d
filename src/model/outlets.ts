/** 申請図面の下流端の候補（UI と申請書で共用） */
import type { Doc } from './doc';
import { FIXTURE_CATALOG, isManhole } from './fixtures';
import { floorById } from './building';
import { isDrain } from './slope';

/** 下流端の候補: 公共マス → 他のマス → 排水の端点 */
export function outletCandidates(doc: Doc): { id: string; label: string }[] {
  const out: { id: string; label: string; rank: number }[] = [];
  const net = doc.network;
  for (const n of Object.values(net.nodes)) {
    const segs = Object.values(net.segments).filter((s) => isDrain(s.system) && (s.a === n.id || s.b === n.id));
    if (!segs.length) continue;
    const fx = n.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
    const fl = (fx && floorById(doc.building, fx.floorId)) || (n.floorId ? floorById(doc.building, n.floorId) : undefined);
    const floorName = fl ? `（${fl.name}）` : '';
    if (fx && isManhole(fx.type)) out.push({ id: n.id, label: `${FIXTURE_CATALOG[fx.type].label}${floorName}`, rank: fx.type.startsWith('public') ? 0 : 1 });
    else if (!fx && segs.length === 1) out.push({ id: n.id, label: `排水の端点${floorName} 高さ ${Math.round(n.pos.z)}`, rank: 2 });
  }
  return out.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'ja')).map(({ id, label }) => ({ id, label }));
}

