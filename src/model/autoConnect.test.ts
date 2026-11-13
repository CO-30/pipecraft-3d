import { describe, expect, test } from 'vitest';
import { addVentValves, autoConnect, connectYard } from './autoConnect';
import type { Doc } from './doc';
import { analyzeFittings } from './fittings';
import { placeFixture, portNodes } from './fixtures';
import { dropFixturePipes } from './dropPipes';
import { addPolyline, segmentsAt, type Network } from './network';
import { closestPoints } from './clash';
import { supplyHouse } from './testSupplyHouse';
import { testSite } from './drainSolve/testSite';
import { addFloor, addWall, emptyBuilding, type Building } from './building';
import { emptyDoc } from '../state/store';

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
    const pub = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1300 }).doc;
    const r = autoConnect(pub);
    expect(r.vents).toBe(2);
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

describe('まとめてつなぐ（レビューの指摘）', () => {
  const withPub = (x: number, y: number) => { const h = supplyHouse(); const p = placeFixture(h.doc, h.floorId, 'publicSewage', { x, y }, 0, { invertZ: -1300 }); return { h, doc: p.doc, pub: p.fixtureId! }; };

  test('公共マスが家の反対側（道路側）にあっても、建物の周りを回ってつなぐ', () => {
    const { h, doc, pub } = withPub(3000, -2500);
    const r = autoConnect(doc);
    const reach = drainReach(r.doc.network, port(r.doc, pub));
    for (const [fid, pid] of [[h.ids.toilet, 'sewage'], [h.ids.kitchen, 'drain'], [h.ids.washbasin, 'drain']] as const) expect(reach.has(port(r.doc, fid, pid))).toBe(true);
    for (const s of Object.values(r.doc.network.segments)) {
      if (s.system !== 'sewage' && s.system !== 'drain') continue;
      const p = r.doc.network.nodes[s.a].pos, q = r.doc.network.nodes[s.b].pos;
      if (p.z > -650 || q.z > -650) continue; // 床下の管は除く（屋外の地中の管だけ見る）
      for (let k = 1; k < 10; k++) {
        const x = p.x + ((q.x - p.x) * k) / 10, y = p.y + ((q.y - p.y) * k) / 10;
        expect(x > 150 && x < 7850 && y > 150 && y < 5850).toBe(false);
      }
    }
  });

  test('公共マスと同じ所に置いたマスでも止まらない（つなげない組は飛ばす）', () => {
    const t = testSite(-1200, -4000);
    const d = placeFixture(t.doc, t.floorId, 'manholeSewage', { x: -4000, y: 3000 }, 0, { invertZ: -1200 }).doc;
    const t0 = Date.now();
    connectYard(d);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  test('外壁が 1 周つながっていなくても、建物の中を通さない', () => {
    const t = testSite(-1200, -4000);
    const walls = { ...t.doc.building.walls };
    delete walls[Object.keys(walls)[1]]; // 東の壁が無い
    let doc: Doc = { ...t.doc, building: { ...t.doc.building, walls } };
    doc = placeFixture(doc, t.floorId, 'manholeSewage', { x: 8800, y: 3000 }).doc;
    const r = connectYard(doc);
    for (const s of Object.values(r.doc.network.segments)) {
      const p = r.doc.network.nodes[s.a].pos, q = r.doc.network.nodes[s.b].pos;
      for (let k = 1; k < 10; k++) {
        const x = p.x + ((q.x - p.x) * k) / 10, y = p.y + ((q.y - p.y) * k) / 10;
        expect(x > 300 && x < 7700 && y > 300 && y < 5700).toBe(false);
      }
    }
  });

  test('雨水の系統（公共雨水マスにつながったマス）は汚水につながない', () => {
    const t = testSite(-1200, -4000);
    let doc = t.doc;
    const rp = placeFixture(doc, t.floorId, 'publicRain', { x: 4000, y: -3000 }, 0, { invertZ: -1200 }); doc = rp.doc;
    const tr = placeFixture(doc, t.floorId, 'manholeTrap', { x: 4000, y: -1000 }); doc = tr.doc;
        doc = { ...doc, network: addPolyline(doc.network, [portNodes(doc.network, tr.fixtureId!)[0].pos, portNodes(doc.network, rp.fixtureId!)[0].pos], { system: 'drain', diameter: 100 }, { startNodeId: portNodes(doc.network, tr.fixtureId!)[0].id, endNodeId: portNodes(doc.network, rp.fixtureId!)[0].id }).net };
    expect(connectYard(doc).connected).toBe(0);
  });

  test('通気弁の管は給水・給湯の管や口に重ならない（50mm 以上離す）', () => {
    const { doc } = withPub(-3000, 1000);
    const r = autoConnect(doc);
    const net = r.doc.network;
        const vents = Object.values(net.segments).filter((s) => s.system === 'vent');
    expect(vents.length).toBeGreaterThan(0);
    for (const v of vents) for (const o of Object.values(net.segments)) {
      if (o.system === 'vent' || o.system === 'drain' || o.system === 'sewage') continue;
      const c = closestPoints(net.nodes[v.a].pos, net.nodes[v.b].pos, net.nodes[o.a].pos, net.nodes[o.b].pos);
      expect(c.dist).toBeGreaterThanOrEqual(50);
    }
  });

  test('外へ出ていない排水には通気弁を付けない（あとで外へ出せなくならないように）', () => {
    const h = supplyHouse();
    const r = addVentValves(dropFixturePipes(h.doc).doc);
    expect(r.valves).toBe(0);
  });

  test('通気弁のチーズは「要確認」にしない', () => {
    const { doc } = withPub(-3000, 1000);
    const r = autoConnect(doc);
    const fits = analyzeFittings(r.doc.network, r.doc.fixtures);
    const teeAtVent = fits.filter((f) => segmentsAt(r.doc.network, f.nodeId).some((s) => s.system === 'vent') && segmentsAt(r.doc.network, f.nodeId).length === 3);
    expect(teeAtVent.length).toBe(2);
    expect(teeAtVent.every((f) => !f.needsConfirm)).toBe(true);
  });
});

describe('公共マスまで必ず届く（2026-11-12）', () => {
  test('コの字の建物のへこみにあるマスでも、建物の周りを回って反対側の公共マスへ（建物の中を通さない）', () => {
    const f = addFloor(emptyBuilding(), { height: 2900 });
    let b: Building = { ...f.b, foundation: { slabTop: -550 } };
    const P = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 8000 }, { x: 7000, y: 8000 }, { x: 7000, y: 3000 }, { x: 3000, y: 3000 }, { x: 3000, y: 8000 }, { x: 0, y: 8000 }];
    for (let i = 0; i < P.length; i++) b = addWall(b, f.floorId, P[i], P[(i + 1) % P.length], { kind: 'exterior' }).b;
    let doc: Doc = { ...emptyDoc(), building: b, site: { designGL: -600 } };
    const pub = placeFixture(doc, f.floorId, 'publicSewage', { x: 5000, y: -3000 }, 0, { invertZ: -1300 }); doc = pub.doc;
    const mh = placeFixture(doc, f.floorId, 'manholeSewage', { x: 5000, y: 5000 }); doc = mh.doc;
    const r = connectYard(doc);
    expect(r.connected).toBe(1);
    expect(drainReach(r.doc.network, port(r.doc, pub.fixtureId!)).has(port(r.doc, mh.fixtureId!))).toBe(true);
    const inU = (x: number, y: number) => (x > 0 && x < 10000 && y > 0 && y < 3000) || (x > 0 && x < 3000 && y > 0 && y < 8000) || (x > 7000 && x < 10000 && y > 0 && y < 8000);
    for (const sg of Object.values(r.doc.network.segments)) {
      const p = r.doc.network.nodes[sg.a].pos, q = r.doc.network.nodes[sg.b].pos;
      for (let k = 0; k <= 20; k++) expect(inU(p.x + ((q.x - p.x) * k) / 20, p.y + ((q.y - p.y) * k) / 20)).toBe(false);
    }
  });
});

describe('ヘッダーはできるだけ足さない（2026-11-12）', () => {
  test('まとめてつなぐではヘッダーを置かずに枝分かれでつなぎ、聞くことは無い', () => {
    const h = supplyHouse();
    const p = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1300 });
    const r = autoConnect(p.doc);
    expect(r.headers).toBe(0);
    expect(r.questions).toEqual([]);
    expect(r.summary.join()).toContain('ヘッダーは使っていません');
  });
  test('ヘッダーの質問ははじめての人にも分かる言葉で、理由と答えごとの説明がある', async () => {
    const { headerQuestion } = await import('./question');
    expect(headerQuestion({ water: 0, hot: 0 })).toBeNull();
    const q = headerQuestion({ water: 1, hot: 2 })!;
    expect(q.title).toContain('ヘッダー');
    expect(q.why).toContain('給水 1 か所・お湯 2 か所');
    expect(q.options.map((o) => o.value)).toEqual(['use', 'skip']);
    for (const o of q.options) expect(o.hint.length).toBeGreaterThan(5);
  });
  test('質問に「置く」と答えると、ヘッダーでつなぐ（use）で続きを実行する', async () => {
    const { useStore } = await import('../state/store');
    const h = supplyHouse();
    const p = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1300 });
    useStore.setState({ doc: p.doc, questionDoc: p.doc, question: { id: 'header', title: 't', why: 'w', options: [] } });
    useStore.getState().answerQuestion('use');
    expect(useStore.getState().question).toBeNull();
    expect(Object.values(useStore.getState().doc.fixtures).some((f) => f.type === 'waterHeader')).toBe(true);
  });
  test('質問のあとに図が変わったら（元に戻すなど）、答えても続きを実行しない', async () => {
    const { useStore } = await import('../state/store');
    const h = supplyHouse();
    useStore.setState({ doc: h.doc, questionDoc: supplyHouse().doc, question: { id: 'header', title: 't', why: 'w', options: [] } });
    useStore.getState().answerQuestion('use');
    expect(Object.values(useStore.getState().doc.fixtures).some((f) => f.type === 'waterHeader')).toBe(false);
    expect(useStore.getState().notice).toContain('取り消しました');
  });
});

describe('基礎貫通スリーブの高さに合わせる（レビューの指摘）', () => {
  test('まとめてつなぐで置いたマスは、KSA の高さ H に合う深さにする（積算に高さ違いの要確認が出ない）。土間の貫通を二重に数えない', async () => {
    const { kisoSleeveItems } = await import('./kisoSleeve');
    const { sleeveSchedule } = await import('./sleeves');
    const h = supplyHouse();
    const p = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1300 });
    const r = autoConnect(p.doc);
    const k = kisoSleeveItems(r.doc);
    expect(k.items.some((i) => i.spec.startsWith('KSA'))).toBe(true);
    expect(k.checks.filter((c) => c.message.includes('KSA'))).toEqual([]);
    const rows = sleeveSchedule(r.doc);
    const outer = rows.filter((x) => x.part === 'footingOuter');
    for (const s of rows.filter((x) => x.part === 'baseSlab')) {
      expect(outer.some((o) => Math.hypot(o.point.x - s.point.x, o.point.y - s.point.y) < 250 && o.system === s.system)).toBe(false);
    }
  });
});

describe('手で置いたヘッダーを使う（2026-11-13 不具合: 1 階に置いたヘッダーを使わず別の所に置いていた）', () => {
  const house = (extraWater = 0) => {
    const h = supplyHouse({ extraWater });
    let doc = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1300 }).doc;
    // 1 階の図（床の上）で置いたヘッダー。高さは決めていない（mountZ なし）
    const w = placeFixture(doc, h.floorId, 'waterHeader', { x: 6000, y: 3000 }); doc = w.doc;
    const hw = placeFixture(doc, h.floorId, 'hotWaterHeader', { x: 6000, y: 2000 }); doc = hw.doc;
    return { ...h, doc, water: w.fixtureId!, hot: hw.fixtureId! };
  };
  const outsUsed = (doc: Doc, fid: string) => portNodes(doc.network, fid).filter((n) => n.portId?.startsWith('out') && segmentsAt(doc.network, n.id).length > 0).length;

  test('1 階に置いた給水・給湯ヘッダーを同じ場所の床下へ下ろして使い、別のヘッダーは置かない', () => {
    const h = house();
    const r = autoConnect(h.doc);
    const heads = Object.values(r.doc.fixtures).filter((f) => f.type === 'waterHeader' || f.type === 'hotWaterHeader');
    expect(heads.map((f) => f.id).sort()).toEqual([h.water, h.hot].sort());
    expect(r.headers).toBe(0);
    for (const id of [h.water, h.hot]) {
      const f = r.doc.fixtures[id];
      expect(f.params?.mountZ ?? 0).toBeLessThan(0);
      expect([f.x, f.y]).toEqual([h.doc.fixtures[id].x, h.doc.fixtures[id].y]);
      expect(segmentsAt(r.doc.network, port(r.doc, id, 'in')).length).toBeGreaterThan(0);
    }
    expect(outsUsed(r.doc, h.water)).toBe(4); // キッチン・洗面台・トイレ・給湯器
    expect(outsUsed(r.doc, h.hot)).toBeGreaterThan(0);
    expect(r.questions).toEqual([]);
    expect(r.summary.join()).toContain('床下へ下ろして');
    const again = autoConnect(r.doc);
    expect(Object.keys(again.doc.network.segments).length).toBe(Object.keys(r.doc.network.segments).length);
  });

  test('出口が足りないときに足すヘッダーは、置いたヘッダーのそばに置く（メーターの近くへ勝手に置かない）', () => {
    const h = house(3); // 給水口 7（ヘッダー 1 台は出口 6）
    const r = autoConnect(h.doc);
    const ws = Object.values(r.doc.fixtures).filter((f) => f.type === 'waterHeader');
    expect(ws).toHaveLength(2);
    const added = ws.find((f) => f.id !== h.water)!;
    expect(Math.hypot(added.x - 6000, added.y - 3000)).toBeLessThan(1500);
  });

  test('配管をもうつないである床上のヘッダーは動かさない', () => {
    const h = house();
    const inN = portNodes(h.doc.network, h.water).find((n) => n.portId === 'in')!;
    const net = addPolyline(h.doc.network, [inN.pos, { ...inN.pos, x: inN.pos.x - 500 }], { system: 'water', diameter: 20 }, { startNodeId: inN.id }).net;
    const r = autoConnect({ ...h.doc, network: net });
    expect(r.doc.fixtures[h.water].params?.mountZ).toBeUndefined();
    expect(r.summary.join()).toContain('配管がつないであるため、そのままにしました');
  });

  test('つながらなかったヘッダーは「つなぎました」と知らせない（給湯器が無い家の給湯ヘッダー）', () => {
    const h = house();
    const heater = Object.values(h.doc.fixtures).find((f) => f.type === 'waterHeater')!;
    const { [heater.id]: _gone, ...fixtures } = h.doc.fixtures;
    const net = { ...h.doc.network, nodes: Object.fromEntries(Object.entries(h.doc.network.nodes).filter(([, n]) => n.fixtureId !== heater.id)) };
    const r = autoConnect({ ...h.doc, fixtures, network: net });
    expect(r.summary.join()).toContain('給水ヘッダーを、同じ場所の床下へ下ろしてつなぎました');
    expect(r.summary.join()).not.toContain('給湯ヘッダーを、同じ場所の床下へ下ろしてつなぎました');
  });
});
