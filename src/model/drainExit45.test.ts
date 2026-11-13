/**
 * 床下から外への排水の出し方（2026-11-13 ユーザー: 基礎伏図 FG1・前澤「排水管貫通セット」のように。品は前澤 KSA-B75N×280H の形）:
 * 土間の口から 45° で下り、基礎の外の面から 255 内側の曲がりで水平になって基礎を抜ける（H は品番の高さ）。
 * 外の口が GL−370 より高ければ、基礎の外の面で L で落として GL−370 から外へ（真下に落として L で出さない）
 */
import { describe, expect, test } from 'vitest';
import { autoConnect } from './autoConnect';
import { supplyHouse } from './testSupplyHouse';
import { placeFixture } from './fixtures';
import { solveDrain } from './drainSolve';
import { resolveDrainRules } from './drainRules';
import { BUILTIN_PROFILES } from './municipality';
import { segmentsAt, type Segment } from './network';
import { kisoSleeveItems, ksaExit, KSA_STRAIGHT } from './kisoSleeve';
import { endZ, isRiserLike } from './slope';
import { dropLegs } from './dropLegs';
import { buildingBoxes } from './building3d';
import { computeEstimate } from './estimate';
import { analyzeFittings } from './fittings';

const NAHA = resolveDrainRules(BUILTIN_PROFILES.find((p) => p.id === 'naha')!);
const GL = -611, SLAB = -550;

describe('床下から外への排水の出し方', () => {
  const h = supplyHouse(); // 土間 −550・GL −611・外周の立上り 150
  const p = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1500 });
  const solved = solveDrain(autoConnect(p.doc).doc, NAHA);
  const d = solved.doc;
  const net = d.network;
  const isDrain = (s: { system: string }) => s.system === 'drain' || s.system === 'sewage';
  const other = (s: Segment, id: string) => net.nodes[s.a === id ? s.b : s.a];
  /** 外周の壁の芯からの距離（建物の中は負） */
  const off = (q: { x: number; y: number }) => {
    const inside = q.x > 0 && q.x < 8000 && q.y > 0 && q.y < 6000;
    const m = Math.min(Math.abs(q.x), Math.abs(q.x - 8000), Math.abs(q.y), Math.abs(q.y - 6000));
    return inside ? -m : m;
  };
  // KSA の曲がり: 排水の点で、上へ 45° の管と横の管がつながる所（エルボは数えない印つき）
  const bends = Object.values(net.nodes).filter((n) => n.fitting?.type === 'none' && segmentsAt(net, n.id).some(isDrain));
  const exits = bends.map((k) => {
    const segs = segmentsAt(net, k.id);
    const up = segs.find((s) => isRiserLike(net, s) && other(s, k.id).pos.z > k.pos.z)!;
    const out = segs.find((s) => s !== up)!;
    return { k, up, out, top: other(up, k.id), mouth: other(out, k.id) };
  });

  test('外へ出る 2 本とも KSA の形: 土間の口から 45° で下り、基礎の外の面から 255 内側で水平になる（H は品番の高さ）', () => {
    expect(exits).toHaveLength(2);
    for (const e of exits) {
      const L = Math.hypot(e.top.pos.x - e.k.pos.x, e.top.pos.y - e.k.pos.y), dz = e.top.pos.z - e.k.pos.z;
      expect(Math.abs(dz - L)).toBeLessThan(2); // 45°
      const ksa = ksaExit(e.up.diameter, SLAB, Math.min(GL - 370, GL - NAHA.cover - (e.up.diameter === 100 ? 114 : 89)))!;
      expect(e.top.pos.z).toBeCloseTo(SLAB, 0);
      expect(e.k.pos.z).toBe(SLAB - ksa.H);
      expect(off(e.k.pos)).toBeCloseTo(75 - KSA_STRAIGHT, 0); // 外の面（芯から 75）の 255 内側
      expect(off(e.mouth.pos)).toBeCloseTo(75, 0); // 外の口は外の面
    }
  });

  test('外の口が GL−370 より高ければ、外の面で真下へ L で落として GL−370 から外へ', () => {
    for (const e of exits) {
      const fall = segmentsAt(net, e.mouth.id).find((s) => s.id !== e.out.id)!;
      const low = other(fall, e.mouth.id);
      expect(Math.hypot(low.pos.x - e.mouth.pos.x, low.pos.y - e.mouth.pos.y)).toBeLessThan(1);
      expect(low.pos.z).toBeCloseTo(GL - 370, 0);
      expect(e.mouth.pos.z).toBeGreaterThan(low.pos.z + 50);
    }
    // 土かぶりの検査で、基礎の外の面の口（すぐ落とす所）を不足に数えない
    expect(solved.issues.filter((i) => i.kind === 'cover')).toEqual([]);
  });

  test('外の配管は標準の勾配でマスへ。マスが深ければマスの外で L で落とす', () => {
    let dropped = 0;
    for (const e of exits) {
      const fall = segmentsAt(net, e.mouth.id).find((s) => s.id !== e.out.id)!;
      const low = other(fall, e.mouth.id);
      const out = segmentsAt(net, low.id).find((t) => t.id !== fall.id)!;
      const far = out.a === low.id ? 'b' : 'a';
      const o = net.nodes[out[far]].pos, q = low.pos;
      const sl = (q.z - endZ(net, out, far)) / Math.hypot(q.x - o.x, q.y - o.y);
      expect(sl).toBeGreaterThanOrEqual(NAHA.defaultSlope(out.diameter) - 1e-3);
      expect(sl).toBeLessThan(Math.max(2 * NAHA.defaultSlope(out.diameter), 0.02));
      if ((out.dropEnd ?? 0) > 50) dropped++;
    }
    // 2 本の出口のうち、深い合流マスへ着く方は L で落とす
    expect(dropped).toBe(1);
  });

  test('KSA の曲がりはエルボに数えない（フレキ管が曲がる所）。外の面で落とす所は 90°エルボ', () => {
    const fits = analyzeFittings(d.network, d.fixtures);
    for (const e of exits) {
      const f = fits.find((x) => x.nodeId === e.k.id);
      expect(f?.type ?? 'none').toBe('none');
      expect(fits.find((x) => x.nodeId === e.mouth.id)?.type).toBe('elbow90');
    }
  });

  test('高く着く管は 3D でマスの外で L で落とす。積算に L（90°エルボ）2 個', () => {
    const legs = [...dropLegs(d).values()];
    expect(legs).toHaveLength(1);
    const leg = legs[0];
    expect(leg.top.z - leg.bottom.z).toBe(leg.length);
    expect(leg.bottom.z).toBeCloseTo(leg.into.z, 3);
    expect(Math.hypot(leg.top.x - leg.into.x, leg.top.y - leg.into.y)).toBeGreaterThan(150);
    const k = computeEstimate(d).kiso.find((l) => l.key.startsWith('kiso|dropL|'));
    expect(k?.count).toBe(2);
  });

  test('床下より下の基礎: 外周の立上りを GL−250 まで下ろし、その下に内側へ張り出すベース（3D）', () => {
    const boxes = buildingBoxes(d.building, d.site);
    const roots = boxes.filter((x) => x.key.endsWith(':root')), bases = boxes.filter((x) => x.key.endsWith(':base'));
    expect(roots.length).toBe(4); // 外周の立上り 4 本（内部の立上りは無し）
    for (const r of roots) expect(r.center.z - r.size.z / 2).toBeCloseTo(-611 - 250, 0);
    for (const b of bases) { expect(b.center.z + b.size.z / 2).toBeCloseTo(-611 - 250, 0); expect(b.size.y).toBe(150 + 300); }
  });

  test('もう一度計算しても同じ（管ごとのドロップが行ったり来たりしない）', () => {
    const again = solveDrain(d, NAHA).doc;
    expect(again.network).toBe(d.network);
    expect(solveDrain(again, NAHA).doc.network).toBe(d.network);
  });

  test('管がつなぎ替わって不要になった管ごとのドロップは消す', () => {
    const s0 = Object.values(d.network.segments).find((s) => (s.dropEnd ?? 0) > 0)!;
    const net = { ...d.network, segments: { ...d.network.segments, [s0.id]: { ...s0, system: 'water' as const } } };
    const out = solveDrain({ ...d, network: net }, NAHA).doc;
    expect(out.network.segments[s0.id].dropEnd).toBeUndefined();
  });

  test('積算の基礎貫通スリーブ: 防蟻品（KSA-B）を出口ごとに 1 セット。H は図と合う（要確認なし）', () => {
    const k = kisoSleeveItems(d, { antiTermite: true });
    const ksa = k.items.filter((i) => i.spec.startsWith('KSA-B'));
    expect(ksa.reduce((n, i) => n + i.count, 0)).toBe(2);
    expect(k.checks.filter((c) => c.message.includes('KSA'))).toEqual([]);
    // 積算の既定も防蟻品
    expect(computeEstimate(d).kiso.filter((l) => l.spec.startsWith('KSA-B')).reduce((n, l) => n + l.count, 0)).toBe(2);
  });
});

describe('外の口が GL−370 より深いとき（床が地面に近い家）', () => {
  test('外では落とさず、KSA の曲がりからそのまま勾配でマスへ。H は一番浅い品（230）', () => {
    const h = supplyHouse();
    const d0 = { ...h.doc, site: { designGL: -300 } }; // 土間 −550 は GL より 250 下
    const p = placeFixture(d0, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1500 });
    const d = solveDrain(autoConnect(p.doc).doc, NAHA).doc;
    const net = d.network;
    const bends = Object.values(net.nodes).filter((n) => n.fitting?.type === 'none' && segmentsAt(net, n.id).some((s) => s.system === 'drain' || s.system === 'sewage'));
    expect(bends.length).toBeGreaterThan(0);
    for (const k of bends) {
      expect(k.pos.z).toBe(SLAB - 230);
      // 曲がりの先は外へ出る横の管だけ（外の面で真下へ落とす管は無い）
      const out = segmentsAt(net, k.id).find((s) => !isRiserLike(net, s))!;
      const o = net.nodes[out.a === k.id ? out.b : out.a];
      expect(segmentsAt(net, o.id).some((t) => t.id !== out.id && isRiserLike(net, t) && Math.hypot(net.nodes[t.a].pos.x - net.nodes[t.b].pos.x, net.nodes[t.a].pos.y - net.nodes[t.b].pos.y) < 1)).toBe(false);
    }
    // もう一度計算しても同じ
    expect(solveDrain(d, NAHA).doc.network).toBe(d.network);
  });
});
