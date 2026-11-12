import { describe, expect, test } from 'vitest';
import { testSite } from './drainSolve/testSite';
import { placeFixture, portNodes } from './fixtures';
import { addPolyline, type Network } from './network';
import { buildProfile, extractRoute, trimToManholes, type ProfileModel } from './profileDrawing';
import { manholeTable } from './manholeTable';
import { STANDARD_PROFILE } from './municipality';
import { solveDoc } from '../state/store';
import type { Doc } from './doc';

const S = { system: 'sewage' as const, diameter: 100, material: 'VU' };
/** 公共ます ← NO.1 ← NO.2（本線）、NO.1 ← NO.3（枝） */
function site(): { doc: Doc; models: ProfileModel[]; pubPort: string } {
  const t = testSite(-1200, -4000);
  let doc = t.doc;
  const mh = (x: number, y: number) => { const r = placeFixture(doc, t.floorId, 'manholeSewage', { x, y }); doc = r.doc; return portNodes(doc.network, r.fixtureId!)[0]; };
  const m1 = mh(-2000, 3000), m2 = mh(-2000, 6000), m3 = mh(-2000, 0);
  const pub = doc.network.nodes[t.pub];
  let net: Network = doc.network;
  net = addPolyline(net, [m1.pos, pub.pos], S, { startNodeId: m1.id, endNodeId: t.pub }).net;
  net = addPolyline(net, [m2.pos, m1.pos], S, { startNodeId: m2.id, endNodeId: m1.id }).net;
  net = addPolyline(net, [m3.pos, m1.pos], S, { startNodeId: m3.id, endNodeId: m1.id }).net;
  doc = solveDoc({ ...doc, network: net }).doc;
  const profile = { ...STANDARD_PROFILE, profileTable: { ...STANDARD_PROFILE.profileTable, datum: 'publicInvert' as const, manholeLabel: 'above' as const } };
  const r = extractRoute(doc.network, t.pub);
  if ('error' in r) throw new Error(r.error);
  const main = buildProfile(doc, trimToManholes(doc, r.route), profile, 't');
  const models = [main];
  let start = main.manholeCount;
  for (const b of r.branches) { const bm = buildProfile(doc, trimToManholes(doc, b.nodeIds), profile, 'b', {}, { datumZ: main.datumZ, manholeNoStart: start }); start += bm.manholeCount; models.push(bm); }
  return { doc, models, pubPort: t.pub };
}

describe('ます表', () => {
  test('縦断図と同じ順・同じ番号（本線の上流から NO.1…、枝は続き）。公共ますは最後。同じますは 1 行', () => {
    const { doc, models } = site();
    const t = manholeTable(doc, models);
    expect(t.rows.map((r) => r.no)).toEqual(['NO.1', 'NO.2', 'NO.3', '公共']);
    const names = models.flatMap((m) => m.nodes.filter((n) => n.manhole && !n.manhole.isPublic).map((n) => n.manhole!.name));
    expect(names.slice(0, 2)).toEqual(['NO.1汚水マス', 'NO.2汚水マス']);
  });

  test('高さは縦断図の基準（公共ますの管底 ±0）。深さ・管・勾配・次のますまでの延長', () => {
    const { doc, models } = site();
    const t = manholeTable(doc, models);
    const pub = t.rows.at(-1)!;
    expect(pub.invert).toBe(0);
    expect(pub.toNext).toBeUndefined();
    const no2 = t.rows.find((r) => r.no === 'NO.2')!;
    const main = models[0];
    const n2 = main.nodes.find((n) => n.manhole?.name.startsWith('NO.2'))!;
    expect(no2.invert).toBe(Math.round(n2.invertLevel));
    expect(no2.gl).toBe(Math.round(n2.groundLevel));
    expect(no2.depth).toBe(Math.round(n2.manhole!.depth));
    expect(no2.size).toBe('φ300');
    expect(no2.pipe).toMatch(/100/);
    expect(no2.slope).toBeTruthy();
    // 本線: NO.1（上流の端のます）→ NO.2（合流のます）→ 公共。NO.1 から NO.2 まで 3000、NO.2 から公共まで 2000
    const no1 = t.rows.find((r) => r.no === 'NO.1')!;
    expect(no1).toMatchObject({ toNext: 3000, next: 'NO.2' });
    expect(no2).toMatchObject({ toNext: 2000, next: '公共' });
    expect(t.rows.find((r) => r.no === 'NO.3')).toMatchObject({ toNext: 3000, next: 'NO.2' });
    expect(t.datumLabel).toBeTruthy();
  });

  test('縦断図に入っていないマス（別の系統）は数を知らせる', () => {
    const { doc, models } = site();
    const extra = placeFixture(doc, doc.building.floors[0].id, 'manholeRain', { x: 9000, y: 9000 }).doc;
    const t = manholeTable(extra, models);
    expect(t.outside).toBe(1);
  });
});
