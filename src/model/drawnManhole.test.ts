/**
 * 図面のますに合わせる（2026-11-18 ユーザー指定）: 床下の本管でまとめると、配置図に描かれた汚水ますのうち上流の端のますに
 * 何も流れ込まなくなる（例: トイレのすぐ外のます）。そのますには、すぐ内側の器具（トイレなど）を基礎を抜いて直接つなぐ。
 */
import { describe, expect, test } from 'vitest';
import { autoConnect } from './autoConnect';
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
