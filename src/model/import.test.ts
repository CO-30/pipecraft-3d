import { describe, expect, it } from 'vitest';
import { aerialPlan, alignAngle, metersPerPixel, offsetRingInward, parseOverpass, polygonArea, rotatePoint, sortByDistance, toLocalMm, worldPx } from './geo';
import { applyH, openingToRect, rectToOpening, rectify, solveHomography } from './homography';
import { applyPaperScale, detectDrawingScale, initialPlacement, paperMmPerPx, paperScaleOf, pxToWorld, rescaleByTwoPoints, underlayCorners, worldToPx, type Underlay } from './underlay';

const U = (o: Partial<Underlay> = {}): Underlay => ({ id: 'u', floorId: 'f', kind: 'image', label: '', src: 'data:', widthPx: 200, heightPx: 100, center: { x: 0, y: 0 }, mmPerPx: 10, rotation: 0, opacity: 0.5, scaled: false, ...o });

describe('下敷き', () => {
  it('画素→図面: 左上の画素は 中心から (−w/2, +h/2)×縮尺、往復で一致（回転あり）', () => {
    expect(pxToWorld(U(), { x: 0, y: 0 })).toEqual({ x: -1000, y: 500 });
    const u = U({ rotation: 30, center: { x: 1234, y: -567 } });
    const w = pxToWorld(u, { x: 37, y: 81 });
    const p = worldToPx(u, w);
    expect(p.x).toBeCloseTo(37, 6);
    expect(p.y).toBeCloseTo(81, 6);
    expect(underlayCorners(U())).toHaveLength(4);
  });
  it('2点で縮尺: 1000mm に見える2点を 3000mm と指定 → 3倍、1点目は動かない', () => {
    const u = rescaleByTwoPoints(U(), { x: 100, y: 0 }, { x: 1100, y: 0 }, 3000)!;
    expect(u.mmPerPx).toBe(30);
    expect(u.center).toEqual({ x: -200, y: 0 });
    expect(u.scaled).toBe(true);
    expect(rescaleByTwoPoints(U(), { x: 0, y: 0 }, { x: 0, y: 0 }, 3000)).toBeNull();
    expect(rescaleByTwoPoints(U(), { x: 0, y: 0 }, { x: 10, y: 0 }, -1)).toBeNull();
  });
  it('縮尺未確定の初期配置は長辺10m', () => {
    expect(initialPlacement(2000, 1000, { x: 0, y: 0 })).toMatchObject({ mmPerPx: 5, scaled: false });
    expect(initialPlacement(2000, 1000, { x: 0, y: 0 }, 537)).toMatchObject({ mmPerPx: 537, scaled: true });
  });
  it('PDF の紙の大きさ: A3 横（1190.55pt）を 2400px にすると 1px = 紙の 0.175mm、1/100 なら 11,830mm は 676px', () => {
    const paper = paperMmPerPx(1190.55, 2400);
    expect(paper).toBeCloseTo(0.175, 4);
    expect(11830 / (paper * 100)).toBeCloseTo(676, 0);
  });
  it('図面の文字から縮尺を読む: 「S:1/100」「縮尺 1：50」。勾配の 1/100 は縮尺にしない', () => {
    expect(detectDrawingScale(['1階 平面図 S:1/100'])).toBe(100);
    expect(detectDrawingScale(['縮尺　１：５０'])).toBe(50);
    expect(detectDrawingScale(['S=1/200', 'SCALE 1/200'])).toBe(200);
    // 違う縮尺が混ざっている図面は決めない（詳細図の縮尺で置かない）
    expect(detectDrawingScale(['S=1/100', 'S=1/20', 'S=1/20'])).toBeUndefined();
    // 「S」に区切りが無い・別の文字列にまたがるものは縮尺にしない
    expect(detectDrawingScale(['75s 1/100'])).toBeUndefined();
    expect(detectDrawingScale(['VU100', 'S', '1/50'])).toBeUndefined();
    expect(detectDrawingScale(['L=2.5 S', '1/100'])).toBeUndefined();
    // 1文字ずつに分かれた PDF
    expect(detectDrawingScale(['S', ':', '1', '/', '1', '0', '0'])).toBe(100);
    expect(detectDrawingScale(['勾配 1/100', 'VU100×5.05', 'H=1/50'])).toBeUndefined();
    // 同じ数だけ違う縮尺があるときは決めない
    expect(detectDrawingScale(['S=1/100', 'S=1/200'])).toBeUndefined();
    expect(detectDrawingScale(['S=1/7'])).toBeUndefined();
    // 表題欄で見出し（SCALE・縮尺）と値が別々の文字になっている図面
    expect(detectDrawingScale(['DRAWING TITLE', '1階 平面詳細図', 'SCALE', '1/50', 'DATE'])).toBe(50);
    expect(detectDrawingScale(['縮 尺', '１／７５'])).toBe(75);
    expect(detectDrawingScale(['基 礎 伏 図 S : 1 / 7 5', 'SCALE', '1/75'])).toBe(75);
    // 見出しが無い「1/100」だけの文字は勾配かもしれないので縮尺にしない。複数の縮尺が書かれた欄も決めない
    expect(detectDrawingScale(['VU100', '1/100'])).toBeUndefined();
    expect(detectDrawingScale(['SCALE', '1/20,100'])).toBeUndefined();
    expect(detectDrawingScale(['SCALE', '1/50', '1/100'])).toBeUndefined();
  });
  it('紙の縮尺を選び直す: 中心は動かさず 1px の実寸だけ変える。紙の大きさが分からない下敷きは変えない', () => {
    const u = applyPaperScale(U({ paperMmPerPx: 0.175, center: { x: 500, y: 700 } }), 50)!;
    expect(u.mmPerPx).toBeCloseTo(8.75, 6);
    expect(u.center).toEqual({ x: 500, y: 700 });
    expect(u.scaled).toBe(true);
    expect(paperScaleOf(u)).toBe(50);
    expect(applyPaperScale(U(), 50)).toBeNull();
    expect(applyPaperScale(U({ paperMmPerPx: 0.175 }), 0)).toBeNull();
    // 2点で合わせ直して半端な縮尺になったら、どの縮尺でもない
    expect(paperScaleOf(U({ paperMmPerPx: 0.175, mmPerPx: 16.1 }))).toBeUndefined();
    expect(paperScaleOf(U())).toBeUndefined();
  });
});

describe('地理計算', () => {
  it('緯度 0.001° ≒ 111.32m、経度は cos(緯度) 倍', () => {
    const o = { lat: 26.2, lon: 127.68 };
    const p = toLocalMm(o, { lat: 26.201, lon: 127.681 });
    expect(p.y).toBeCloseTo(111319.49, 0);
    expect(p.x).toBeCloseTo(111319.49 * Math.cos((26.2 * Math.PI) / 180), 0);
  });
  it('zoom 18 の地上解像度（那覇付近 約0.536m/px）とタイル計画', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
    expect(metersPerPixel(26.2, 18)).toBeCloseTo(0.5359, 3);
    const p = aerialPlan({ lat: 26.2, lon: 127.68 });
    expect(p.tiles).toHaveLength(9);
    const wp = worldPx({ lat: 26.2, lon: 127.68 }, 18);
    expect(p.tiles[4]).toMatchObject({ x: Math.floor(wp.x / 256), y: Math.floor(wp.y / 256) });
    expect(p.tiles[0].url).toMatch(/seamlessphoto\/18\/\d+\/\d+\.jpg$/);
    expect(p.crop.size).toBe(Math.round(120 / 0.5359)); // 224px
    expect(p.crop.x).toBeGreaterThanOrEqual(0);
    expect(p.crop.x + p.crop.size).toBeLessThanOrEqual(768);
    // 画素に丸めたずれは半画素以内
    expect(Math.abs(p.centerOffset.x)).toBeLessThanOrEqual(p.mmPerPx / 2 + 1e-6);
    expect(Math.abs(p.centerOffset.y)).toBeLessThanOrEqual(p.mmPerPx / 2 + 1e-6);
  });
  it('Overpass の建物を多角形（反時計回り・閉じ点なし）にし、地点を含む建物を先頭に', () => {
    const o = { lat: 26.2, lon: 127.68 };
    const d = 0.0001; // 約 10m
    const sq = (lat: number, lon: number) => [[lat, lon], [lat, lon + d], [lat + d, lon + d], [lat + d, lon], [lat, lon]].map(([a, b]) => ({ lat: a, lon: b }));
    const json = { elements: [
      { type: 'way', id: 1, geometry: sq(26.2003, 127.6803), tags: { building: 'yes' } },
      { type: 'way', id: 2, geometry: sq(26.19995, 127.67995).reverse(), tags: { building: 'house', name: '本人宅' } },
      { type: 'node', id: 3 },
    ] };
    const fps = parseOverpass(json, o);
    expect(fps).toHaveLength(2);
    const sorted = sortByDistance(fps, { x: 0, y: 0 });
    expect(sorted[0].id).toBe('2');
    expect(sorted[0].polygon).toHaveLength(4);
    expect(polygonArea(sorted[0].polygon) / 1e6).toBeCloseTo(11.13 * 9.99, 0); // 約111㎡
  });
  it('軒の出補正: 10m 四方を 500mm 内側へ → 9m 四方。縮めすぎは失敗', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 10000 }, { x: 0, y: 10000 }];
    const r = offsetRingInward(sq, 500)!;
    expect(r.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[500, 500], [9500, 500], [9500, 9500], [500, 9500]]);
    expect(offsetRingInward(sq, 4900)).toBeNull();
  });
  it('20°傾いた建物 → −20°回転で軸に合う', () => {
    const rect = [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 8000 }, { x: 0, y: 8000 }].map((p) => rotatePoint(p, 20));
    expect(alignAngle(rect)).toBeCloseTo(-20, 6);
    const back = rect.map((p) => rotatePoint(p, alignAngle(rect)));
    expect(back[1].y - back[0].y).toBeCloseTo(0, 6);
  });
});

describe('射影変換（現場写真の補正）', () => {
  it('四隅の対応どおりに写り、中間点も射影で写る', () => {
    const from = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
    const to = [{ x: 10, y: 20 }, { x: 210, y: 0 }, { x: 230, y: 160 }, { x: 0, y: 120 }];
    const H = solveHomography(from, to)!;
    from.forEach((p, i) => { const q = applyH(H, p); expect(q.x).toBeCloseTo(to[i].x, 6); expect(q.y).toBeCloseTo(to[i].y, 6); });
    expect(solveHomography(from, [to[0], to[0], to[0], to[0]])).toBeNull();
  });
  it('rectify: 斜めの四角を正面化すると、四角の中の色が出力いっぱいに広がる', () => {
    const W = 40, Hh = 40;
    const data = new Uint8ClampedArray(W * Hh * 4);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const inside = x >= 10 && x < 30 && y >= 10 && y < 30; data[i] = inside ? 255 : 0; data[i + 3] = 255; }
    const out = rectify({ data, width: W, height: Hh }, [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }], 8, 8)!;
    for (let i = 0; i < 64; i++) expect(out[i * 4]).toBe(255);
  });
  it('四角→開口部（壁5000mm×面2500mm を 1000×500px）、反転時は壁の反対端から', () => {
    const r = { x0: 400, y0: 100, x1: 600, y1: 300 };
    expect(rectToOpening(r, 1000, 500, 5000, 2500, false)).toEqual({ offset: 2500, width: 1000, height: 1000, sill: 1000 });
    expect(rectToOpening({ x0: 100, y0: 100, x1: 300, y1: 300 }, 1000, 500, 5000, 2500, true).offset).toBe(4000);
    const o = { offset: 4000, width: 1000, height: 1000, sill: 1000 };
    const back = rectToOpening(openingToRect(o, 1000, 500, 5000, 2500, true), 1000, 500, 5000, 2500, true);
    expect(back).toEqual(o);
  });
});

describe('航空写真・建物外形の配置', () => {
  it('20°傾いた 12×8m の建物 → 軸に合わせて左下を原点、軒の出 500mm で 11×7m', async () => {
    const { planSiteImport } = await import('./siteImport');
    const rect = [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 8000 }, { x: 0, y: 8000 }].map((p) => rotatePoint({ x: p.x + 3000, y: p.y - 2000 }, 20));
    const r = planSiteImport(rect, { eaveMm: 500, align: true });
    if ('error' in r) throw new Error(r.error);
    expect(r.rotation).toBeCloseTo(-20, 6);
    const xs = r.polygon!.map((p) => p.x), ys = r.polygon!.map((p) => p.y);
    expect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]).toEqual([0, 0, 11000, 7000]);
    // 検索地点（原点）も同じ変換で動く: 回転後の原点 + 平行移動
    const o = rotatePoint({ x: 0, y: 0 }, r.rotation);
    expect(r.aerialCenter.x).toBeCloseTo(o.x + r.aerialCenter.x, 6);
    expect(planSiteImport(rect, { eaveMm: 5000, align: true })).toHaveProperty('error');
    expect(planSiteImport(null, { eaveMm: 0, align: true })).toEqual({ rotation: 0, aerialCenter: { x: 0, y: 0 } });
  });
});
