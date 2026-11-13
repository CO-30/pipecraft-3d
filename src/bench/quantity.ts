/**
 * 数量の照合: 自動でつないだ配管の材料（材料集計表）と、実際に使った数量（見積の内訳・竣工）を品目ごとに比べる。純粋関数。
 * 見積の書き方はまちまちなので、管は「管種＋口径」、部品は「名前＋口径」で合わせる。合わなかった品目もそのまま出す（人が見て直す）。
 */
import type { MatSummary } from '../model/materialSummary';
import type { Truth } from './truth';

export type QtyRow = { label: string; unit: string; design: number; actual: number | null; diff: number | null; rate: number | null };

/** 管種（語として。「PEX」「CHIP」を PE・HI にしない）。長い名前を先に */
const MATERIAL_RE = /(?<![A-Z])(HIVP|HTVP|VU|VP|PB|SGP|PE|SUS|HI)(?![A-Z])/;
const norm = (s: string) => s.normalize('NFKC').toUpperCase().replace(/\s+/g, '');
const nums = (s: string) => (s.normalize('NFKC').match(/\d+(?:\.\d+)?/g) ?? []);
/** 口径: φ の後ろの数字があればそれ（「PB保温10mm φ13」→ 13）、無ければ最初の数字 */
const dias = (s: string) => { const f = s.normalize('NFKC').match(/[φΦ]\s*\d+(?:\.\d+)?/g); return f ? f.map((x) => x.replace(/[^\d.]/g, '')) : nums(s); };

function parse(name: string, spec: string, unit: string): { key: string; label: string } {
  const all = norm(`${name} ${spec}`);
  if (unit === 'm') {
    const mat = MATERIAL_RE.exec(all)?.[1] ?? norm(name).replace(/\d.*$/, '');
    const d = dias(spec)[0] ?? dias(name)[0] ?? '';
    return { key: `m|${mat}|${d}`, label: `${mat} ${d}`.trim() };
  }
  const word = norm(name).replace(/\d+/g, '');
  return { key: `${unit}|${word}|${dias(spec).join('x')}`, label: spec.trim() ? `${name}（${spec.trim()}）` : name };
}

export const qtyKey = (name: string, spec: string, unit: string) => parse(name, spec, unit).key;

const round = (v: number) => Math.round(v * 100) / 100;

export function compareQuantities(actual: NonNullable<Truth['quantities']>, design: MatSummary): QtyRow[] {
  const d = new Map<string, { label: string; unit: string; qty: number }>();
  for (const it of design.sections.flatMap((s) => s.items)) {
    const p = parse(it.name, it.spec, it.unit);
    const cur = d.get(p.key);
    d.set(p.key, { label: cur?.label ?? p.label, unit: it.unit, qty: (cur?.qty ?? 0) + it.total });
  }
  const a = new Map<string, { label: string; unit: string; qty: number }>();
  for (const q of actual) {
    const p = parse(q.name, q.spec, q.unit);
    const cur = a.get(p.key);
    a.set(p.key, { label: cur?.label ?? p.label, unit: q.unit, qty: (cur?.qty ?? 0) + q.qty });
  }
  const rows: QtyRow[] = [];
  for (const [k, v] of a) {
    const des = round(d.get(k)?.qty ?? 0), act = round(v.qty);
    rows.push({ label: v.label, unit: v.unit, design: des, actual: act, diff: round(des - act), rate: act ? round((des - act) / act * 1000) / 1000 : null });
  }
  for (const [k, v] of d) if (!a.has(k)) rows.push({ label: v.label, unit: v.unit, design: round(v.qty), actual: null, diff: null, rate: null });
  return rows;
}

const sign = (v: number, f: (x: number) => string) => `${v > 0 ? '+' : ''}${f(v)}`;

export function formatQuantities(rows: QtyRow[]): string {
  // 管: 長さの合計で見た誤差（短い管の大きな率に引っぱられない）。部品・器具: 品目ごとの率の平均。実際の数量に無い品目（自動が足した物）は数を出す
  const pipes = rows.filter((r) => r.unit === 'm' && r.actual !== null);
  const sumAct = pipes.reduce((s, r) => s + r.actual!, 0), sumDiff = pipes.reduce((s, r) => s + Math.abs(r.diff!), 0);
  const parts = rows.filter((r) => r.unit !== 'm' && r.rate !== null);
  const partAvg = parts.length ? parts.reduce((s, r) => s + Math.abs(r.rate!), 0) / parts.length : null;
  const extra = rows.filter((r) => r.actual === null).length;
  const head = [
    sumAct ? `管の長さの誤差 ${(sumDiff / sumAct * 100).toFixed(1)}%（差の合計 ${round(sumDiff)}m ÷ 実際 ${round(sumAct)}m）` : '',
    partAvg === null ? '' : `部品・器具の数の誤差（平均）${(partAvg * 100).toFixed(1)}%`,
    extra ? `実際の数量に無い品目 ${extra}` : '',
  ].filter(Boolean).join('・');
  return [
    `### 数量の照合（自動でつないだ配管 ↔ 実際）${head ? ` ${head}` : ''}`,
    '',
    '| 品目 | 単位 | 自動 | 実際 | 差 | 率 |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.label} | ${r.unit} | ${r.design} | ${r.actual ?? '—'} | ${r.diff === null ? '—' : sign(r.diff, String)} | ${r.rate === null ? '—' : sign(r.rate, (x) => `${(x * 100).toFixed(1)}%`)} |`),
    '',
  ].join('\n');
}
