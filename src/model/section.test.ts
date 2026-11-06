import { describe, expect, it } from 'vitest';
import { clampSection, defaultSectionValue, sectionPlane } from './section';
import { createBuildingFromDims } from './building';
import { buildingBoxes } from './building3d';

const b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });

describe('断面', () => {
  it('clampSection: 水平は 0〜最上階上端、縦は建物範囲±1000mm', () => {
    expect(clampSection(b, { mode: 'z', value: -500 }).value).toBe(0);
    expect(clampSection(b, { mode: 'z', value: 99999 }).value).toBe(5800);
    expect(clampSection(b, { mode: 'x', value: -5000 }).value).toBe(-1000);
    expect(clampSection(b, { mode: 'y', value: 99999 }).value).toBe(7000);
    expect(clampSection(b, { mode: 'off', value: 123 })).toEqual({ mode: 'off', value: 123 });
  });

  it('sectionPlane: 値より大きい側を切り取る（normal·p + constant >= 0 を残す）', () => {
    expect(sectionPlane({ mode: 'off', value: 0 })).toBeNull();
    const keep = (s: Parameters<typeof sectionPlane>[0], p: { x: number; y: number; z: number }) => {
      const pl = sectionPlane(s)!;
      return pl.normal.x * p.x + pl.normal.y * p.y + pl.normal.z * p.z + pl.constant >= 0;
    };
    expect(keep({ mode: 'z', value: 1200 }, { x: 0, y: 0, z: 1000 })).toBe(true);
    expect(keep({ mode: 'z', value: 1200 }, { x: 0, y: 0, z: 1500 })).toBe(false);
    expect(keep({ mode: 'x', value: 4000 }, { x: 3000, y: 0, z: 0 })).toBe(true);
    expect(keep({ mode: 'y', value: 3000 }, { x: 0, y: 3500, z: 0 })).toBe(false);
  });

  it('defaultSectionValue: 水平は現在の階の床+1200、縦は建物中央', () => {
    expect(defaultSectionValue(b, 'z', b.floors[1].id)).toBe(2900 + 1200);
    expect(defaultSectionValue(b, 'x', b.floors[0].id)).toBe(4000);
    expect(defaultSectionValue(b, 'y', b.floors[0].id)).toBe(3000);
  });

  it('3D の箱に階ID が付く', () => {
    const boxes = buildingBoxes(b);
    expect(new Set(boxes.map((x) => x.floorId))).toEqual(new Set(b.floors.map((f) => f.id)));
  });
});
