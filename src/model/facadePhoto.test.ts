import { describe, expect, it } from 'vitest';
import { applyH, rectify, solveHomography } from './homography';
import { checkRefRect, refRectPx, faceLengths, photoPlane, type RefRect } from './facadePhoto';
import { elevationFromWall, elevationStandalone } from './elevation';
import { addFloor, emptyBuilding, createBuildingFromDims } from './building';
import { emptyNetwork, type Network } from './network';

describe('基準の四角（壁の一部で写真を合わせる）', () => {
  const el = { width: 10000, height: 12000 };
  it('refRectPx: 立面 mm の四角を補正画像の画素（左上・右上・右下・左下）に直す', () => {
    const r: RefRect = { left: 2000, bottom: 3000, width: 4000, height: 6000 };
    const px = refRectPx(r, el.width, el.height, 500, 600);
    // 1px = 20mm。上端 v = 9000 → y = (12000-9000)/20 = 150、下端 v = 3000 → y = 450
    expect(px).toEqual([{ x: 100, y: 150 }, { x: 300, y: 150 }, { x: 300, y: 450 }, { x: 100, y: 450 }]);
  });
  it('checkRefRect: 壁からはみ出す・小さすぎる四角はエラー', () => {
    expect(checkRefRect({ left: 0, bottom: 0, width: 10000, height: 12000 }, el.width, el.height)).toBeNull();
    expect(checkRefRect({ left: 7000, bottom: 0, width: 4000, height: 1000 }, el.width, el.height)).toMatch(/横幅/);
    expect(checkRefRect({ left: 0, bottom: 11500, width: 1000, height: 1000 }, el.width, el.height)).toMatch(/高さ/);
    expect(checkRefRect({ left: 0, bottom: 0, width: 50, height: 1000 }, el.width, el.height)).toMatch(/100mm/);
    expect(checkRefRect({ left: -1, bottom: 0, width: 1000, height: 1000 }, el.width, el.height)).toMatch(/0 以上/);
    expect(checkRefRect({ left: NaN, bottom: 0, width: 1000, height: 1000 }, el.width, el.height)).toMatch(/数字/);
  });
  it('rectify(dst 指定): 写真の四角は出力の基準の位置に、四角の外も延長して写る。写真の外は灰色', () => {
    // 写真 40×40: 左半分が赤、右半分が青。四隅 (10,10)-(20,30) は赤の領域、(20..30) は青
    const W = 40, Hh = 40;
    const data = new Uint8ClampedArray(W * Hh * 4);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (x < 20) data[i] = 255; else data[i + 2] = 255;
      data[i + 3] = 255;
    }
    // 写真の (10,10)-(20,20) の四角 = 出力 (0,0)-(10,10)。出力は 40×10（四角の右へ延長）
    const quad = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }];
    const dst = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const out = rectify({ data, width: W, height: Hh }, quad, 40, 10, dst)!;
    const px = (x: number, y: number) => Array.from(out.slice((y * 40 + x) * 4, (y * 40 + x) * 4 + 3));
    expect(px(5, 5)).toEqual([255, 0, 0]); // 四角の中 = 赤
    expect(px(15, 5)).toEqual([0, 0, 255]); // 四角の右 = 写真の x=25 → 青
    expect(px(35, 5)).toEqual([226, 232, 240]); // 写真の x=45 → 写真の外 = 灰色
  });
  it('壁全体（dst なし）: 写真の外は灰色（以前の黒から変更）', () => {
    const data = new Uint8ClampedArray(10 * 10 * 4).fill(255);
    // 四隅が写真からはみ出している → 出力の右下は写真の外
    const out = rectify({ data, width: 10, height: 10 }, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], 4, 4)!;
    expect(Array.from(out.slice(0, 3))).toEqual([255, 255, 255]);
    expect(Array.from(out.slice((3 * 4 + 3) * 4, (3 * 4 + 3) * 4 + 3))).toEqual([226, 232, 240]);
  });
  it('延長しすぎて写真の地平線を越えた所は、裏返しの写真ではなく灰色', () => {
    // 写真いっぱいが赤。上がすぼまる強い台形を出力の上端 10 行に合わせると、出力の地平線は 10.5 行目あたり
    // → それより下（地平線の向こう）を写真から引くと裏返しの赤になってしまう。灰色でなければならない
    const W = 100, Hh = 100;
    const data = new Uint8ClampedArray(W * Hh * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 3] = 255; }
    const quad = [{ x: 48, y: 60 }, { x: 52, y: 60 }, { x: 90, y: 90 }, { x: 10, y: 90 }];
    const dst = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }, { x: 0, y: 10 }];
    const out = rectify({ data, width: W, height: Hh }, quad, 100, 400, dst)!;
    const at = (x: number, y: number) => Array.from(out.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 3));
    expect(at(50, 5)).toEqual([255, 0, 0]);
    for (let y = 20; y < 400; y += 40) expect(at(50, y)).toEqual([226, 232, 240]);
  });
  it('dst 指定の行列は 基準の四角 → 写真の四隅 に写す', () => {
    const quad = [{ x: 12, y: 8 }, { x: 40, y: 11 }, { x: 38, y: 50 }, { x: 9, y: 47 }];
    const dst = [{ x: 100, y: 150 }, { x: 300, y: 150 }, { x: 300, y: 450 }, { x: 100, y: 450 }];
    const H = solveHomography(dst, quad)!;
    dst.forEach((p, i) => { const q = applyH(H, p); expect(q.x).toBeCloseTo(quad[i].x, 6); expect(q.y).toBeCloseTo(quad[i].y, 6); });
  });
});

describe('立面の配管の長さ', () => {
  it('faceLengths: 区間の長さを合計し、系統ごとに分ける（多い順）', () => {
    const net: Network = emptyNetwork();
    const n = (id: string, z: number, x = 0) => (net.nodes[id] = { id, kind: 'end', pos: { x, y: 0, z } } as Network['nodes'][string]);
    n('a', 0); n('b', 12000); n('c', 12000, 500); n('d', 0, 2000); n('e', 3000, 2000);
    const seg = (id: string, a: string, b: string, system: string) => (net.segments[id] = { id, a, b, system, diameter: 75 } as unknown as Network['segments'][string]);
    seg('s1', 'a', 'b', 'drain'); seg('s2', 'b', 'c', 'drain'); seg('s3', 'd', 'e', 'water');
    const r = faceLengths(net, ['s1', 's2', 's3']);
    expect(r.total).toBeCloseTo(15500);
    expect(r.bySystem).toEqual([{ system: 'drain', length: 12500 }, { system: 'water', length: 3000 }]);
    expect(faceLengths(net, []).total).toBe(0);
  });
});

describe('3Dの外壁に写真を貼る位置', () => {
  const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  it('単独の立面: 中心は 横幅/2・高さ/2、外面から 3mm 外。右×上 = 外向き（鏡像にならない）', () => {
    const el = elevationStandalone('f1', 8000, 6000, 0);
    const p = photoPlane(el);
    expect(p.center).toEqual({ x: 4000, y: -3, z: 3000 });
    const c = cross(p.right, p.up);
    expect(c.x).toBeCloseTo(p.normal.x); expect(c.y).toBeCloseTo(p.normal.y); expect(c.z).toBeCloseTo(p.normal.z);
  });
  it('壁から作った立面（4面すべて）でも 右×上 = 外向き', () => {
    let b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    if (!Object.keys(b.walls).length) b = addFloor(emptyBuilding()).b;
    for (const wid of Object.keys(b.walls).slice(0, 4)) {
      const el = elevationFromWall(b, wid);
      const p = photoPlane(el);
      const c = cross(p.right, p.up);
      expect(c.x).toBeCloseTo(p.normal.x); expect(c.y).toBeCloseTo(p.normal.y); expect(c.z).toBeCloseTo(p.normal.z);
      expect(p.size).toEqual({ w: el.width, h: el.height });
    }
  });
});
