import { describe, expect, test } from 'vitest';
import { FIXTURE_CATALOG, isManhole, type FixtureType } from './fixtures';
import { fixtureParts, planSymbol, type Part3D, type Prim2D } from './fixtureShapes';

const TYPES = (Object.keys(FIXTURE_CATALOG) as FixtureType[]).filter((t) => !isManhole(t));
const EPS = 0.5;
const ABOVE: Partial<Record<FixtureType, number>> = { washbasin: 300, kitchen: 350, shower: 2100 };

/** 平面の記号の外接（ローカル mm） */
function bounds2D(p: Prim2D): [number, number, number, number] {
  if (p.k === 'rect') return [p.x, p.y, p.x + p.w, p.y + p.h];
  if (p.k === 'ellipse') return [p.cx - p.rx, p.cy - p.ry, p.cx + p.rx, p.cy + p.ry];
  return [Math.min(p.x1, p.x2), Math.min(p.y1, p.y2), Math.max(p.x1, p.x2), Math.max(p.y1, p.y2)];
}
/** 3D の部品の外接（ローカル mm、z は設置面から） */
function bounds3D(p: Part3D): [number, number, number, number, number, number] {
  if (p.k === 'box') return [p.x - p.w / 2, p.y - p.d / 2, p.z - p.h / 2, p.x + p.w / 2, p.y + p.d / 2, p.z + p.h / 2];
  if (p.k === 'sphere') return [p.x - p.r, p.y - p.r, p.z - p.r, p.x + p.r, p.y + p.r, p.z + p.r];
  const rx = p.r, ry = p.ry ?? p.r, hl = p.h / 2;
  if (p.axis === 'x') return [p.x - hl, p.y - ry, p.z - rx, p.x + hl, p.y + ry, p.z + rx];
  if (p.axis === 'y') return [p.x - rx, p.y - hl, p.z - ry, p.x + rx, p.y + hl, p.z + ry];
  return [p.x - rx, p.y - ry, p.z - hl, p.x + rx, p.y + ry, p.z + hl];
}

describe('器具の平面の記号', () => {
  for (const t of TYPES) {
    test(`${FIXTURE_CATALOG[t].label}: 外形の中に収まる 2 つ以上の形`, () => {
      const { w, d } = FIXTURE_CATALOG[t].size;
      const prims = planSymbol(t, w, d);
      expect(prims.length).toBeGreaterThanOrEqual(2);
      for (const p of prims) {
        const [x0, y0, x1, y1] = bounds2D(p);
        expect(x0).toBeGreaterThanOrEqual(-w / 2 - EPS); expect(x1).toBeLessThanOrEqual(w / 2 + EPS);
        expect(y0).toBeGreaterThanOrEqual(-d / 2 - EPS); expect(y1).toBeLessThanOrEqual(d / 2 + EPS);
      }
    });
  }
  test('トイレ: タンクは奥（壁側 +y）、便器は手前', () => {
    const { w, d } = FIXTURE_CATALOG.toilet.size;
    const prims = planSymbol('toilet', w, d);
    expect(prims.some((p) => p.k === 'rect' && p.y + p.h / 2 > 0)).toBe(true);
    expect(prims.some((p) => p.k === 'ellipse' && p.cy < 0)).toBe(true);
  });
  test('大きさを変えると記号も合わせて伸びる（キッチン 1800 と 3000）', () => {
    for (const w of [1800, 3000]) for (const p of planSymbol('kitchen', w, 650)) {
      const [x0, , x1] = bounds2D(p);
      expect(x0).toBeGreaterThanOrEqual(-w / 2 - EPS); expect(x1).toBeLessThanOrEqual(w / 2 + EPS);
    }
  });
});

describe('器具の 3D の形', () => {
  for (const t of TYPES) {
    test(`${FIXTURE_CATALOG[t].label}: 平面は外形の中、設置面より下に出ない、2 つ以上の部品`, () => {
      const { w, d, h } = FIXTURE_CATALOG[t].size;
      const parts = fixtureParts(t, w, d, h);
      expect(parts.length).toBeGreaterThanOrEqual(2);
      for (const p of parts) {
        const [x0, y0, z0, x1, y1, z1] = bounds3D(p);
        expect(x0).toBeGreaterThanOrEqual(-w / 2 - EPS); expect(x1).toBeLessThanOrEqual(w / 2 + EPS);
        expect(y0).toBeGreaterThanOrEqual(-d / 2 - EPS); expect(y1).toBeLessThanOrEqual(d / 2 + EPS);
        expect(z0).toBeGreaterThanOrEqual(-EPS);
        // 器具の高さはカウンター・トレイの高さ。その上の水栓・シャワーのヘッドだけ上に出てよい
        expect(z1).toBeLessThanOrEqual(h + (ABOVE[t] ?? 0) + EPS);
      }
    });
  }
  test('どの器具も、部品どうしが同じ向きの面を同じ平面で重ねない（3D で面がちらつかない）', () => {
    const faces = (p: Part3D) => {
      const [x0, y0, z0, x1, y1, z1] = bounds3D(p);
      // 箱は 6 面、z 向きの円柱は上下のふただけ（側面は曲面）
      const all: { axis: 0 | 1 | 2; at: number; dir: 1 | -1 }[] = [{ axis: 2, at: z0, dir: -1 }, { axis: 2, at: z1, dir: 1 }];
      if (p.k === 'box') all.push({ axis: 0, at: x0, dir: -1 }, { axis: 0, at: x1, dir: 1 }, { axis: 1, at: y0, dir: -1 }, { axis: 1, at: y1, dir: 1 });
      if (p.k === 'sphere' || (p.k === 'cyl' && p.axis && p.axis !== 'z')) return [];
      return all.filter((f) => !(f.axis === 2 && f.dir === -1 && Math.abs(f.at) < 0.01)); // 床に置いた底は見えない
    };
    const overlap = (a: number[], b: number[], axis: number) => [0, 1, 2].filter((k) => k !== axis).every((k) => Math.min(a[k + 3], b[k + 3]) - Math.max(a[k], b[k]) > 0.5);
    for (const t of TYPES) {
      const { w, d, h } = FIXTURE_CATALOG[t].size;
      const parts = fixtureParts(t, w, d, h);
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const A = parts[i], B = parts[j], ba = bounds3D(A), bb = bounds3D(B);
        for (const fa of faces(A)) for (const fb of faces(B)) {
          if (fa.axis === fb.axis && fa.dir === fb.dir && Math.abs(fa.at - fb.at) < 0.01 && overlap(ba, bb, fa.axis)) {
            throw new Error(`${FIXTURE_CATALOG[t].label}: 部品 ${i} と ${j} が軸 ${fa.axis} の ${fa.at} で重なる`);
          }
        }
      }
    }
  });
  test('ポンプ・メーター・混合水栓の形が接続口まで届く（管が宙に浮かない）', () => {
    for (const t of ['pump', 'waterMeter', 'mixFaucet'] as const) {
      const { w, d, h } = FIXTURE_CATALOG[t].size;
      const parts = fixtureParts(t, w, d, h);
      for (const port of FIXTURE_CATALOG[t].ports) {
        const near = parts.some((p) => { const [x0, y0, z0, x1, y1, z1] = bounds3D(p); return port.dx >= x0 - 2 && port.dx <= x1 + 2 && port.dy >= y0 - 2 && port.dy <= y1 + 2 && port.dz >= z0 - 2 && port.dz <= z1 + 2; });
        expect(near, `${t} ${port.id}`).toBe(true);
      }
    }
  });
  test('トイレ: タンクは奥で高く、便器は手前', () => {
    const { w, d, h } = FIXTURE_CATALOG.toilet.size;
    const parts = fixtureParts('toilet', w, d, h);
    const top = parts.reduce((a, p) => (bounds3D(p)[5] > bounds3D(a)[5] ? p : a));
    expect(top.y).toBeGreaterThan(0);
    expect(parts.some((p) => p.mat === 'ceramic' && p.y < 0)).toBe(true);
  });
});
