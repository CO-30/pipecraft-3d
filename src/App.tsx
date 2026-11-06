import { useState } from 'react';
import { HomeScreen } from './ui/HomeScreen';
import { Editor } from './ui/Editor';
import type { NewProjectInput } from './ui/NewProjectDialog';
import { emptyDoc, useStore } from './state/store';
import { repo } from './storage/instance';
import { flushNow, useSaveState } from './ui/autosave';
import { createBuildingFromDims } from './model/building';
import { emptyNetwork } from './model/network';
import { newId } from './model/id';
import './App.css';

export default function App() {
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const [error, setError] = useState('');
  const save = useSaveState();

  const open = async (id: string) => {
    try {
      const p = await repo.load(id);
      if (!p) throw new Error('現場が見つかりません');
      useStore.getState().openProject(p);
      setScreen('editor');
    } catch (e) {
      setError('現場を開けませんでした: ' + (e as Error).message);
    }
  };

  const create = async (v: NewProjectInput) => {
    const doc = v.mode === 'dims'
      ? { building: createBuildingFromDims(v), network: emptyNetwork() }
      : emptyDoc();
    const meta = { id: newId('p'), name: v.name, address: v.address || undefined, createdAt: Date.now() };
    const st = useStore.getState();
    st.newDoc(doc, meta);
    try {
      await repo.save(st.toProjectData()!);
      setScreen('editor');
    } catch (e) {
      setError('保存できませんでした: ' + (e as Error).message);
    }
  };

  const back = async () => {
    await flushNow();
    useStore.getState().closeProject();
    setScreen('home');
  };

  return (
    <>
      {error && <div className="toast" role="alert" onClick={() => setError('')}>{error}（タップで閉じる）</div>}
      {screen === 'home' ? <HomeScreen onOpen={open} onCreate={create} /> : <Editor save={save} onBack={back} />}
    </>
  );
}

// E2Eテスト用に共通ストアを公開（e2e ビルドのみ）
if (import.meta.env.MODE === 'e2e') (window as unknown as { __pc: typeof useStore }).__pc = useStore;
