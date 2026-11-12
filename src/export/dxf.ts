/**
 * 申請図面（Sheet）を DXF に書き出す。R12（AC1009）・Shift_JIS（$DWGCODEPAGE ANSI_932）。AutoCAD・Jw_cad で開ける形。
 * 単位は用紙の mm。Sheet は y 下向きなので上向きに直す。複数ページは横に 20mm あけて並べる。
 * 画像（見取図の地図）は DXF に入れられないので入れない（知らせる）。
 */
import { encodeSjis } from '../import/sjis';
import type { Op, Sheet } from './sheet';

const GAP = 20;
/** AutoCAD の色番号（ACI）と近い色 */
const ACI: [number, number, number, number][] = [
  [1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 160, 0], [4, 0, 200, 200], [5, 0, 0, 255], [6, 255, 0, 255], [7, 0, 0, 0], [8, 128, 128, 128], [9, 192, 192, 192], [30, 255, 127, 0], [34, 128, 64, 0],
];
function aci(hex: string | undefined): number {
  const m = hex && /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 7;
  const v = parseInt(m[1], 16), r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  let best = 7, bd = Infinity;
  for (const [n, R, G, B] of ACI) { const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
}
const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

export function sheetsToDxf(sheets: Sheet[]): { bytes: Uint8Array; notes: string[]; missing: Set<string> } {
  const out: string[] = [];
  const g = (code: number, v: string | number) => { out.push(String(code), typeof v === 'number' ? f(v) : v); };
  let images = 0;

  // ヘッダ・表（線種・画層・文字スタイル）
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$DWGCODEPAGE'); g(3, 'ANSI_932'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, '2');
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, '0'); g(3, 'Solid line'); g(72, '65'); g(73, '0'); g(40, 0);
  g(0, 'LTYPE'); g(2, 'DASHED'); g(70, '0'); g(3, '__ __ __'); g(72, '65'); g(73, '2'); g(40, 3); g(49, 2); g(49, -1);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, '1'); g(0, 'LAYER'); g(2, '0'); g(70, '0'); g(62, '7'); g(6, 'CONTINUOUS'); g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, '1'); g(0, 'STYLE'); g(2, 'STANDARD'); g(70, '0'); g(40, 0); g(41, 1); g(50, 0); g(71, '0'); g(42, 2.5); g(3, 'txt'); g(4, ''); g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  let ox = 0;
  for (const sh of sheets) {
    const X = (x: number) => ox + x, Y = (y: number) => sh.height - y;
    const head = (type: string, color?: string, dash?: boolean) => { g(0, type); g(8, '0'); g(62, String(aci(color))); if (dash) g(6, 'DASHED'); };
    const poly = (pts: [number, number][], closed: boolean, color?: string, dash?: boolean) => {
      head('POLYLINE', color, dash); g(66, '1'); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? '1' : '0');
      for (const [x, y] of pts) { g(0, 'VERTEX'); g(8, '0'); g(10, X(x)); g(20, Y(y)); g(30, 0); }
      g(0, 'SEQEND'); g(8, '0');
    };
    for (const o of sh.ops as Op[]) {
      switch (o.t) {
        case 'line': head('LINE', o.color, o.dash); g(10, X(o.x1)); g(20, Y(o.y1)); g(30, 0); g(11, X(o.x2)); g(21, Y(o.y2)); g(31, 0); break;
        case 'poly': poly(o.pts, !!o.close, o.color); break;
        case 'rect': poly([[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]], true, o.stroke); break;
        case 'circle': head('CIRCLE', o.stroke); g(10, X(o.cx)); g(20, Y(o.cy)); g(30, 0); g(40, o.r); break;
        case 'text': {
          if (!o.s.trim()) break;
          // 文字の高さ（DXF は大文字の高さ）は字の大きさの 0.8。回転は y を上向きにしたので向きが逆
          head('TEXT', o.color); g(10, X(o.x)); g(20, Y(o.y)); g(30, 0); g(40, o.size * 0.8); g(1, o.s);
          if (o.rotate) g(50, -o.rotate);
          const h = o.anchor === 'middle' ? 1 : o.anchor === 'end' ? 2 : 0;
          if (h) { g(72, String(h)); g(11, X(o.x)); g(21, Y(o.y)); g(31, 0); }
          break;
        }
        case 'image': images++; break;
      }
    }
    ox += sh.width + GAP;
  }
  g(0, 'ENDSEC'); g(0, 'EOF');

  const missing = new Set<string>();
  const bytes = encodeSjis(out.join('\r\n') + '\r\n', missing);
  const notes = images ? ['地図などの画像は DXF に入れられないため、入っていません（枠と文字だけ）'] : [];
  return { bytes, notes, missing };
}
