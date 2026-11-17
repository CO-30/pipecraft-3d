/**
 * 公共ますが無い汚水の系統の下流端（2026-11-18 実物の図面: 配置図に公共ますの記号が無く「下水引込へ」だけ。
 * 外のマスをつながず、縦断図が床下の管を地中の管として描いて「土被り −659mm」などの注意が 56 件出ていた）
 */
import { describe, expect, test } from 'vitest';
import { connectYard } from './autoConnect';
import type { Doc } from './doc';
import { placeFixture, portNodes } from './fixtures';
import { addPolyline, segmentsAt, type Network } from './network';
import { testSite } from './drainSolve/testSite';
import { buildDrainTrees } from './drainSolve/tree';
import { outletCandidates } from './outlets';
import { markDownstream, pickOutletManhole } from './drainOutlet';
import { applySite } from './siteApply';
import { buildRouteProfiles, extractRoute, manholeNodes } from './profileDrawing';
import { STANDARD_PROFILE } from './municipality';

/** 公共ますの無い工事（8000×6000 の平屋、FL 0・設計 GL −600）。北の外に汚水マスを並べる */
function noPublic(xs: number[], ground?: { x: number; y: number; gl: number }[]) {
  const t = testSite();
  let doc: Doc = { ...t.doc, fixtures: {}, network: { nodes: {}, segments: {} }, site: { ...t.doc.site, ...(ground ? { groundPoints: ground } : {}) } };
  const ids = xs.map((x) => { const r = placeFixture(doc, t.floorId, 'manholeSewage', { x, y: 7000 }); doc = r.doc; return r.fixtureId!; });
  return { doc, ids, floorId: t.floorId };
}
const portOf = (doc: Doc, fid: string) => portNodes(doc.network, fid)[0].id;
function reach(net: Network, a: string): Set<string> {
  const seen = new Set([a]), st = [a];
  while (st.length) { const n = st.pop()!; for (const s of segmentsAt(net, n)) for (const m of [s.a, s.b]) if (!seen.has(m)) { seen.add(m); st.push(m); } }
  return seen;
}

describe('下流端のマスを選ぶ（pickOutletManhole）', () => {
  test('地面がいちばん低い所のマス。同じ低さなら家から遠いマス', () => {
    // 西へ下がる敷地（x=-4000 で GL−950）
    const g = [{ x: -4000, y: 7000, gl: -950 }, { x: -3000, y: 7000, gl: -950 }, { x: 4000, y: 7000, gl: 0 }, { x: 9000, y: 7000, gl: 0 }];
    const { doc, ids } = noPublic([7000, -3000, -4000], g);
    expect(pickOutletManhole(doc, Object.values(doc.fixtures))?.id).toBe(ids[2]);
  });
  test('印の付いたマス（下流端）がいちばん。次に「下水引込へ」の近く', () => {
    const { doc, ids } = noPublic([7000, 2000, -1000]);
    expect(pickOutletManhole(doc, Object.values(doc.fixtures), { x: 7400, y: 7300 })?.id).toBe(ids[0]);
    const marked = { ...doc, fixtures: { ...doc.fixtures, [ids[1]]: { ...doc.fixtures[ids[1]], params: { ...doc.fixtures[ids[1]].params, downstream: true } } } };
    expect(pickOutletManhole(marked, Object.values(marked.fixtures), { x: 7400, y: 7300 })?.id).toBe(ids[1]);
  });
});

describe('公共ますが無いとき: 外の汚水マスを下流端へつなぐ（connectYard）', () => {
  test('全部のマスを下流端までつなぎ、下流端に印を付けて知らせる。何度押しても増えない', () => {
    const g = [{ x: -4000, y: 7000, gl: -950 }, { x: 9000, y: 7000, gl: 0 }];
    const { doc, ids } = noPublic([7000, 4000, 1000, -4000], g);
    const r = connectYard(doc);
    expect(r.connected).toBe(3);
    const out = ids[3];
    expect(r.doc.fixtures[out].params?.downstream).toBe(true);
    const all = reach(r.doc.network, portOf(r.doc, out));
    for (const id of ids) expect(all.has(portOf(r.doc, id))).toBe(true);
    expect(r.notes.join()).toContain('下流端');
    expect(r.notes.join()).toContain('公共');
    expect(connectYard(r.doc).connected).toBe(0);
    expect(Object.keys(connectYard(r.doc).doc.network.segments)).toHaveLength(Object.keys(r.doc.network.segments).length);
  });
  test('マスが 1 つだけならつながず印も付けない（公共ますを置くことだけ知らせる）。押し直して何もつながなければ「つなぎました」と言わない', () => {
    const one = noPublic([7000]);
    const r1 = connectYard(one.doc);
    expect(r1.doc).toBe(one.doc);
    expect(r1.notes.join()).not.toContain('下流端');
    expect(r1.notes.join()).toContain('公共汚水マスを置いて');
    const g = [{ x: -4000, y: 7000, gl: -950 }, { x: 9000, y: 7000, gl: 0 }];
    const two = connectYard(noPublic([7000, -4000], g).doc);
    expect(two.notes.join()).toContain('下流端');
    expect(connectYard(two.doc).notes).toEqual([]);
  });
  test('雨水マスはつながない', () => {
    const { doc, floorId } = noPublic([7000, -4000]);
    const rain = placeFixture(doc, floorId, 'manholeRain', { x: 3000, y: 7000 });
    const r = connectYard(rain.doc);
    expect(segmentsAt(r.doc.network, portOf(r.doc, rain.fixtureId!))).toHaveLength(0);
  });
  test('あとで公共ますを置くと、下流端のマスから公共ますへつなぐ（途中のマスからつながない）', () => {
    const g = [{ x: -4000, y: 7000, gl: -950 }, { x: 9000, y: 7000, gl: 0 }];
    const { doc, ids, floorId } = noPublic([7000, 1000, -4000], g);
    const r1 = connectYard(doc);
    // 公共ますは途中のマスのすぐ北（下流端より近い）
    const p = placeFixture(r1.doc, floorId, 'publicSewage', { x: 1000, y: 8500 }, 0, { invertZ: -1800 });
    const r2 = connectYard(p.doc);
    const pub = portOf(r2.doc, p.fixtureId!);
    expect(segmentsAt(r2.doc.network, pub)).toHaveLength(1);
    const s = segmentsAt(r2.doc.network, pub)[0];
    // 公共ますへ入る管をたどると下流端のマスへ行き、途中のマス（ids[1]）の接続口には 3 本目の管が付いていない
    expect(segmentsAt(r2.doc.network, portOf(r2.doc, ids[1]))).toHaveLength(2);
    expect(s).toBeTruthy();
  });
});

describe('下流端を高さの計算・申請画面でも同じに使う', () => {
  function chained() {
    const g = [{ x: -4000, y: 7000, gl: -950 }, { x: -3500, y: 7000, gl: -950 }, { x: 9000, y: 7000, gl: 0 }];
    const { doc, ids } = noPublic([7000, 1000, -3500, -4000], g);
    return { doc: connectYard(doc).doc, ids };
  }
  test('排水の木の根は印の付いた下流端（管底がほかのマスと同じ・もっと低くても）', () => {
    const { doc, ids } = chained();
    const out = portOf(doc, ids[3]);
    // ほかのマス（隣の -3500）を下流端より低くしても根は下流端のまま
    const other = portOf(doc, ids[2]);
    const net = { ...doc.network, nodes: { ...doc.network.nodes, [other]: { ...doc.network.nodes[other], pos: { ...doc.network.nodes[other].pos, z: doc.network.nodes[out].pos.z - 300 } } } };
    const t = buildDrainTrees({ ...doc, network: net });
    expect(t).toHaveLength(1);
    expect(t[0].root).toBe(out);
  });
  test('申請図面の下流端の候補は、公共ますの次に印の付いた下流端。公共ますを置いた後は印を「下流端」と書かない', () => {
    const { doc, ids } = chained();
    expect(outletCandidates(doc)[0].id).toBe(portOf(doc, ids[3]));
    expect(outletCandidates(doc)[0].label).toContain('下流端');
    const withPub = placeFixture(doc, doc.building.floors[0].id, 'publicSewage', { x: -5000, y: 8000 }, 0, { invertZ: -2500 }).doc;
    const linked = connectYard(withPub).doc;
    const c = outletCandidates(linked);
    expect(c[0].label).toContain('公共');
    expect(c.some((o) => o.label.includes('下流端'))).toBe(false);
  });
  test('印は 1 つだけ（付け直すと前の印は外れる）', () => {
    const { doc, ids } = chained();
    const again = markDownstream(doc, ids[0]);
    expect(Object.values(again.fixtures).filter((f) => f.params?.downstream).map((f) => f.id)).toEqual([ids[0]]);
    expect(markDownstream(again, ids[0])).toBe(again);
  });
});

describe('縦断図に床下・屋内の管を入れない（マスにつながらない枝は宅内の管）', () => {
  /** 下流端 ← マスA ← マスB の外の管と、マスA から建物の中へ長い床下の管 */
  function withIndoor() {
    const t = testSite(-1500, -3000);
    let doc = t.doc;
    const a = placeFixture(doc, t.floorId, 'manholeSewage', { x: -1000, y: 3000 }); doc = a.doc;
    const b = placeFixture(doc, t.floorId, 'manholeSewage', { x: -1000, y: 5000 }); doc = b.doc;
    const pa = portOf(doc, a.fixtureId!), pb = portOf(doc, b.fixtureId!);
    let net = addPolyline(doc.network, [doc.network.nodes[pa].pos, doc.network.nodes[t.pub].pos], { system: 'sewage', diameter: 100 }, { startNodeId: pa, endNodeId: t.pub }).net;
    net = addPolyline(net, [net.nodes[pb].pos, net.nodes[pa].pos], { system: 'sewage', diameter: 100 }, { startNodeId: pb, endNodeId: pa }).net;
    // 建物の中の床下（−300）を長く（8m）。マスB の枝（2m）より長い
    const p0 = net.nodes[pa].pos;
    net = addPolyline(net, [p0, { x: 500, y: 3000, z: -400 }, { x: 7000, y: 3000, z: -300 }, { x: 7000, y: 1000, z: -300 }], { system: 'drain', diameter: 100 }, { startNodeId: pa }).net;
    return { doc: { ...doc, network: net }, pub: t.pub, pa, pb };
  }
  test('本線はマスへ向かう枝を選び、床下の枝は枝の図にもしない', () => {
    const { doc, pub, pa, pb } = withIndoor();
    const r = extractRoute(doc.network, pub, {}, manholeNodes(doc));
    if ('error' in r) throw new Error(r.error);
    expect(r.route).toEqual([pub, pa, pb]);
    expect(r.branches).toHaveLength(0);
    const ms = buildRouteProfiles(doc, r, STANDARD_PROFILE, 'T', () => 'B');
    expect(ms).toHaveLength(1);
    expect(ms[0].warnings.filter((w) => w.kind === 'cover' && w.message.includes('-'))).toHaveLength(0);
  });
  test('マスを渡さなければ今までどおり（いちばん長い枝が本線）', () => {
    const { doc, pub } = withIndoor();
    const r = extractRoute(doc.network, pub, {});
    if ('error' in r) throw new Error(r.error);
    expect(r.branches).toHaveLength(1);
  });
});

describe('配置図の「下水引込へ」（applySite）', () => {
  test('公共ますが無ければ、「下水引込へ」にいちばん近い汚水マスを下流端にする', () => {
    const t = testSite();
    const doc = { ...t.doc, fixtures: {}, network: { nodes: {}, segments: {} } };
    const r = applySite(doc, t.floorId, { items: [{ type: 'manholeSewage', x: 7000, y: 7000 }, { type: 'manholeSewage', x: -3000, y: 7000 }], levels: [], sewerOut: { x: -4500, y: 7200 } });
    const out = Object.values(r.doc.fixtures).filter((f) => f.params?.downstream);
    expect(out).toHaveLength(1);
    expect(out[0].x).toBe(-3000);
  });
  test('配置図を 2 回入れても印は 1 つ（前から印・公共ますがあれば付けない）', () => {
    const t = testSite();
    const doc = { ...t.doc, fixtures: {}, network: { nodes: {}, segments: {} } };
    const site = { items: [{ type: 'manholeSewage' as const, x: 7000, y: 7000 }, { type: 'manholeSewage' as const, x: -3000, y: 7000 }], levels: [], sewerOut: { x: -4500, y: 7200 } };
    const once = applySite(doc, t.floorId, site).doc;
    const twice = applySite(once, t.floorId, site).doc;
    expect(Object.values(twice.fixtures).filter((f) => f.params?.downstream)).toHaveLength(1);
    const pub = placeFixture(doc, t.floorId, 'publicSewage', { x: -5000, y: 7000 }, 0, { invertZ: -2000 }).doc;
    expect(Object.values(applySite(pub, t.floorId, site).doc.fixtures).some((f) => f.params?.downstream)).toBe(false);
  });
  test('公共ますがあれば印を付けない。遠すぎれば付けない', () => {
    const t = testSite();
    const doc = { ...t.doc, fixtures: {}, network: { nodes: {}, segments: {} } };
    const withPub = applySite(doc, t.floorId, { items: [{ type: 'publicSewage', x: -3500, y: 7000 }, { type: 'manholeSewage', x: -3000, y: 7000 }], levels: [], sewerOut: { x: -4500, y: 7200 } });
    expect(Object.values(withPub.doc.fixtures).some((f) => f.params?.downstream)).toBe(false);
    const far = applySite(doc, t.floorId, { items: [{ type: 'manholeSewage', x: 7000, y: 7000 }], levels: [], sewerOut: { x: -9000, y: 7200 } });
    expect(Object.values(far.doc.fixtures).some((f) => f.params?.downstream)).toBe(false);
  });
});
