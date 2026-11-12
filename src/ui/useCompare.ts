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

/** 比べている版と今の違い（比べていなければ null）。比べていないときは図面の変化で描き直さない */
export function useCompare(): ShownCompare | null {
  const target = useStore((s) => s.compare);
  const net = useStore((s) => (s.compare ? s.doc.network : null));
  const fx = useStore((s) => (s.compare ? s.doc.fixtures : null));
  const bld = useStore((s) => (s.compare ? s.doc.building : null));
  const dragging = useStore((s) => s.dragBase !== null);
  return compute(target, net, fx, bld, dragging);
}

function compute(target: CompareTarget | null, net: Doc['network'] | null, fx: Doc['fixtures'] | null, bld: Doc['building'] | null, dragging: boolean): ShownCompare | null {
  if (!target || !net || !fx || !bld) return null;
  // ドラッグ中は前の結果のまま（離したら比べ直す）
  if (cache && cache.target === target && ((cache.net === net && cache.fx === fx && cache.bld === bld) || dragging)) return cache.out;
  const c = compareDocs(target.doc, { building: bld, network: net, fixtures: fx });
  const out: ShownCompare = {
    ...c, target,
    addedSegs: new Set(c.segments.added), changedSegs: new Set(c.segments.changed.map((x) => x.id)),
    addedFx: new Set(c.fixtures.added), movedFx: new Set([...c.fixtures.moved.map((x) => x.id), ...c.fixtures.changed.map((x) => x.id)]),
  };
  cache = { net, fx, bld, target, out };
  return out;
}

/** 比較の色: 増えた=緑、なくなった=赤、変わった・動いた=だいだい */
export const DIFF_COLOR = { added: '#16a34a', removed: '#dc2626', changed: '#ea580c' } as const;
