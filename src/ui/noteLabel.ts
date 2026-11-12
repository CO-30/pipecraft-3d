/** メモの付けた先の名前 */
import type { Doc } from '../model/doc';
import { FIXTURE_CATALOG } from '../model/fixtures';
import type { NoteTarget } from '../model/notes';
import { systemLabel } from './colors';

const MEMBER_NAME: Record<string, string> = { beam: '梁', eave: '軒・庇', balcony: 'バルコニー', stair: '階段', footing: '基礎の立上り' };

/** 付けた先の名前（無ければ null） */
export function noteTargetLabel(doc: Doc, t: NoteTarget): string | null {
  const { network: net, building: b, fixtures } = doc;
  switch (t.kind) {
    case 'segment': { const s = net.segments[t.id]; return s ? `${systemLabel(s.system)}の配管 φ${s.diameter}` : null; }
    case 'fixture': { const f = fixtures[t.id]; return f ? FIXTURE_CATALOG[f.type].label : null; }
    case 'node': {
      const n = net.nodes[t.id];
      if (!n) return null;
      const f = n.fixtureId ? fixtures[n.fixtureId] : undefined;
      return f ? `${FIXTURE_CATALOG[f.type].label}の接続口` : '配管の点';
    }
    case 'wall': { const w = b.walls[t.id]; return w ? (w.kind === 'exterior' ? '外壁' : '内壁') : null; }
    case 'room': { const r = b.rooms[t.id]; return r ? `部屋「${r.name}」` : null; }
    case 'opening': { const o = b.openings[t.id]; return o ? (o.type === 'door' ? 'ドア' : '窓') : null; }
    case 'member': { const m = b.members?.[t.id]; return m ? MEMBER_NAME[m.kind] ?? '梁など' : null; }
    case 'corner': return b.corners[t.id] ? '壁の角' : null;
  }
}

