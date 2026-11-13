/**
 * 床下から外への排水の出し方（2026-11-13 ユーザー: 基礎伏図 FG1・前澤「排水管貫通セット」のように）:
 * 土間から 45° で基礎を抜け、外周の基礎の外の面で GL−370 の水平になって外へ出る（真下に落として L で出さない）
 */
import { describe, expect, test } from 'vitest';
import { autoConnect } from './autoConnect';
import { supplyHouse } from './testSupplyHouse';
import { placeFixture } from './fixtures';
import { solveDrain } from './drainSolve';
import { resolveDrainRules } from './drainRules';
import { BUILTIN_PROFILES } from './municipality';
import { segmentsAt } from './network';
import { kisoSleeveItems } from './kisoSleeve';
import { endZ } from './slope';
import { dropLegs } from './dropLegs';
import { buildingBoxes } from './building3d';
import { computeEstimate } from './estimate';

const NAHA = resolveDrainRules(BUILTIN_PROFILES.find((p) => p.id === 'naha')!);

describe('床下から外への排水の出し方', () => {
  const h = supplyHouse(); // 土間 −550・GL −611・外周の立上り 150
  const p = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1500 });
  const d = solveDrain(autoConnect(p.doc).doc, NAHA).doc;
  const net = d.network;
  const isDrain = (s: { system: string }) => s.system === 'drain' || s.system === 'sewage';
  // 外周の壁の線（x=0・8000・y=0・6000）をまたぐ排水の区間
  const crossing = Object.values(net.segments).filter((s) => {
    if (!isDrain(s)) return false;
    const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos;
    const inside = (q: { x: number; y: number }) => q.x > 0 && q.x < 8000 && q.y > 0 && q.y < 6000;
    return inside(a) !== inside(b);
  });

  test('外周を抜ける所は 45° の斜め（土間から GL−370 へ）。真下へ落とさない', () => {
    expect(crossing.length).toBeGreaterThan(0);
    for (const s of crossing) {
      const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos;
      const [hi, lo] = a.z > b.z ? [a, b] : [b, a];
      const L = Math.hypot(a.x - b.x, a.y - b.y), dz = hi.z - lo.z;
      expect(Math.abs(dz - L)).toBeLessThan(20);
      expect(hi.z).toBeCloseTo(-550, 0);
      expect(lo.z).toBeCloseTo(-611 - 370, 0);
      // 低い端（外の口）は外周の基礎の外の面（壁の芯から 75）
      const off = Math.min(Math.abs(lo.x), Math.abs(lo.x - 8000), Math.abs(lo.y), Math.abs(lo.y - 6000));
      expect(off).toBeCloseTo(75, -1);
      // 高い端（土間の口）には真下へ下りる管がつながっていない
      const hiId = net.nodes[s.a].pos.z > net.nodes[s.b].pos.z ? s.a : s.b;
      for (const t of segmentsAt(net, hiId)) {
        const o = net.nodes[t.a === hiId ? t.b : t.a].pos;
        expect(Math.hypot(o.x - net.nodes[hiId].pos.x, o.y - net.nodes[hiId].pos.y)).toBeGreaterThan(1);
      }
    }
  });

  test('外の口から外へは水平（標準の勾配）でマスへ。マスが深ければマスの外で L で落とす（外の口は GL−370 のまま）', () => {
    let dropped = 0;
    for (const s of crossing) {
      const lowId = net.nodes[s.a].pos.z < net.nodes[s.b].pos.z ? s.a : s.b;
      const out = segmentsAt(net, lowId).find((t) => t.id !== s.id)!;
      const far = out.a === lowId ? 'b' : 'a';
      const o = net.nodes[out[far]].pos, q = net.nodes[lowId].pos;
      const sl = (q.z - endZ(net, out, far)) / Math.hypot(q.x - o.x, q.y - o.y);
      expect(sl).toBeGreaterThanOrEqual(NAHA.defaultSlope(out.diameter) - 1e-3);
      expect(sl).toBeLessThan(Math.max(2 * NAHA.defaultSlope(out.diameter), 0.02));
      if ((out.dropEnd ?? 0) > 50) dropped++;
    }
    // 2 本の出口のうち、深い合流マスへ着く方は L で落とす
    expect(dropped).toBe(1);
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

  test('積算の基礎貫通スリーブ（KSA）は 45° の高さ（土間 − 外の口 = 431）で選ぶ', () => {
    const k = kisoSleeveItems(d);
    expect(k.items.some((i) => i.spec.startsWith('KSA'))).toBe(true);
  });
});
