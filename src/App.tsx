import { setPendingUnderlayFile } from './import/pending';
import { defaultEstimate } from './model/estimate';
import { useEffect, useState } from 'react';
import { HomeScreen } from './ui/HomeScreen';
import { Editor } from './ui/Editor';
import type { NewProjectInput } from './ui/NewProjectDialog';
import { emptyDoc, useStore } from './state/store';
import { repo } from './storage/instance';
import { flushNow, useSaveState } from './ui/autosave';
import { addFloor, createBuildingFromDims, emptyBuilding, type Building } from './model/building';
import { emptyNetwork } from './model/network';
import { newId } from './model/id';
import './App.css';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { buildSample, SAMPLE_NAME } from './sample/sample';
import { ImportReportDialog } from './ui/ImportReportDialog';
import type { ImportReport, PlacedCandidate } from './model/planRead/assemble';
import { applyLearned } from './learn/fixtureLearning';
import { learnStore, startFixtureLearning } from './learn/learnStore';
import type { LearnedCandidate } from './ui/ImportReportDialog';

export default function App() {
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const [error, setError] = useState('');
  /** 「外壁の写真から測る」で作った直後は立面の作成画面を開く */
  const [startFacade, setStartFacade] = useState(false);
  /** 「図面から自動で3Dにする」の読み取り中の表示と、読み取り結果 */
  const [busy, setBusy] = useState('');
  /** fixtures: 直し方の記録に合わせた候補、raw: 合わせる前（「覚えた直し方を消す」で戻す） */
  const [report, setReport] = useState<{ report: ImportReport; fixtures: LearnedCandidate[]; raw: PlacedCandidate[] } | null>(null);
  // 図面から置いた器具を使う人が直したら、この端末に覚える
  useEffect(() => startFixtureLearning(useStore), []);
  const save = useSaveState();

  const open = async (id: string) => {
    try {
      setPendingUnderlayFile(null); // 前に選んだ図面を別の工事へ取り込まない
      const r = await repo.loadWithStatus(id);
      if (!r) throw new Error('工事が見つかりません');
      useStore.getState().openProject(r.project);
      setScreen('editor');
      if (r.recovered) setError('保存データの一部が壊れていたため、直前に保存した版から復旧しました。内容を確認してください');
    } catch (e) {
      setError('工事を開けませんでした: ' + (e as Error).message);
    }
  };

  const create = async (v: NewProjectInput): Promise<boolean> => {
    let auto: Awaited<ReturnType<typeof import('./import/planSet').importPlanSet>> | null = null;
    if (v.mode === 'auto') {
      setBusy('図面を読み取っています…');
      try {
        auto = await (await import('./import/planSet')).importPlanSet(v.files ?? []);
      } catch (e) {
        // PlanReadError は使う人向けの文。それ以外は想定外の失敗
        setError((e as Error).name === 'PlanReadError' ? (e as Error).message : '図面を読み取れませんでした。PDF が壊れていないか確かめて、もう一度試してください（詳細: ' + (e as Error).message + '）');
        return false;
      } finally {
        setBusy('');
      }
    }
    const doc = auto
      ? { ...emptyDoc(), building: auto.building, underlays: auto.underlays, site: auto.designGL === undefined ? {} : { designGL: auto.designGL } }
      : v.mode === 'dims'
      ? { building: createBuildingFromDims(v), network: emptyNetwork(), fixtures: {}, estimate: defaultEstimate(), underlays: {} }
      : v.mode === 'sketch' || v.mode === 'photo' || v.mode === 'facade' ? { ...emptyDoc(), building: emptyFloors(v.floors, v.floorHeight) } : emptyDoc();
    const meta = { id: newId('p'), name: v.name, address: v.address || undefined, createdAt: Date.now() };
    const st = useStore.getState();
    st.newDoc(doc, meta);
    if (v.mode === 'sketch') st.setTool('outline');
    setPendingUnderlayFile(v.mode === 'photo' ? v.file ?? null : null);
    if (v.mode === 'photo') st.setTool('underlay');
    try {
      await repo.save(st.toProjectData()!);
      setStartFacade(v.mode === 'facade');
      setScreen('editor');
      setReport(auto ? { report: auto.report, fixtures: applyLearned(auto.fixtures, learnStore.loadSamples()), raw: auto.fixtures } : null);
      return true;
    } catch (e) {
      setPendingUnderlayFile(null);
      setError('保存できませんでした: ' + (e as Error).message);
      return false;
    }
  };

  /** サンプル工事を新しく作って開く（毎回別の工事として保存するので壊しても良い） */
  const sample = async () => {
    try {
      buildSample({ id: newId('p'), name: SAMPLE_NAME, createdAt: Date.now() });
      await repo.save(useStore.getState().toProjectData()!);
      setScreen('editor');
    } catch (e) {
      setError('サンプルを開けませんでした: ' + (e as Error).message);
    }
  };

  const back = async () => {
    const ok = await flushNow();
    if (!ok && !window.confirm('最新の変更がまだ保存できていません。一覧に戻ると、この変更は失われるおそれがあります。それでも戻りますか？\n（「キャンセル」でこの画面に残り、自動で再保存を試みます）')) return;
    useStore.getState().closeProject();
    setScreen('home');
  };

  return (
    <>
      {error && <div className="toast" role="alert" onClick={() => setError('')}>{error}（タップで閉じる）</div>}
      {screen === 'home' ? <HomeScreen onOpen={open} onCreate={create} onSample={sample} /> : <Editor save={save} onBack={back} startFacade={startFacade} onFacadeStarted={() => setStartFacade(false)} />}
      {busy && <div className="modal-back busy-back" role="status" aria-live="polite" aria-busy="true"><div className="modal busy" data-testid="busy">{busy}</div></div>}
      {report && screen === 'editor' && (
        <ImportReportDialog report={report.report} fixtures={report.fixtures}
          floorNames={Object.fromEntries(useStore.getState().doc.building.floors.map((f) => [f.id, f.name]))}
          learnedCount={learnStore.sampleCount()}
          onForget={() => { learnStore.clearSamples(); setReport({ ...report, fixtures: report.raw }); }}
          onClose={(place) => {
            if (place.length) {
              const st = useStore.getState();
              const ids = st.placeFixtureCandidates(place);
              const meta = st.meta;
              if (meta) learnStore.watchPlaced(meta.id, place.flatMap((c, i) => (ids[i] && c.room ? [{ id: ids[i]!, type: c.type, room: c.room }] : [])));
            }
            setReport(null);
          }} />
      )}
      <UpdatePrompt />
    </>
  );
}

// 端末の空き容量が少ないときにブラウザがデータを消さないよう、永続保存を要求（対応ブラウザのみ）
void navigator.storage?.persist?.().catch(() => undefined);

// E2Eテスト用に共通ストアを公開（e2e ビルドのみ）
if (import.meta.env.MODE === 'e2e') (window as unknown as { __pc: typeof useStore }).__pc = useStore;

/** 壁のない階を n 階分（外形をなぞると全階に外壁が入る） */
function emptyFloors(n: number, height: number): Building {
  let b = emptyBuilding();
  for (let i = 0; i < n; i++) b = addFloor(b, { height }).b;
  return b;
}
