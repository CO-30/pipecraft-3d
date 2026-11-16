/**
 * 道路の手続きの計算（純関数）: 取出しごとの数量、要る手続きのチェックリストと期限の目安、注意、舗装の層、工程。
 * 長さ・面積は mm・mm²（入力は m）。
 */
import type { ApplicationValues } from '../forms/types';
import { num, numM, STEPS, YES } from './fields';

export type Takeoff = { kind: 'water' | 'sewer'; label: string; pipe: string; dia: number; main: string; length: number; width: number; depth: number; digArea: number; restoreArea: number };
export type CheckItem = { label: string; to: string; app: boolean; due?: string; late?: boolean; note?: string };
export type Layer = { name: string; t: number };

/** 期限の目安（着工日の何日前までに出すか）。役所によって違うので画面では「目安」と書く */
export const ROAD_LEAD_DAYS = { occupancy: 21, use: 7, notice: 3, buried: 7 } as const;

const mm = (v: string | undefined) => Math.round((numM(v) ?? 0) * 1000);

export function roadTakeoffs(v: ApplicationValues): Takeoff[] {
  const out: Takeoff[] = [];
  const width = mm(v['road.digWidth']), margin = mm(v['road.restoreMargin']);
  const one = (kind: Takeoff['kind'], k: 'water' | 'sewer', label: string) => {
    if (v[`road.${k}`] !== YES) return;
    const length = mm(v[`road.${k}MainAt`]);
    const dia = num(v[`road.${k}PipeDia`]) ?? 0;
    const pipe = [v[`road.${k}Pipe`], dia ? `φ${dia}` : ''].filter(Boolean).join(' ');
    const mainDia = num(v[`road.${k}MainDia`]);
    const main = [v[`road.${k}Main`], mainDia ? `φ${mainDia}` : ''].filter(Boolean).join(' ');
    out.push({ kind, label, pipe, dia, main, length, width, depth: mm(v[`road.${k}Depth`]), digArea: length * width, restoreArea: length > 0 && width > 0 ? (length + 2 * margin) * (width + 2 * margin) : 0 });
  };
  one('water', 'water', '給水管');
  one('sewer', 'sewer', '下水道取付管');
  return out;
}

/** YYYY-MM-DD に日数を足す */
export function addDays(iso: string, d: number): string {
  const [y, m, dd] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + d));
  return t.toISOString().slice(0, 10);
}
const isIso = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function roadChecklist(v: ApplicationValues, today: string): CheckItem[] {
  const water = v['road.water'] === YES, sewer = v['road.sewer'] === YES;
  if (!water && !sewer) return [{ label: '道路を掘らないので、道路の手続きは要りません', to: '', app: false }];
  const start = isIso(v['road.start']) ? v['road.start'] : undefined;
  const due = (lead: number) => (start ? { due: addDays(start, -lead), late: addDays(start, -lead) < today } : {});
  const admin = v['road.roadAdmin'] || '道路管理者（町道・市道は役場の道路担当、県道は土木事務所）';
  const police = v['road.police'] || '工事場所を受け持つ警察署';
  const out: CheckItem[] = [];
  if (v['road.roadKind'] === '私道') {
    out.push({ label: '道路の所有者の承諾書', to: '道路の所有者', app: false, ...due(ROAD_LEAD_DAYS.occupancy), note: '私道でも、人や車が通るなら警察の道路使用許可が要ることがあります。警察署で確認' });
  } else {
    out.push({ label: '道路占用許可申請書（道路法 第32条）', to: admin, app: true, ...due(ROAD_LEAD_DAYS.occupancy), note: '添付: 位置図・平面図・横断図・復旧断面図・交通規制図・工程表・占用内訳調書（このアプリで作れます）、現況写真' });
    out.push({ label: '道路使用許可申請書（道路交通法 第77条）', to: police, app: true, ...due(ROAD_LEAD_DAYS.use), note: '添付: 位置図・交通規制図。手数料が要ります（額は警察署で確認）' });
    if (v['road.curb'] === 'はい') out.push({ label: '道路工事施行承認申請書（道路法 第24条）', to: admin, app: false, ...due(ROAD_LEAD_DAYS.occupancy), note: '縁石・側溝の構造図が要ります。様式は道路管理者から' });
    out.push({ label: '工事着手届', to: admin, app: true, ...due(ROAD_LEAD_DAYS.notice), note: '許可書・道路使用許可書の写しを付ける所が多いです' });
    out.push({ label: '工事完了届', to: admin, app: true, note: '工事が終わったら。完成写真を付けます' });
    out.push({ label: '道路占用料の減免申請', to: admin, app: false, note: '給水管・下水の取付管は対象のことがあります。窓口で確認' });
  }
  out.push({ label: '他の埋設物の確認（ガス・NTT・電力など）', to: '各事業者', app: false, ...due(ROAD_LEAD_DAYS.buried), note: '掘る前に埋設物の位置を確かめます' });
  if (water) out.push({ label: '分岐（穿孔）の立会いの予約', to: '水道の担当', app: false });
  if (sewer) out.push({ label: '公共ます・取付管の設置の申請', to: '下水道の担当', app: false, note: '役所が設置する自治体もあります。その場合は下水の取付管を「しない」に' });
  return out;
}

export function roadWarnings(v: ApplicationValues): string[] {
  const w: string[] = [];
  if (!v['road.roadKind']) w.push('道路の種類が未選択です');
  const width = numM(v['road.roadWidth']);
  for (const [k, name] of [['water', '給水'], ['sewer', '下水']] as const) {
    if (v[`road.${k}`] !== YES) continue;
    const at = numM(v[`road.${k}MainAt`]);
    if (at === undefined) w.push(`${name}: 本管の位置が未入力です（道路の中の長さが出せません）`);
    else if (width !== undefined && at > width) w.push(`${name}: 本管の位置（${at} m）が道路の幅（${width} m）より遠くになっています`);
    if (numM(v[`road.${k}Depth`]) === undefined) w.push(`${name}: 深さが未入力です`);
  }
  if (!isIso(v['road.start'])) w.push('着工日が未入力です（期限の目安と工程表が出せません）');
  else if (isIso(v['road.end'])) {
    const last = schedule(v).at(-1)?.to;
    if (v['road.end'] < v['road.start']) w.push('完了日が着工日より前になっています');
    else if (last && v['road.end'] < last) w.push(`完了日（${v['road.end']}）が、作業の日数から出した終わり（${last}）より前です。日数か完了日を直してください`);
  }
  if (!numM(v['road.digWidth'])) w.push('掘削の幅が未入力です');
  return w;
}

const DEFAULT_LAYERS: Record<string, Record<'temp' | 'final', Layer[]>> = {
  アスファルト: {
    final: [{ name: '表層 アスファルト', t: 50 }, { name: '上層路盤 粒度調整砕石', t: 150 }, { name: '下層路盤 再生砕石', t: 200 }],
    temp: [{ name: '仮舗装 常温合材', t: 30 }, { name: '路盤 再生砕石', t: 370 }],
  },
  コンクリート: {
    final: [{ name: 'コンクリート舗装', t: 150 }, { name: '路盤 再生砕石', t: 150 }],
    temp: [{ name: '仮舗装 常温合材', t: 30 }, { name: '路盤 再生砕石', t: 270 }],
  },
  未舗装: { final: [{ name: '砕石', t: 150 }], temp: [{ name: '砕石', t: 150 }] },
};

/** 一般的な舗装の層（舗装の種類から） */
export function pavementLayers(kind: string | undefined, phase: 'temp' | 'final'): Layer[] {
  return (DEFAULT_LAYERS[kind ?? ''] ?? DEFAULT_LAYERS['アスファルト'])[phase];
}

/** 入力（1 行に「名前 厚さ」）があればそれ、無ければ一般的な層 */
export function roadLayers(v: ApplicationValues, phase: 'temp' | 'final'): Layer[] {
  const raw = v[phase === 'temp' ? 'road.layersTemp' : 'road.layersFinal'] ?? '';
  const parsed = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(.*?)[\s　]+([0-9０-９.．]+)\s*(mm)?$/.exec(l);
    const t = m ? num(m[2]) : undefined;
    return m && t ? { name: m[1].trim(), t } : undefined;
  }).filter((x): x is Layer => !!x);
  return parsed.length ? parsed : pavementLayers(v['road.pavement'], phase);
}

export type ScheduleRow = { label: string; from: string; to: string; days: number };

/** 着工日から作業を順に並べる（日数が無い・0 の作業は飛ばす）。着工日が無ければ空 */
export function schedule(v: ApplicationValues): ScheduleRow[] {
  if (!isIso(v['road.start'])) return [];
  let cur = v['road.start'];
  const rows: ScheduleRow[] = [];
  for (const s of STEPS) {
    const d = Math.max(0, Math.round(num(v[`road.days.${s.id}`]) ?? 1));
    if (!d) continue;
    rows.push({ label: s.label, from: cur, to: addDays(cur, d - 1), days: d });
    cur = addDays(cur, d);
  }
  return rows;
}

/** 工事の期間（完了日が入力されていればそれ、無ければ工程から） */
export function workPeriod(v: ApplicationValues): { from?: string; to?: string; days?: number } {
  const from = isIso(v['road.start']) ? v['road.start'] : undefined;
  if (!from) return {};
  const last = schedule(v).at(-1)?.to ?? from;
  // 完了日が着工日より前なら使わない（作業の日数から出した終わりにする）
  const to = isIso(v['road.end']) && v['road.end'] >= from ? v['road.end'] : last;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  return { from, to, days };
}
