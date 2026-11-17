/**
 * 配置図から読んだもの（ます・メーター・立水栓・敷地の高さ）を工事に入れる（純関数）。
 * 敷地の高さを先に入れるので、ますの深さ（標準の管底）はその場所の地面から決まる
 */
import type { Doc } from './doc';
import { placeFixture } from './fixtures';
import type { SiteResult } from './planRead/assemble';
import { markDownstream, pickOutletManhole, SEWER_OUT_REACH } from './drainOutlet';

export function applySite(doc: Doc, floorId: string, site: SiteResult): { doc: Doc; placed: number } {
  let cur: Doc = { ...doc, site: { ...(doc.site ?? {}), ...(site.levels.length ? { groundPoints: site.levels.map((l) => ({ x: l.x, y: l.y, gl: l.gl })) } : {}) } };
  let placed = 0;
  const ids: string[] = [];
  for (const it of site.items) {
    const r = placeFixture(cur, floorId, it.type, { x: it.x, y: it.y });
    if (r.fixtureId) { cur = r.doc; placed++; ids.push(r.fixtureId); }
  }
  // 公共ますの記号が無く「下水引込へ」と書いてあれば、その近くの汚水マスを下流端にする（自動でつなぐ・申請図面の下流端）
  // 公共ます（読んだもの・前から置いてあるもの）や、もう印の付いたマスがあれば付けない
  const hasPublic = site.items.some((i) => i.type === 'publicSewage') || Object.values(cur.fixtures).some((f) => f.type === 'publicSewage');
  const marked = Object.values(cur.fixtures).some((f) => f.params?.downstream);
  if (site.sewerOut && !hasPublic && !marked) {
    const holes = ids.map((id) => cur.fixtures[id]).filter((f) => f.type === 'manholeSewage');
    const near = pickOutletManhole(cur, holes, site.sewerOut);
    if (near && Math.hypot(near.x - site.sewerOut.x, near.y - site.sewerOut.y) <= SEWER_OUT_REACH) cur = markDownstream(cur, near.id);
  }
  return { doc: cur, placed };
}
