import { useStore } from '../state/store';
import { traceFrom, type Trace, type TraceSeed } from '../model/trace';
import type { Doc } from '../model/doc';

export type ShownTrace = Trace & { segs: Set<string>; fixtures: Set<string> };

// 2D・3D・帯の 3 か所で使うので、同じ図面・同じ手がかりなら 1 回だけたどる
let cache: { net: Doc['network']; fx: Doc['fixtures']; seed: TraceSeed; out: ShownTrace | null } | null = null;
function compute(doc: Doc, seed: TraceSeed | null): ShownTrace | null {
  if (!seed) return null;
  if (cache && cache.net === doc.network && cache.fx === doc.fixtures && cache.seed === seed) return cache.out;
  const t = traceFrom(doc, seed);
  const out = t ? { ...t, segs: new Set(t.segmentIds), fixtures: new Set(t.fixtureIds) } : null;
  cache = { net: doc.network, fx: doc.fixtures, seed, out };
  return out;
}

/** 系統をたどって強調している中身（図面が変わるたびにたどり直す。区間を分けても両端から続ける）。たどれなければ null */
export function useTrace(): ShownTrace | null {
  const doc = useStore((s) => s.doc);
  const seed = useStore((s) => s.trace);
  return compute(doc, seed);
}

/** 系統の強調の色（選択の橙と分ける） */
export const TRACE_COLOR = '#7c3aed';
