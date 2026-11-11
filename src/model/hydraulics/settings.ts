/**
 * 水理計算の設定。現場の申請書類の入力値（site.application）に `suiri.*` のキーで入れる（保存形式は変えない）。
 * 空・未入力は「自動（自治体の値・既定値）」。
 */
export type SuiriSettings = {
  /** 設計水圧 MPa */
  pressure?: number;
  /** 余裕水頭 m */
  margin?: number;
  /** 引込（配水管〜メーター）の延長 m。描いた管があればそちらを使う */
  serviceLen?: number;
  /** 配水管とメーターの高低差 m */
  drop?: number;
  /** 水道メーターの口径 mm（空なら図面から） */
  meterDia?: number;
  /** 同時に使う器具（器具 id）。空なら自動で選ぶ */
  use?: string[];
  /** 器具ごとの使用水量 L/min */
  flows: Record<string, number>;
};

const NUM_KEYS = { pressure: 'suiri.pressure', margin: 'suiri.margin', serviceLen: 'suiri.serviceLen', drop: 'suiri.drop', meterDia: 'suiri.meterDia' } as const;
const USE = 'suiri.use';
const FLOW = 'suiri.flow.';

const num = (s: string | undefined) => {
  if (s === undefined || s.trim() === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
};

export function readSuiriSettings(app?: Record<string, string>): SuiriSettings {
  const out: SuiriSettings = { flows: {} };
  if (!app) return out;
  for (const [k, key] of Object.entries(NUM_KEYS) as [keyof typeof NUM_KEYS, string][]) {
    const v = num(app[key]);
    if (v !== undefined) out[k] = v;
  }
  const use = (app[USE] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (use.length) out.use = use;
  for (const [k, s] of Object.entries(app)) {
    if (!k.startsWith(FLOW)) continue;
    const v = num(s);
    if (v !== undefined && v > 0) out.flows[k.slice(FLOW.length)] = v;
  }
  return out;
}

/** patch のキーだけを書き換えた新しい入力値。undefined・空はキーごと消す。他のキーは残す */
export function writeSuiriSettings(app: Record<string, string> | undefined, patch: Partial<SuiriSettings>): Record<string, string> {
  const out = { ...(app ?? {}) };
  for (const [k, key] of Object.entries(NUM_KEYS) as [keyof typeof NUM_KEYS, string][]) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === undefined || !Number.isFinite(v)) delete out[key];
    else out[key] = String(v);
  }
  if ('use' in patch) {
    if (patch.use?.length) out[USE] = patch.use.join(',');
    else delete out[USE];
  }
  if ('flows' in patch) {
    for (const k of Object.keys(out)) if (k.startsWith(FLOW)) delete out[k];
    for (const [id, v] of Object.entries(patch.flows ?? {})) if (Number.isFinite(v) && v > 0) out[FLOW + id] = String(v);
  }
  return out;
}
