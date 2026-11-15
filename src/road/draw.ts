/** 道路の書類で使う描画の小道具（用紙 mm）。文字は欄の幅で折り返し、入らなければ … で切る */
import { textWidth } from '../export/labelLayout';
import { GRAY, INK, type Sheet } from '../export/sheet';
import { reiwa } from '../forms/types';

export type RoadMeta = { siteName: string; address: string; date: Date };

/** 幅 maxW に収まるように折り返す（maxLines を超えたら最後の行を … で切る） */
export function wrap(s: string, size: number, maxW: number, maxLines = 3): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let cur = '';
    for (const ch of [...para]) {
      if (cur && textWidth(cur + ch, size) > maxW) {
        // 英数字の続き（200mm・HIVP など）は途中で切らず、まとめて次の行へ
        const m = /[A-Za-z0-9.φ]+$/.exec(cur);
        if (/[A-Za-z0-9.]/.test(ch) && m && m.index > 0) { out.push(cur.slice(0, m.index)); cur = m[0] + ch; }
        else { out.push(cur); cur = ch; }
      } else cur += ch;
    }
    out.push(cur);
  }
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && textWidth(last + '…', size) > maxW) last = [...last].slice(0, -1).join('');
    kept[maxLines - 1] = last + '…';
    return kept;
  }
  return out;
}

/** 文字を置く（size で 1 行、幅を超えたら縮め、それでも入らなければ … で切る） */
export function label(sheet: Sheet, x: number, y: number, s: string, size: number, maxW: number, o: { anchor?: 'start' | 'middle' | 'end'; color?: string; bold?: boolean; min?: number } = {}): void {
  if (!s) return;
  let sz = size;
  const min = o.min ?? size * 0.75;
  while (sz > min && textWidth(s, sz) > maxW) sz -= 0.1;
  const [line] = wrap(s, sz, maxW, 1);
  sheet.ops.push({ t: 'text', x, y, s: line, size: sz, anchor: o.anchor, color: o.color, bold: o.bold });
}

export type Row = { label: string; value: string; lines?: number };
/**
 * 2 列の表（左: 項目、右: 内容）。値は折り返す（行の高さは lines 行分。既定 1）。
 * 戻り値は表の下端 y
 */
export function table(sheet: Sheet, x: number, y: number, labelW: number, valueW: number, rows: Row[], size = 3.2): number {
  const lh = size * 1.45, pad = 1.8;
  let cy = y;
  for (const r of rows) {
    const n = Math.max(1, r.lines ?? 1);
    const h = n * lh + pad * 2;
    sheet.ops.push({ t: 'rect', x, y: cy, w: labelW, h, lw: 0.3 });
    sheet.ops.push({ t: 'rect', x: x + labelW, y: cy, w: valueW, h, lw: 0.3 });
    const ll = wrap(r.label, size, labelW - 3, 2);
    const ly = cy + h / 2 - ((ll.length - 1) * lh) / 2 + size * 0.35;
    ll.forEach((s, i) => sheet.ops.push({ t: 'text', x: x + labelW / 2, y: ly + i * lh, s, size, anchor: 'middle' }));
    wrap(r.value, size, valueW - 4, n).forEach((s, i) => { if (s) sheet.ops.push({ t: 'text', x: x + labelW + 2, y: cy + pad + size * 0.9 + i * lh, s, size }); });
    cy += h;
  }
  return cy;
}

/** 令和の日付（YYYY-MM-DD）。読めなければ空欄の日付 */
export function jaDate(iso: string | undefined): string {
  const r = iso ? reiwa(iso) : undefined;
  return r ? `令和${r.year}年${r.month}月${r.day}日` : '令和　　年　　月　　日';
}
export const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 申請者のまとまり（右寄せの住所・氏名・担当・電話）。戻り値は下端 y */
export function applicantBlock(sheet: Sheet, y: number, v: Record<string, string>, who = '申請者'): number {
  const x = 100, w = 90, size = 3.2, lh = 5.2;
  sheet.ops.push({ t: 'text', x: x - 2, y, s: who, size, anchor: 'end' });
  const rows: [string, string][] = [['住所', v['road.applicantAddress'] ?? ''], ['氏名', [v['road.applicantName'], v['road.applicantRep']].filter(Boolean).join('　')], ['担当者', v['road.siteManager'] ?? ''], ['電話', v['road.applicantTel'] ?? '']];
  let cy = y;
  for (const [k, val] of rows) {
    sheet.ops.push({ t: 'text', x, y: cy, s: k, size, color: GRAY });
    const lines = wrap(val, size, w - 14, 2);
    lines.forEach((s, i) => { if (s) sheet.ops.push({ t: 'text', x: x + 13, y: cy + i * lh, s, size }); });
    cy += lh * Math.max(1, lines.length);
  }
  return cy;
}

export function title(sheet: Sheet, s: string, y = 30): void {
  sheet.ops.push({ t: 'text', x: sheet.width / 2, y, s, size: 6.5, anchor: 'middle', bold: true });
}

/** 図面の表題欄（右下）: 図名・工事名・作成日 */
export function titleBlock(sheet: Sheet, name: string, m: RoadMeta): void {
  const w = 110, h = 18, x = sheet.width - 10 - w, y = sheet.height - 10 - h;
  sheet.ops.push({ t: 'rect', x, y, w, h, lw: 0.4, fill: '#ffffff' });
  sheet.ops.push({ t: 'line', x1: x, y1: y + 6, x2: x + w, y2: y + 6, w: 0.25 });
  sheet.ops.push({ t: 'line', x1: x, y1: y + 12, x2: x + w, y2: y + 12, w: 0.25 });
  sheet.ops.push({ t: 'line', x1: x + 18, y1: y, x2: x + 18, y2: y + h, w: 0.25 });
  ([['図名', name], ['工事名', m.siteName], ['作成日', `${m.date.getFullYear()}年${m.date.getMonth() + 1}月${m.date.getDate()}日`]] as const).forEach(([k, val], i) => {
    sheet.ops.push({ t: 'text', x: x + 9, y: y + 4.3 + i * 6, s: k, size: 2.8, anchor: 'middle', color: GRAY });
    label(sheet, x + 20, y + 4.3 + i * 6, val, 3, w - 22, { bold: i === 0 });
  });
}

export { GRAY, INK };
