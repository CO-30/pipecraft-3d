/**
 * 南部水道企業団の申請書類（A4 縦）を罫線から描き起こす。受理された実物（記入済み、2026-11-16 入手）の並びと項目に合わせた。
 * 公式の白紙様式が手元に無いため背景には使わない（記入済みの実物は個人情報を含むので同梱しない）。
 * 並び（チェック表の順）: チェック表 → 穿孔時書類確認 → 給水申込書＋委任状 → 臨時用給水に関する誓約書（臨時給水ありのとき）
 *   → 給水装置工事申請書及び設計書（様式第6号）→ 横断面図・オフセット → 竣工検査項目 → 製品一覧表（呼ぶ側で作る）
 */
import { textWidth } from '../export/labelLayout';
import { MAP_FRAME } from '../export/locationSheet';
import { GRAY, type Op, type Sheet } from '../export/sheet';
import { label, wrap } from '../road/draw';
import { NANBU_FORMS, NANBU_SUPPLY_KINDS, NANBU_USE_KINDS, NANBU_WORK_KINDS, splitSite } from './nanbu';
import { reiwa, type ApplicationValues, type Contractor } from './types';

type Box = { x: number; y: number; w: number; h: number };
export type NanbuSheetOpts = { siteName: string; date: Date; products: Sheet[]; /** 見取図（src/export/locationSheet.ts の A4 縦） */ map?: Sheet; /** 道路の横断図（src/road/drawSheets.ts の renderRoadSection） */ roadSection?: Sheet };

/** 見取図の地図の枠 */
const MAP_REGION: Box = MAP_FRAME;

/** src の region の範囲を、縦横比を保って box の中央に縮めて描く（region の外の図形は描かない） */
export function insetSheet(dst: Sheet, src: Sheet, region: Box, box: Box): void {
  const k = Math.min(box.w / region.w, box.h / region.h);
  const ox = box.x + (box.w - region.w * k) / 2 - region.x * k, oy = box.y + (box.h - region.h * k) / 2 - region.y * k;
  const X = (x: number) => ox + x * k, Y = (y: number) => oy + y * k;
  const inside = (x: number, y: number) => x >= region.x - 0.01 && x <= region.x + region.w + 0.01 && y >= region.y - 0.01 && y <= region.y + region.h + 0.01;
  for (const o of src.ops) {
    let n: Op | undefined;
    if (o.t === 'line') { if (inside(o.x1, o.y1) || inside(o.x2, o.y2)) n = { ...o, x1: X(o.x1), y1: Y(o.y1), x2: X(o.x2), y2: Y(o.y2), w: (o.w ?? 0.25) * Math.max(k, 0.5) }; }
    else if (o.t === 'poly') { if (o.pts.some(([x, y]) => inside(x, y))) n = { ...o, pts: o.pts.map(([x, y]) => [X(x), Y(y)] as [number, number]), w: (o.w ?? 0.25) * Math.max(k, 0.5) }; }
    else if (o.t === 'rect') { if (inside(o.x, o.y) && inside(o.x + o.w, o.y + o.h)) n = { ...o, x: X(o.x), y: Y(o.y), w: o.w * k, h: o.h * k }; }
    else if (o.t === 'image') {
      // 範囲からはみ出す画像（地図）は範囲で切り抜く
      const x1 = Math.max(o.x, region.x), y1 = Math.max(o.y, region.y), x2 = Math.min(o.x + o.w, region.x + region.w), y2 = Math.min(o.y + o.h, region.y + region.h);
      if (x2 > x1 && y2 > y1) n = { ...o, x: X(o.x), y: Y(o.y), w: o.w * k, h: o.h * k, clip: { x: X(x1), y: Y(y1), w: (x2 - x1) * k, h: (y2 - y1) * k } };
    }
    else if (o.t === 'circle') { if (inside(o.cx, o.cy)) n = { ...o, cx: X(o.cx), cy: Y(o.cy), r: o.r * k }; }
    else if (o.t === 'text') { if (inside(o.x, o.y)) n = { ...o, x: X(o.x), y: Y(o.y), size: o.size * k }; }
    if (n) dst.ops.push(n);
  }
}

// --- 描画の小道具（用紙 mm） ---
const A4 = (): Sheet => ({ width: 210, height: 297, ops: [] });
const rect = (s: Sheet, b: Box, lw = 0.3) => s.ops.push({ t: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, lw });
const hline = (s: Sheet, x1: number, x2: number, y: number, w = 0.25) => s.ops.push({ t: 'line', x1, y1: y, x2, y2: y, w });
const vline = (s: Sheet, x: number, y1: number, y2: number, w = 0.25) => s.ops.push({ t: 'line', x1: x, y1, x2: x, y2, w });
const text = (s: Sheet, x: number, y: number, str: string, size: number, o: { anchor?: 'start' | 'middle' | 'end'; color?: string; bold?: boolean } = {}) => { if (str) s.ops.push({ t: 'text', x, y, s: str, size, ...o }); };
/** 枠の中に 1 行（縦は中央。幅を超えたら縮める） */
function cell(s: Sheet, b: Box, str: string, size = 3.2, anchor: 'start' | 'middle' = 'start', color?: string) {
  if (!str) return;
  label(s, anchor === 'middle' ? b.x + b.w / 2 : b.x + 1.5, b.y + b.h / 2 + size * 0.36, str, size, b.w - 3, { anchor, color, min: size * 0.55 });
}
/** 枠と中の文字（枠線つき） */
function boxCell(s: Sheet, b: Box, str: string, size = 3.2, anchor: 'start' | 'middle' = 'middle', color?: string) { rect(s, b, 0.25); cell(s, b, str, size, anchor, color); }
/** 選択肢を横に並べ、選んだものを四角で囲む。戻り値は右端 x */
function choices(s: Sheet, x: number, y: number, opts: string[], chosen: string | undefined, size: number, gap = 2.5): number {
  let cx = x;
  for (const o of opts) {
    const w = textWidth(o, size);
    text(s, cx, y, o, size);
    if (o === chosen) s.ops.push({ t: 'rect', x: cx - 0.9, y: y - size * 0.95, w: w + 1.8, h: size * 1.3, lw: 0.3 });
    cx += w + gap;
  }
  return cx;
}
/** 縦に並べる選択肢（行の間隔 lh） */
function choicesV(s: Sheet, x: number, y: number, opts: string[], chosen: string | undefined, size: number, lh: number) {
  opts.forEach((o, i) => choices(s, x, y + i * lh, [`・${o}`], chosen === o ? `・${o}` : undefined, size));
}
const jd = (iso: string | undefined) => { const r = iso ? reiwa(iso) : undefined; return r ? `令和${r.year}年${r.month}月${r.day}日` : '令和　　年　　月　　日'; };
/** 「第 n 号」（入力に 第 が入っていればそのまま） */
const dai = (v: string | undefined) => (!v ? '第　　　　号' : /第/.test(v) ? (/号$/.test(v) ? v : `${v} 号`) : `第 ${v} 号`);
/** 使用者（所有者と同じなら所有者の値） */
function userOf(v: ApplicationValues) {
  const same = (v.userSame ?? '同じ') !== '別';
  return same ? { address: v.ownerAddress ?? '', kana: v.ownerKana ?? '', name: v.ownerName ?? '', tel: v.ownerTel ?? '' } : { address: v.userAddress ?? '', kana: v.userKana ?? '', name: v.userName ?? '', tel: v.userTel ?? '' };
}
const zipAddr = (zip: string | undefined, addr: string | undefined) => [zip ? `〒${zip.replace(/^〒/, '')}` : '', addr ?? ''].filter(Boolean).join(' ');

/** 見取図の枠（見出し＋地図） */
function mapBox(s: Sheet, b: Box, map: Sheet | undefined) {
  rect(s, b, 0.3);
  text(s, b.x + b.w / 2, b.y + 5, '見　取　図', 3.4, { anchor: 'middle' });
  const inner = { x: b.x + 3, y: b.y + 8, w: b.w - 6, h: b.h - 10 };
  if (map) {
    // 枠の形（横長）に合わせて地図の中央（工事場所の印）を切り抜き、なるべく大きく入れる
    const R = MAP_REGION, aspect = inner.w / inner.h;
    const region = aspect >= R.w / R.h ? { x: R.x, w: R.w, h: R.w / aspect, y: R.y + (R.h - R.w / aspect) / 2 } : { y: R.y, h: R.h, w: R.h * aspect, x: R.x + (R.w - R.h * aspect) / 2 };
    insetSheet(s, map, region, inner);
    rect(s, inner, 0.25);
    // 方位（地図は北が上）
    const nx = inner.x + inner.w - 7, ny = inner.y + 8;
    s.ops.push({ t: 'circle', cx: nx, cy: ny, r: 5.5, fill: '#ffffff', stroke: GRAY, lw: 0.2 });
    s.ops.push({ t: 'poly', pts: [[nx, ny - 2.2], [nx - 2, ny + 3.8], [nx, ny + 2.3], [nx + 2, ny + 3.8]], close: true, fill: '#1f2328', color: '#1f2328', w: 0.2 });
    text(s, nx, ny - 2.8, 'N', 2.4, { anchor: 'middle', bold: true });
  } else text(s, b.x + b.w / 2, b.y + b.h / 2 + 2, '（申請図面の「見取図」で工事場所を決めると地図が入ります）', 2.6, { anchor: 'middle', color: GRAY });
}

// --- 1. チェック表 ---
function checkSheet(v: ApplicationValues, c: Contractor): Sheet {
  const s = A4();
  text(s, 35, 24, '給水装置工事申請書類チェック表', 5, { bold: true });
  const d = v.date ? reiwa(v.date) : undefined;
  text(s, 175, 32, `令和 ${d ? d.year : '　'} 年　　月　　日`, 3.2, { anchor: 'end' });
  [['受付番号', 39], ['受付者', 46]].forEach(([k, y]) => { text(s, 125, y as number, k as string, 3.2); hline(s, 123, 177, (y as number) + 1.5); });
  text(s, 35, 56, '【申請者記入】※工事店記入', 3.2);
  const X = 35, W = 140, rh = 8, y0 = 59;
  const site = splitSite(v.siteAddress ?? '');
  boxCell(s, { x: X, y: y0, w: 32, h: rh }, '指定工事業者'); boxCell(s, { x: X + 32, y: y0, w: 48, h: rh }, c.name);
  boxCell(s, { x: X + 80, y: y0, w: 30, h: rh }, '指定工事事業者証交付番号', 2.2); boxCell(s, { x: X + 110, y: y0, w: 30, h: rh }, c.licenseNo);
  boxCell(s, { x: X, y: y0 + rh, w: 32, h: rh }, '担当者'); boxCell(s, { x: X + 32, y: y0 + rh, w: 48, h: rh }, c.chiefEngineer);
  boxCell(s, { x: X, y: y0 + rh * 2, w: 32, h: rh }, '担当者連絡先'); boxCell(s, { x: X + 32, y: y0 + rh * 2, w: 48, h: rh }, c.chiefEngineerTel || c.tel);
  boxCell(s, { x: X + 80, y: y0 + rh, w: 30, h: rh * 2 }, '穿孔', 4.2); rect(s, { x: X + 110, y: y0 + rh, w: 30, h: rh * 2 }, 0.25);
  boxCell(s, { x: X, y: y0 + rh * 3, w: 32, h: rh }, '申請者氏名'); boxCell(s, { x: X + 32, y: y0 + rh * 3, w: 108, h: rh }, v.ownerName ?? '', 3.2, 'start');
  boxCell(s, { x: X, y: y0 + rh * 4, w: 32, h: rh }, '設置場所'); boxCell(s, { x: X + 32, y: y0 + rh * 4, w: 108, h: rh }, `（八重瀬町・南風原町）字　${site.aza}`, 3.2, 'start');
  text(s, 35, 104, '【給水装置工事申請書】※穿孔検査添付書類', 3.2);
  text(s, 35, 110, '※南部水道企業団記入', 2.8);
  const cols = [10, 14, 58, 58], cx = cols.map((_, i) => X + cols.slice(0, i).reduce((a, b) => a + b, 0));
  const t0 = 113, hh = 6.5, lh = 6.5;
  ['', 'チェック欄', '書類項目', '備考'].forEach((h, i) => boxCell(s, { x: cx[i], y: t0, w: cols[i], h: hh }, h, i === 1 ? 2.2 : 3));
  const items = NANBU_FORMS.checklist;
  for (let r = 0; r < 16; r++) {
    const y = t0 + hh + r * lh, it = items[r];
    cols.forEach((w, i) => rect(s, { x: cx[i], y, w, h: lh }, 0.25));
    if (!it) continue;
    cell(s, { x: cx[0], y, w: cols[0], h: lh }, String(r + 1), 3, 'middle');
    cell(s, { x: cx[2], y, w: cols[2], h: lh }, it.label, 2.9);
    const ls = wrap(FORM_NOTES[r] ?? '', 1.9, cols[3] - 3, 2);
    ls.forEach((l, i) => text(s, cx[3] + 1.5, y + (ls.length === 1 ? lh / 2 + 0.7 : 2.6 + i * 2.5), l, 1.9));
  }
  const oy = t0 + hh + 16 * lh + 4;
  boxCell(s, { x: X, y: oy, w: W, h: 6 }, 'その他特記事項', 3); rect(s, { x: X, y: oy + 6, w: W, h: 22 }, 0.25);
  const dy = oy + 32;
  ([['決　裁　通　知　日', dy], ['穿　　　　孔', dy + 7]] as const).forEach(([k, y]) => {
    boxCell(s, { x: X, y, w: 40, h: 7 }, k, 3); boxCell(s, { x: X + 40, y, w: 60, h: 7 }, '令和　　年　　月　　日　　曜日', 3); rect(s, { x: X + 100, y, w: 40, h: 7 }, 0.25);
  });
  return s;
}

/** チェック表の備考の欄（様式に印刷されている文言。行 1〜14） */
const FORM_NOTES: (string | undefined)[] = [
  undefined, undefined, '現場で記入できるよう図記されていること。構造物（汚水桝、グレーチング等）を記入する', undefined, undefined,
  '直結の場合（タンクの場合は計画水量をもとに口径計算書提出。口径は1カ月当たりの使用水量参照）',
  '※無指定区域は工事届。様式第６号 給水装置工事申請書及び設計書に記入しその解る写し', '建築図面を使用（レベル、境界線等の確認できるもの）',
  '様式第６号 給水装置工事申請書及び設計書に記入しその解る写し', '様式第６号 給水装置工事申請書及び設計書に記入しその解る写し', undefined, '※貯水槽がある場合',
];
const DRILL = ['添付書類が整っているか？　日付は記入されているか？', 'メータ位置は適切か？（植栽や車庫等により検針の支障にならないこと）', '本管の管種と口径は一致しているか？', '国道・県道・距離が長い（　　m以上）・本管が耐震管の場合はPE管', '水理計算は0.2Mpaで計算しているが、そもそも現地水圧が大丈夫か？', '私有地ではないか？（私有地の場合は、承諾書・地役権）', 'φ40以上の受水槽の場合は、定流量弁を設置すること。', '月使用量がメータの適正範囲内であるか？', '有機溶剤等を取り扱う店舗の場合は、樹脂製品はＮＧ', '瞬間湯沸かし器（ガス給湯器）を使用する場合は、ＨＴの使用はＮＧ'];
function drillSheet(): Sheet {
  const s = A4();
  text(s, 25, 32, '穿孔時書類確認', 3.6);
  DRILL.forEach((t, i) => { s.ops.push({ t: 'rect', x: 38, y: 37.6 + i * 6.5, w: 2.8, h: 2.8, lw: 0.25 }); label(s, 43, 40.3 + i * 6.5, t, 3.2, 150); });
  return s;
}

// --- 2. 給水申込書＋委任状 ---
function applicationSheet(v: ApplicationValues, c: Contractor, map: Sheet | undefined): Sheet {
  const s = A4();
  text(s, 15, 14, '様式第7号（第20条関係）', 2.8);
  rect(s, { x: 15, y: 17, w: 180, h: 275 }, 0.4);
  text(s, 105, 29, '給　水　申　込　書', 6.5, { anchor: 'middle' });
  text(s, 188, 37, `申請日 ${jd(v.date)}`, 3, { anchor: 'end' });
  text(s, 20, 44, '南部水道企業団　企業長　様', 3.6);
  let x = choices(s, 23, 50, ['南部水道企業団水道事業給水条例第５条の規定により給水装置（'], undefined, 3, 1.4);
  x = choices(s, x, 50, NANBU_WORK_KINDS, v.workKind, 3, 2);
  text(s, x, 50, '）申込み', 3);
  text(s, 20, 55, 'しますので承認願います。', 3);
  // 表
  const X = 20, rh = 7, y0 = 58, L1 = 22, V1 = 70, L2 = 22, V2 = 56;
  const xV1 = X + L1, xL2 = xV1 + V1, xV2 = xL2 + L2;
  const row = (i: number, l1: string, v1: string | ((b: Box) => void), l2: string, v2: string) => {
    const y = y0 + i * rh;
    boxCell(s, { x: X, y, w: L1, h: rh }, l1, 3);
    const b = { x: xV1, y, w: V1, h: rh };
    rect(s, b, 0.25);
    if (typeof v1 === 'string') cell(s, b, v1, 3); else v1(b);
    boxCell(s, { x: xL2, y, w: L2, h: rh }, l2, 3);
    boxCell(s, { x: xV2, y, w: V2, h: rh }, v2, 3, v2.startsWith('令和') || v2.endsWith('mm') ? 'middle' : 'start');
  };
  row(0, '水 道 番 号', '', '検針区域', '道順');
  row(1, '種　　別', (b) => choices(s, b.x + 1.5, b.y + 4.9, NANBU_SUPPLY_KINDS, v.supplyKind, 2.8), 'メーター口径', `${v.diameter || '　　'} mm`);
  row(2, '用 途 別', (b) => choices(s, b.x + 1.5, b.y + 4.9, NANBU_USE_KINDS, v.useKind, 2.8), 'メーター番号', '');
  row(3, '設 置 場 所', v.siteAddress ?? '', '取　　付', '令和　　年　　月　　日');
  row(4, 'ビル等名称', v.buildingName ?? '', '工 事 完 成', '令和　　年　　月　　日');
  // 使用者・所有者
  const u = userOf(v);
  const who = (top: number, title: string, p: { address: string; kana: string; name: string; tel: string }) => {
    boxCell(s, { x: X, y: top, w: 7, h: rh * 3 }, '', 3);
    [...title].forEach((ch, i) => text(s, X + 3.5, top + 6 + i * 6.5, ch, 3, { anchor: 'middle' }));
    (['住　所', 'フリガナ', '氏　名'] as const).forEach((k, i) => boxCell(s, { x: X + 7, y: top + i * rh, w: 15, h: rh }, k, 2.8));
    boxCell(s, { x: xV1, y: top, w: V1, h: rh }, p.address, 2.8, 'start');
    boxCell(s, { x: xV1, y: top + rh, w: V1 - 20, h: rh }, p.kana, 2.6, 'start');
    boxCell(s, { x: xV1, y: top + rh * 2, w: V1 - 20, h: rh }, p.name, 3, 'start');
    rect(s, { x: xL2 - 20, y: top + rh, w: 20, h: rh * 2 }, 0.25);
    text(s, xL2 - 18.5, top + rh + 4.6, 'TEL', 2.8);
    label(s, xL2 - 19, top + rh * 2 + 4.7, p.tel, 2.8, 18);
  };
  who(y0 + rh * 5, '使用者', u);
  who(y0 + rh * 8, '所有者', { address: v.ownerAddress ?? '', kana: v.ownerKana ?? '', name: v.ownerName ?? '', tel: v.ownerTel ?? '' });
  boxCell(s, { x: xL2, y: y0 + rh * 5, w: L2, h: rh * 3 }, '臨時用メーター', 2.6);
  rect(s, { x: xV2, y: y0 + rh * 5, w: V2, h: rh * 3 }, 0.25);
  text(s, xV2 + 2, y0 + rh * 5 + 5, '・満　期', 2.8); text(s, xV2 + 2, y0 + rh * 6 + 6, '取 付 指 数', 2.8); text(s, xV2 + V2 - 2, y0 + rh * 6 + 6, 'm³', 2.8, { anchor: 'end' });
  boxCell(s, { x: xL2, y: y0 + rh * 8, w: L2, h: rh * 3 }, '受付情報', 3);
  rect(s, { x: xV2, y: y0 + rh * 8, w: V2, h: rh * 3 }, 0.25);
  text(s, xV2 + 2, y0 + rh * 9 + 4.5, '受 付 者', 2.8);
  // 委任状
  const iy = y0 + rh * 11 + 9;
  text(s, 105, iy, '委　　任　　状', 6, { anchor: 'middle' });
  text(s, 20, iy + 8, '上記の給水申込みに関する一切の事項を下記の指定工事事業者に委任します。', 3.2);
  text(s, 40, iy + 15, '委任者　住　所', 3.2); label(s, 66, iy + 15, zipAddr(v.ownerZip, v.ownerAddress), 3, 120);
  text(s, 53, iy + 22, '氏　名', 3.2); label(s, 66, iy + 22, v.ownerName ?? '', 3.4, 100); text(s, 185, iy + 22, '印', 3.2, { anchor: 'end', color: GRAY });
  const ky = iy + 26, kh = 6.5;
  rect(s, { x: 20, y: ky, w: 170, h: kh * 3 }, 0.3);
  ([['指定工事事業者', c.name], ['及び代表者', c.representative], ['住　　所', c.address]] as const).forEach(([k, val], i) => {
    label(s, 22, ky + kh * i + 4.6, k, 3, 24); label(s, 50, ky + kh * i + 4.6, val, 3, i === 2 ? 70 : 90);
  });
  vline(s, 48, ky, ky + kh * 3);
  text(s, 142, ky + 4.6, 'TEL', 3); label(s, 150, ky + 4.6, c.tel, 3, 38);
  text(s, 186, ky + kh + 4.6, '印', 3, { anchor: 'end', color: GRAY });
  text(s, 122, ky + kh * 2 + 4.6, '指定工事事業者証交付番号', 2.6); label(s, 154, ky + kh * 2 + 4.6, c.licenseNo, 3, 34);
  mapBox(s, { x: 20, y: ky + kh * 3 + 4, w: 170, h: 262 - (ky + kh * 3 + 4) }, map);
  // 企業団の欄
  const oy = 265;
  ['現　確', '承　認', '入　力'].forEach((k, i) => { boxCell(s, { x: 20 + i * 16, y: oy, w: 16, h: 5 }, k, 2.6); rect(s, { x: 20 + i * 16, y: oy + 5, w: 16, h: 13 }, 0.25); });
  ['企業長', '次　長', '技術管理者', '課　長', '班　長', '係', '受　付'].forEach((k, i) => { boxCell(s, { x: 85 + i * 15, y: oy, w: 15, h: 5 }, k, 2.3); rect(s, { x: 85 + i * 15, y: oy + 5, w: 15, h: 13 }, 0.25); });
  text(s, 20, 288, '※太線の中だけ記入して下さい。', 2.8);
  return s;
}

// --- 3. 臨時用給水に関する誓約書 ---
const PLEDGE = [
  '水道使用者の名義は、建築工事請負者または興行用等の代表者とすること。',
  '水道料金は、使用者が責任を持って支払いするものとする。',
  '水道料金の支払いが滞った時は申請者が責任を持って精算するものとする。',
  '申請者は常に水道料金の支払い及び使用状況等を把握し、企業団との連絡を密にすること。',
  '使用後の施設の撤去は、使用者と申請者が責任をもって指定工事事業者に施工させるものとする。',
  '企業団の承認を受けないで用途変更はできないものとする。',
  '臨時メーターの設置場所は、検針業務に支障のない様に常に管理するものとする。',
  '臨時給水の水道料金は、毎月検針により算出した料金を「納付書」又は「口座振替」により納付するものとする。',
  '臨時給水を中止する場合は、臨時メーターの引上げ指数を係が確認した後、その指示に従い企業団窓口において水道料金の精算手続きを行うものとする。',
];
function pledgeSheet(v: ApplicationValues, c: Contractor): Sheet {
  const s = A4();
  text(s, 105, 28, '臨時用給水に関する誓約書（建築工事用・興行用等）', 5, { anchor: 'middle' });
  text(s, 22, 44, '設　置　場　所', 3.4); label(s, 52, 44, v.siteAddress ?? '', 3.4, 140); hline(s, 50, 192, 45.5);
  text(s, 22, 54, `使用期間、許可日から ${jd(v.tempUntil)}まで（但し更新した場合は、その更新期間に準ずる）`, 3.2);
  let y = 63;
  for (const l of wrap('上記の臨時給水申込みに際して、申請者と使用者は、下記事項を遵守する事を誓約します。なお、下記事項を遵守しない場合は、南部水道企業団水道事業給水条例による処分を受けても異議申し立ていたしません。', 3.2, 168, 4)) { text(s, 22, y, l, 3.2); y += 5; }
  text(s, 105, y + 5, '記', 3.4, { anchor: 'middle' });
  y += 13;
  PLEDGE.forEach((p, i) => {
    const ls = wrap(p, 3, 158, 3);
    text(s, 24, y, `${i + 1}．`, 3);
    ls.forEach((l, k) => text(s, 31, y + k * 4.6, l, 3));
    y += ls.length * 4.6 + 2.2;
  });
  y += 4;
  for (const l of wrap('※上記誓約事項を履行する証として、申請者と使用者は、この誓約書の写しを各々１部を所持します。', 3, 168, 2)) { text(s, 22, y, l, 3); y += 4.6; }
  y += 6;
  text(s, 188, y, jd(v.date), 3.2, { anchor: 'end' });
  text(s, 22, y + 8, '南部水道企業団　企業長　様', 3.4);
  const u = userOf(v);
  /** 署名欄（実物は 申請者（施主）・使用者・指定工事事業者 の 3 つ） */
  const party = (top: number, who: string, sub: string, rows: [string, string][]) => {
    text(s, 62, top, who, 3.2); if (sub) text(s, 62, top + 4.5, sub, 2.6, { color: GRAY });
    rows.forEach(([k, val], i) => { text(s, 100, top + i * 6.5, k, 3); label(s, 114, top + i * 6.5, val, 3, 72); });
    text(s, 190, top + (rows.length - 1) * 6.5, '印', 3, { anchor: 'end', color: GRAY });
  };
  party(y + 16, '申　請　者', '（施主）', [['住　所', zipAddr(v.ownerZip, v.ownerAddress)], ['氏　名', v.ownerName ?? '']]);
  party(y + 34, '使　用　者', '', [['所在地', u.address], ['社　名', u.name], ['代表者', (v.userSame ?? '同じ') === '別' ? v.userRep ?? '' : '']]);
  party(y + 58, '指定工事事業者', '', [['所在地', c.address], ['社　名', c.name], ['代表者', c.representative]]);
  return s;
}

// --- 4. 給水装置工事申請書及び設計書（様式第6号） ---
function designSheet(v: ApplicationValues, c: Contractor, map: Sheet | undefined): Sheet {
  const s = A4();
  text(s, 12, 13, '様式第6号（第6条関係）', 2.8);
  text(s, 105, 22, '給水装置工事申請書及び設計書', 6, { anchor: 'middle' });
  const X = 12, R = 198;
  rect(s, { x: X, y: 26, w: R - X, h: 263 }, 0.4);
  // 審査
  let y = 26;
  boxCell(s, { x: X, y, w: 7, h: 20 }, '', 3); text(s, X + 3.5, y + 8, '審', 3, { anchor: 'middle' }); text(s, X + 3.5, y + 15, '査', 3, { anchor: 'middle' });
  ['技術管理者', '課　長', '班　長', '係', '受　付'].forEach((k, i) => { boxCell(s, { x: X + 7 + i * 14, y, w: 14, h: 5 }, k, 2.2); rect(s, { x: X + 7 + i * 14, y: y + 5, w: 14, h: 15 }, 0.25); });
  boxCell(s, { x: 89, y, w: 7, h: 20 }, '', 3); text(s, 92.5, y + 8, '用', 3, { anchor: 'middle' }); text(s, 92.5, y + 15, '途', 3, { anchor: 'middle' });
  rect(s, { x: 96, y, w: 34, h: 20 }, 0.25);
  choicesV(s, 98, y + 5.5, ['一般用', '連合用・高層用', '臨時用'], v.useKind === '連合用' || v.useKind === '高層用' ? '連合用・高層用' : v.useKind, 2.8, 6);
  boxCell(s, { x: 130, y, w: 7, h: 20 }, '', 3); text(s, 133.5, y + 8, '種', 3, { anchor: 'middle' }); text(s, 133.5, y + 15, '別', 3, { anchor: 'middle' });
  rect(s, { x: 137, y, w: 30, h: 20 }, 0.25);
  choicesV(s, 139, y + 5.5, NANBU_SUPPLY_KINDS, v.supplyKind, 2.8, 6);
  rect(s, { x: 167, y, w: R - 167, h: 20 }, 0.25); text(s, 182.5, y + 4, '復　活　印', 2.4, { anchor: 'middle', color: GRAY });
  // 調定
  y += 20;
  boxCell(s, { x: X, y, w: 7, h: 13 }, '', 3); text(s, X + 3.5, y + 5, '調', 3, { anchor: 'middle' }); text(s, X + 3.5, y + 11, '定', 3, { anchor: 'middle' });
  boxCell(s, { x: X + 7, y, w: 18, h: 6.5 }, '水道番号', 2.6); boxCell(s, { x: X + 25, y, w: 45, h: 6.5 }, '－　　　　－', 2.8);
  boxCell(s, { x: X + 7, y: y + 6.5, w: 18, h: 6.5 }, '調定入力', 2.6); rect(s, { x: X + 25, y: y + 6.5, w: 45, h: 6.5 }, 0.25);
  boxCell(s, { x: X + 70, y, w: 7, h: 13 }, '係', 2.8);
  rect(s, { x: 89, y, w: 78, h: 13 }, 0.25);
  const hi = v.buildingUse;
  choices(s, 91, y + 5, ['高層専用（ ）', '連合専用（ ）'], undefined, 2.5, 3);
  choices(s, 91, y + 10.5, NANBU_BUILDING_USES_FORM.map((b) => `${b}（ ）`), hi ? `${hi}（ ）` : undefined, 2.5, 2.2);
  rect(s, { x: 167, y, w: R - 167, h: 13 }, 0.25);
  text(s, 169, y + 4, '排水放流先', 2.6);
  choicesV(s, 169, y + 8, ['公共下水道', '浄化槽'], v.drainTo, 2.4, 3.6);
  // 受付・検査・完成 / 納入金
  y += 13;
  ([['受　　付', `番号第　　　　号`], ['', '令和　　年　　月　　日'], ['検　　査', '令和　　年　　月　　日'], ['完　　成', '令和　　年　　月　　日']] as const).forEach(([k, val], i) => {
    boxCell(s, { x: X, y: y + i * 5.5, w: 18, h: 5.5 }, k, 2.6); boxCell(s, { x: X + 18, y: y + i * 5.5, w: 59, h: 5.5 }, val, 2.6);
  });
  boxCell(s, { x: 89, y, w: 7, h: 22 }, '', 3); ['納', '入', '金'].forEach((ch, i) => text(s, 92.5, y + 6 + i * 6, ch, 3, { anchor: 'middle' }));
  [['加　入　金', 96, 34], ['設計審査手数料', 130, 34], ['工事検査手数料', 164, R - 164]].forEach(([k, x, w]) => { boxCell(s, { x: x as number, y, w: w as number, h: 5.5 }, k as string, 2.5); rect(s, { x: x as number, y: y + 5.5, w: w as number, h: 16.5 }, 0.25); text(s, (x as number) + (w as number) - 1.5, y + 20, '円', 2.6, { anchor: 'end' }); });
  text(s, 98, y + 10.5, `口径 ${v.diameter || '　　'} mm`, 2.8);
  // メーター / 水道の種類
  y += 22;
  boxCell(s, { x: X, y, w: 7, h: 14 }, '', 3); text(s, X + 3.5, y + 6, 'メ', 2.6, { anchor: 'middle' }); text(s, X + 3.5, y + 11, 'ー', 2.6, { anchor: 'middle' });
  rect(s, { x: X + 7, y, w: 70, h: 14 }, 0.25);
  text(s, X + 10, y + 4.2, '満期', 2.6); text(s, X + 10, y + 8.5, '指数', 2.6); text(s, X + 74, y + 8.5, 'm³', 2.6, { anchor: 'end' }); text(s, X + 10, y + 12.8, 'No.', 2.6);
  boxCell(s, { x: 89, y, w: 52, h: 5 }, '水　道　の　種　類', 2.6); rect(s, { x: 89, y: y + 5, w: 52, h: 9 }, 0.25);
  text(s, 91, y + 9, '・簡専水　・小規模貯水槽', 2.5); text(s, 91, y + 13, '・雨　水　・飲用井戸', 2.5);
  ['受水槽', '高置水槽', '地下水', '雨水'].forEach((k, i) => { boxCell(s, { x: 141 + i * 14.25, y, w: 14.25, h: 5 }, k, 2.3); rect(s, { x: 141 + i * 14.25, y: y + 5, w: 14.25, h: 9 }, 0.25); });
  // 申請
  y += 14;
  const AY = y, AH = 46, LW = 112;
  rect(s, { x: X, y: AY, w: LW, h: AH }, 0.3); rect(s, { x: X + LW, y: AY, w: R - X - LW, h: AH }, 0.3);
  text(s, X + 5, AY + 6, '南部水道企業団　企業長　様', 3.2);
  wrap('南部水道企業団水道事業給水条例を遵守し、給水装置工事に関する一切の事項を下記の指定工事事業者に委任し、工事の申請をします。', 2.8, LW - 10, 3).forEach((l, i) => text(s, X + 6, AY + 12 + i * 4, l, 2.8));
  const rowsA: [string, string, number][] = [['住　　所', zipAddr(v.ownerZip, v.ownerAddress), 2.8], ['フリガナ', v.ownerKana ?? '', 2.6], ['氏　　名', v.ownerName ?? '', 3.2], ['Ｔ Ｅ Ｌ', v.ownerTel ?? '', 2.8]];
  rowsA.forEach(([k, val, sz], i) => { text(s, X + 6, AY + 27 + i * 5, k, 2.8); label(s, X + 24, AY + 27 + i * 5, val, sz, LW - 34); });
  text(s, X + LW - 3, AY + 37, '印', 2.8, { anchor: 'end', color: GRAY });
  ['申', '請', '者'].forEach((ch, i) => text(s, X + 2.6, AY + 14 + i * 9, ch, 2.8, { anchor: 'middle' }));
  const RX = X + LW + 2, RW = R - X - LW - 4;
  text(s, RX, AY + 5, '申請のあった給水装置工事を承認する。', 2.7);
  text(s, RX + 4, AY + 10, '南部水道企業団　企業長', 2.7); text(s, R - 3, AY + 14, '印', 2.8, { anchor: 'end', color: GRAY });
  hline(s, X + LW, R, AY + 16);
  const site = splitSite(v.siteAddress ?? '');
  text(s, RX, AY + 22, '設置場所', 2.8);
  label(s, RX + 14, AY + 22, site.town ? `${site.town} 町 字` : '', 2.8, 15);
  const azaLines = wrap(site.aza, 2.4, RW - (site.town ? 30 : 14), 2);
  azaLines.forEach((l, i) => text(s, RX + (site.town ? 30 : 14), AY + (azaLines.length === 1 ? 22 : 20 + i * 3.2), l, 2.4));
  hline(s, X + LW, R, AY + 25);
  const u = userOf(v);
  ([['フリガナ', u.kana, 2.4], ['使用者名', u.name, 2.9], ['Ｔ Ｅ Ｌ', u.tel, 2.8]] as const).forEach(([k, val, sz], i) => {
    text(s, RX, AY + 30 + i * 6.5, k, 2.8); label(s, RX + 14, AY + 30 + i * 6.5, val, sz, RW - 18);
    if (i < 2) hline(s, X + LW, R, AY + 32 + i * 6.5);
  });
  text(s, R - 3, AY + 36.5, '印', 2.8, { anchor: 'end', color: GRAY });
  // 指定工事事業者・主任技術者
  y = AY + AH;
  rect(s, { x: X, y, w: LW, h: 21 }, 0.3); rect(s, { x: X + LW, y, w: R - X - LW, h: 21 }, 0.3);
  ([['指定工事事業者', c.name], ['代表者名', c.representative], ['住　　所', c.address], ['Ｔ Ｅ Ｌ', c.tel]] as const).forEach(([k, val], i) => { label(s, X + 2, y + 4.5 + i * 4.8, k, 2.8, 22); label(s, X + 26, y + 4.5 + i * 4.8, val, 2.8, LW - 34); });
  text(s, X + LW - 3, y + 9.3, '印', 2.8, { anchor: 'end', color: GRAY });
  text(s, RX, y + 7, '主任技術者', 2.8); label(s, RX + 18, y + 7, dai(c.chiefEngineerNo), 2.8, RW - 18);
  text(s, RX, y + 15, '氏　名', 2.8); label(s, RX + 12, y + 15, c.chiefEngineer, 3, RW - 20); text(s, R - 3, y + 15, '印', 2.8, { anchor: 'end', color: GRAY });
  // 見取図
  y += 21;
  const by = 289 - 26;
  mapBox(s, { x: X, y, w: R - X, h: by - y }, map);
  // 下の表
  const rh = 6.5, cw = [26, 34, 22, 38, 20, R - X - 140];
  const cxs = cw.map((_, i) => X + cw.slice(0, i).reduce((a, b) => a + b, 0));
  const put = (r: number, i: number, str: string, sz = 2.6, span = 1) => { const w = cw.slice(i, i + span).reduce((a, b) => a + b, 0); boxCell(s, { x: cxs[i], y: by + r * rh, w, h: rh }, str, sz); };
  put(0, 0, '道路占用許可番号'); put(0, 1, dai(v.roadOccNo), 2.6); put(0, 2, '確認通知番号'); put(0, 3, dai(v.confirmNo), 2.6); put(0, 4, '年月日'); put(0, 5, jd(v.confirmDate), 2.4);
  put(1, 0, '許可年月日'); put(1, 1, jd(v.roadOccDate), 2.4); put(1, 2, '建築物'); put(1, 3, `延面積 ${v.totalArea || '　　'} ㎡`); put(1, 4, `地上 ${v.floorsAbove || '　'} 階`); put(1, 5, `地下 ${v.floorsBelow || '　'} 階　${v.structure ?? ''}`);
  put(2, 0, '道路使用許可番号'); put(2, 1, dai(v.roadUseNo), 2.6); put(2, 2, '旧収納番号'); put(2, 3, '冊　番号'); put(2, 4, '廃栓の確認'); put(2, 5, '譲渡幹線番号');
  put(3, 0, '許可年月日'); put(3, 1, jd(v.roadUseDate), 2.4); put(3, 2, ''); put(3, 3, ''); put(3, 4, '済・不明'); put(3, 5, 'No.');
  return s;
}
const NANBU_BUILDING_USES_FORM = ['住宅', '店舗', 'アパート', '事務所', 'その他'];

// --- 5. 横断面図・オフセット ---
function crossSheet(v: ApplicationValues, road: Sheet | undefined): Sheet {
  const s = A4();
  rect(s, { x: 15, y: 12, w: 180, h: 272 }, 0.4);
  text(s, 22, 21, '横　断　面　図', 3.4);
  if (road) insetSheet(s, road, { x: 0, y: 0, w: road.width, h: road.height }, { x: 20, y: 25, w: 170, h: 150 });
  else text(s, 105, 100, '（道路の手続きで掘る大きさ・本管の位置を入れると横断図が入ります）', 2.8, { anchor: 'middle', color: GRAY });
  hline(s, 15, 195, 182, 0.2);
  text(s, 22, 191, 'オ　フ　セ　ッ　ト', 3.4);
  const offs = (v.offsets ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (offs.length) offs.slice(0, 12).forEach((l, i) => label(s, 28, 200 + i * 6.5, l, 3.4, 160));
  else wrap('引込みの分岐点を、動かない構造物（電柱・汚水桝・グレーチング等）からの距離で記入する。現場で記入できるよう図記されていること', 2.8, 160, 2).forEach((l, i) => text(s, 28, 200 + i * 4.5, l, 2.8, { color: GRAY }));
  return s;
}

// --- 6. 竣工検査項目 ---
const INSPECT = ['止水栓及び副弁の位置がメーターカバーの枠に覆われていないか。', 'メーターの逆取付け、片寄り、シモクの伸びが点検取替作業に支障はないか。', '給水引込分岐点のオフセット寸法が竣工図面と整合するか。', '給水管の配管位置、管種、口径及び延長が竣工図面と整合するか。', '給水装置のクロスコネクション点検', '給水装置の残留塩素及び水圧測定　　残留塩素　　　PPM　水圧　　　MPa', '本舗装の確認', '給水装置の材質が指定どおり使用されているか。', '危険防止措置がとられているか。', 'その他（　　　　　　　　　　　　　　　　）'];
const SUBMIT = ['道路占用許可書の写しの提出', '道路使用許可書の写しの提出', '道路占用工事完了届の写しの提出', '建築確認済証の写しの提出', '給水引込み工事写真の提出', '小規模貯水槽水道設置届出書の提出', '利害関係人の同意書及び条件承諾書の提出'];
function inspectSheet(): Sheet {
  const s = A4();
  const list = (title: string, items: string[], y0: number) => {
    text(s, 25, y0, title, 4.2);
    items.forEach((t, i) => {
      const y = y0 + 9 + i * 11;
      label(s, 28, y, `${i + 1}．${t}`, 3.2, 150);
      text(s, 34, y + 5, '備　考（　　　　　　　　　　　　　　　　　　　　　　）', 3, { color: GRAY });
      text(s, 188, y, String(i + 1), 2.6, { anchor: 'end', color: GRAY });
    });
    return y0 + 9 + items.length * 11;
  };
  const y = list('竣工検査項目', INSPECT, 22);
  list('提出書類項目', SUBMIT, y + 6);
  return s;
}

export function nanbuSheets(v: ApplicationValues, c: Contractor, o: NanbuSheetOpts): Sheet[] {
  const temp = (v.tempSupply ?? '有り') === '有り';
  return [
    checkSheet(v, c), drillSheet(),
    applicationSheet(v, c, o.map),
    ...(temp ? [pledgeSheet(v, c)] : []),
    designSheet(v, c, o.map),
    crossSheet(v, o.roadSection),
    inspectSheet(),
    ...o.products,
  ];
}
