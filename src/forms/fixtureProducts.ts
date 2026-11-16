/**
 * 給水装置使用製品一覧表（南部水道企業団の様式、A4 横）。受理された実物（2026-11-16 入手）は
 * 管・継手ではなく「器具とヘッダー」を書き、メーカー名と認証（日水協検査合格品又は第三者認証品／自己認証品／JIS表示品）に ○ を付けている。
 * 行は図面の器具から作り、メーカー・認証は画面で選ぶ（種類ごとにこの端末に覚える）。
 */
import type { Doc } from '../model/doc';
import type { FixtureType } from '../model/fixtures';
import { drawFrame, GRAY, type Sheet } from '../export/sheet';
import { label } from '../road/draw';
import { reiwa, todayIso, type ApplicationValues, type Contractor } from './types';

export type Cert = 'jwwa' | 'self' | 'jis' | '';
export const CERT_LABEL: Record<Exclude<Cert, ''>, string> = { jwwa: '日水協・第三者認証', self: '自己認証', jis: 'JIS' };
export type FixtureProduct = { key: string; name: string; qty: string; maker: string; cert: Cert };
/** 種類 → メーカー・認証（この端末に覚える） */
export type ProductMemory = Record<string, { maker?: string; cert?: Cert }>;
export const PRODUCT_MEMORY_KEY = 'productMakers';
/** 図に無い製品の行（1 行に「製品名／個数／メーカー」。区切りは ／ / , 、） */
export const EXTRA_KEY = 'product.extra';

type Def = { name: string; unit: '台' | '個'; cert: Cert };
/** 並びも実物どおり（ヘッダー → 便器 → 洗面 → 流し → 給湯器 → シャワー → 洗濯 → 散水栓） */
const DEFS: [FixtureType, Def][] = [
  ['toilet', { name: '洋風大便器', unit: '台', cert: 'jwwa' }],
  ['washbasin', { name: '洗面化粧台', unit: '台', cert: 'jwwa' }],
  ['kitchen', { name: '流し用混合水栓', unit: '個', cert: 'jwwa' }],
  ['waterHeater', { name: '給湯器', unit: '台', cert: 'jwwa' }],
  ['shower', { name: 'シャワー水栓 混合水栓', unit: '個', cert: 'jis' }],
  ['washer', { name: '洗濯用水栓', unit: '個', cert: 'jis' }],
  ['outdoorFaucet', { name: '散水栓', unit: '個', cert: 'jis' }],
  ['mixFaucet', { name: '混合水栓', unit: '個', cert: 'jis' }],
  ['faucet', { name: '水栓', unit: '個', cert: 'jis' }],
  ['pump', { name: 'ポンプ', unit: '台', cert: 'jwwa' }],
];
const isCert = (s: string | undefined): s is Cert => s === 'jwwa' || s === 'self' || s === 'jis' || s === '';

/** ヘッダーの口数（配管がつながった出口の数。1 つもつながっていなければ出口の数） */
function headerPorts(doc: Doc, fixtureId: string): number {
  const ends = new Set(Object.values(doc.network.segments).flatMap((s) => [s.a, s.b]));
  const outs = Object.values(doc.network.nodes).filter((n) => n.fixtureId === fixtureId && n.portId?.startsWith('out'));
  const used = outs.filter((n) => ends.has(n.id)).length;
  return used || outs.length;
}

export function fixtureProducts(doc: Doc, v: ApplicationValues, memory: ProductMemory): FixtureProduct[] {
  const fx = Object.values(doc.fixtures);
  const pick = (key: string, memKey: string, def: Def, qty: string): FixtureProduct => {
    const m = memory[memKey] ?? {};
    const c = v[`product.${key}.cert`];
    return { key, name: def.name, qty, maker: v[`product.${key}.maker`] ?? m.maker ?? '', cert: isCert(c) ? c : m.cert ?? def.cert };
  };
  const rows: FixtureProduct[] = [];
  // ヘッダー（口数ごとに 1 行）
  const headers = new Map<string, { type: FixtureType; n: number; count: number }>();
  for (const f of fx) if (f.type === 'waterHeader' || f.type === 'hotWaterHeader') {
    const n = headerPorts(doc, f.id), k = `${f.type}:${n}`;
    const h = headers.get(k) ?? { type: f.type, n, count: 0 };
    h.count++; headers.set(k, h);
  }
  for (const [k, h] of [...headers].sort((a, b) => (a[1].type === b[1].type ? b[1].n - a[1].n : a[1].type === 'waterHeader' ? -1 : 1))) {
    rows.push(pick(k.replace(':', '.'), h.type, { name: `PB管継手 ヘッダー${h.n}P`, unit: '個', cert: 'jis' }, `${h.count}個`));
  }
  const count = (t: FixtureType) => fx.filter((f) => f.type === t).length;
  for (const [t, def] of DEFS) {
    let n = count(t);
    if (t === 'shower' && n === 0) n = count('bathtub'); // 浴槽だけでもシャワー水栓は付く
    if (n > 0) rows.push(pick(t, t, def, `${n}${def.unit}`));
  }
  // 図に無い製品
  (v[EXTRA_KEY] ?? '').split('\n').map((l) => l.trim()).filter(Boolean).forEach((l, i) => {
    const [name, qty = '', maker = ''] = l.split(/\s*[／/,，、]\s*/);
    const key = `extra${i}`;
    const c = v[`product.${key}.cert`];
    rows.push({ key, name, qty, maker: v[`product.${key}.maker`] ?? maker, cert: isCert(c) ? c : 'jwwa' });
  });
  return rows;
}

const ROWS = 16;
const COLS: { w: number; h: string[] }[] = [
  { w: 11, h: ['番号'] }, { w: 64, h: ['製品名'] }, { w: 22, h: ['個数・延長'] }, { w: 42, h: ['製品メーカー名'] },
  { w: 30, h: ['日水協検査合格品', '又は第三者認証品'] }, { w: 20, h: ['自己認証品'] }, { w: 20, h: ['JIS表示品'] }, { w: 38, h: ['鉛新浸出性能基準適合'] }, { w: 20, h: ['備　考'] },
];
const CERT_COL: Record<Exclude<Cert, ''>, number> = { jwwa: 4, self: 5, jis: 6 };

export function renderNanbuProductSheets(rows: FixtureProduct[], meta: { date: Date }, c: Contractor): Sheet[] {
  const pages = Math.max(1, Math.ceil(rows.length / ROWS));
  const out: Sheet[] = [];
  const d = reiwa(todayIso(meta.date));
  const x0 = 15, top = 30, headH = 10, rowH = 7.2, W = COLS.reduce((a, b) => a + b.w, 0);
  const colX = COLS.map((_, i) => x0 + COLS.slice(0, i).reduce((a, b) => a + b.w, 0));
  for (let pg = 0; pg < pages; pg++) {
    const s: Sheet = { width: 297, height: 210, ops: [] };
    drawFrame(s);
    const ops = s.ops;
    ops.push({ t: 'text', x: x0 + 5, y: 20, s: '給水装置使用製品一覧表', size: 5, bold: true });
    ops.push({ t: 'text', x: x0 + W, y: 26, s: d ? `令和${d.year}年${d.month}月${d.day}日提出` : '令和　年　月　日提出', size: 3.2, anchor: 'end' });
    if (pages > 1) ops.push({ t: 'text', x: x0 + W, y: 19, s: `${pg + 1} / ${pages}`, size: 2.6, anchor: 'end', color: GRAY });
    ops.push({ t: 'rect', x: x0, y: top, w: W, h: headH + rowH * ROWS, lw: 0.4 });
    ops.push({ t: 'line', x1: x0, y1: top + headH, x2: x0 + W, y2: top + headH, w: 0.4 });
    COLS.forEach((col, i) => {
      if (i > 0) ops.push({ t: 'line', x1: colX[i], y1: top, x2: colX[i], y2: top + headH + rowH * ROWS, w: 0.25 });
      col.h.forEach((h, k) => label(s, colX[i] + col.w / 2, top + (col.h.length === 1 ? 6.3 : 4.3 + 3.6 * k), h, col.h.length === 1 ? 3 : 2.3, col.w - 1.5, { anchor: 'middle' }));
    });
    for (let r = 0; r < ROWS; r++) {
      const y = top + headH + rowH * r, ty = y + 4.9;
      if (r > 0) ops.push({ t: 'line', x1: x0, y1: y, x2: x0 + W, y2: y, w: 0.2 });
      const row = rows[pg * ROWS + r];
      ops.push({ t: 'text', x: colX[0] + COLS[0].w / 2, y: ty, s: String(pg * ROWS + r + 1), size: 3, anchor: 'middle' });
      // 鉛新浸出性能基準適合: 「ァ・適合する イ・適合しない」。器具の行は ア に丸
      const lx = colX[7] + 3;
      ops.push({ t: 'text', x: lx, y: ty, s: 'ア・適合する　イ・適合しない', size: 2.3, color: row ? undefined : GRAY });
      if (!row) continue;
      if (row.cert) ops.push({ t: 'circle', cx: lx + 1.15, cy: ty - 0.8, r: 1.9, lw: 0.25 });
      label(s, colX[1] + 1.5, ty, row.name, 3, COLS[1].w - 3);
      label(s, colX[2] + COLS[2].w / 2, ty, row.qty, 3, COLS[2].w - 2, { anchor: 'middle' });
      label(s, colX[3] + COLS[3].w / 2, ty, row.maker, 3, COLS[3].w - 2, { anchor: 'middle' });
      if (row.cert) { const ci = CERT_COL[row.cert]; ops.push({ t: 'text', x: colX[ci] + COLS[ci].w / 2, y: ty, s: '○', size: 3.4, anchor: 'middle' }); }
    }
    const ny = top + headH + rowH * ROWS + 6;
    ['※日本水道協会検査合格品又は第三者認証品、自己認証品、JIS表示品の欄には該当する場所に○をつけること。', '※鉛新浸出性能基準適合の欄には適合しているかどうか○をつけること。', '※経過措置により猶予される製品（旧法適用製品）については鉛新浸出性能基準適合の記入は不要。', '※平成15年4月1日から給水装置工事申請書に添付すること。']
      .forEach((t, i) => label(s, x0, ny + 4.2 * i, t, 2.4, 150, { color: GRAY }));
    const cx = 172, vx = 205, vw = x0 + W - vx - 8;
    ops.push({ t: 'text', x: cx, y: ny + 18, s: '会　社', size: 3 });
    ([['住所', c.address], ['商号', c.name], ['代表者', c.representative]] as const).forEach(([k, val], i) => {
      ops.push({ t: 'text', x: vx - 3, y: ny + 18 + 5 * i, s: k, size: 3, anchor: 'end' });
      label(s, vx, ny + 18 + 5 * i, val, 3.2, vw);
    });
    ops.push({ t: 'text', x: x0 + W, y: ny + 28, s: '印', size: 3, anchor: 'end', color: GRAY });
    ops.push({ t: 'text', x: vx - 3, y: ny + 34, s: '給水装置工事主任技術者名', size: 3, anchor: 'end' });
    label(s, vx, ny + 34, c.chiefEngineer, 3.2, vw);
    ops.push({ t: 'text', x: x0 + W, y: ny + 34, s: '印', size: 3, anchor: 'end', color: GRAY });
    out.push(s);
  }
  return out;
}
