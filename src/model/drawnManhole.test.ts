/**
 * 図面のますに合わせる（2026-11-18 ユーザー指定）: 床下の本管でまとめると、配置図に描かれた汚水ますのうち上流の端のますに
 * 何も流れ込まなくなる（例: トイレのすぐ外のます）。そのますには、すぐ内側の器具（トイレなど）を基礎を抜いて直接つなぐ。
 */
import { describe, expect, test } from 'vitest';
import { autoConnect, pairDrawnManholes } from './autoConnect';
import type { Doc } from './doc';
import { isManhole, placeFixture, portNodes } from './fixtures';
import { segmentsAt, type Network } from './network';
import { supplyHouse } from './testSupplyHouse';

/** 器具の排水口から排水の管をたどって最初に着くマス（マスの先へは進まない） */
function firstManholes(doc: Doc, fixtureId: string): Set<string> {
  const net: Network = doc.network;
  const start = portNodes(net, fixtureId).find((n) => n.portId === 'drain' || n.portId === 'sewage')!.id;
  const seen = new Set([start]), st = [start], out = new Set<string>();
  while (st.length) {
    const id = st.pop()!;
    for (const s of segmentsAt(net, id)) {
      if (s.system !== 'drain' && s.system !== 'sewage') continue;
      const o = s.a === id ? s.b : s.a;
      if (seen.has(o)) continue;
      seen.add(o);
      const f = net.nodes[o].fixtureId ? doc.fixtures[net.nodes[o].fixtureId!] : undefined;
      if (f && isManhole(f.type)) { out.add(f.id); continue; }
      st.push(o);
    }
  }
  return out;
}

/**
 * 西の外に配置図のように並んだ汚水ます: D（北の下流端）← B（本管の出口になる）← A（洗面台のすぐ外・線の上流の端）。
 * 本管にまとめると A に何も流れ込まない
 */
function house() {
  const h = supplyHouse();
  let doc = h.doc;
  const put = (x: number, y: number) => { const r = placeFixture(doc, h.floorId, 'manholeSewage', { x, y }); doc = r.doc; return r.fixtureId!; };
  const B = put(-600, 5000), A = put(-600, 1000), D = put(-600, 7500);
  return { doc, ids: { ...h.ids, A, B, D } };
}

describe('図面のますに合わせる: 本管で空になる上流の端のますへ、すぐ内側の器具を直接', () => {
  test('洗面台はすぐ外のます A へ直接（本管の出口のます B を通らない）。A は空のますでなくなる', () => {
    const { doc, ids } = house();
    // 今までの形（本管だけ）では A に何も流れ込まないことを先に確かめる
    const before = autoConnect(doc, { directToDrawn: false });
    expect([...firstManholes(before.doc, ids.washbasin!)]).toEqual([ids.B]);
    const r = autoConnect(doc);
    expect([...firstManholes(r.doc, ids.washbasin!)]).toEqual([ids.A]);
    expect(r.direct).toHaveLength(1);
    // トイレ・キッチンは今までどおり床下の本管から B へ
    expect([...firstManholes(r.doc, ids.toilet!)]).toEqual([ids.B]);
    expect([...firstManholes(r.doc, ids.kitchen!)]).toEqual([ids.B]);
    // A には流れ込む管がある（トイレ）と、下流へ出ていく管
    const pa = portNodes(r.doc.network, ids.A)[0].id;
    expect(segmentsAt(r.doc.network, pa).filter((s) => s.system === 'drain' || s.system === 'sewage').length).toBeGreaterThanOrEqual(2);
    expect(r.summary.join()).toContain('図面のます');
    // ほかの器具は新しく通した φ100 の本管で（直接つないだ管を本管とみなして枝でつながない）
    expect(r.summary.join()).toContain('本管を通し');
    expect(r.summary.join()).not.toContain('床下の本管へつなぎました');
  });
  test('何度押しても増えない', () => {
    const { doc } = house();
    const r1 = autoConnect(doc);
    const r2 = autoConnect(r1.doc);
    expect(Object.keys(r2.doc.network.segments)).toHaveLength(Object.keys(r1.doc.network.segments).length);
  });
  test('上流の端のますの近くに器具が無ければ、今までどおり（器具を遠くから引かない）', () => {
    const h = supplyHouse();
    let doc = h.doc;
    const put = (x: number, y: number) => { const r = placeFixture(doc, h.floorId, 'manholeSewage', { x, y }); doc = r.doc; return r.fixtureId!; };
    const B = put(-600, 5000); put(-600, 7500);
    // 線の上流の端が、どの器具からも遠い（南西の外の離れた所）
    put(-600, -2500);
    const r = autoConnect(doc);
    expect(r.direct).toEqual([]);
    expect([...firstManholes(r.doc, h.ids.washbasin!)]).toEqual([B]);
  });
});

describe('ます × 器具の組の決め方（pairDrawnManholes）', () => {
  const end = (id: string, x: number, y: number, system = 'drain') => ({ node: { id, pos: { x, y } }, seg: { system } });
  test('2 つのますが同じ器具を取り合う → 近い方のますへ。もう一方のますは近くに残りの器具が無ければ空のまま', () => {
    const holes = [{ id: 'far', x: 0, y: 2000 }, { id: 'near', x: 0, y: 900 }];
    expect(pairDrawnManholes(holes, [end('wb', 0, 0), end('k', 9000, 9000)])).toEqual([{ endId: 'wb', holeId: 'near' }]);
  });
  test('先のますが後のますのすぐ内側の器具を取らない（組を近い順に）', () => {
    // ます P: b まで 1200・a まで 1400、ます Q: b まで 400。ますの順に取ると P が b を取り、Q が空のままになる
    const holes = [{ id: 'P', x: 0, y: 0 }, { id: 'Q', x: 1600, y: 0 }];
    const r = pairDrawnManholes(holes, [end('a', -1400, 0), end('b', 1200, 0), end('k', 9000, 9000)]);
    expect(r).toContainEqual({ endId: 'b', holeId: 'Q' });
    expect(r).toContainEqual({ endId: 'a', holeId: 'P' });
  });
  test('ほぼ同じ近さならトイレ（汚水）を先に。遠い器具は引かない。本管に 1 つは残す', () => {
    const holes = [{ id: 'H', x: 0, y: 0 }];
    expect(pairDrawnManholes(holes, [end('kitchen', 1000, 0), end('toilet', 0, 1050, 'sewage'), end('wb', 5000, 0)])).toEqual([{ endId: 'toilet', holeId: 'H' }]);
    expect(pairDrawnManholes(holes, [end('wb', 3000, 0), end('k', 9000, 0)])).toEqual([]);
    expect(pairDrawnManholes(holes, [end('only', 100, 0)])).toEqual([]);
  });
});
