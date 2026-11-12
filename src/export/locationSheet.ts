/**
 * 見取図（案内図）。A4 縦。国土地理院の標準地図の上に、工事場所の印・方位記号・縮尺目盛りを重ねる。
 * 様式の注記「方位、位置及び目標となる地物を表示し、工事施工の位置を明示すること」を満たす形。
 * 文字はすべて LabelPlacer で置き、地図の上の文字には白い下地を敷く。
 */
import { GSI_STD_CREDIT, scaleBarMeters } from '../model/locationMap';
import { around, at, LabelPlacer, textRects, textWidth, type Cand } from './labelLayout';
import { dateJa } from './report';
import { GRAY, INK, RED, type Sheet } from './sheet';

/** 地図の枠（用紙 mm） */
export const MAP_FRAME = { x: 12, y: 40, w: 186, h: 226 } as const;
/** 枠に入れる地図画像の画素数（約 6 画素/mm。枠と同じ縦横比） */
export const MAP_PX = { w: 1116, h: 1356 } as const;

export type LocationMapImage = { href: string; wPx: number; hPx: number; /** m/画素 */ mpp: number };
export type LocationSheetInput = { map: LocationMapImage | null; siteName: string; address: string; date: Date; title?: string };

const L = 12, R = 198;

/** 幅 maxW に収める。まず字を小さく（minSize まで）、それでも長ければ 2 行に折る（2 行目も長ければ … で切る） */
function fitLines(s: string, size: number, minSize: number, maxW: number): { lines: string[]; size: number } {
  for (let sz = size; sz >= minSize - 1e-9; sz -= 0.2) if (textWidth(s, sz) <= maxW) return { lines: [s], size: sz };
  const chars = [...s];
  const take = (from: number) => { let k = from; while (k < chars.length && textWidth(chars.slice(from, k + 1).join(''), minSize) <= maxW) k++; return k; };
  const a = take(0);
  let rest = chars.slice(a).join('');
  if (textWidth(rest, minSize) > maxW) { const r = [...rest]; while (r.length && textWidth(r.join('') + '…', minSize) > maxW) r.pop(); rest = r.join('') + '…'; }
  return { lines: [chars.slice(0, a).join(''), rest], size: minSize };
}

export function renderLocationSheet(input: LocationSheetInput): Sheet {
  const sheet: Sheet = { width: 210, height: 297, ops: [] };
  const P = new LabelPlacer(sheet, { x1: L - 2, y1: 6, x2: R + 2, y2: 291 });
  const put = (c: Cand) => P.place([c]);
  /** 地図の上の札: 白い下地を文字の下に敷く */
  const putOnMap = (cands: Cand[]) => {
    const placed = P.place(cands);
    if (!placed) return;
    const i = sheet.ops.indexOf(placed.texts[0]);
    const bg = placed.texts.flatMap((t) => textRects(t, 0.7)).map((r) => ({ t: 'rect' as const, x: r.x1, y: r.y1, w: r.x2 - r.x1, h: r.y2 - r.y1, fill: '#ffffff', stroke: '#ffffff', lw: 0.1 }));
    sheet.ops.splice(i, 0, ...bg);
  };
  const { map } = input;
  const F = MAP_FRAME;

  // 表題・工事名・工事場所
  put(at(L, 18, { s: input.title ?? '見取図（案内図）', size: 6, bold: true }));
  put(at(R, 18, { s: `作成日: ${dateJa(input.date)}`, size: 3, color: GRAY }, 'end'));
  let y = 25.5;
  for (const [label, value] of [['工事名', input.siteName], ['工事場所', input.address]] as const) {
    const f = fitLines(`${label}: ${value || '（未入力）'}`, 3.4, 2.4, R - L);
    for (const s of f.lines) { put(at(L, y, { s, size: f.size })); y += f.size * 1.35; }
    y += 0.6;
  }

  // 地図
  if (map) sheet.ops.push({ t: 'image', x: F.x, y: F.y, w: F.w, h: F.h, href: map.href });
  sheet.ops.push({ t: 'rect', x: F.x, y: F.y, w: F.w, h: F.h, lw: 0.5, stroke: INK });

  // 方位記号（地図は北が上）
  const nx = F.x + F.w - 12, ny = F.y + 16;
  sheet.ops.push({ t: 'circle', cx: nx, cy: ny, r: 10, fill: '#ffffff', stroke: GRAY, lw: 0.25 });
  sheet.ops.push({ t: 'poly', pts: [[nx, ny - 4], [nx - 3.6, ny + 7], [nx, ny + 4.2], [nx + 3.6, ny + 7]], close: true, fill: INK, color: INK, w: 0.3 });
  P.block({ x1: nx - 10, y1: ny - 10, x2: nx + 10, y2: ny + 10 });
  put(at(nx, ny - 5.2, { s: 'N', size: 3.6, bold: true }, 'middle'));

  if (!map) {
    const cx = F.x + F.w / 2, cy = F.y + F.h / 2;
    put(at(cx, cy - 3, { s: '地図を取得できませんでした', size: 4.2, color: GRAY }, 'middle'));
    put(at(cx, cy + 4, { s: '周辺の道路・目標物と工事場所を書き込んでください', size: 3, color: GRAY }, 'middle'));
    return sheet;
  }

  // 縮尺目盛り（左下、白い下地）
  const mPerMm = (map.mpp * map.wPx) / F.w;
  const m = scaleBarMeters(mPerMm, 40);
  const len = m / mPerMm;
  const bx = F.x + 8, by = F.y + F.h - 8;
  sheet.ops.push({ t: 'rect', x: bx - 4, y: by - 7, w: len + 14, h: 10, fill: '#ffffff', stroke: GRAY, lw: 0.2 });
  sheet.ops.push({ t: 'line', x1: bx, y1: by, x2: bx + len, y2: by, w: 0.8, color: INK });
  for (const tx of [bx, bx + len / 2, bx + len]) sheet.ops.push({ t: 'line', x1: tx, y1: by - 1.6, x2: tx, y2: by + 1.2, w: 0.3, color: INK });
  P.block({ x1: bx - 4, y1: by - 0.5, x2: bx + len + 10, y2: by + 3 });
  put(at(bx, by - 2.6, { s: '0', size: 2.6 }, 'middle'));
  put(at(bx + len, by - 2.6, { s: `${m}m`, size: 2.6 }, 'middle'));

  // 工事場所の印（地図の中心）
  const cx = F.x + F.w / 2, cy = F.y + F.h / 2;
  sheet.ops.push({ t: 'circle', cx, cy, r: 4, stroke: RED, lw: 0.7 });
  sheet.ops.push({ t: 'circle', cx, cy, r: 1.5, fill: RED, stroke: RED, lw: 0.2 });
  P.block({ x1: cx - 4.5, y1: cy - 4.5, x2: cx + 4.5, y2: cy + 4.5 });
  putOnMap(around(cx, cy, [{ s: '工事場所', size: 4.2, color: RED, bold: true }], { gap: 5, prefer: [-45, -135, 45, 135], maxDist: 30 }));

  // 凡例・出典（枠の下）
  put(at(L, F.y + F.h + 5, { s: '◎ 工事場所', size: 2.8, color: RED }));
  put(at(R, F.y + F.h + 5, { s: GSI_STD_CREDIT, size: 2.6, color: GRAY }, 'end'));
  return sheet;
}
