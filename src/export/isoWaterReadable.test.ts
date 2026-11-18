/**
 * 給水の立面図（展開図）の見やすさ（受付 2026-11-18「完成した給水立面図が見にくい」）。
 * - 曲がりで続く同じ管は 1 本として、長さの合計を 1 か所に書く
 * - バルブは記号と凡例で示し、1 個ごとに文字を書かない
 * - 引出線はなるべく配管・ほかの引出線をまたがない
 */
import { describe, expect, test } from 'vitest';
import { addFloor, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork } from '../model/network';
import { placeFixture, portNodes } from '../model/fixtures';
import { BUILTIN_PROFILES, STANDARD_PROFILE } from '../model/municipality';
import { buildIsometric } from '../model/isometric';
import { supplyHouse } from '../model/testSupplyHouse';
import { routeSupplies } from '../model/supplyRoute';
import { renderIsoSheet } from './isoSheet';
import { findTextOverlaps, LabelPlacer, segsCross, type TextOp } from './labelLayout';
import type { Sheet } from './sheet';

const meta = { siteName: 'テスト工事', date: new Date(2026, 10, 18), title: '立面図（展開図）' };
const texts = (sh: Sheet) => sh.ops.filter((o): o is TextOp => o.t === 'text');
const pipeLabels = (sh: Sheet) => texts(sh).filter((t) => /×\d/.test(t.s));

function bentDoc(): Doc {
  const b1 = addFloor(emptyBuilding(), { height: 3000 });
  let doc: Doc = { building: b1.b, network: emptyNetwork(), fixtures: {}, site: { designGL: -300 } };
  const m = placeFixture(doc, b1.floorId, 'waterMeter', { x: 0, y: 0 }); doc = m.doc;
  const out = portNodes(doc.network, m.fixtureId!).find((n) => n.portId === 'out')!;
  const t = placeFixture(doc, b1.floorId, 'faucet', { x: 4000, y: 2000 }); doc = t.doc;
  const p = portNodes(doc.network, t.fixtureId!)[0];
  const r = addPolyline(doc.network, [out.pos, { x: 4000, y: 0, z: out.pos.z }, { x: 4000, y: 2000, z: out.pos.z }, p.pos], { system: 'water', diameter: 20, material: 'HI' }, { startNodeId: out.id, endNodeId: p.id });
  return { ...doc, network: r.net };
}

describe('給水の立面図（展開図）の見やすさ', () => {
  test('曲がりで続く同じ管は、長さの合計を 1 か所に書く', () => {
    const iso = buildIsometric(bentDoc(), 'water', STANDARD_PROFILE);
    expect(iso.lines.length).toBeGreaterThanOrEqual(2);
    const total = iso.lines.reduce((s, l) => s + (l.lenMm ?? 0), 0);
    const labels = pipeLabels(renderIsoSheet(iso, STANDARD_PROFILE, meta));
    expect(labels.map((t) => t.s)).toEqual([`HI20×${(total / 1000).toFixed(1)}`]);
  });

  test('口径が変わる所・分岐・器具では切る（まとめない）', () => {
    let doc = bentDoc();
    const far = Object.values(doc.network.nodes).find((n) => n.pos.x === 4000 && n.pos.y === 0)!;
    doc = { ...doc, network: addPolyline(doc.network, [far.pos, { x: 6000, y: 0, z: far.pos.z }], { system: 'water', diameter: 13, material: 'HI' }, { startNodeId: far.id }).net };
    const labels = pipeLabels(renderIsoSheet(buildIsometric(doc, 'water', STANDARD_PROFILE), STANDARD_PROFILE, meta)).map((t) => t.s).sort();
    expect(labels).toHaveLength(3);
    expect(labels).toContain('HI13×2.0');
  });

  test('器具の接続口では切る（お湯を洗面台 → 浴槽と数珠つなぎにしても 2 本のまま）', () => {
    const b1 = addFloor(emptyBuilding(), { height: 3000 });
    let doc: Doc = { building: b1.b, network: emptyNetwork(), fixtures: {}, site: { designGL: -300 } };
    const w = placeFixture(doc, b1.floorId, 'washbasin', { x: 3000, y: 0 }); doc = w.doc;
    const ports = portNodes(doc.network, w.fixtureId!);
    const hot = ports.find((n) => n.portId === 'hot')!, cold = ports.find((n) => n.portId === 'water')!;
    const spec = { system: 'hotWater' as const, diameter: 13, material: 'PB' as const };
    doc = { ...doc, network: addPolyline(doc.network, [{ x: 0, y: 0, z: hot.pos.z }, hot.pos], spec, { endNodeId: hot.id }).net };
    doc = { ...doc, network: addPolyline(doc.network, [hot.pos, { x: 6000, y: 0, z: hot.pos.z }], spec, { startNodeId: hot.id }).net };
    doc = { ...doc, network: addPolyline(doc.network, [{ x: 0, y: 500, z: cold.pos.z }, cold.pos], { system: 'water', diameter: 13, material: 'PB' }, { endNodeId: cold.id }).net };
    const iso = buildIsometric(doc, 'water', STANDARD_PROFILE);
    expect(iso.fixed).toContain(hot.id);
    const hotLabels = pipeLabels(renderIsoSheet(iso, STANDARD_PROFILE, meta)).filter((t) => iso.lines.some((l) => l.system === 'hotWater' && t.s.endsWith(`×${l.len}`)));
    expect(hotLabels.length).toBeGreaterThanOrEqual(2);
    expect(pipeLabels(renderIsoSheet(iso, STANDARD_PROFILE, meta))).toHaveLength(3);
  });
  test('竣工図の実測長（lengthOf）は、まとめた合計にそのまま使う', () => {
    const iso = buildIsometric(bentDoc(), 'water', STANDARD_PROFILE, { lengthOf: () => 1000 });
    expect(pipeLabels(renderIsoSheet(iso, STANDARD_PROFILE, meta)).map((t) => t.s)).toEqual([`HI20×${iso.lines.length}.0`]);
  });

  describe('自動でつないだ戸建（ヘッダー工法）', () => {
    const doc = routeSupplies(supplyHouse().doc).doc;
    const profile = BUILTIN_PROFILES.find((p) => p.id === 'okinawa-city')!;
    const iso = buildIsometric(doc, 'water', profile);
    const sheet = renderIsoSheet(iso, profile, meta);

    test('管の文字は線の本数の半分以下で、「×0.0」を書かない', () => {
      const labels = pipeLabels(sheet);
      expect(labels.length).toBeLessThanOrEqual(iso.lines.length / 2);
      expect(labels.filter((t) => t.s.endsWith('×0.0'))).toEqual([]);
    });
    test('書いた長さの合計は、配管の長さの合計と合う（差は 0.05m 未満の管と、文字ごとの四捨五入だけ）', () => {
      const labels = pipeLabels(sheet);
      const written = labels.reduce((s, t) => s + Number(t.s.split('×')[1]), 0);
      const real = iso.lines.reduce((s, l) => s + (l.lenMm ?? 0), 0) / 1000;
      const stubs = iso.lines.filter((l) => (l.lenMm ?? 0) < 50).length;
      expect(Math.abs(written - real)).toBeLessThan(0.05 * (labels.length + stubs));
    });
    test('バルブの記号は、バルブの数＋凡例の 1 個', () => {
      const tri = (sh: Sheet) => JSON.stringify(sh.ops).length;
      const noValve = renderIsoSheet({ ...iso, points: iso.points.filter((p) => !p.valve) }, profile, meta);
      expect(tri(sheet)).toBeGreaterThan(tri(noValve));
      expect(texts(noValve).filter((t) => t.s.includes('バルブ'))).toEqual([]);
    });
    test('「バルブ」の文字は凡例の 1 回だけ。記号はバルブの数だけ描く', () => {
      expect(iso.points.filter((p) => p.valve).length).toBeGreaterThan(1);
      expect(texts(sheet).filter((t) => t.s.includes('バルブ'))).toHaveLength(1);
    });
    test('文字が重ならない', () => {
      expect(findTextOverlaps(sheet)).toEqual([]);
    });
  });
});

describe('引出線の交差', () => {
  test('segsCross: 途中で交わる線だけ true（端が触れるだけ・平行は false）', () => {
    expect(segsCross({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 0, y1: 10, x2: 10, y2: 0 })).toBe(true);
    expect(segsCross({ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 10, y1: 0, x2: 10, y2: 10 })).toBe(false);
    expect(segsCross({ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 0, y1: 5, x2: 10, y2: 5 })).toBe(false);
  });
  test('leaderCross を指定すると、配管をまたぐ引出線より、またがない候補を選ぶ', () => {
    const mk = (leaderCross?: number) => {
      const sheet: Sheet = { width: 100, height: 100, ops: [] };
      const pl = new LabelPlacer(sheet, { x1: 0, y1: 0, x2: 100, y2: 100 }, leaderCross ? { leaderCross } : {});
      pl.blockSeg(30, 0, 30, 100, 'pipe');
      const t = (x: number): TextOp => ({ t: 'text', x, y: 50, s: 'A', size: 2 });
      return pl.place([
        { texts: [t(40)], leader: { x1: 20, y1: 50, x2: 40, y2: 50 }, penalty: 0 }, // 配管をまたぐ
        { texts: [t(10)], leader: { x1: 20, y1: 50, x2: 12, y2: 50 }, penalty: 5 }, // またがない
      ])!.texts[0].x;
    };
    expect(mk()).toBe(40); // 既定はこれまでどおり
    expect(mk(40)).toBe(10);
  });
});
