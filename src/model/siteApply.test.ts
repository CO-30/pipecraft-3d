import { describe, expect, it } from 'vitest';
import { emptyDoc } from '../state/store';
import { createBuildingFromDims } from './building';
import { applySite } from './siteApply';
import { manholeDepth, portNodes } from './fixtures';

describe('配置図の内容を工事に入れる（applySite）', () => {
  it('ます・メーター・立水栓を置き、敷地の高さを入れる。ますの深さはその場所の地面から', () => {
    const b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    const doc0 = { ...emptyDoc(), building: b, site: { designGL: -600 } };
    const r = applySite(doc0, b.floors[0].id, {
      items: [{ type: 'manholeSewage', x: 1000, y: 7000 }, { type: 'publicSewage', x: -2000, y: 7000 }, { type: 'waterMeter', x: -1000, y: -800 }, { type: 'outdoorFaucet', x: 500, y: -500 }],
      levels: [{ x: 1000, y: 7000, gl: -500 }, { x: -2000, y: 7000, gl: -950 }],
    });
    expect(r.placed).toBe(4);
    expect(r.doc.site?.groundPoints).toHaveLength(2);
    const m = Object.values(r.doc.fixtures).find((f) => f.type === 'manholeSewage')!;
    expect(manholeDepth(m, r.doc.building, r.doc.site)).toBe(600);
    expect(portNodes(r.doc.network, m.id)[0].pos.z).toBe(-600 - 500 - 600);
  });
});
