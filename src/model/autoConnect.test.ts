import { describe, expect, test } from 'vitest';
import { addVentValves, autoConnect, connectYard } from './autoConnect';
import type { Doc } from './doc';
import { analyzeFittings } from './fittings';
import { placeFixture, portNodes } from './fixtures';
import { dropFixturePipes } from './dropPipes';
import { segmentsAt, type Network } from './network';
import { supplyHouse } from './testSupplyHouse';
import { testSite } from './drainSolve/testSite';

/** 点 a から排水・汚水の管だけでたどれる点 */
function drainReach(net: Network, a: string): Set<string> {
  const seen = new Set([a]), st = [a];
  while (st.length) { const n = st.pop()!; for (const s of segmentsAt(net, n)) { if (s.system !== 'sewage' && s.system !== 'drain') continue; for (const m of [s.a, s.b]) if (!seen.has(m)) { seen.add(m); st.push(m); } } }
  return seen;
}
const port = (doc: Doc, fid: string, pid?: string) => portNodes(doc.network, fid).find((n) => !pid || n.portId === pid)!.id;

describe('屋外: マスどうし・公共マスまでつなぐ', () => {
  function yard() {
    const t = testSite(-1200, -4000);
    let doc = t.doc;
    const mh = (x: number, y: number) => { const r = placeFixture(doc, t.floorId, 'manholeSewage', { x, y }); doc = r.doc; return r.fixtureId!; };
    const a = mh(-700, 1000), b = mh(-700, 5000), c = mh(4000, 6700);
    return { doc, pub: t.pub, ids: [a, b, c] };
  }

  test('つながっていない汚水マスを、建物の外を通して公共マスへ（建物をまたぐ所は L 字）', () => {
    const { doc, pub, ids } = yard();
    const r = connectYard(doc);
    expect(r.connected).toBe(3);
    const reach = drainReach(r.doc.network, pub);
    for (const id of ids) expect(reach.has(port(r.doc, id))).toBe(true);
    // 建物（0..8000 × 0..6000）の中を通る管は無い
    for (const s of Object.values(r.doc.network.segments)) {
      for (let k = 0; k <= 10; k++) {
        const p = r.doc.network.nodes[s.a].pos, q = r.doc.network.nodes[s.b].pos;
        const x = p.x + ((q.x - p.x) * k) / 10, y = p.y + ((q.y - p.y) * k) / 10;
        expect(x > -300 && x < 8300 && y > -300 && y < 6300).toBe(false);
      }
    }
    // 何度押しても増えない
    expect(connectYard(r.doc).connected).toBe(0);
  });

  test('公共汚水マスが無ければつながず知らせる。雨水マスはつながない', () => {
    const t = testSite(-1200, -4000);
    const noPub = { ...t.doc, fixtures: {}, network: { nodes: {}, segments: {} } };
    const m = placeFixture(noPub, t.floorId, 'manholeSewage', { x: -700, y: 1000 }).doc;
    expect(connectYard(m).notes.join()).toContain('公共汚水マス');
    const rain = placeFixture(t.doc, t.floorId, 'manholeRain', { x: -700, y: 1000 }).doc;
    expect(connectYard(rain).connected).toBe(0);
  });
});

describe('通気弁', () => {
  test('キッチン・洗面台の排水口の下に通気弁（トイレには付けない）。2 回押しても 1 つずつ。積算では通気弁', () => {
    const h = supplyHouse();
    const d0 = dropFixturePipes(h.doc).doc;
    const r = addVentValves(d0);
    expect(r.valves).toBe(2);
    const aav = analyzeFittings(r.doc.network, r.doc.fixtures).filter((f) => f.type === 'aav');
    expect(aav).toHaveLength(2);
    expect(addVentValves(r.doc).valves).toBe(0);
    // 排水口から通気弁まで排水・通気の管でつながっている
    const kport = port(r.doc, h.ids.kitchen, 'drain');
    const seen = new Set([kport]), st = [kport];
    while (st.length) { const n = st.pop()!; for (const s of segmentsAt(r.doc.network, n)) for (const m of [s.a, s.b]) if (!seen.has(m)) { seen.add(m); st.push(m); } }
    expect(aav.some((f) => seen.has(f.nodeId))).toBe(true);
  });
});

describe('まとめて自動でつなぐ', () => {
  test('器具・メーター・公共マスを置いた家で 1 回: 汚水・排水は公共マスまで、給水・給湯もつながり、止水栓・通気弁が入る。もう一度押しても増えない', () => {
    const h = supplyHouse();
    const p = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1300 });
    const r = autoConnect(p.doc);
    const pub = port(r.doc, p.fixtureId!);
    const reach = drainReach(r.doc.network, pub);
    for (const [fid, pid] of [[h.ids.toilet, 'sewage'], [h.ids.kitchen, 'drain'], [h.ids.washbasin, 'drain']] as const) expect(reach.has(port(r.doc, fid, pid))).toBe(true);
    for (const [fid, pid] of [[h.ids.kitchen, 'water'], [h.ids.kitchen, 'hot'], [h.ids.washbasin, 'water'], [h.ids.toilet, 'water']] as const) expect(segmentsAt(r.doc.network, port(r.doc, fid, pid)).length).toBeGreaterThan(0);
    expect(r.valves).toBeGreaterThan(0);
    expect(r.vents).toBe(2);
    expect(r.summary.length).toBeGreaterThan(0);
    const again = autoConnect(r.doc);
    expect(Object.keys(again.doc.network.segments).length).toBe(Object.keys(r.doc.network.segments).length);
  });
});
