import { describe, expect, it } from 'vitest';
import { validateBuilding, wallsOnFloor } from '../building';
import { membersOf } from '../members';
import { memberBoxes } from '../members3d';
import { buildingSchema } from '../schema';
import { PlanReadError, buildFromSheets, overlapLength } from './assemble';
import { readHeights, readSlabOffset } from './heights';
import { PT_TO_MM, alignTransform, baseTransform, classifySheet, gridWorld, readGrid, sheetScale, toWorldX, toWorldY, type PText } from './sheet';
import { detectStrips, heavyWidth, subtract, type WSeg } from './strips';
import { D, HEAVY, PITCH, THIN, W, elevationSheet, foundationSheet, planSheet, siteSheet } from './testHouse';
import { buildingStrips, wallsFromStrips } from './walls';

const t = (s: string, h = 8, x = 0, y = 0): PText => ({ x, y, h, s });
const world = (pg = planSheet()) => {
  const grid = readGrid(pg.texts)!;
  const tr = baseTransform(grid, 100);
  const segs: WSeg[] = pg.segs.map((s) => ({ x1: toWorldX(tr, s.x1), y1: toWorldY(tr, s.y1), x2: toWorldX(tr, s.x2), y2: toWorldY(tr, s.y2), w: s.w }));
  return { grid, tr, segs, gw: gridWorld(grid, tr) };
};

describe('図面の見分け（sheet）', () => {
  it('図面名から種類と階を決める。「展開図参照」の注記は図面名にしない', () => {
    expect(classifySheet([t('展開図参照', 14), t('造作ｶｳﾝﾀｰ展開図参照', 14), t('1階 平面詳細図', 6)])).toMatchObject({ kind: 'plan', floor: 1 });
    expect(classifySheet([t('2階平面図')])).toMatchObject({ kind: 'plan', floor: 2 });
    expect(classifySheet([t('2F平面図')])).toMatchObject({ kind: 'plan', floor: 2 });
    expect(classifySheet([t('平面図'), t('３Ｆ')])).toMatchObject({ kind: 'plan', floor: 3 });
    expect(classifySheet([t('基 礎 伏 図 S : 1 / 7 5', 12)]).kind).toBe('foundation');
    expect(classifySheet([t('南側 立面図 S:1/100')]).kind).toBe('elevation');
    expect(classifySheet([t('WC展開図')]).kind).toBe('detail');
    expect(classifySheet([t('配置図')]).kind).toBe('site');
  });
  it('大きい文字の図面名を優先する。文字が無ければファイル名を見る', () => {
    expect(classifySheet([t('配置図', 6), t('基礎伏図', 12)]).kind).toBe('foundation');
    expect(classifySheet([t('abc')], '03_1階平面図.pdf')).toMatchObject({ kind: 'plan', floor: 1 });
    expect(classifySheet([t('abc')], 'scan0001.pdf').kind).toBe('unknown');
  });
  it('通り芯: 番号順の位置を読む。凡例に紛れた同じ文字は中央値で外す。向きが逆なら通り芯としない', () => {
    const g = readGrid(planSheet().texts)!;
    expect(g.xs.map((l) => l.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(g.ys).toHaveLength(7);
    expect((g.xs[1].pos - g.xs[0].pos) * PT_TO_MM * 100).toBeCloseTo(PITCH, 3);
    const dup = readGrid([...planSheet().texts, t('X1', 8, 9999, 0), t('X1', 8, g.xs[0].pos, 5)])!;
    expect(dup.xs[0].pos).toBeCloseTo(g.xs[0].pos, 6);
    expect(readGrid([t('X1', 8, 100, 0), t('X2', 8, 50, 0), t('Y1', 8, 0, 100), t('Y2', 8, 0, 50)])).toBeNull();
    expect(readGrid([t('X1'), t('abc')])).toBeNull();
  });
  it('縮尺: 文字 → 表題欄の「1/50」だけの文字 → 通り芯の間隔（910mm）から推定', () => {
    const pg = planSheet();
    const g = readGrid(pg.texts);
    expect(sheetScale(pg.texts, g)).toEqual({ scale: 100, guessed: false });
    const noText = planSheet({ scaleText: false });
    expect(sheetScale(noText.texts, readGrid(noText.texts))).toEqual({ scale: 100, guessed: true });
    expect(sheetScale([...noText.texts, t('1/100')], readGrid(noText.texts))).toEqual({ scale: 100, guessed: false });
    expect(sheetScale([t('1/50')], null)).toEqual({ scale: 50, guessed: false });
    expect(sheetScale([t('1/20,100')], null)).toBeNull();
    expect(sheetScale([t('基礎伏図 S : 1 / 7 5')], null)).toEqual({ scale: 75, guessed: false });
    // 文字の縮尺（詳細図のもの）が通り芯の間隔と合わなければ、通り芯から出した縮尺を採って「推定」と知らせる
    expect(sheetScale([...noText.texts, t('S:1/30')], readGrid(noText.texts))).toEqual({ scale: 100, guessed: true });
    expect(sheetScale([...noText.texts, t('S:1/50')], readGrid(noText.texts))).toEqual({ scale: 50, guessed: false }); // 455mm 間隔としてあり得る
  });
  it('別の縮尺の図面を、同じ番号の通り芯で重ねる。番号をずらして合わせることもできる', () => {
    const { gw } = world();
    const f = readGrid(foundationSheet().texts)!;
    const a = alignTransform(f, gw)!;
    expect(a.k).toBeCloseTo(PT_TO_MM * 50, 6);
    expect(toWorldX(a, f.xs[4].pos)).toBeCloseTo(4 * PITCH, 3);
    expect(toWorldY(a, f.ys[2].pos)).toBeCloseTo(2 * PITCH, 3);
    const shifted = readGrid(foundationSheet({ firstY: 2 }).texts)!; // Y2 が平面図の Y1 の位置
    expect(toWorldY(alignTransform(shifted, gw)!, shifted.ys[0].pos)).toBeCloseTo(PITCH, 3);
    expect(toWorldY(alignTransform(shifted, gw, 0, -1)!, shifted.ys[0].pos)).toBeCloseTo(0, 3);
    expect(alignTransform({ xs: [{ n: 20, pos: 0 }, { n: 21, pos: 9 }], ys: f.ys }, gw)).toBeNull();
  });
});

describe('壁の帯（strips）', () => {
  it('切り口の線の太さ: 数本だけの極太線（枠・印）は採らない', () => {
    const segs: WSeg[] = [{ x1: 0, y1: 0, x2: 1000, y2: 0, w: 2 }];
    for (let i = 0; i < 20; i++) segs.push({ x1: 0, y1: i * 300, x2: 5000, y2: i * 300, w: HEAVY }, { x1: 0, y1: i * 300 + 7, x2: 9000, y2: i * 300 + 7, w: THIN });
    expect(heavyWidth(segs)).toBe(HEAVY);
    expect(heavyWidth([])).toBe(0);
  });
  it('太い 2 本線を帯にする。細い線・厚さの合わない組・短い組は帯にしない', () => {
    const base: WSeg[] = [];
    for (let i = 0; i < 50; i++) base.push({ x1: 20000, y1: i * 50, x2: 20100, y2: i * 50, w: THIN });
    const pair = (y: number, gap: number, w: number, len = 3000): WSeg[] => [{ x1: 0, y1: y, x2: len, y2: y, w }, { x1: 0, y1: y + gap, x2: len, y2: y + gap, w }];
    const s = detectStrips([...base, ...pair(0, 120, HEAVY), ...pair(2000, 120, THIN), ...pair(4000, 600, HEAVY), ...pair(6000, 30, HEAVY), ...pair(8000, 120, HEAVY, 100)]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ dir: 'h', lo: 0, hi: 3000 });
    expect(s[0].c).toBeCloseTo(60);
    expect(s[0].t).toBeCloseTo(120);
  });
  it('柱で途切れた線はつなげ、向かいの線より先にある線とは組にしない', () => {
    const segs: WSeg[] = [
      { x1: 0, y1: 0, x2: 1000, y2: 0, w: HEAVY }, { x1: 1005, y1: 0, x2: 3000, y2: 0, w: HEAVY },
      { x1: 0, y1: 120, x2: 3000, y2: 120, w: HEAVY }, { x1: 0, y1: 240, x2: 3000, y2: 240, w: HEAVY },
    ];
    const s = detectStrips(segs);
    expect(s.map((x) => Math.round(x.c))).toEqual([60, 180]); // 0-120 と 120-240。0-240 は作らない
    expect(s[0]).toMatchObject({ lo: 0, hi: 3000 });
  });
  it('区間の引き算', () => {
    expect(subtract([0, 10], [[2, 4], [8, 20]])).toEqual([[0, 2], [4, 8]]);
    expect(subtract([0, 10], [[-5, 20]])).toEqual([]);
  });
});

describe('壁（walls）', () => {
  it('建物の外にある紛らわしい線（表の枠）を捨てる', () => {
    const { segs } = world();
    const strips = detectStrips(segs);
    expect(strips.some((s) => s.lo > W + 5000)).toBe(true);
    expect(buildingStrips(strips).some((s) => s.lo > W + 5000)).toBe(false);
  });
  it('四角い家: 外壁 4・間仕切り 1、窓とドアは開口部、端は相手の壁芯に届く', () => {
    const { segs, gw } = world();
    const walls = wallsFromStrips(detectStrips(segs), segs, { gridX: [...gw.xs.values()], gridY: [...gw.ys.values()] });
    expect(walls).toHaveLength(5);
    expect(walls.filter((w) => w.kind === 'exterior')).toHaveLength(4);
    const south = walls.find((w) => w.a.y === 0 && w.b.y === 0)!;
    expect([south.a.x, south.b.x]).toEqual([0, W]);
    expect(south.openings).toHaveLength(1);
    expect(south.openings[0].offset).toBeCloseTo(2730, 0);
    expect(south.openings[0].width).toBeCloseTo(1820, 0);
    const mid = walls.find((w) => w.a.x === 3640 && w.b.x === 3640)!;
    expect(mid.kind).toBe('interior');
    expect([mid.a.y, mid.b.y]).toEqual([0, D]);
    expect(mid.openings[0].width).toBeCloseTo(910, 0);
    expect(walls.every((w) => w.thickness === 120)).toBe(true);
  });
  it('建具の線が無い切れ目は開けたままにする（壁を 2 本に分ける）', () => {
    const { segs, gw } = world();
    const noDoor = segs.filter((s) => !(s.w === THIN && Math.abs(s.x1 - 3640) < 1 && Math.abs(s.x2 - 3640) < 1 && Math.abs(s.y2 - s.y1) < 1000));
    const walls = wallsFromStrips(detectStrips(noDoor), noDoor, { gridX: [...gw.xs.values()], gridY: [...gw.ys.values()] });
    expect(walls.filter((w) => w.a.x === 3640 && w.b.x === 3640)).toHaveLength(2);
  });
  it('通り芯が無くても読める（5mm 単位に丸める）', () => {
    const { segs } = world();
    const walls = wallsFromStrips(detectStrips(segs), segs);
    expect(walls).toHaveLength(5);
    expect(walls.every((w) => [w.a.x, w.a.y, w.b.x, w.b.y].every((v) => Math.abs(v % 5) < 1e-6))).toBe(true);
  });
});

describe('高さ（heights）', () => {
  it('文字の上下の間隔から高さを出し、近い寸法数字があればそれを採る', () => {
    const h = readHeights(elevationSheet().texts, PT_TO_MM * 100);
    expect(h).toMatchObject({ glToFl: 550, footingTop: 400, topToEaves: 2700 });
    expect(h.floorToFloor.size).toBe(0);
  });
  it('寸法数字が無ければ 10mm 単位に丸める。2 階建ては階高も読む', () => {
    const k = PT_TO_MM * 100;
    const at = (mm: number, s: string): PText => t(s, 8, 100, 500 - mm / k);
    const h = readHeights([at(0, 'GL'), at(523, '1FL'), at(3323, '2階FL'), at(6000, '軒高')], k);
    expect(h.glToFl).toBe(520);
    expect(h.floorToFloor.get(1)).toBe(2800);
    expect(h.topToEaves).toBe(2680);
    expect(h.topFloor).toBe(2);
    expect(readHeights([t('GL')], k)).toMatchObject({ glToFl: undefined, topToEaves: undefined, topFloor: 1 });
    expect(readHeights([at(0, '▽GL'), at(600, '▽1FL')], k).glToFl).toBe(600);
  });
});

describe('床下の底（基礎伏図のスラブの高さの印）', () => {
  it('区画の「基礎天端」「−350」から、基礎天端からスラブ天端までの差を読む（凡例・記号の違いも同じ）', () => {
    expect(readSlabOffset(foundationSheet({ slab: '-350' }).texts)).toBe(-350);
    expect(readSlabOffset(foundationSheet({ slab: '−300' }).texts)).toBe(-300);
    expect(readSlabOffset([t('基礎天端-350', 8, 10, 10)])).toBe(-350);
    // 印が無い・離れた数字は読まない
    expect(readSlabOffset(foundationSheet().texts)).toBeUndefined();
    expect(readSlabOffset([t('基礎天端', 8, 10, 10), t('-350', 8, 300, 300)])).toBeUndefined();
  });
});

describe('図面一式 → 建物（assemble）', () => {
  const sheets = () => [{ name: 'a', page: planSheet() }, { name: 'b', page: foundationSheet() }, { name: 'c', page: elevationSheet() }];
  it('平面図・基礎伏図・立面図から、壁・開口部・基礎・高さの入った建物を作る', () => {
    const r = buildFromSheets(sheets());
    const b = r.building;
    expect(validateBuilding(b)).toEqual([]);
    expect(buildingSchema.safeParse(b).success).toBe(true);
    expect(b.floors).toHaveLength(1);
    expect(b.floors[0].height).toBe(2700);
    const walls = wallsOnFloor(b, b.floors[0].id);
    // 間仕切りが北・南の壁を T 字で分けるので 4 + 1 + 2
    expect(walls).toHaveLength(7);
    expect(walls.filter((w) => w.kind === 'interior')).toHaveLength(1);
    expect(Object.values(b.openings).map((o) => o.type).sort()).toEqual(['door', 'window']);
    expect(r.designGL).toBe(-550);
    const foot = membersOf(b);
    expect(foot).toHaveLength(6); // 外周 4 + 中央（人通口で 2 つ）
    expect(foot.every((m) => m.kind === 'footing' && m.z0 === -550 && m.z1 === -150 && m.width === 150)).toBe(true);
    expect(memberBoxes(b).filter((x) => x.category === 'member')).toHaveLength(6);
    expect(r.plans).toHaveLength(1);
    expect(r.report.sheets.map((s) => s.used)).toEqual([true, true, true]);
    expect(r.report.found.join()).toContain('基礎の立上り 6 本');
    // 読み取った壁は、まちがって動かさないようロック（2026-11-13）。保存しても残る
    expect(walls.every((w) => w.locked === true)).toBe(true);
    expect(buildingSchema.parse(b).walls[walls[0].id].locked).toBe(true);
  });
  it('床下の底（スラブ天端）を 基礎の高さ + 基礎伏図の印 で決める。印が無ければ標準値にして確かめてもらう', () => {
    const r = buildFromSheets([sheets()[0], { name: 'b', page: foundationSheet({ slab: '-350' }) }, sheets()[2]]);
    // GL = 1階FL−550、基礎天端 GL+400 → スラブ天端 GL+50 = 1階FL−500
    expect(r.building.foundation).toEqual({ slabTop: -500 });
    expect(r.report.found.join()).toContain('床下の底（基礎のスラブの上）は GL+50mm');
    expect(buildingSchema.safeParse(r.building).success).toBe(true);
    const d = buildFromSheets(sheets());
    expect(d.building.foundation).toEqual({ slabTop: -550 + 400 - 350 });
    expect(d.report.check.join()).toContain('床下の底（基礎のスラブの上）は読めなかった');
    // 印の値が区画で違えば、いちばん多い値にして確かめてもらう
    const fs = foundationSheet({ slab: '-350' });
    const two = { ...fs, texts: [...fs.texts, { ...fs.texts.find((x) => x.s === '-350')!, s: '-300', x: 50 }, { ...fs.texts.find((x) => x.s === '基礎天端')!, x: 50 }] };
    const m = buildFromSheets([sheets()[0], { name: 'b', page: two }, sheets()[2]]);
    expect(m.building.foundation).toEqual({ slabTop: -500 });
    expect(m.report.check.join()).toContain('スラブの高さの印が区画で違います（−350・−300）');
    // 基礎伏図が無ければ床下の底も入れない
    expect(buildFromSheets([sheets()[0], sheets()[2]]).building.foundation).toBeUndefined();
  });
  it('基礎伏図の通り芯の番号が 1 つずれていても、壁の重なりで合わせて知らせる', () => {
    const r = buildFromSheets([sheets()[0], { name: 'b', page: foundationSheet({ firstY: 2 }) }]);
    const ys = membersOf(r.building).flatMap((m) => [m.a.y, m.b.y]);
    expect(Math.min(...ys)).toBeCloseTo(0, 0);
    expect(Math.max(...ys)).toBeCloseTo(D, 0);
    expect(r.report.check.join()).toContain('1 つずれていた');
  });
  it('立面図・基礎伏図が無ければ標準値で作り、確かめてほしいことに書く', () => {
    const r = buildFromSheets([sheets()[0]]);
    expect(r.building.floors[0].height).toBe(2900);
    expect(r.designGL).toBeUndefined();
    expect(membersOf(r.building)).toHaveLength(0);
    expect(r.report.check.join()).toMatch(/基礎伏図が無い.*立面図が無い/);
  });
  it('基礎だけあって GL が読めないときは、標準の GL で基礎を置く', () => {
    const r = buildFromSheets(sheets().slice(0, 2));
    expect(membersOf(r.building).every((m) => m.z0 === -600 && m.z1 === -200)).toBe(true);
    expect(r.designGL).toBeUndefined();
  });
  it('平面図が無い・線の無い PDF（スキャン）は、分かる文で断る', () => {
    expect(() => buildFromSheets([sheets()[2]])).toThrow(PlanReadError);
    expect(() => buildFromSheets([sheets()[2]])).toThrow(/平面図が見つかりません/);
    const scan = { name: '1階平面図', page: { ...planSheet(), segs: [] } };
    expect(() => buildFromSheets([scan])).toThrow(/スキャン/);
    // 代わりの道（下に敷いてなぞる）を案内する
    expect(() => buildFromSheets([scan])).toThrow(/「図面を取り込む」/);
    // 画像だけの PDF（文字も線も無い。図面の種類も分からない）も、スキャンと分かる文で
    expect(() => buildFromSheets([{ name: 'scan001', page: { widthPt: 1191, heightPt: 842, segs: [], texts: [] } }])).toThrow(/スキャン.*「図面を取り込む」/);
    // 文字が線（アウトライン）になった PDF: 線はあるが文字が無いので、種類も縮尺も分からない
    expect(() => buildFromSheets([{ name: 'p1', page: { ...planSheet(), texts: [] } }])).toThrow(/文字が線になっている.*「図面を取り込む」/);
    expect(() => buildFromSheets([])).toThrow(PlanReadError);
  });
  it('通り芯の無い平面図も壁は読める（位置合わせ無しと知らせる）。文字が無ければファイル名で見分ける', () => {
    const pg = planSheet({ labels: false, title: false });
    const r = buildFromSheets([{ name: '1階平面図', page: pg }, { name: 'b', page: foundationSheet() }]);
    expect(Object.keys(r.building.walls).length).toBeGreaterThanOrEqual(5);
    expect(r.report.check.join()).toContain('通り芯');
    expect(membersOf(r.building)).toHaveLength(0);
  });
  it('2 階建て: 階ごとの平面図（「2F」表記）を重ね、軒高までの高さを 1 階分に取り違えない', () => {
    const two = [{ name: 'a', page: planSheet() }, { name: 'a2', page: planSheet({ floorName: '2F' }) }];
    // 立面図に「1階FL」と「軒高」しか無い → 軒高までは 2 階分なので、どの階の高さにも使わない
    const r = buildFromSheets([...two, { name: 'c', page: elevationSheet() }]);
    expect(r.building.floors.map((f) => f.height)).toEqual([2900, 2900]);
    expect(r.report.check.filter((c) => c.includes('階の高さは立面図から読めなかった'))).toHaveLength(2);
    expect(validateBuilding(r.building)).toEqual([]);
    expect(wallsOnFloor(r.building, r.building.floors[1].id)).toHaveLength(7);
    expect(r.plans.map((p) => p.floorId)).toEqual(r.building.floors.map((f) => f.id));
    expect(r.report.sheets.every((s) => s.used)).toBe(true);
    // 器具の候補は階ごと。屋外の立水栓は 1 階の図面から出たものだけ
    const byFloor = (i: number) => r.fixtures.filter((f) => f.floorId === r.building.floors[i].id).map((f) => f.type).sort();
    expect(byFloor(0)).toEqual(['kitchen', 'outdoorFaucet', 'toilet', 'washbasin', 'washer']);
    expect(byFloor(1)).toEqual(['kitchen', 'toilet', 'washbasin', 'washer']);
  });
  it('線が多すぎて途中までしか読めなかった図面は知らせる', () => {
    const r = buildFromSheets([{ name: '平面', page: { ...planSheet(), truncated: true } }]);
    expect(r.report.check.join()).toContain('途中までしか読んでいません');
  });
  it('重なりの長さ', () => {
    const w = (x1: number, y1: number, x2: number, y2: number) => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness: 100, kind: 'interior' as const, openings: [] });
    expect(overlapLength([w(0, 0, 1000, 0)], [w(500, 50, 3000, 50)])).toBe(500);
    expect(overlapLength([w(0, 0, 1000, 0)], [w(500, 500, 3000, 500), w(0, 0, 0, 1000)])).toBe(0);
  });
});

describe('基礎の立上り（部材 footing）', () => {
  it('配管のぶつかり・かわしの対象にしない（貫通が前提）', async () => {
    const { findHits, penetrationsOf } = await import('../obstacles');
    const { emptyNetwork } = await import('../network');
    const r = buildFromSheets([{ name: 'a', page: planSheet() }, { name: 'b', page: foundationSheet() }]);
    const n1 = { id: 'n1', kind: 'free' as const, pos: { x: 1000, y: -1000, z: -400 } }, n2 = { id: 'n2', kind: 'free' as const, pos: { x: 1000, y: 3000, z: -400 } };
    const network = { ...emptyNetwork(), nodes: { n1, n2 }, segments: { s1: { id: 's1', a: 'n1', b: 'n2', system: 'drain', diameter: 75 } } } as never;
    const doc = { building: r.building, network, fixtures: {} };
    expect(findHits(doc)).toEqual([]);
    expect(penetrationsOf(doc)).toEqual([]);
  });
});

describe('配置図（assemble）', () => {
  it('家の外形で位置を合わせ、ます・メーター・敷地の高さを図面座標で返す。配置図も下に敷く', () => {
    const r = buildFromSheets([{ name: '1階平面図', page: planSheet() }, { name: '配置図', page: siteSheet() }, { name: '立面図', page: elevationSheet() }]);
    expect(r.site).toBeDefined();
    const pub = r.site!.items.find((x) => x.type === 'publicSewage')!;
    expect(Math.abs(pub.x - -1500)).toBeLessThan(10);
    expect(Math.abs(pub.y - (D + 600))).toBeLessThan(10);
    expect(r.site!.items.filter((x) => x.type === 'manholeSewage')).toHaveLength(4);
    // 1 階の床（GL+550）より高い GL+300 は使う（床より低い）
    expect(r.site!.levels.map((l) => l.gl).sort((a, b) => a - b)).toEqual([-950, -500, 0, 300]);
    expect(r.plans.some((p) => p.site)).toBe(true);
    expect(r.report.found.join()).toContain('配置図: 汚水公共ます 1・汚水ます 4・雨水ます 2・立水栓 1・水道メーター 1');
    expect(r.report.found.join()).toContain('BM は GL−550');
  });
  it('家の外形と重ならなければ合わせない（読まない）と知らせる', () => {
    const bad = { ...siteSheet(), segs: siteSheet().segs.filter((s) => s.w < 0.2 || Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 20) }; // 家・軒・境界の長い線を消す
    const r = buildFromSheets([{ name: '1階平面図', page: planSheet() }, { name: '配置図', page: bad }]);
    expect(r.site).toBeUndefined();
    expect(r.report.check.join()).toContain('配置図は家の外形と重ならず、位置を合わせられませんでした');
  });
});
