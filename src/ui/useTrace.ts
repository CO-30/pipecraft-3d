import { useMemo } from 'react';
import { traceSystem, type Trace } from '../model/trace';
import { useStore } from '../state/store';

/** 系統をたどって強調している中身（図面が変わるたびにたどり直す）。出発の区間が消えたら null */
export function useTrace(): (Trace & { segs: Set<string>; fixtures: Set<string> }) | null {
  const doc = useStore((s) => s.doc);
  const id = useStore((s) => s.trace);
  return useMemo(() => {
    const t = id ? traceSystem(doc, id) : null;
    return t ? { ...t, segs: new Set(t.segmentIds), fixtures: new Set(t.fixtureIds) } : null;
  }, [doc, id]);
}

/** 系統の強調の色（選択の橙と分ける） */
export const TRACE_COLOR = '#7c3aed';
