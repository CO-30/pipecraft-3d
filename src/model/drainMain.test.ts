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
