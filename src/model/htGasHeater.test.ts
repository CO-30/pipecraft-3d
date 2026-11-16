import { describe, expect, it } from 'vitest';
import { createBuildingFromDims } from './building';
import type { Doc } from './doc';
import { addPolyline, emptyNetwork } from './network';
import { placeFixture } from './fixtures';
import { htWithGasHeater } from './materials';
import { computeEstimate } from './estimate';

const v = (x: number, y: number, z: number) => ({ x, y, z });
function house(withHeater: boolean, hotMaterial: string | undefined, at: 'out' | 'in' = 'out'): { doc: Doc; segId: string } {
  const building = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 120, slabThickness: 200 });
  let doc: Doc = { building, network: emptyNetwork(), fixtures: {} };
  if (withHeater) doc = placeFixture(doc, building.floors[0].id, 'waterHeater', { x: -800, y: 1000 }).doc;
  const x0 = at === 'out' ? -2000 : 1000, x1 = at === 'out' ? -1000 : 3000;
  const r = addPolyline(doc.network, [v(x0, 2000, -300), v(x1, 2000, -300)], { system: 'hotWater', diameter: 13, ...(hotMaterial ? { material: hotMaterial } : {}) });
  doc = { ...doc, network: r.net };
  return { doc, segId: r.segmentIds[0] };
}

describe('ガス給湯器に HT（耐熱塩ビ）は不可（南部水道企業団・沖縄市のチェック表）', () => {
  it('給湯器があり、給湯管が HTVP なら区間を返す', () => {
    const h = house(true, 'HTVP');
    expect(htWithGasHeater(h.doc)).toEqual([h.segId]);
  });
  it('材質が空欄の給湯は、屋内でも屋外でも HT 扱い（積算が HTVP として数えるのと同じ）', () => {
    expect(htWithGasHeater(house(true, undefined, 'out').doc)).toHaveLength(1);
    expect(htWithGasHeater(house(true, undefined, 'in').doc)).toHaveLength(1);
  });
  it('PB なら返さない。給湯器が無ければ返さない', () => {
    expect(htWithGasHeater(house(true, 'PB保温10mm').doc)).toEqual([]);
    expect(htWithGasHeater(house(false, 'HTVP').doc)).toEqual([]);
  });
  it('積算の要確認に区間ごとに出る', () => {
    const h = house(true, 'HTVP');
    const issues = computeEstimate(h.doc).issues.filter((i) => i.kind === 'material');
    expect(issues).toHaveLength(1);
    expect(issues[0].target).toEqual({ kind: 'segment', id: h.segId });
    expect(issues[0].message).toContain('ガス給湯器');
    expect(issues[0].message).toContain('HT');
  });
});
