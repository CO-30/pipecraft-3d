/**
 * 設備図（給水・排水の申請図など、配管が描かれた図面）の文字から、配管の種類・口径・長さ、ます、器具、部品を読む。純粋関数。
 * 申請図では管ごとに「PB13×7.1」（管種 口径×長さ m）と書く決まりなので、線の色や形より文字の方が確か。
 * 使い道: 有料 CAD や手描きで作った申請図の数量を、精度の測定の正解（実際の設計の数量）にする（src/bench）。
 */
import type { FixtureType } from '../fixtures';
import type { PText } from './sheet';

export type PipeSpec = { material: string; diameter: number; length?: number };
export type PipeLabel = PipeSpec & { x: number; y: number };
export type EquipmentRead = {
  pipes: PipeLabel[];
  /** 管種・口径ごとの長さの合計(m)と表示の数（長さの分かった表示だけ）。nearby: そのうち長さを横の数字から取ったもの（推定） */
  totals: { material: string; diameter: number; length: number; labels: number; nearby: number }[];
  manholes: { small: number; public: number };
  fixtures: Partial<Record<FixtureType, number>>;
  parts: { name: string; size: number; count: number }[];
};

const MAT = '(HIVP|HTVP|VU|VP|PB|SGP|PE|HI)';
const norm = (s: string) => s.normalize('NFKC').toUpperCase().replace(/\s+/g, '');
const FORWARD = new RegExp(`^${MAT}Φ?(\\d{2,3})(?:[×X*](\\d+(?:\\.\\d+)?))?$`);
const BACKWARD = new RegExp(`^(\\d{2,3})${MAT}$`);

export function parsePipeLabel(s: string): PipeSpec | null {
  const n = norm(s);
  const f = FORWARD.exec(n);
  if (f) return { material: f[1], diameter: Number(f[2]), ...(f[3] ? { length: Number(f[3]) } : {}) };
  const b = BACKWARD.exec(n);
  return b ? { material: b[2], diameter: Number(b[1]) } : null;
}

/** 太字の重ね書き（同じ文字を少しずらして何度も書く）を 1 つにする */
function dedupe(texts: PText[]): PText[] {
  const out: PText[] = [];
  for (const t of texts) if (!out.some((o) => o.s === t.s && Math.abs(o.x - t.x) <= 2 && Math.abs(o.y - t.y) <= 2)) out.push(t);
  return out;
}

const FIXTURE_WORDS: [RegExp, FixtureType][] = [
  [/^(トイレ|便器|大便器)$/, 'toilet'], [/^(洗面器|洗面台|洗面化粧台)$/, 'washbasin'], [/^(流し台|キッチン|台所流し)$/, 'kitchen'],
  [/^洗濯機/, 'washer'], [/^シャワー$/, 'shower'], [/^(浴槽|UB)$/, 'bathtub'], [/^給湯器/, 'waterHeater'], [/^(散水栓|立水栓)$/, 'outdoorFaucet'], [/^水栓$/, 'faucet'],
];
const PARTS: [RegExp, string][] = [[/^止水栓(\d+)?/, '止水栓'], [/^量水器(\d+)?/, '量水器'], [/^給水ヘッダー(\d+)?/, '給水ヘッダー'], [/^給湯ヘッダー(\d+)?/, '給湯ヘッダー'], [/^通気弁/, '通気弁']];

export function readEquipment(texts: PText[]): EquipmentRead {
  const ts = dedupe(texts);
  const pipes: PipeLabel[] = [];
  const totals: EquipmentRead['totals'] = [];
  const manholes = { small: 0, public: 0 };
  const fixtures: EquipmentRead['fixtures'] = {};
  const parts: EquipmentRead['parts'] = [];
  // 長さが別の文字のとき（「VU75」の横に「1.5」）: 長さの無い表示ごとに、いちばん近い小数（15pt 以内）を 1 回だけ使う
  const decimals = ts.filter((t) => /^\d{1,2}\.\d{1,2}$/.test(norm(t.s)));
  const used = new Set<PText>();
  const nearLen = (t: PText): number | undefined => {
    let best: PText | undefined, bd = 15;
    for (const d of decimals) { if (used.has(d)) continue; const dd = Math.hypot(d.x - t.x, d.y - t.y); if (dd <= bd) { bd = dd; best = d; } }
    if (!best) return undefined;
    used.add(best);
    return Number(norm(best.s));
  };
  const add = (p: PipeSpec, length: number, nearby: boolean) => {
    const cur = totals.find((x) => x.material === p.material && x.diameter === p.diameter);
    if (cur) { cur.length = Math.round((cur.length + length) * 100) / 100; cur.labels++; cur.nearby += nearby ? 1 : 0; }
    else totals.push({ material: p.material, diameter: p.diameter, length, labels: 1, nearby: nearby ? 1 : 0 });
  };
  for (const t of ts) {
    const p = parsePipeLabel(t.s);
    if (p) {
      const len = p.length ?? nearLen(t);
      pipes.push({ ...p, ...(len !== undefined ? { length: len } : {}), x: t.x, y: t.y });
      if (len !== undefined) add(p, len, p.length === undefined);
      continue;
    }
    const n = norm(t.s);
    if (/^NO\.?\d+小口径[桝枡]/.test(n)) { manholes.small++; continue; }
    if (/公共[桝枡]$/.test(n) && !/既設/.test(n)) { manholes.public++; continue; }
    const fx = FIXTURE_WORDS.find(([re]) => re.test(n));
    if (fx) { fixtures[fx[1]] = (fixtures[fx[1]] ?? 0) + 1; continue; }
    const pt = PARTS.find(([re]) => re.test(n));
    if (pt) {
      const size = Number(pt[0].exec(n)?.[1] ?? 0);
      const cur = parts.find((x) => x.name === pt[1] && x.size === size);
      if (cur) cur.count++; else parts.push({ name: pt[1], size, count: 1 });
    }
  }
  return { pipes, totals, manholes, fixtures, parts };
}

/** 長さ付きの配管の表示が 3 つ以上 = 設備図 */
export const isEquipmentSheet = (texts: PText[]) => dedupe(texts).filter((t) => parsePipeLabel(t.s)?.length !== undefined).length >= 3;

/** 正解の数量（src/bench/truth.ts の quantities の形） */
export function equipmentQuantities(r: EquipmentRead): { name: string; spec: string; unit: 'm' | '個'; qty: number }[] {
  return [
    ...r.totals.map((p) => ({ name: p.material, spec: `φ${p.diameter}`, unit: 'm' as const, qty: p.length })),
    ...(r.manholes.small ? [{ name: '小口径桝', spec: '', unit: '個' as const, qty: r.manholes.small }] : []),
    ...(r.manholes.public ? [{ name: '公共桝', spec: '', unit: '個' as const, qty: r.manholes.public }] : []),
    ...r.parts.map((p) => ({ name: p.name, spec: p.size && !/ヘッダー/.test(p.name) ? `φ${p.size}` : '', unit: '個' as const, qty: p.count })),
  ];
}

/** 平面図（申請図）の文字から置く、配置図の物。凡例を避けるため box（建物の周り）の中だけ */
const SITE_WORDS: [RegExp, 'waterMeter' | 'publicSewage' | 'manholeSewage'][] = [
  // 1 つの物の名前だけの文字（「量水器20mm(壁埋込型)」）。「量水器BOX」「水道メーター室」、凡例の「汚水桝」、注記の文は置かない
  [/^(量水器|水道メーター)(\d+(MM)?)?(\(.*\))?$/, 'waterMeter'], [/^(新設)?(汚水)?公共[桝枡ます](Φ\d+)?$/, 'publicSewage'], [/^NO\.?\d+(小口径)?[桝枡](Φ\d+)?$/, 'manholeSewage'],
];
export function siteLabelItems(texts: { x: number; y: number; s: string }[], box: { x0: number; x1: number; y0: number; y1: number }): { type: 'waterMeter' | 'publicSewage' | 'manholeSewage'; x: number; y: number }[] {
  const out: { type: 'waterMeter' | 'publicSewage' | 'manholeSewage'; x: number; y: number }[] = [];
  for (const t of texts) {
    if (t.x < box.x0 || t.x > box.x1 || t.y < box.y0 || t.y > box.y1) continue;
    const n = norm(t.s);
    if (/既設/.test(n)) continue;
    const w = SITE_WORDS.find(([re]) => re.test(n));
    if (!w) continue;
    // 太字の重ね書き・同じ物の 2 つ目の表示（300mm 以内）は 1 つ
    if (out.some((o) => o.type === w[1] && Math.hypot(o.x - t.x, o.y - t.y) < 300)) continue;
    out.push({ type: w[1], x: t.x, y: t.y });
  }
  return out;
}
