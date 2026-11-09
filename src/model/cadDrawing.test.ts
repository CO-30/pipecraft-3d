import { describe, expect, it } from 'vitest';
import { newJwwDocument, readDocument, toJwwBytes } from 'ezjww';
import { fitDrawing, jwwToDrawing, type JwwLike } from './cadDrawing';

const base = (o: Partial<{ layer: number; layer_group: number; pen_style: number }> = {}) => ({ group: 0, pen_style: 1, pen_color: 1, pen_width: 0, layer: 0, layer_group: 0, flag: 0, ...o });
const groups = (scales: number[], hidden: { group?: number; layer?: [number, number] } = {}) =>
  Array.from({ length: 16 }, (_, g) => ({
    state: hidden.group === g ? 0 : 2,
    scale: scales[g] ?? 1,
    layers: Array.from({ length: 16 }, (_, l) => ({ state: hidden.layer?.[0] === g && hidden.layer?.[1] === l ? 0 : 2 })),
  }));
const doc = (entities: JwwLike['entities'], o: Partial<JwwLike> & { scales?: number[] } = {}): JwwLike => ({
  header: { paper_size: 3, layer_groups: groups(o.scales ?? [100]) },
  entities,
  block_defs: [],
  ...o,
});
const line = (x1: number, y1: number, x2: number, y2: number, b = base()) => ({ type: 'LINE', base: b, start_x: x1, start_y: y1, end_x: x2, end_y: y2 });

describe('jwwToDrawing', () => {
  it('線分を用紙mmのまま取り出し、縮尺と範囲を返す', () => {
    const d = jwwToDrawing(doc([line(0, 0, 80, 0), line(80, 0, 80, 60)]));
    expect(d.lines).toEqual([{ x1: 0, y1: 0, x2: 80, y2: 0 }, { x1: 80, y1: 0, x2: 80, y2: 60 }]);
    expect(d.scale).toBe(100);
    expect(d.bounds).toEqual({ minX: 0, minY: 0, maxX: 80, maxY: 60 });
    expect(d.notes).toEqual([]);
  });

  it('円は折れ線になり、半径の位置を通る', () => {
    const d = jwwToDrawing(doc([{ type: 'CIRCLE', base: base(), center_x: 10, center_y: 20, radius: 5, start_angle: 0, arc_angle: 0, tilt_angle: 0, flatness: 1, is_full_circle: true }]));
    expect(d.lines.length).toBeGreaterThanOrEqual(24);
    for (const l of d.lines) expect(Math.hypot(l.x1 - 10, l.y1 - 20)).toBeCloseTo(5, 6);
    expect(d.lines[0].x1).toBeCloseTo(d.lines.at(-1)!.x2, 6);
    expect(d.bounds.maxX).toBeCloseTo(15, 6);
  });

  it('円弧は始角から弧の角度ぶんだけ描く（扁平率・傾きも反映）', () => {
    const d = jwwToDrawing(doc([{ type: 'ARC', base: base(), center_x: 0, center_y: 0, radius: 10, start_angle: 0, arc_angle: Math.PI / 2, tilt_angle: 0, flatness: 0.5, is_full_circle: false }]));
    expect(d.lines[0].x1).toBeCloseTo(10, 6);
    expect(d.lines[0].y1).toBeCloseTo(0, 6);
    expect(d.lines.at(-1)!.x2).toBeCloseTo(0, 6);
    expect(d.lines.at(-1)!.y2).toBeCloseTo(5, 6);
  });

  it('文字は位置・高さ・角度つきで取り出し、画像の参照（^@BM）は捨てる', () => {
    const t = (content: string) => ({ type: 'TEXT', base: base(), start_x: 5, start_y: 6, end_x: 25, end_y: 6, size_x: 3, size_y: 4, angle: 90, content });
    const d = jwwToDrawing(doc([t('洗面所'), t('^@BMphoto.bmp,100,80')]));
    expect(d.texts).toEqual([{ x: 5, y: 6, h: 4, w: 3, angle: 90, content: '洗面所' }]);
  });

  it('寸法は寸法線・引出線・文字を取り出す', () => {
    const d = jwwToDrawing(doc([{
      type: 'DIMENSION', base: base(),
      line: { start_x: 0, start_y: 10, end_x: 91, end_y: 10 },
      text: { start_x: 40, start_y: 11, end_x: 50, end_y: 11, size_x: 3, size_y: 3, angle: 0, content: '9,100' },
      aux_lines: [{ start_x: 0, start_y: 0, end_x: 0, end_y: 10 }],
    }]));
    expect(d.lines).toHaveLength(2);
    expect(d.texts[0].content).toBe('9,100');
  });

  it('補助線（線種9）・非表示のレイヤ・非表示のレイヤグループは描かない', () => {
    const d = jwwToDrawing({
      header: { paper_size: 3, layer_groups: groups([100, 50, 20], { group: 1, layer: [0, 3] }) },
      block_defs: [],
      entities: [
        line(0, 0, 1, 0),
        line(0, 0, 2, 0, base({ pen_style: 9 })),
        line(0, 0, 3, 0, base({ layer: 3 })),
        line(0, 0, 4, 0, base({ layer_group: 1 })),
      ],
    });
    expect(d.lines).toEqual([{ x1: 0, y1: 0, x2: 1, y2: 0 }]);
  });

  it('ブロックは配置（倍率・回転・基点）を掛けて展開する。入れ子も可', () => {
    const d = jwwToDrawing(doc(
      [{ type: 'BLOCK', base: base(), ref_x: 100, ref_y: 50, scale_x: 2, scale_y: 1, rotation: Math.PI / 2, def_number: 7 }],
      { block_defs: [
        { number: 7, entities: [line(0, 0, 10, 0), { type: 'BLOCK', base: base(), ref_x: 10, ref_y: 0, scale_x: 1, scale_y: 1, rotation: 0, def_number: 8 }] },
        { number: 8, entities: [line(0, 0, 0, 3)] },
      ] },
    ));
    // (10,0) → 倍率 (20,0) → 90°回転 (0,20) → 基点 (100,70)
    expect(d.lines[0].x2).toBeCloseTo(100, 6);
    expect(d.lines[0].y2).toBeCloseTo(70, 6);
    // 入れ子: (10,3) → (20,3) → (-3,20) → (97,70)
    expect(d.lines[1].x2).toBeCloseTo(97, 6);
    expect(d.lines[1].y2).toBeCloseTo(70, 6);
  });

  it('自分自身を呼ぶブロックでも止まる', () => {
    const d = jwwToDrawing(doc(
      [{ type: 'BLOCK', base: base(), ref_x: 0, ref_y: 0, scale_x: 1, scale_y: 1, rotation: 0, def_number: 1 }],
      { block_defs: [{ number: 1, entities: [line(0, 0, 1, 1), { type: 'BLOCK', base: base(), ref_x: 1, ref_y: 0, scale_x: 1, scale_y: 1, rotation: 0, def_number: 1 }] }] },
    ));
    expect(d.lines.length).toBeGreaterThan(0);
    expect(d.lines.length).toBeLessThan(20);
  });

  it('図形が最も多いレイヤグループの縮尺を採用し、混在は知らせる', () => {
    const g1 = base({ layer_group: 1 });
    const d = jwwToDrawing(doc([line(0, 0, 1, 0), line(0, 0, 2, 0, g1), line(0, 0, 3, 0, g1)], { scales: [100, 50] }));
    expect(d.scale).toBe(50);
    expect(d.scales).toEqual([50, 100]);
    expect(d.notes.join()).toContain('1/50');
    expect(d.notes.join()).toContain('1/100');
  });

  it('用紙から大きく外れた図形は範囲に入れない（用紙サイズが分かるとき）', () => {
    // A3 = 420×297、原点は用紙の中心
    const inside = Array.from({ length: 12 }, (_, i) => line(-100, -50 + i, 100, 50 - i));
    const d = jwwToDrawing(doc([...inside, line(5000, 5000, 5001, 5000)]));
    expect(d.bounds.maxX).toBeLessThan(300);
    expect(d.lines).toHaveLength(13);
  });

  it('原点が用紙の中心でない図面（左下原点など）は切り落とさない', () => {
    const d = jwwToDrawing(doc([line(0, 0, 420, 0), line(420, 0, 420, 297), line(0, 0, 0, 297)]));
    expect(d.bounds).toEqual({ minX: 0, minY: 0, maxX: 420, maxY: 297 });
  });

  it('ブロックの入れ子で線が増えすぎる図面は断る', () => {
    const ins = (n: number) => Array.from({ length: 30 }, () => ({ type: 'BLOCK', base: base(), ref_x: 0, ref_y: 0, scale_x: 1, scale_y: 1, rotation: 0, def_number: n }));
    const defs = [1, 2, 3, 4].map((n) => ({ number: n, entities: n === 4 ? [line(0, 0, 1, 1)] : ins(n + 1) }));
    expect(() => jwwToDrawing(doc(ins(1), { block_defs: defs }))).toThrow('図面が大きすぎます');
  });

  it('縦横の倍率が違うブロックの文字は、高さに縦の倍率を掛ける', () => {
    const d = jwwToDrawing(doc(
      [{ type: 'BLOCK', base: base(), ref_x: 0, ref_y: 0, scale_x: 2, scale_y: 3, rotation: 0, def_number: 1 }],
      { block_defs: [{ number: 1, entities: [{ type: 'TEXT', base: base(), start_x: 0, start_y: 0, end_x: 1, end_y: 0, size_x: 1, size_y: 1, angle: 0, content: 'A' }] }] },
    ));
    expect(d.texts[0]).toMatchObject({ h: 3, w: 2 });
  });

  it('壊れた数値（NaN・無限大）の図形は捨てる', () => {
    const d = jwwToDrawing(doc([line(0, 0, NaN, 0), line(0, 0, Infinity, 0), line(0, 0, 1, 1)]));
    expect(d.lines).toHaveLength(1);
  });

  it('描ける図形が無ければ empty', () => {
    expect(jwwToDrawing(doc([])).empty).toBe(true);
    expect(jwwToDrawing(doc([line(0, 0, 1, 0)])).empty).toBe(false);
  });

  it('ezjww で作った .jww を読み戻して変換できる', () => {
    const w = newJwwDocument();
    w.options.layer_groups[0].scale = 50;
    w.entities.push({ type: 'LINE', base: base(), start_x: -100, start_y: -50, end_x: 100, end_y: -50 });
    w.entities.push({ type: 'CIRCLE', base: base(), center_x: 0, center_y: 0, radius: 20, start_angle: 0, arc_angle: Math.PI * 2, tilt_angle: 0, flatness: 1, is_full_circle: true });
    const d = jwwToDrawing(readDocument(toJwwBytes(w)) as unknown as JwwLike);
    expect(d.scale).toBe(50);
    expect(d.bounds.minX).toBeCloseTo(-100, 6);
    expect(d.bounds.maxY).toBeCloseTo(20, 6);
  });
});

describe('fitDrawing', () => {
  const d = jwwToDrawing(doc([line(0, 0, 200, 0), line(0, 0, 0, 100)]));
  it('長辺を maxPx に合わせ、余白をとり、実寸の mm/px を返す', () => {
    const f = fitDrawing(d, 1000);
    expect(Math.max(f.widthPx, f.heightPx)).toBe(1000);
    expect(f.widthPx).toBeGreaterThan(f.heightPx);
    // 用紙 200mm + 余白 → 1px あたりの用紙mm × 縮尺100
    expect(f.mmPerPx).toBeCloseTo(f.paperMmPerPx * 100, 9);
    const p = f.toPx(0, 0), q = f.toPx(200, 100);
    expect(q.x - p.x).toBeCloseTo(200 / f.paperMmPerPx, 6);
    expect(p.y - q.y).toBeCloseTo(100 / f.paperMmPerPx, 6); // 上が北（y は下向きに反転）
    expect(p.x).toBeGreaterThan(0);
    expect(q.y).toBeGreaterThan(0);
  });
  it('点だけ・線1本でも大きさが 0 にならない', () => {
    const f = fitDrawing(jwwToDrawing(doc([line(5, 5, 5, 5)])), 1000);
    expect(f.widthPx).toBeGreaterThan(0);
    expect(f.heightPx).toBeGreaterThan(0);
    expect(Number.isFinite(f.mmPerPx)).toBe(true);
  });
});
