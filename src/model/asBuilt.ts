/**
 * 竣工図モード。工事のあとに、現場の実測長（区間の measuredLength）で申請図面を描き直す。
 * 設定は site.application の shunko.on（'1'）・shunko.date（YYYY-MM-DD）。実測長は読むだけ（図面の値で上書きしない）。
 * 縦断図は profileDrawing を変えずに、できたモデルを差し替える（排水の作業と衝突させないため）。
 */
import type { Doc } from './doc';
import { formatSlope, minSlopeFor } from './municipality';
import type { ProfileModel, ProfileWarning } from './profileDrawing';

export type AsBuiltSettings = { on: boolean; date: string | undefined };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readAsBuilt(app: Record<string, string> | undefined): AsBuiltSettings {
  const d = app?.['shunko.date'];
  return { on: app?.['shunko.on'] === '1', date: d && validDate(d) ? d : undefined };
}

/** YYYY-MM-DD で、実在する日（2026-02-31 などは不可） */
function validDate(d: string): boolean {
  if (!ISO_DATE.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(y, m - 1, day);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === day;
}

export function writeAsBuilt(app: Record<string, string> | undefined, patch: Partial<AsBuiltSettings>): Record<string, string> {
  const out = { ...(app ?? {}) };
  if ('on' in patch) { if (patch.on) out['shunko.on'] = '1'; else delete out['shunko.on']; }
  if ('date' in patch) { if (patch.date && validDate(patch.date)) out['shunko.date'] = patch.date; else delete out['shunko.date']; }
  return out;
}

const KINDS = /(縦断図|立面図|展開図|平面図|配管立図|系統図)/;
/** 「排水設備 縦断図」→「排水設備 竣工縦断図」（図の見出し・表題欄に収まるよう 2 字だけ足す）。種類の無い表題は「竣工図 …」 */
export function asBuiltTitle(title: string): string {
  return KINDS.test(title) ? title.replace(KINDS, '竣工$1') : `竣工図 ${title}`;
}

const measured = (doc: Doc, segId: string): number | undefined => {
  const v = doc.network.segments[segId]?.measuredLength;
  return v !== undefined && v > 0 ? v : undefined;
};

/** 区間の長さ: 実測（> 0）があればそれ、無ければ配管の 3D の長さ */
export function measuredLengthOf(doc: Doc): (segId: string) => number {
  const net = doc.network;
  return (segId) => {
    const m = measured(doc, segId);
    if (m !== undefined) return m;
    const s = net.segments[segId];
    const a = s && net.nodes[s.a], b = s && net.nodes[s.b];
    return a && b ? Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z) : 0;
  };
}

/** 実測長が無い区間（按分した概算は実測ありとみなす） */
export function unmeasuredSegments(doc: Doc, segIds: string[]): string[] {
  return segIds.filter((id) => doc.network.segments[id] && measured(doc, id) === undefined);
}

/** 按分した概算の実測長の区間 */
export function approxSegments(doc: Doc, segIds: string[]): string[] {
  return segIds.filter((id) => measured(doc, id) !== undefined && doc.network.segments[id]?.measuredApprox);
}

/** 実測が図面の長さの半分未満・2 倍超の区間（mm と m の入れ違いなど）。図面で 100mm 未満の区間は比べない */
export function suspiciousMeasured(doc: Doc, segIds: string[], modelLen: Record<string, number>): string[] {
  return segIds.filter((id) => {
    const m = measured(doc, id), L = modelLen[id];
    return m !== undefined && L !== undefined && L >= 100 && (m < L * 0.5 || m > L * 2);
  });
}

/**
 * 縦断図のモデルの延長を実測にする。追加距離を積み直し、勾配＝落差÷実測。立管（延長 1mm 未満）は触らない。
 * 元のモデルは変えない。unmeasured: 実測の無い区間（立管を除く）
 */
export function applyMeasuredToProfile(model: ProfileModel, doc: Doc): { model: ProfileModel; unmeasured: string[] } {
  const fmt = model.profile.profileTable.slopeFormat;
  const unmeasured: string[] = [];
  const segments = model.segments.map((s, k) => {
    if (s.distance < 1) return s;
    const m = measured(doc, s.segId);
    if (m === undefined) { unmeasured.push(s.segId); return s; }
    const up = model.nodes[k], down = model.nodes[k + 1];
    if (!up || !down) return { ...s, distance: m };
    const slope = (up.invertLevel - (down.invertIn ?? down.invertLevel)) / m;
    return { ...s, distance: m, slope, slopeText: slope < -1e-9 ? '逆勾配' : formatSlope(slope, fmt) };
  });
  // 勾配の注意（逆勾配・最小勾配）は、延長を変えた区間だけ出し直す
  const changed = new Set(segments.filter((s, k) => s !== model.segments[k]).map((s) => s.segId));
  const warnings: ProfileWarning[] = model.warnings.filter((w) => !(w.segId && changed.has(w.segId) && (w.kind === 'minSlope' || w.kind === 'reverseSlope')));
  segments.forEach((s, k) => {
    if (!changed.has(s.segId) || s.slope === null) return;
    if (s.slope < -1e-9) { warnings.push({ kind: 'reverseSlope', segId: s.segId, message: `区間 ${k + 1}: 逆勾配（下流のほうが高い）` }); return; }
    const need = minSlopeFor(model.profile, s.diameter);
    if (need !== undefined && s.slope + 1e-9 < need) warnings.push({ kind: 'minSlope', segId: s.segId, message: `区間 ${k + 1}: φ${s.diameter} の最小勾配 ${formatSlope(need, fmt)} より緩い（${formatSlope(s.slope, fmt)}・実測）` });
  });
  let cum = model.nodes[0]?.cumDistance ?? 0;
  const nodes = model.nodes.map((n, k) => {
    if (k === 0) return n;
    cum += segments[k - 1]?.distance ?? 0;
    return { ...n, cumDistance: cum };
  });
  return { model: { ...model, segments, nodes, warnings }, unmeasured };
}
