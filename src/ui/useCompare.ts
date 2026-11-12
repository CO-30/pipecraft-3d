import { useStore, type CompareTarget } from '../state/store';
import { compareDocs, type Comparison } from '../model/compare';
import type { Doc } from '../model/doc';

export type ShownCompare = Comparison & {
  target: CompareTarget;
  /** 今の区間・器具のうち、増えた／変わった／動いた */
  addedSegs: Set<string>; changedSegs: Set<string>; addedFx: Set<string>; movedFx: Set<string>;
};

// 2D・3D・帯の 3 か所で使うので、同じ図面・同じ版なら 1 回だけ比べる
let cache: { net: Doc['network']; fx: Doc['fixtures']; bld: Doc['building']; target: CompareTarget; out: ShownCompare } | null = null;

/** 比べている版と今の違い（比べていなければ null） */
export function useCompare(): ShownCompare | null {
  const doc = useStore((s) => s.doc);
  const target = useStore((s) => s.compare);
  return compute(doc, target);
}

function compute(doc: Doc, target: CompareTarget | null): ShownCompare | null {
  if (!target) return null;
  if (cache && cache.net === doc.network && cache.fx === doc.fixtures && cache.bld === doc.building && cache.target === target) return cache.out;
  const c = compareDocs(target.doc, doc);
  const out: ShownCompare = {
    ...c, target,
    addedSegs: new Set(c.segments.added), changedSegs: new Set(c.segments.changed.map((x) => x.id)),
    addedFx: new Set(c.fixtures.added), movedFx: new Set([...c.fixtures.moved.map((x) => x.id), ...c.fixtures.changed.map((x) => x.id)]),
  };
  cache = { net: doc.network, fx: doc.fixtures, bld: doc.building, target, out };
  return out;
}

/** 比較の色: 増えた=緑、なくなった=赤、変わった・動いた=だいだい */
export const DIFF_COLOR = { added: '#16a34a', removed: '#dc2626', changed: '#ea580c' } as const;
