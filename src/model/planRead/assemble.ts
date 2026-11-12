/**
 * 図面一式（平面図・基礎伏図・立面図…）→ 建物モデル。
 * 平面図の壁、基礎伏図の立上り、立面図の高さを、通り芯で位置を合わせて 1 つの建物にする。純粋関数。
 * 読み取れなかった項目は標準値で埋め、何を読めて何が標準値かを report に残す（使う人が確認できるように）。
 */
import { DEFAULT_FLOOR_HEIGHT, DEFAULT_SLAB, OPENING_DEFAULTS, addFloor, addOpening, addWall, clearHeight, emptyBuilding, wallsOnFloor, type Building, type Vec2 } from '../building';
import { withMember } from '../members';
import { heavyWidth, detectStrips, WALL_STRIP, type StripOptions, type WSeg } from './strips';
import { FIXTURE_CATALOG } from '../fixtures';
import { guessFixtures, type FixtureCandidate } from './fixtureGuess';
import { alignSite, readSite, type SiteItem } from './siteRead';
import { DEFAULT_SLAB_BELOW_FOOTING, readHeights, readSlabOffset, slabMarks, type Heights } from './heights';
import {
  PT_TO_MM, SHEET_LABEL, alignTransform, baseTransform, classifySheet, gridWorld, readGrid, sheetScale, toWorldX, toWorldY,
  type Grid, type GridWorld, type SheetKind, type ToWorld, type VectorPage,
} from './sheet';
import { wallsFromStrips, type WallSpec } from './walls';

export type SheetInput = { name: string; page: VectorPage };
export type SheetReport = { name: string; kind: SheetKind; label: string; used: boolean; note: string };
export type ImportReport = {
  sheets: SheetReport[];
  /** 読み取れたこと */
  found: string[];
  /** 標準値で埋めた・読めなかったこと（確認してほしいこと） */
  check: string[];
};
/** 下敷きにする平面図: sheets の番号と、紙の座標 → 図面座標の変換 */
export type PlanPlacement = { index: number; floorId: string; toWorld: ToWorld; scale: number; /** 配置図（下に薄く敷く） */ site?: boolean };
/** 配置図から読んだもの（図面座標 mm）。levels: 敷地の高さ（設計 GL からの mm）、bm: BM から GL±0 までの高さ(mm) */
export type SiteResult = { items: { type: SiteItem['type']; x: number; y: number }[]; levels: { x: number; y: number; gl: number }[]; bm?: number };
/** 器具の候補（どの階か付き）。使う人が確認してから置く */
export type PlacedCandidate = FixtureCandidate & { floorId: string };
export type PlanSetResult = { building: Building; designGL?: number; plans: PlanPlacement[]; fixtures: PlacedCandidate[]; report: ImportReport; site?: SiteResult };

/** 配置図の記号と平面図の文字が同じ器具とみなす距離(mm)。文字は記号のすぐ横に書かれる */
const SITE_SAME_MM = 2500;
/**
 * 配置図で記号から置く器具（立水栓など）と同じ物を、平面図の文字から重ねて候補に出さない。
 * 記号の方が正しい位置なので、近くの同じ種類の文字の候補を除く（離れていれば別の器具として残す）
 */
export function dropSiteDuplicates(fixtures: PlacedCandidate[], site: SiteResult | undefined): PlacedCandidate[] {
  if (!site?.items.length) return fixtures;
  return fixtures.filter((c) => !site.items.some((i) => i.type === c.type && Math.hypot(i.x - c.x, i.y - c.y) < SITE_SAME_MM));
}

/** 図面から建物を作れないとき（使う人にそのまま見せる文） */
export class PlanReadError extends Error {
  override name = 'PlanReadError';
}

/** 基礎の立上りは壁より厚い（120〜400mm）。人通口は切れ目のまま残す */
const FOOTING_STRIP: StripOptions = { minT: 100, maxT: 420, minLen: WALL_STRIP.minLen };
/** 立面図から読めなかったときの標準値(mm): GL〜1階の床、GL〜基礎の天端 */
export const DEFAULT_GL_TO_FL = 600, DEFAULT_FOOTING_TOP = 400;
/** 通り芯の外側で線を読む範囲(mm)。外にある表・詳細図を壁と取り違えない */
const GRID_MARGIN = 2000;
/** 線の入っていない PDF（スキャン）とみなす本数 */
const MIN_SEGS = 200;

type Read = { index: number; name: string; page: VectorPage; kind: SheetKind; floor: number; grid: Grid | null; scale: { scale: number; guessed: boolean } | null };

function worldSegs(page: VectorPage, t: ToWorld, gw: GridWorld | null): WSeg[] {
  const all = page.segs.map((s) => ({ x1: toWorldX(t, s.x1), y1: toWorldY(t, s.y1), x2: toWorldX(t, s.x2), y2: toWorldY(t, s.y2), w: s.w }));
  if (!gw) return all;
  const xs = [...gw.xs.values()], ys = [...gw.ys.values()];
  const x0 = Math.min(...xs) - GRID_MARGIN, x1 = Math.max(...xs) + GRID_MARGIN, y0 = Math.min(...ys) - GRID_MARGIN, y1 = Math.max(...ys) + GRID_MARGIN;
  return all.filter((s) => Math.min(s.x1, s.x2) >= x0 && Math.max(s.x1, s.x2) <= x1 && Math.min(s.y1, s.y2) >= y0 && Math.max(s.y1, s.y2) <= y1);
}

function readWalls(page: VectorPage, t: ToWorld, gw: GridWorld | null, o: StripOptions): WallSpec[] {
  const segs = worldSegs(page, t, gw);
  if (!heavyWidth(segs)) return [];
  return wallsFromStrips(detectStrips(segs, o), segs, gw ? { gridX: [...gw.xs.values()], gridY: [...gw.ys.values()] } : {});
}

/** 2 つの図面の壁（立上り）の芯が重なっている長さの合計(mm)。位置合わせの確からしさ */
export function overlapLength(p: WallSpec[], q: WallSpec[]): number {
  let sum = 0;
  for (const a of p) for (const b of q) {
    const ah = Math.abs(a.a.y - a.b.y) < 1, bh = Math.abs(b.a.y - b.b.y) < 1;
    if (ah !== bh) continue;
    const [ac, a0, a1, bc, b0, b1] = ah ? [a.a.y, a.a.x, a.b.x, b.a.y, b.a.x, b.b.x] : [a.a.x, a.a.y, a.b.y, b.a.x, b.a.y, b.b.y];
    if (Math.abs(ac - bc) > 120) continue;
    sum += Math.max(0, Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1)));
  }
  return sum;
}

/**
 * 図面を基準（1 階平面図）へ合わせて壁を読む。通り芯の番号どおりに合わせたものと、番号を 1 つずらしたものを比べ、
 * 基準の壁といちばん重なるものを採る（平面図と基礎伏図で通り芯の番号が 1 つずれている図面があるため）。
 */
function alignedWalls(page: VectorPage, grid: Grid, base: GridWorld, ref: WallSpec[], o: StripOptions): { t: ToWorld; specs: WallSpec[]; shifted: boolean } | null {
  let best: { t: ToWorld; specs: WallSpec[]; shifted: boolean; score: number } | null = null;
  for (const [sx, sy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const t = alignTransform(grid, base, sx, sy);
    if (!t) continue;
    const specs = readWalls(page, t, gridWorld(grid, t), o);
    const score = overlapLength(specs, ref);
    // 番号どおり（最初の候補）を優先し、ずらした方がはっきり良いときだけ替える
    if (!best || score > best.score * 1.2 + 1000) best = { t, specs, shifted: sx !== 0 || sy !== 0, score };
    // 番号どおりで半分以上重なっていれば、ずらした候補は試さない
    if (sx === 0 && sy === 0 && score >= 0.5 * Math.min(totalLength(specs), totalLength(ref)) && score > 0) break;
  }
  return best;
}

const totalLength = (ws: WallSpec[]) => ws.reduce((s, w) => s + Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), 0);
const len = (w: { a: Vec2; b: Vec2 }) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
const mm = (v: number) => Math.round(v).toLocaleString('ja-JP');

/** 壁を足したあとで、開口部を「その位置にある壁」へ付ける（T 字で壁が分かれているため） */
function addOpenings(b: Building, floorId: string, specs: WallSpec[]): { b: Building; count: number } {
  let count = 0;
  const maxH = clearHeight(b, floorId);
  for (const spec of specs) {
    const L = len(spec);
    for (const o of spec.openings) {
      const p = { x: spec.a.x + ((spec.b.x - spec.a.x) * o.offset) / L, y: spec.a.y + ((spec.b.y - spec.a.y) * o.offset) / L };
      for (const w of wallsOnFloor(b, floorId)) {
        const A = b.corners[w.a], B = b.corners[w.b];
        const wl = Math.hypot(B.x - A.x, B.y - A.y);
        const s = ((p.x - A.x) * (B.x - A.x) + (p.y - A.y) * (B.y - A.y)) / wl;
        const d = Math.abs((p.x - A.x) * (B.y - A.y) - (p.y - A.y) * (B.x - A.x)) / wl;
        if (d > 60 || s < 0 || s > wl) continue;
        // 壁の端から 50mm は残す。収まらない分は幅を詰める
        const half = Math.min(o.width / 2, s - 50, wl - s - 50);
        if (half < 150) continue;
        const type = spec.kind === 'exterior' ? 'window' : 'door';
        const def = OPENING_DEFAULTS[type];
        const height = Math.min(def.height, maxH - def.sill);
        if (!(height > 0)) continue;
        const r = addOpening(b, w.id, type, s, { width: Math.round(half * 2), height });
        if (r.openingId) { b = r.b; count++; }
        break;
      }
    }
  }
  return { b, count };
}

/**
 * 図面一式から建物を作る。平面図が 1 枚も読めなければ PlanReadError。
 * 座標の原点は 1 階平面図の通り芯（X・Y の最小番号）の交点。通り芯の無い図面は紙の左下。
 */
export function buildFromSheets(inputs: SheetInput[]): PlanSetResult {
  const reads: Read[] = inputs.map((s, index) => {
    const c = classifySheet(s.page.texts, s.name);
    const grid = readGrid(s.page.texts);
    return { index, name: s.name, page: s.page, kind: c.kind, floor: c.floor, grid, scale: sheetScale(s.page.texts, grid) };
  });
  const sheets: SheetReport[] = reads.map((r) => ({ name: r.name, kind: r.kind, label: SHEET_LABEL[r.kind], used: false, note: '' }));
  const found: string[] = [], check: string[] = [];
  const note = (r: Read, used: boolean, text: string) => { sheets[r.index] = { ...sheets[r.index], used, note: text }; };

  const vector = (r: Read) => r.page.segs.length >= MIN_SEGS;
  const plans = reads.filter((r) => r.kind === 'plan').sort((a, b) => a.floor - b.floor);
  for (const r of plans.filter((p) => !vector(p))) note(r, false, '線のデータが入っていません（スキャンした PDF は自動で読めません）');
  for (const r of plans.filter((p) => vector(p) && !p.scale)) note(r, false, '縮尺を読み取れませんでした');
  const usable = plans.filter((p) => vector(p) && p.scale);
  // 同じ階の平面図が複数あれば、通り芯のあるものを優先して 1 枚
  const byFloor = new Map<number, Read>();
  for (const r of usable) {
    const cur = byFloor.get(r.floor);
    if (!cur || (!cur.grid && r.grid)) { if (cur) note(cur, false, `${r.floor}階の平面図が複数あるため使っていません`); byFloor.set(r.floor, r); }
    else note(r, false, `${r.floor}階の平面図が複数あるため使っていません`);
  }
  if (!byFloor.size) {
    if (!plans.length) throw new PlanReadError('平面図が見つかりませんでした。図面名に「平面図」「平面詳細図」と入った PDF を選んでください');
    throw new PlanReadError(sheets.filter((s) => s.kind === 'plan').map((s) => s.note)[0] || '平面図を読み取れませんでした');
  }

  const floors = [...byFloor.keys()].sort((a, b) => a - b);
  const first = byFloor.get(floors[0])!;
  const base: GridWorld | null = first.grid ? gridWorld(first.grid, baseTransform(first.grid, first.scale!.scale)) : null;
  const firstT: ToWorld = first.grid ? baseTransform(first.grid, first.scale!.scale) : { ox: 0, oy: first.page.heightPt, k: PT_TO_MM * first.scale!.scale };
  /** 1 階の壁（他の図面の位置合わせの基準） */
  const refWalls = readWalls(first.page, firstT, base, WALL_STRIP);
  const SHIFT_NOTE = '通り芯の番号が 1 階平面図と 1 つずれていたので、壁の重なりで位置を合わせました';

  // 高さ（立面図）
  const heights: Heights = { floorToFloor: new Map(), topFloor: 1 };
  for (const r of reads.filter((x) => x.kind === 'elevation')) {
    if (!r.scale) { note(r, false, '縮尺を読み取れませんでした'); continue; }
    const h = readHeights(r.page.texts, PT_TO_MM * r.scale.scale);
    heights.glToFl ??= h.glToFl;
    heights.footingTop ??= h.footingTop;
    if (heights.topToEaves === undefined && h.topToEaves !== undefined) { heights.topToEaves = h.topToEaves; heights.topFloor = h.topFloor; }
    for (const [n, v] of h.floorToFloor) if (!heights.floorToFloor.has(n)) heights.floorToFloor.set(n, v);
    const got = [h.glToFl && `GL〜1階の床 ${mm(h.glToFl)}`, h.topToEaves && `床〜軒高 ${mm(h.topToEaves)}`, h.footingTop && `基礎の高さ ${mm(h.footingTop)}`].filter(Boolean);
    note(r, got.length > 0, got.length ? `高さを読みました（${got.join('、')}）` : '高さの文字（GL・1階FL・軒高）が見つかりませんでした');
  }

  // 階と壁
  let b = emptyBuilding();
  const placements: PlanPlacement[] = [];
  const fixtures: PlacedCandidate[] = [];
  const topFloor = floors.at(-1)!;
  for (let n = 1; n <= topFloor; n++) {
    // 軒高までの高さは、立面図の最上階がこの建物の最上階と同じときだけ使う（2 階建てで「1FL」しか無い立面図の値を 1 階分にしない）
    const fromDrawing = heights.floorToFloor.get(n) ?? (n === topFloor && heights.topFloor === topFloor ? heights.topToEaves : undefined);
    const height = fromDrawing && fromDrawing >= 2000 && fromDrawing <= 6000 ? fromDrawing : DEFAULT_FLOOR_HEIGHT;
    const f = addFloor(b, { height, slabThickness: DEFAULT_SLAB });
    b = f.b;
    if (height === fromDrawing) found.push(`${n}階の高さ ${mm(height)}mm（立面図）`);
    else check.push(`${n}階の高さは立面図から読めなかったので ${mm(height)}mm にしています（「階の設定」で直せます）`);
    const r = byFloor.get(n);
    if (!r) { check.push(`${n}階の平面図がありません（壁は空です）`); continue; }
    const al = r === first ? { t: firstT, specs: refWalls, shifted: false } : r.grid && base ? alignedWalls(r.page, r.grid, base, refWalls, WALL_STRIP) : null;
    if (!al) { note(r, false, '1階の平面図と共通の通り芯（X1・Y1 など）が無く、位置を合わせられませんでした'); check.push(`${n}階の壁は読み取れていません`); continue; }
    const { t, specs } = al;
    if (al.shifted) check.push(`${n}階平面図: ${SHIFT_NOTE}`);
    for (const w of specs) b = addWall(b, f.floorId, w.a, w.b, { thickness: w.thickness, kind: w.kind }).b;
    const op = addOpenings(b, f.floorId, specs);
    b = op.b;
    const walls = wallsOnFloor(b, f.floorId);
    const total = walls.reduce((s, w) => s + Math.hypot(b.corners[w.b].x - b.corners[w.a].x, b.corners[w.b].y - b.corners[w.a].y), 0);
    placements.push({ index: r.index, floorId: f.floorId, toWorld: t, scale: r.scale!.scale });
    // 器具の候補（文字から）。凡例・表の文字を除くため、通り芯（無ければ壁）の範囲 + 3m だけを見る
    const gwF = r.grid ? gridWorld(r.grid, t) : null;
    const area = gwF ? { x0: Math.min(...gwF.xs.values()) - 3000, x1: Math.max(...gwF.xs.values()) + 3000, y0: Math.min(...gwF.ys.values()) - 3000, y1: Math.max(...gwF.ys.values()) + 3000 } : undefined;
    // 出入口（ドア）の位置も渡す（器具の候補の部屋の情報＝直し方を覚えるのに使う）
    const doorsOn = (id: string) => Object.values(b.openings).filter((o) => o.wallId === id && o.type === 'door').map((o) => o.offset);
    const lines = walls.map((w) => ({ a: b.corners[w.a], b: b.corners[w.b], thickness: w.thickness, doors: doorsOn(w.id) }));
    const cands = guessFixtures(r.page.texts.map((x) => ({ x: toWorldX(t, x.x), y: toWorldY(t, x.y), s: x.s })), lines, area);
    // 屋外の器具（立水栓・給湯器）は 1 階の図面から出たものだけ（上の階の図面にも同じ文字が写っていることがある）
    fixtures.push(...cands.filter((c) => n === floors[0] || (c.type !== 'outdoorFaucet' && c.type !== 'waterHeater')).map((c) => ({ ...c, floorId: f.floorId })));
    note(r, true, walls.length ? `壁 ${walls.length} 本（延べ ${(total / 1000).toFixed(1)}m）・開口部 ${op.count} か所` : '壁の線を見つけられませんでした');
    if (walls.length) found.push(`${n}階の壁 ${walls.length} 本・開口部 ${op.count} か所（1/${r.scale!.scale}${r.grid ? '、通り芯で位置合わせ' : ''}）`);
    else check.push(`${n}階の壁を読み取れませんでした。図面を下に敷いてあるので、なぞって描いてください`);
    if (r.scale!.guessed) check.push(`${n}階平面図の縮尺は通り芯の間隔から 1/${r.scale!.scale} と推定しました。壁の長さを 1 か所確かめてください`);
    if (!r.grid) check.push(`${n}階平面図に通り芯（X1・Y1…）の文字が無いため、他の図面との位置合わせはしていません`);
  }
  if (Object.keys(b.walls).length) {
    check.push('外壁・内壁の区別は目安です。開口部は外壁なら窓・内壁ならドアとして標準の高さで入れています（玄関・掃き出し窓は選んで直してください）。斜めの壁・曲がった壁は読み取りません');
  }

  // 器具の候補の数（配置図を読んだあと、配置図で置いた物と重なる候補を除いて数え直す）
  const countLine = (list: PlacedCandidate[]) => {
    const count = new Map<string, number>();
    for (const c of list) count.set(FIXTURE_CATALOG[c.type].label, (count.get(FIXTURE_CATALOG[c.type].label) ?? 0) + 1);
    return `器具の候補 ${list.length} 個（${[...count].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join('・')}）`;
  };
  const countAt = fixtures.length ? found.push(countLine(fixtures)) - 1 : -1;

  // 高さの基準と基礎
  const gl = heights.glToFl !== undefined && heights.glToFl <= 3000 ? heights.glToFl : undefined;
  if (gl !== undefined) found.push(`1階の床は GL+${mm(gl)}mm（立面図）`);
  const floor1 = b.floors[0].id;
  for (const r of reads.filter((x) => x.kind === 'foundation')) {
    if (!vector(r)) { note(r, false, '線のデータが入っていません'); continue; }
    const al = r.grid && base ? alignedWalls(r.page, r.grid, base, refWalls, FOOTING_STRIP) : null;
    if (!al) { note(r, false, '平面図と共通の通り芯が無く、位置を合わせられませんでした'); check.push('基礎伏図は位置を合わせられなかったため、基礎は入っていません'); continue; }
    const { specs } = al;
    if (al.shifted) check.push(`基礎伏図: ${SHIFT_NOTE}`);
    const z0 = -(gl ?? DEFAULT_GL_TO_FL);
    const top = heights.footingTop && heights.footingTop < (gl ?? DEFAULT_GL_TO_FL) ? heights.footingTop : Math.min(DEFAULT_FOOTING_TOP, (gl ?? DEFAULT_GL_TO_FL) - 50);
    let n = 0;
    for (const w of specs) {
      // 人通口（切れ目）は開けたままにする: 開口部の所で分ける
      const L = len(w), u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
      const at = (s: number): Vec2 => ({ x: w.a.x + u.x * s, y: w.a.y + u.y * s });
      let s0 = 0;
      for (const cut of [...w.openings.map((o) => [o.offset - o.width / 2, o.offset + o.width / 2]).sort((p, q) => p[0] - q[0]), [L, L]]) {
        if (cut[0] - s0 >= 100) { b = withMember(b, { kind: 'footing', floorId: floor1, a: at(s0), b: at(cut[0]), width: w.thickness, z0, z1: z0 + top }).b; n++; }
        s0 = cut[1];
      }
    }
    note(r, n > 0, n ? `基礎の立上り ${n} 本` : '立上りの線を見つけられませんでした');
    if (n) {
      found.push(`基礎の立上り ${n} 本（GL〜GL+${mm(top)}mm）`);
      if (gl === undefined) check.push(`GL の高さが立面図から読めなかったので、1階の床を GL+${DEFAULT_GL_TO_FL}mm として基礎を置いています`);
      if (!heights.footingTop) check.push(`基礎の高さは読めなかったので GL+${mm(top)}mm にしています`);
      // 床下の底: 区画の「基礎天端 −350」の印（スラブ天端は基礎天端のその分下）。床下の配管はこの上〜基礎天端の間を通る
      const off = readSlabOffset(r.page.texts);
      const raw = top + (off ?? -DEFAULT_SLAB_BELOW_FOOTING);
      const slabGL = Math.max(0, raw);
      b = { ...b, foundation: { slabTop: z0 + slabGL } };
      const minus = (v: number) => `−${-v}`;
      if (off !== undefined) found.push(`床下の底（基礎のスラブの上）は GL+${mm(slabGL)}mm（基礎伏図の「基礎天端 ${minus(off)}」）。1階の床まで ${mm(-(z0 + slabGL))}mm`);
      else check.push(`床下の底（基礎のスラブの上）は読めなかったので GL+${mm(slabGL)}mm（基礎天端の ${DEFAULT_SLAB_BELOW_FOOTING}mm 下）にしています`);
      const kinds = [...new Set(slabMarks(r.page.texts))];
      if (kinds.length > 1) check.push(`基礎伏図のスラブの高さの印が区画で違います（${kinds.map(minus).join('・')}）。いちばん多い ${minus(off!)} にしています。区画ごとの違い（玄関・浴室の下など）は入っていません`);
      if (raw < 0) check.push(`床下の底が GL より下になる値だったので、GL+0 にしています（基礎の高さ・スラブの印を確かめてください）`);
    }
  }
  // 配置図: 家の外形（1 階の外壁）で位置を合わせ、ます・メーター・敷地の高さを読む
  let site: SiteResult | undefined;
  for (const r of reads.filter((x) => x.kind === 'site')) {
    if (!vector(r)) { note(r, false, '線のデータが入っていません'); continue; }
    const ref = wallsOnFloor(b, floor1).filter((w) => w.kind === 'exterior').map((w) => ({ a: b.corners[w.a], b: b.corners[w.b], t: w.thickness }));
    const scale = r.scale?.scale ?? 100;
    const t = alignSite(r.page, PT_TO_MM * scale, ref);
    if (!t) { note(r, false, '家の外形と重ならず、位置を合わせられませんでした'); check.push('配置図は家の外形と重ならず、位置を合わせられませんでした（ます・メーター・敷地の高さは入っていません）'); continue; }
    const sr = readSite(r.page);
    const at = (p: Vec2) => ({ x: Math.round(toWorldX(t, p.x)), y: Math.round(toWorldY(t, p.y)) });
    // 1 階の床より高い高さは、隣地・擁壁の高さとみて使わない（家のすぐ横の地面が床より高いことはまず無い）
    const floorGL = gl ?? DEFAULT_GL_TO_FL;
    const levels = sr.levels.filter((l) => l.gl < floorGL).map((l) => ({ ...at(l.p), gl: l.gl }));
    const dropped = [...new Set(sr.levels.filter((l) => l.gl >= floorGL).map((l) => l.gl))];
    site = { items: sr.items.map((i) => ({ type: i.type, ...at(i.p) })), levels, ...(sr.bm !== undefined ? { bm: sr.bm } : {}) };
    placements.push({ index: r.index, floorId: floor1, toWorld: t, scale, site: true });
    const n = (type: SiteItem['type']) => site!.items.filter((x) => x.type === type).length;
    const parts = ([['publicSewage', '汚水公共ます'], ['manholeSewage', '汚水ます'], ['manholeRain', '雨水ます'], ['outdoorFaucet', '立水栓'], ['waterMeter', '水道メーター']] as const).filter(([k]) => n(k)).map(([k, l]) => `${l} ${n(k)}`);
    const gls = levels.map((l) => l.gl);
    const sgl = (v: number) => `GL${v === 0 ? '±0' : v > 0 ? `+${v}` : `−${-v}`}`;
    note(r, true, parts.length ? parts.join('・') : '家の外形で位置を合わせました');
    found.push(`配置図: ${parts.join('・') || 'ますの記号なし'}${levels.length ? `、敷地の高さ ${levels.length} か所（${sgl(Math.min(...gls))}〜${sgl(Math.max(...gls))}）` : ''}（家の外形で位置を合わせました）`);
    if (sr.bm !== undefined) found.push(`配置図: BM は GL−${mm(sr.bm)}（「BM+${sr.bm}=GL±0」）`);
    if (!sr.legend) check.push('配置図に凡例（汚水桝・雨水桝の記号）が見つからなかったので、ますは読んでいません');
    if (!n('publicSewage')) check.push(`配置図に汚水公共ますの記号はありませんでした${r.page.texts.some((x) => /下水引込/.test(x.s)) ? '（「下水引込へ」の向きにあるはずです）' : ''}。公共ますは「器具」から置いてください`);
    if (dropped.length) check.push(`配置図の ${dropped.sort((p, q) => p - q).map(sgl).join('・')} は 1 階の床より高いので、隣地・擁壁の高さとみて敷地の高さに使っていません`);
  }
  if (!reads.some((r) => r.kind === 'foundation')) check.push('基礎伏図が無いので、基礎は入っていません');
  if (!reads.some((r) => r.kind === 'elevation')) check.push('立面図が無いので、高さは標準値です');
  for (const r of reads) if (r.page.truncated) check.push(`${r.name} は線が多すぎて途中までしか読んでいません。壁が欠けていないか確かめてください`);
  for (const r of reads) {
    if (sheets[r.index].note) continue;
    if (r.kind === 'detail') note(r, false, '展開図は読み取りません（器具の高さは標準値です）');
    else if (r.kind === 'unknown') note(r, false, '図面の種類が分かりませんでした（図面名の文字が読めない PDF）');
  }
  const kept = dropSiteDuplicates(fixtures, site);
  if (countAt >= 0) {
    if (kept.length) found[countAt] = countLine(kept);
    else found.splice(countAt, 1);
  }
  return { building: b, designGL: gl === undefined ? undefined : -gl, plans: placements, fixtures: kept, report: { sheets, found, check }, ...(site ? { site } : {}) };
}
