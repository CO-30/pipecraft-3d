/**
 * 排水設備 平面図（申請用、A3 横）。南風原町で受理された実物（2026-11-18 入手）の書き方に合わせる:
 * - 各階の平面（壁・器具）を並べ（上の階を左）、排水を 新設＝赤・既設＝青 で重ねる
 * - 桝は ○ に「① H=410」（縦断図の NO.n と同じ番号。落差は H=600-1280）、公共は「既設公共汚水桝 H=1100」
 * - 桝どうしの本管は「VU100×1.6」（長さは縦断図と同じ水平の長さ）、器具からの枝は「VU50」「1.2」の 2 段（曲がりは 1 本にまとめる）
 * - 敷地の高さの点は「GL±0」「GL−900」を □ で囲む。凡例の箱と「※単位はmm 管長はm」、表題欄は 申請地・申請者・指定工事店
 * 建物の平面の下敷き（取り込んだ図面）は描かない（縮尺・向きの合わない画像を申請図面に混ぜないため）。壁と器具の外形を描く。
 */
import type { Doc } from '../model/doc';
import type { Floor } from '../model/building';
import { FIXTURE_CATALOG, fixtureCorners, isManhole, type Fixture } from '../model/fixtures';
import type { MunicipalityProfile } from '../model/municipality';
import { isDrain, planLength } from '../model/slope';
import { drawingMaterial } from '../model/materials';
import { groupRuns } from '../model/drainRuns';
import { dateJa } from './report';
import { SCALES } from './drawingPdf';
import { around, LabelPlacer, textWidth, type LabelLine } from './labelLayout';
import { drawFrame, drawTitleBlock, GRAY, PAPER_MM, titleWidth, WARN, type Sheet } from './sheet';
import { drawLegendBox, type SheetMeta } from './profileSheet';

export type DrainPlanMeta = SheetMeta & {
  /** 桝の点の ID → 図に書く文字（isoManholeLabels。縦断図と同じ番号）。無ければ桝の種類名と深さ */
  manholeLabels?: Record<string, string>;
};

const WALL = '#6b7280';
/** 排水の口がある器具だけ描く（メーター・タンク・電気などは排水の平面図に要らない） */
const hasDrainPort = (t: Fixture['type']) => !isManhole(t) && FIXTURE_CATALOG[t].ports.some((p) => isDrain(p.system));
const FIX = '#9ca3af';
/** z がこの階か（最下階より下＝床下・地中は最下階に含める） */
const onFloor = (b: Doc['building'], f: Floor, z: number) => {
  const first = b.floors[0]?.id === f.id, last = b.floors.at(-1)?.id === f.id;
  return (first || z >= f.elevation - 1) && (last || z < f.elevation + f.height - 1);
};
const fmtGL = (gl: number) => (Math.abs(gl) < 1 ? 'GL±0' : `GL${gl > 0 ? '+' : '−'}${Math.abs(Math.round(gl))}`);

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** 図に何も無ければ undefined（排水の配管が無い） */
export function renderDrainPlanSheet(doc: Doc, profile: MunicipalityProfile, meta: DrainPlanMeta): Sheet | undefined {
  const b = doc.building, net = doc.network;
  const segs = Object.values(net.segments).filter((s) => isDrain(s.system) && net.nodes[s.a] && net.nodes[s.b]);
  if (!segs.length) return undefined;
  const [W, H] = PAPER_MM.A3;
  const sheet: Sheet = { width: W, height: H, ops: [] };
  drawFrame(sheet);
  const colors = profile.colors;
  const floors = b.floors.length ? b.floors : [{ id: '_', name: '1階', elevation: 0, height: 3000 } as Floor];

  // 階ごとの範囲（壁・器具・排水）。1 階は外の桝・公共桝・敷地の高さの点を含む
  type FloorPlan = { f: Floor; box: Box; segs: typeof segs };
  const plans: FloorPlan[] = [];
  for (const f of floors) {
    const pts: { x: number; y: number }[] = [];
    for (const w of Object.values(b.walls)) if (w.floorId === f.id) pts.push(b.corners[w.a], b.corners[w.b]);
    for (const x of Object.values(doc.fixtures)) if (x.floorId === f.id && hasDrainPort(x.type)) pts.push(...fixtureCorners(x));
    const fs = segs.filter((s) => onFloor(b, f, net.nodes[s.a].pos.z) || onFloor(b, f, net.nodes[s.b].pos.z));
    for (const s of fs) pts.push(net.nodes[s.a].pos, net.nodes[s.b].pos);
    if (f.id === floors[0].id) for (const g of doc.site?.groundPoints ?? []) pts.push(g);
    if (!pts.length) continue;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    plans.push({ f, box: { minX: Math.min(...xs) - 1200, minY: Math.min(...ys) - 1200, maxX: Math.max(...xs) + 1200, maxY: Math.max(...ys) + 1200 }, segs: fs });
  }
  if (!plans.length) return undefined;
  // 上の階を左に（実物の並び）
  plans.reverse();
  const titleH = 7 * profile.paper.titleBlockFields.length + 6;
  const area = { x: 20, y: 30, w: W - 40, h: H - 30 - 12 - titleH - 4 };
  const GAP = 12;
  const totalW = plans.reduce((t, p) => t + (p.box.maxX - p.box.minX), 0);
  const maxH = Math.max(...plans.map((p) => p.box.maxY - p.box.minY));
  const scale = SCALES.find((n) => n >= 50 && totalW / n + GAP * (plans.length - 1) <= area.w && maxH / n <= area.h) ?? SCALES[SCALES.length - 1];
  const used = totalW / scale + GAP * (plans.length - 1);
  let cursor = area.x + Math.max(0, (area.w - used) / 2);
  sheet.content = { x: cursor - 8, y: area.y + (area.h - maxH / scale) / 2 - 10, w: used + 16, h: maxH / scale + 20 };

  sheet.ops.push({ t: 'text', x: 25, y: 22, s: '平面図', size: 6, bold: true });
  sheet.ops.push({ t: 'text', x: 25 + textWidth('平面図', 6) + 4, y: 22, s: `S=1/${scale}`, size: 3, color: GRAY });

  const placer = new LabelPlacer(sheet, { x1: 11, y1: 26, x2: W - 11, y2: H - 11 });
  const later: (() => void)[] = [];
  for (const p of plans) {
    const ox = cursor, oy = area.y + (area.h - (p.box.maxY - p.box.minY) / scale) / 2;
    cursor += (p.box.maxX - p.box.minX) / scale + GAP;
    const X = (x: number) => ox + (x - p.box.minX) / scale, Y = (y: number) => oy + (y - p.box.minY) / scale;
    // 階の名前（図の下）
    later.push(() => placer.place(around((X(p.box.minX) + X(p.box.maxX)) / 2, Y(p.box.maxY) - 2, [{ s: p.f.name, size: 3.2 }], { gap: 0, prefer: [90, -90] })));
    // 壁（芯の線を厚さの分だけ太く）
    for (const w of Object.values(b.walls)) {
      if (w.floorId !== p.f.id) continue;
      const A = b.corners[w.a], B = b.corners[w.b];
      sheet.ops.push({ t: 'line', x1: X(A.x), y1: Y(A.y), x2: X(B.x), y2: Y(B.y), w: Math.max(0.25, Math.min(0.7, (w.thickness / scale) * 0.5)), color: WALL });
      placer.blockSeg(X(A.x), Y(A.y), X(B.x), Y(B.y));
    }
    // 器具の外形と名前（小さく灰色）
    for (const x of Object.values(doc.fixtures)) {
      if (x.floorId !== p.f.id || !hasDrainPort(x.type)) continue;
      const cs = fixtureCorners(x).map((c) => [X(c.x), Y(c.y)] as [number, number]);
      sheet.ops.push({ t: 'poly', pts: [...cs, cs[0]], w: 0.15, color: FIX });
      const cx = cs.reduce((t, c) => t + c[0], 0) / cs.length, cy = cs.reduce((t, c) => t + c[1], 0) / cs.length;
      later.push(() => placer.place(around(cx, cy, [{ s: FIXTURE_CATALOG[x.type].label, size: 2, color: GRAY }], { gap: 0.5, maxDist: 10 })));
    }
    // 排水の管
    for (const s of p.segs) {
      const A = net.nodes[s.a].pos, B = net.nodes[s.b].pos;
      const c = s.existing ? colors.existing : colors.newWork;
      if (Math.hypot(B.x - A.x, B.y - A.y) < 1) {
        // 縦管: 点（立ち上がり・立ち下がり）
        sheet.ops.push({ t: 'circle', cx: X(A.x), cy: Y(A.y), r: 0.7, stroke: c, fill: '#ffffff', lw: 0.25 });
        continue;
      }
      sheet.ops.push({ t: 'line', x1: X(A.x), y1: Y(A.y), x2: X(B.x), y2: Y(B.y), w: 0.45, color: c });
      placer.blockSeg(X(A.x), Y(A.y), X(B.x), Y(B.y), s.id);
    }
    // 敷地の高さ（1 階の図だけ）: □ で囲んだ GL±0
    if (p.f.id === floors[0].id) {
      for (const g of doc.site?.groundPoints ?? []) {
        const l: LabelLine = { s: fmtGL(g.gl), size: 2.4 };
        later.push(() => {
          // 置いた文字を □ で囲む
          const t = placer.place(around(X(g.x), Y(g.y), [l], { gap: 0.6, maxDist: 15 }))?.texts[0];
          if (t) {
            const tw = textWidth(t.s, t.size), x0 = t.anchor === 'middle' ? t.x - tw / 2 : t.anchor === 'end' ? t.x - tw : t.x;
            sheet.ops.push({ t: 'rect', x: x0 - 0.8, y: t.y - t.size * 0.95, w: tw + 1.6, h: t.size * 1.3, lw: 0.2 });
          }
        });
      }
    }
    // 桝と器具の口
    for (const n of Object.values(net.nodes)) {
      const fx = n.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
      if (!fx || !p.segs.some((s) => s.a === n.id || s.b === n.id)) continue;
      const x = X(n.pos.x), y = Y(n.pos.y);
      if (isManhole(fx.type)) {
        if (p.f.id !== floors[0].id) continue;
        const c = fx.params?.existing ? colors.existing : colors.newWork;
        const r = Math.max(1.4, (fx.params?.diameter ?? 300) / scale / 2 + 0.6);
        sheet.ops.push({ t: 'circle', cx: x, cy: y, r, stroke: c, fill: '#ffffff', lw: 0.35 });
        // 落差桝: ○ に短い縦棒（実物の記号）
        if ((n.dropIn ?? 0) > 50) sheet.ops.push({ t: 'line', x1: x, y1: y - r - 0.9, x2: x, y2: y + r + 0.9, w: 0.3, color: c });
        placer.block({ x1: x - r - 0.3, y1: y - r - 1, x2: x + r + 0.3, y2: y + r + 1 });
        const label = meta.manholeLabels?.[n.id] ?? `${FIXTURE_CATALOG[fx.type].label}`;
        later.unshift(() => placer.place(around(x, y, [{ s: label, size: 2.6, color: c }], { gap: r + 0.6, prefer: [-90, -45, -135, 45, 135, 90], leaderAlways: false, leaderColor: GRAY })));
      } else {
        sheet.ops.push({ t: 'circle', cx: x, cy: y, r: 0.8, stroke: colors.newWork, fill: '#ffffff', lw: 0.25 });
        placer.block({ x1: x - 1, y1: y - 1, x2: x + 1, y2: y + 1 });
      }
    }
    // 管の文字: 桝どうしは「VU100×1.6」、枝は「VU50」「1.2」の 2 段（曲がりは 1 本にまとめる）
    const isMhNode = (id: string) => { const n = net.nodes[id]; const fx = n?.fixtureId ? doc.fixtures[n.fixtureId] : undefined; return !!fx && isManhole(fx.type); };
    const flat = p.segs.filter((s) => planLength(net, s) >= 1);
    const spec = (s: (typeof segs)[number]) => `${drawingMaterial(s.material) || 'VU'}${s.diameter}`;
    const mains = flat.filter((s) => isMhNode(s.a) && isMhNode(s.b));
    const degree = new Map<string, number>();
    for (const s of p.segs) for (const n of [s.a, s.b]) degree.set(n, (degree.get(n) ?? 0) + 1);
    const stops = new Set(Object.values(net.nodes).filter((n) => n.fixtureId).map((n) => n.id));
    const len3d = (s: (typeof segs)[number]) => { const A = net.nodes[s.a].pos, B = net.nodes[s.b].pos; return Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z); };
    // 縦管（同じ点の上下）も枝の長さに入れる（立面図の長さと合わせる）
    const runs = groupRuns(p.segs.filter((s) => !(isMhNode(s.a) && isMhNode(s.b))).map((s) => ({ id: s.id, a: s.a, b: s.b, key: spec(s), lengthMm: len3d(s) })), degree, stops);
    const segById = new Map(p.segs.map((s) => [s.id, s]));
    const mid = (s: (typeof segs)[number]) => ({ x: (X(net.nodes[s.a].pos.x) + X(net.nodes[s.b].pos.x)) / 2, y: (Y(net.nodes[s.a].pos.y) + Y(net.nodes[s.b].pos.y)) / 2 });
    for (const s of mains) {
      const c = s.existing ? colors.existing : colors.newWork;
      const m = mid(s);
      const l: LabelLine = { s: `${spec(s)}×${(planLength(net, s) / 1000).toFixed(1)}`, size: 2.6, color: c };
      later.push(() => placer.place([...around(m.x, m.y, [l], { gap: 1.2, prefer: [-90, 90] }), ...around(m.x, m.y, [l], { gap: 3, prefer: [-90, 90, -45, 45], leaderAlways: true, leaderColor: GRAY }).map((cd) => ({ ...cd, penalty: cd.penalty + 50 }))], { ignoreSeg: s.id }));
    }
    for (const r of runs) {
      const ss = r.ids.map((id) => segById.get(id)!).filter((s) => planLength(net, s) >= 1);
      if (!ss.length) continue;
      const rep = ss.reduce((a, s) => (planLength(net, s) > planLength(net, a) ? s : a));
      const m = mid(rep);
      const two: LabelLine[] = [{ s: r.key, size: 2.4 }, { s: (r.lengthMm / 1000).toFixed(1), size: 2.4 }];
      later.push(() => placer.place([...around(m.x, m.y, two, { gap: 1, prefer: [0, 180, -90, 90] }), ...around(m.x, m.y, two, { gap: 3, leaderAlways: true, leaderColor: GRAY }).map((cd) => ({ ...cd, penalty: cd.penalty + 50 }))], { ignoreSeg: rep.id }));
    }
  }
  // 文字は図形を全部描いてから（桝の名前 → 管 → 器具・GL・階の名前の順）
  for (const f of later) f();

  // 凡例・表題欄
  if (profile.paper.legend === 'box') drawLegendBox(sheet, profile, W - 10 - titleWidth(W) - 50, H - 10 - 26);
  else sheet.ops.push({ t: 'text', x: 25, y: H - 10 - titleH, s: '凡例: 赤＝新設・増設　青＝既設　黒＝公共下水道　※単位はmm 管長はm', size: 2.4, color: GRAY });
  if (placer.collisions > 0) sheet.ops.push({ t: 'text', x: 25, y: H - 14, s: '※ 文字が混み合っています。必要なら手で位置を直してください', size: 2.6, color: WARN });
  const values: Record<string, string> = { '工事名': meta.siteName, '図面名': '排水設備 平面図', '縮尺': `1/${scale}`, '作成日': dateJa(meta.date), ...(meta.titleValues ?? {}) };
  drawTitleBlock(sheet, profile.paper.titleBlockFields.map((f) => ({ label: f, value: values[f] ?? '' })));
  return sheet;
}
