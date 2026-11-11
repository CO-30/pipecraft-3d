/**
 * 配置図から読んだもの（ます・メーター・立水栓・敷地の高さ）を工事に入れる（純関数）。
 * 敷地の高さを先に入れるので、ますの深さ（標準の管底）はその場所の地面から決まる
 */
import type { Doc } from './doc';
import { placeFixture } from './fixtures';
import type { SiteResult } from './planRead/assemble';

export function applySite(doc: Doc, floorId: string, site: SiteResult): { doc: Doc; placed: number } {
  let cur: Doc = { ...doc, site: { ...(doc.site ?? {}), ...(site.levels.length ? { groundPoints: site.levels.map((l) => ({ x: l.x, y: l.y, gl: l.gl })) } : {}) } };
  let placed = 0;
  for (const it of site.items) {
    const r = placeFixture(cur, floorId, it.type, { x: it.x, y: it.y });
    if (r.fixtureId) { cur = r.doc; placed++; }
  }
  return { doc: cur, placed };
}
