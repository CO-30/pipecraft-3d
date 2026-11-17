/**
 * 申請図面で「1 本の管」として長さを 1 か所に書くためのまとまり（純関数）。
 * 器具・桝の無い曲がり（ちょうど 2 本がつながる点）で続く、同じ管種口径の管を 1 本にまとめる。
 * 南風原町の実例: 器具からの枝は「VU50 / 1.2」のように 1 本ごとに 1 回だけ書く（曲がりごとには書かない）。
 */

export type RunItem = { id: string; a: string; b: string; key: string; lengthMm: number };
export type Run = { ids: string[]; key: string; lengthMm: number };

/**
 * items: まとめる候補の管。degree: 点 → その点につながる管の本数（図に出る管すべてで数える）。
 * stops: まとめずに切る点（器具・桝の点）
 */
export function groupRuns(items: RunItem[], degree: Map<string, number>, stops: Set<string>): Run[] {
  const parent = new Map(items.map((q) => [q.id, q.id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const byNode = new Map<string, RunItem[]>();
  for (const q of items) for (const n of [q.a, q.b]) byNode.set(n, [...(byNode.get(n) ?? []), q]);
  for (const [n, qs] of byNode) {
    if (qs.length === 2 && degree.get(n) === 2 && !stops.has(n) && qs[0].key === qs[1].key) parent.set(find(qs[0].id), find(qs[1].id));
  }
  const groups = new Map<string, RunItem[]>();
  for (const q of items) {
    const r = find(q.id);
    groups.set(r, [...(groups.get(r) ?? []), q]);
  }
  return [...groups.values()].map((g) => ({ ids: g.map((q) => q.id), key: g[0].key, lengthMm: g.reduce((t, q) => t + q.lengthMm, 0) }));
}
