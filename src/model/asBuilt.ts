/**
 * 竣工図モード。工事のあとに、現場の実測長（区間の measuredLength）で申請図面を描き直す。
 * 設定は site.application の shunko.on（'1'）・shunko.date（YYYY-MM-DD）。実測長は読むだけ（図面の値で上書きしない）。
 * 縦断図は profileDrawing を変えずに、できたモデルを差し替える（排水の作業と衝突させないため）。
 */
import type { Doc } from './doc';
import { formatSlope } from './municipality';
import type { ProfileModel } from './profileDrawing';

export type AsBuiltSettings = { on: boolean; date: string | undefined };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readAsBuilt(app: Record<string, string> | undefined): AsBuiltSettings {
  const d = app?.['shunko.date'];
  return { on: app?.['shunko.on'] === '1', date: d && ISO_DATE.test(d) ? d : undefined };
}

export function writeAsBuilt(app: Record<string, string> | undefined, patch: Partial<AsBuiltSettings>): Record<string, string> {
  const out = { ...(app ?? {}) };
  if ('on' in patch) { if (patch.on) out['shunko.on'] = '1'; else delete out['shunko.on']; }
  if ('date' in patch) { if (patch.date && ISO_DATE.test(patch.date)) out['shunko.date'] = patch.date; else delete out['shunko.date']; }
  return out;
}

const KINDS = /(縦断図|立面図|展開図|平面図|配管立図|系統図)/;
/** 「排水設備 縦断図」→「排水設備 竣工図（縦断図）」。図の種類で始まる表題は全体を括弧に入れる */
export function asBuiltTitle(title: string): string {
  const m = KINDS.exec(title);
  if (!m) return `竣工図 ${title}`;
  if (m.index === 0) return `竣工図（${title}）`;
  return title.replace(KINDS, '竣工図（$1）');
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
  let cum = model.nodes[0]?.cumDistance ?? 0;
  const nodes = model.nodes.map((n, k) => {
    if (k === 0) return n;
    cum += segments[k - 1]?.distance ?? 0;
    return { ...n, cumDistance: cum };
  });
  return { model: { ...model, segments, nodes }, unmeasured };
}
