import { describe, expect, it } from 'vitest';
import { createBuildingFromDims } from './building';
import { buildingBoxes } from './building3d';
import { glOfDepth, levelSummary, levelText, underfloorText, viewGroundZ, SLAB_THICKNESS } from './levels';
import { withMember } from './members';

const base = () => createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2970, wallThickness: 150, slabThickness: 200 });
const withFooting = () => {
  const b = base();
  return { ...withMember(b, { kind: 'footing', floorId: b.floors[0].id, a: { x: 0, y: 0 }, b: { x: 8000, y: 0 }, width: 150, z0: -611, z1: -161 }).b, foundation: { slabTop: -511 } };
};

describe('高さの基準（GL・基礎天端・床下の底）', () => {
  it('3D の地面は設計 GL に置く（床下が地下に見えないように）', () => {
    expect(viewGroundZ(base(), { designGL: -611 })).toBe(-611);
    // GL 未入力でも、図面から置いた基礎があれば その下端（GL）に置く
    expect(viewGroundZ(withFooting(), {})).toBe(-611);
    expect(viewGroundZ(base(), undefined)).toBe(0);
  });
  it('1 階の床・基礎天端・床下の底を GL からの高さでまとめる', () => {
    expect(levelSummary(withFooting(), { designGL: -611 })).toEqual({ floor: 611, footingTop: 450, slabTop: 100, tentative: false });
    expect(levelSummary(base(), {})).toEqual({ floor: 0, tentative: true });
  });
  it('3D に床下の底（基礎のスラブ）を描く。外形いっぱい・天端が slabTop', () => {
    const s = buildingBoxes(withFooting()).find((x) => x.key.endsWith(':foundation'))!;
    expect(s).toMatchObject({ category: 'floor', center: { x: 4000, y: 3000, z: -511 - SLAB_THICKNESS / 2 }, size: { x: 8150, y: 6150, z: SLAB_THICKNESS } });
    expect(buildingBoxes(base()).some((x) => x.key.endsWith(':foundation'))).toBe(false);
  });
  it('画面の文: 高さの並び・床下の範囲・床下の配管の高さ', () => {
    const s = levelSummary(withFooting(), { designGL: -611 });
    expect(levelText(s)).toBe('1階の床 GL+611・基礎天端 GL+450・床下の底 GL+100');
    expect(levelText(levelSummary(withFooting(), {}))).toBe('1階の床 GL+611・基礎天端 GL+450・床下の底 GL+100（GL は仮）');
    expect(levelText(levelSummary(base(), {}))).toBeNull();
    expect(underfloorText(s)).toBe('GL+100〜GL+450 の基礎の中・地面より上');
    expect(glOfDepth(s, 300)).toBe('GL+311');
    expect(glOfDepth(levelSummary(base(), {}), 300)).toBeNull();
    expect(glOfDepth(levelSummary(base(), { designGL: -200 }), 300)).toBe('GL−100');
  });
});
