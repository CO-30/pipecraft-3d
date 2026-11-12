import { describe, expect, test } from 'vitest';
import { drainHouse as crowdedDrain } from './testDrainHouse';
import { STANDARD_PROFILE } from './municipality';
import { buildProfile, extractRoute } from './profileDrawing';
import { applyMeasuredToProfile, asBuiltTitle, measuredLengthOf, readAsBuilt, unmeasuredSegments, writeAsBuilt } from './asBuilt';
import type { Doc } from './doc';

function withMeasured(doc: Doc, m: Record<string, number>, approx: string[] = []): Doc {
  const segments = { ...doc.network.segments };
  for (const [id, v] of Object.entries(m)) segments[id] = { ...segments[id], measuredLength: v, ...(approx.includes(id) ? { measuredApprox: true } : {}) };
  return { ...doc, network: { ...doc.network, segments } };
}
function profileOf(doc: Doc, outlet: string) {
  const r = extractRoute(doc.network, outlet);
  if ('error' in r) throw new Error(r.error);
  return buildProfile(doc, r.route, STANDARD_PROFILE, '排水設備 縦断図');
}

describe('竣工の設定', () => {
  test('往復し、既定は申請図', () => {
    expect(readAsBuilt(undefined)).toEqual({ on: false, date: undefined });
    const app = writeAsBuilt({ x: '1' }, { on: true, date: '2026-11-12' });
    expect(readAsBuilt(app)).toEqual({ on: true, date: '2026-11-12' });
    expect(readAsBuilt(writeAsBuilt(app, { on: false }))).toEqual({ on: false, date: '2026-11-12' });
    expect(readAsBuilt({ 'shunko.on': '1', 'shunko.date': '11/12' }).date).toBeUndefined();
    expect(app.x).toBe('1');
  });
});

describe('asBuiltTitle', () => {
  test('図の種類を括弧に入れて竣工図に', () => {
    expect(asBuiltTitle('排水設備 縦断図')).toBe('排水設備 竣工図（縦断図）');
    expect(asBuiltTitle('給水装置 立面図')).toBe('給水装置 竣工図（立面図）');
    expect(asBuiltTitle('立面図（展開図）')).toBe('竣工図（立面図（展開図））');
    expect(asBuiltTitle('排水設備 縦断図（枝1: 点3 から）')).toBe('排水設備 竣工図（縦断図）（枝1: 点3 から）');
    expect(asBuiltTitle('配管図')).toBe('竣工図 配管図');
  });
});

describe('縦断図を実測長で描き直す', () => {
  test('実測のある区間だけ延長が実測になり、追加距離を積み直し、勾配は落差÷実測', () => {
    const { doc, outlet } = crowdedDrain();
    const base = profileOf(doc, outlet);
    const flat = base.segments.filter((s) => s.slope !== null);
    const target = flat[flat.length - 1]; // 公共桝へ 6m の区間
    const d2 = withMeasured(doc, { [target.segId]: 6500 });
    const { model, unmeasured } = applyMeasuredToProfile(profileOf(d2, outlet), d2);
    const seg = model.segments.find((s) => s.segId === target.segId)!;
    expect(seg.distance).toBe(6500);
    const i = model.segments.indexOf(seg);
    const up = model.nodes[i], down = model.nodes[i + 1];
    const drop = up.invertLevel - (down.invertIn ?? down.invertLevel);
    expect(seg.slope).toBeCloseTo(drop / 6500, 9);
    // 追加距離は区間の延長の和
    model.nodes.forEach((n, k) => { if (k > 0) expect(n.cumDistance).toBeCloseTo(model.nodes[k - 1].cumDistance + model.segments[k - 1].distance, 6); });
    expect(model.nodes[model.nodes.length - 1].cumDistance).toBeCloseTo(base.nodes[base.nodes.length - 1].cumDistance + 6500 - target.distance, 6);
    expect(unmeasured).not.toContain(target.segId);
    expect(unmeasured.length).toBe(base.segments.filter((s) => s.distance >= 1).length - 1); // 立管は数えない
    // 元のモデルは変えない
    expect(profileOf(d2, outlet).segments.find((s) => s.segId === target.segId)!.distance).toBe(target.distance);
  });
  test('立管（長さ 0）は実測があっても触らず、逆勾配は「逆勾配」', () => {
    const { doc, outlet } = crowdedDrain();
    const base = profileOf(doc, outlet);
    const riser = base.segments.find((s) => s.slope === null);
    const flat = base.segments.find((s) => s.slope !== null)!;
    const i = base.segments.indexOf(flat);
    const m: Record<string, number> = { [flat.segId]: 1234 };
    if (riser) m[riser.segId] = 300;
    const { model } = applyMeasuredToProfile(profileOf(withMeasured(doc, m), outlet), withMeasured(doc, m));
    if (riser) expect(model.segments.find((s) => s.segId === riser.segId)!.distance).toBe(riser.distance);
    expect(model.segments[i].slopeText).not.toBe('');
    const rev = { ...model, nodes: model.nodes.map((n, k) => (k === i + 1 ? { ...n, invertLevel: model.nodes[i].invertLevel + 50, invertIn: undefined } : n)) };
    expect(applyMeasuredToProfile(rev, withMeasured(doc, m)).model.segments[i].slopeText).toBe('逆勾配');
  });
});

describe('展開図の長さ・未実測の区間', () => {
  test('実測 > 0 ならそれ、無ければ幾何の長さ。未実測は概算（按分）も含めて数えない', () => {
    const { doc } = crowdedDrain();
    const ids = Object.keys(doc.network.segments);
    const d2 = withMeasured(doc, { [ids[0]]: 777, [ids[1]]: 500 }, [ids[1]]);
    const len = measuredLengthOf(d2);
    expect(len(ids[0])).toBe(777);
    expect(len(ids[2])).toBeGreaterThan(0);
    expect(unmeasuredSegments(d2, ids)).toEqual(ids.slice(2));
  });
});
