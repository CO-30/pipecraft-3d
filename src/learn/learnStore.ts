/**
 * 器具の直し方の記録を、この端末（localStorage）に置く。工事データには入れない。
 * 図面から置いた器具を「見張り」、使う人が動かす・回す・消すたびに記録を作り直す（src/learn/fixtureLearning.ts）。
 */
import type { Fixture, FixtureType } from '../model/fixtures';
import type { CandidateRoom } from '../model/planRead/fixtureGuess';
import { sampleFor, type LearnSample } from './fixtureLearning';

export type KeyValue = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
type Watch = { project: string; type: FixtureType; room: CandidateRoom; at: number };

const SAMPLES_KEY = 'pipecraft3d.fixtureLearn.v1';
const WATCH_KEY = 'pipecraft3d.fixtureLearnWatch.v1';
/** 種類ごとに残す記録の数 */
export const KEEP_PER_TYPE = 50;
/** 見張る器具の数（古いものから外す） */
export const KEEP_WATCH = 300;

const same = (a: LearnSample, b: LearnSample) => a.room === b.room && a.flip === b.flip && JSON.stringify(a.f) === JSON.stringify(b.f);

export function createLearnStore(kv: KeyValue | null, now: () => number = Date.now) {
  const read = <T>(k: string, fallback: T): T => {
    try { const s = kv?.getItem(k); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
  };
  const write = (k: string, v: unknown) => { try { kv?.setItem(k, JSON.stringify(v)); } catch { /* 保存できない環境では今回のみ */ } };
  let samples: LearnSample[] = read<LearnSample[]>(SAMPLES_KEY, []);
  if (!Array.isArray(samples)) samples = [];
  let watch: Record<string, Watch> = read<Record<string, Watch>>(WATCH_KEY, {});
  if (!watch || typeof watch !== 'object') watch = {};
  /** 直前に見た位置・向き（同じなら何もしない） */
  const last = new Map<string, string>();

  const saveSamples = (next: LearnSample[]) => {
    // 種類ごとに新しい順で KEEP_PER_TYPE 件まで
    const count = new Map<string, number>();
    samples = [...next].sort((p, q) => q.at - p.at).filter((s) => { const n = (count.get(s.type) ?? 0) + 1; count.set(s.type, n); return n <= KEEP_PER_TYPE; });
    write(SAMPLES_KEY, samples);
  };

  return {
    loadSamples: (): LearnSample[] => samples,
    sampleCount: () => samples.length,
    clearSamples: () => { samples = []; try { kv?.removeItem(SAMPLES_KEY); } catch { /* 今回のみ */ } },
    /** 図面の候補から置いた器具を見張る（project: 工事の id） */
    watchPlaced(project: string, list: { id: string; type: FixtureType; room: CandidateRoom }[]) {
      if (!list.length) return;
      const at = now();
      for (const x of list) watch[x.id] = { project, type: x.type, room: x.room, at };
      const ids = Object.keys(watch);
      if (ids.length > KEEP_WATCH) for (const id of ids.sort((p, q) => watch[p].at - watch[q].at).slice(0, ids.length - KEEP_WATCH)) delete watch[id];
      write(WATCH_KEY, watch);
    },
    /** 開いている工事（project）の器具が変わったら、見張り中の器具の記録を作り直す */
    onFixtures(project: string, fixtures: Record<string, Fixture>) {
      let next = samples, changed = false;
      for (const [id, w] of Object.entries(watch)) {
        if (w.project !== project) continue;
        const f = fixtures[id];
        const pose = f ? `${f.x},${f.y},${f.rotation}` : '';
        if (last.get(id) === pose) continue;
        last.set(id, pose);
        const s = f && f.type === w.type ? sampleFor(id, w.type, w.room, f, now()) : null;
        const old = next.find((x) => x.id === id);
        if (s && old && same(s, old)) continue;
        if (!s && !old) continue;
        next = [...next.filter((x) => x.id !== id), ...(s ? [s] : [])];
        changed = true;
      }
      if (changed) saveSamples(next);
    },
  };
}
export type LearnStore = ReturnType<typeof createLearnStore>;

const safeLocalStorage = (): KeyValue | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
/** この端末の記録 */
export const learnStore: LearnStore = createLearnStore(safeLocalStorage());

/** 共通ストアを購読して、器具が変わるたびに記録を作り直す。戻り値で購読をやめる */
export function startFixtureLearning(store: { getState(): { meta: { id: string } | null; doc: { fixtures: Record<string, Fixture> } }; subscribe(fn: (s: { meta: { id: string } | null; doc: { fixtures: Record<string, Fixture> } }) => void): () => void }, ls: LearnStore = learnStore): () => void {
  let prev: unknown = null;
  return store.subscribe((s) => {
    if (!s.meta || s.doc.fixtures === prev) return;
    prev = s.doc.fixtures;
    ls.onFixtures(s.meta.id, s.doc.fixtures);
  });
}
