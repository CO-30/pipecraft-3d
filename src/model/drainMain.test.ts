/**
 * 床下の排水の本管（2026-11-13 ユーザー）: 器具から近く材料が少ない所に φ100 の本管を 1 本、
 * 公共マスに近い側（無ければ道路側 = メーターの側）から出す。器具はそれぞれ本管へ。外のマスは本管の出口から。
 */
import { describe, expect, test } from 'vitest';
import type { Doc } from './doc';
import { autoConnect } from './autoConnect';
import { routeDrainMain, MAIN_DIAMETER } from './drainMain';
import { dropFixturePipes } from './dropPipes';
import { placeFixture, portNodes } from './fixtures';
import { segmentsAt, validateNetwork, type Network } from './network';
import { supplyHouse } from './testSupplyHouse';
import { isRiserLike } from './slope';

const isDrain = (s: { system: string }) => s.system === 'drain' || s.system === 'sewage';
const withPub = (x: number, y: number) => {
  const h = supplyHouse();
  const p = placeFixture(h.doc, h.floorId, 'publicSewage', { x, y }, 0, { invertZ: -1500 });
  return { h, doc: p.doc, pub: p.fixtureId! };
};
/** 外周の壁の線（x=0・8000・y=0・6000）をまたぐ排水の区間 */
const crossings = (net: Network) => Object.values(net.segments).filter((s) => {
  if (!isDrain(s)) return false;
  const inside = (q: { x: number; y: number }) => q.x > 0 && q.x < 8000 && q.y > 0 && q.y < 6000;
  return inside(net.nodes[s.a].pos) !== inside(net.nodes[s.b].pos);
});
/** 点からつながる排水の点（全部） */
const reach = (net: Network, from: string) => {
  const seen = new Set<string>([from]), st = [from];
  while (st.length) { const id = st.pop()!; for (const s of segmentsAt(net, id)) if (isDrain(s)) { const o = s.a === id ? s.b : s.a; if (!seen.has(o)) { seen.add(o); st.push(o); } } }
  return seen;
};

describe('床下の排水を φ100 の本管にまとめる', () => {
  const { h, doc, pub } = withPub(-3000, 1000); // 公共マスは西
  const r = autoConnect(doc);
  const net = r.doc.network;
  const port = (fid: string, pid: string) => portNodes(net, fid).find((n) => n.portId === pid)!.id;

  test('外へ出るのは 1 か所だけ（公共マスに近い西の外壁）。器具の排水は全部公共マスまでつながる', () => {
    const xs = crossings(net);
    expect(xs).toHaveLength(1);
    const a = net.nodes[xs[0].a].pos, b = net.nodes[xs[0].b].pos;
    expect(Math.min(Math.abs(a.x), Math.abs(b.x))).toBeLessThan(400); // 西の外壁（x=0）
    const pubPort = portNodes(net, pub)[0].id;
    const all = reach(net, pubPort);
    for (const [fid, pid] of [[h.ids.toilet, 'sewage'], [h.ids.kitchen, 'drain'], [h.ids.washbasin, 'drain']] as const) expect(all.has(port(fid, pid))).toBe(true);
    expect(validateNetwork(net)).toEqual([]);
    expect(r.summary.join()).toMatch(/本管/);
  });

  test('本管は φ100 で西の外壁に直角。位置は器具の中央（材料が少ない）: 南北の位置はトイレの排水口の所', () => {
    const ty = net.nodes[port(h.ids.toilet, 'sewage')].pos.y;
    const mains = Object.values(net.segments).filter((s) => isDrain(s) && s.diameter === MAIN_DIAMETER && !isRiserLike(net, s)
      && Math.min(net.nodes[s.a].pos.z, net.nodes[s.b].pos.z) > -560 && net.nodes[s.a].pos.x > 0 && net.nodes[s.b].pos.x > 0);
    expect(mains.length).toBeGreaterThan(0);
    for (const s of mains) {
      expect(net.nodes[s.a].pos.y).toBe(ty);
      expect(net.nodes[s.b].pos.y).toBe(ty);
    }
  });

  test('枝の太さ: トイレ 75・キッチン 50・手洗い（洗面台）40', () => {
    const dia = (fid: string, pid: string) => segmentsAt(net, port(fid, pid))[0].diameter;
    expect(dia(h.ids.toilet, 'sewage')).toBe(75);
    expect(dia(h.ids.kitchen, 'drain')).toBe(50);
    expect(dia(h.ids.washbasin, 'drain')).toBe(40);
  });

  test('外の汚水マスは本管の出口から: 器具ごとのマスは作らない（公共マスまでで 3 個まで）', () => {
    const mh = Object.values(r.doc.fixtures).filter((f) => f.type === 'manholeSewage');
    expect(mh.length).toBeGreaterThanOrEqual(1);
    expect(mh.length).toBeLessThanOrEqual(3);
  });

  test('もう一度押しても増えない。あとで器具を足すと、本管へ枝でつなぐ（出口・マスは増えない）', () => {
    const again = autoConnect(r.doc);
    expect(Object.keys(again.doc.network.segments)).toHaveLength(Object.keys(net.segments).length);
    const w = placeFixture(r.doc, h.floorId, 'washer', { x: 2500, y: 5600 });
    const mhBefore = Object.values(r.doc.fixtures).filter((f) => f.type === 'manholeSewage').length;
    const r2 = autoConnect(w.doc);
    expect(crossings(r2.doc.network)).toHaveLength(1);
    expect(Object.values(r2.doc.fixtures).filter((f) => f.type === 'manholeSewage').length).toBe(mhBefore);
    const wp = portNodes(r2.doc.network, w.fixtureId!).find((n) => n.portId === 'drain')!.id;
    expect(reach(r2.doc.network, portNodes(r2.doc.network, pub)[0].id).has(wp)).toBe(true);
    expect(segmentsAt(r2.doc.network, wp)[0].diameter).toBe(50);
  });
});

describe('出口の向き', () => {
  const exitX = (d: Doc) => {
    const xs = crossings(d.network);
    expect(xs).toHaveLength(1);
    const a = d.network.nodes[xs[0].a].pos, b = d.network.nodes[xs[0].b].pos;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  test('公共マスが東なら東の外壁から出す', () => {
    const { doc } = withPub(11000, 3000);
    const p = exitX(routeDrainMain(dropFixturePipes(doc).doc).doc);
    expect(p.x).toBeGreaterThan(7600);
  });
  test('公共マスが無ければ、道路側（水道メーターの側 = 西）から出す', () => {
    const h = supplyHouse();
    const p = exitX(routeDrainMain(dropFixturePipes(h.doc).doc).doc);
    expect(p.x).toBeLessThan(400);
  });
  test('公共マスもメーターも無ければ、一番材料の少ない外壁から出す', () => {
    const h = supplyHouse({ meter: false });
    const r = routeDrainMain(dropFixturePipes(h.doc).doc);
    expect(r.main).toBe('new');
    expect(crossings(r.doc.network)).toHaveLength(1);
  });
});

/** 床下の排水の横管どうしが交わらない・重ならない（つながる点を除く）。4 本以上が 1 点に集まらない */
function noCrossing(net: Network) {
  const segs = Object.values(net.segments).filter((s) => isDrain(s) && !isRiserLike(net, s) && net.nodes[s.a].pos.z > -560 && net.nodes[s.b].pos.z > -560);
  const P = (id: string) => net.nodes[id].pos;
  const cross = (p: { x: number; y: number }, q: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const d = (o: typeof p, s: typeof p, t: typeof p) => (s.x - o.x) * (t.y - o.y) - (s.y - o.y) * (t.x - o.x);
    const d1 = d(a, b, p), d2 = d(a, b, q), d3 = d(p, q, a), d4 = d(p, q, b);
    return ((d1 > 1 && d2 < -1) || (d1 < -1 && d2 > 1)) && ((d3 > 1 && d4 < -1) || (d3 < -1 && d4 > 1));
  };
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], t = segs[j];
    if ([s.a, s.b].some((x) => x === t.a || x === t.b)) continue;
    expect(cross(P(s.a), P(s.b), P(t.a), P(t.b))).toBe(false);
  }
  for (const n of Object.values(net.nodes)) expect(segmentsAt(net, n.id).filter(isDrain).length).toBeLessThanOrEqual(3);
}

describe('いろいろな器具の置き方でも、枝どうし・本管と交わらない', () => {
  // 決まった乱数（毎回同じ置き方）
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const types = ['toilet', 'washbasin', 'kitchen', 'washer'] as const;
  for (let k = 0; k < 12; k++) {
    const n = 2 + Math.floor(rnd() * 4);
    const pts = Array.from({ length: n }, () => ({ t: types[Math.floor(rnd() * types.length)], x: 400 + Math.round(rnd() * 72) * 100, y: 400 + Math.round(rnd() * 52) * 100 }));
    test(`置き方 ${k + 1}（${pts.map((p) => `${p.t}@${p.x},${p.y}`).join(' ')}）`, () => {
      const h = supplyHouse();
      let d: Doc = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1500 }).doc;
      for (const p of pts) d = placeFixture(d, h.floorId, p.t, { x: p.x, y: p.y }).doc;
      const r = routeDrainMain(dropFixturePipes(d).doc);
      expect(validateNetwork(r.doc.network)).toEqual([]);
      expect(r.main).toBe('new');
      noCrossing(r.doc.network);
      expect(crossings(r.doc.network)).toHaveLength(1);
    });
  }
});

describe('あとから足した器具', () => {
  test('雑排水だけの本管にトイレを足すと、トイレの枝から外のマスまでが汚水になる。トイレ（75）は細い枝（40・50）へつながない', () => {
    const h = supplyHouse();
    // トイレを除いた家（キッチン・洗面台）
    const noToilet: Doc = { ...h.doc, fixtures: Object.fromEntries(Object.entries(h.doc.fixtures).filter(([id]) => id !== h.ids.toilet)),
      network: { ...h.doc.network, nodes: Object.fromEntries(Object.entries(h.doc.network.nodes).filter(([, n]) => n.fixtureId !== h.ids.toilet)) } };
    const d0 = placeFixture(noToilet, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1500 }).doc;
    const r1 = routeDrainMain(dropFixturePipes(d0).doc);
    expect(r1.main).toBe('new');
    const t = placeFixture(r1.doc, h.floorId, 'toilet', { x: 1800, y: 2200 });
    const r2 = routeDrainMain(dropFixturePipes(t.doc).doc);
    expect(r2.main).toBe('joined');
    const net = r2.doc.network;
    const tp = portNodes(net, t.fixtureId!).find((n) => n.portId === 'sewage')!.id;
    // トイレから外のマスまでたどって、通る管はすべて汚水・φ75 以上
    const mh = new Set(Object.values(r2.doc.fixtures).filter((f) => f.type === 'manholeSewage').flatMap((f) => portNodes(net, f.id).map((n) => n.id)));
    const prev = new Map<string, string>(), seen = new Set([tp]), q = [tp];
    let hit: string | undefined;
    while (q.length && !hit) { const id = q.shift()!; for (const s of segmentsAt(net, id)) { if (!isDrain(s)) continue; const o = s.a === id ? s.b : s.a; if (seen.has(o)) continue; seen.add(o); prev.set(o, s.id); q.push(o); if (mh.has(o)) { hit = o; break; } } }
    expect(hit).toBeDefined();
    for (let id = hit!; id !== tp;) { const s = net.segments[prev.get(id)!]; expect(s.system).toBe('sewage'); expect(s.diameter).toBeGreaterThanOrEqual(75); id = s.a === id ? s.b : s.a; }
    noCrossing(net);
  });
});

