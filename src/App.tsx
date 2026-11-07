import { defaultEstimate } from './model/estimate';
import { useState } from 'react';
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

export default function App() {
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const [error, setError] = useState('');
  const save = useSaveState();

  const open = async (id: string) => {
    try {
      const r = await repo.loadWithStatus(id);
      if (!r) throw new Error('工事が見つかりません');
      useStore.getState().openProject(r.project);
      setScreen('editor');
      if (r.recovered) setError('保存データの一部が壊れていたため、直前に保存した版から復旧しました。内容を確認してください');
    } catch (e) {
      setError('工事を開けませんでした: ' + (e as Error).message);
    }
  };

  const create = async (v: NewProjectInput) => {
    const doc = v.mode === 'dims'
      ? { building: createBuildingFromDims(v), network: emptyNetwork(), fixtures: {}, estimate: defaultEstimate(), underlays: {} }
      : v.mode === 'sketch' || v.mode === 'photo' ? { ...emptyDoc(), building: emptyFloors(v.floors, v.floorHeight) } : emptyDoc();
    const meta = { id: newId('p'), name: v.name, address: v.address || undefined, createdAt: Date.now() };
    const st = useStore.getState();
    st.newDoc(doc, meta);
    if (v.mode === 'sketch') st.setTool('outline');
    if (v.mode === 'photo') st.setTool('underlay');
    try {
      await repo.save(st.toProjectData()!);
      setScreen('editor');
    } catch (e) {
      setError('保存できませんでした: ' + (e as Error).message);
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
      {screen === 'home' ? <HomeScreen onOpen={open} onCreate={create} onSample={sample} /> : <Editor save={save} onBack={back} />}
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
