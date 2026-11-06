import { useEffect, useState } from 'react';
import { PlanView } from './ui/PlanView';
import { View3D } from './ui/View3D';
import { useStore } from './state/store';
import { useAutosave } from './ui/useAutosave';
import { SYSTEMS, systemLabel } from './ui/colors';
import { segmentLength, totalLength, type SystemType } from './model/network';
import './App.css';

type Layout = '2d' | '3d' | 'split';

const HEIGHT_PRESETS: { label: string; z: number }[] = [
  { label: '床下', z: -300 }, { label: '床上', z: 100 }, { label: '壁内', z: 1200 }, { label: '天井裏', z: 2700 },
];

export default function App() {
  const save = useAutosave();
  const net = useStore((s) => s.network);
  const tool = useStore((s) => s.tool);
  const drawAttrs = useStore((s) => s.drawAttrs);
  const selSeg = useStore((s) => s.selectedSegmentId);
  const selNode = useStore((s) => s.selectedNodeId);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [ortho, setOrtho] = useState(true);
  const isWide = useWide();
  const [layout, setLayout] = useState<Layout>('2d');
  const effLayout: Layout = isWide && layout !== '3d' && layout !== '2d' ? 'split' : layout;
  const st = useStore.getState();

  const seg = selSeg ? net.segments[selSeg] : null;
  const node = selNode ? net.nodes[selNode] : null;

  const confirmDeleteBranch = () => {
    if (window.confirm('この枝管を分岐点から先まですべて削除します。よろしいですか？')) st.deleteSelectedBranch();
  };

  return (
    <div className={`app ${isWide ? 'wide' : 'narrow'}`}>
      <header>
        <strong>PipeCraft 3D</strong><span className="tag">技術検証</span>
        <div className="seg-btns">
          {(['2d', 'split', '3d'] as Layout[]).filter((l) => isWide || l !== 'split').map((l) => (
            <button key={l} className={layout === l ? 'on' : ''} onClick={() => setLayout(l)}>{l === '2d' ? '2D' : l === '3d' ? '3D' : '2D+3D'}</button>
          ))}
        </div>
        <span className="sum">総延長 <b data-testid="total-length">{Math.round(totalLength(net))}</b>mm／<b data-testid="seg-count">{Object.keys(net.segments).length}</b>区間</span>
        <span data-testid="save-state" className={`save ${save}`}>{save === 'saved' ? '保存済み' : save === 'saving' ? '保存中…' : save === 'loading' ? '読込中…' : '保存失敗'}</span>
      </header>

      <main className={`views ${effLayout}`}>
        {effLayout !== '3d' && <PlanView orthoDeg={ortho ? 15 : 0} />}
        {effLayout !== '2d' && <View3D />}
      </main>

      <section className="panel">
        {seg ? (
          <div className="row">
            <span>区間 {systemLabel(seg.system)} φ{seg.diameter} 長さ <b data-testid="sel-length">{Math.round(segmentLength(net, seg.id))}</b>mm</span>
            <button className="danger" onClick={() => st.deleteSelected()}>区間削除</button>
            <button className="danger" onClick={confirmDeleteBranch}>枝管ごと削除</button>
            <button onClick={() => st.setTool('draw')}>ここから分岐</button>
          </div>
        ) : node ? (
          <div className="row">
            <span>点（{kindLabel(node.kind)}） 高さ <b data-testid="sel-height">{Math.round(node.pos.z)}</b>mm</span>
            <button onClick={() => st.setNodeHeight(node.id, node.pos.z - 100)}>−100</button>
            <button onClick={() => st.setNodeHeight(node.id, node.pos.z + 100)}>＋100</button>
            {HEIGHT_PRESETS.map((h) => <button key={h.label} onClick={() => st.setNodeHeight(node.id, h.z)}>{h.label}</button>)}
          </div>
        ) : (
          <div className="row">
            <label>種類 <select value={drawAttrs.system} onChange={(e) => st.setDrawAttrs({ system: e.target.value as SystemType })}>
              {SYSTEMS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select></label>
            <label>口径 <select value={drawAttrs.diameter} onChange={(e) => st.setDrawAttrs({ diameter: Number(e.target.value) })}>
              {[13, 16, 20, 25, 32, 40, 50, 65, 75, 100].map((d) => <option key={d} value={d}>φ{d}</option>)}
            </select></label>
            <label><input type="checkbox" checked={ortho} onChange={(e) => setOrtho(e.target.checked)} /> 直角補正</label>
          </div>
        )}
      </section>

      <nav className="toolbar">
        <button data-testid="tool-draw" className={tool === 'draw' ? 'on' : ''} onClick={() => st.setTool('draw')}>✏️<span>描く</span></button>
        <button data-testid="tool-select" className={tool === 'select' ? 'on' : ''} onClick={() => st.setTool('select')}>👆<span>選択</span></button>
        <button data-testid="undo" disabled={!canUndo} onClick={() => st.undo()}>↶<span>戻す</span></button>
        <button data-testid="redo" disabled={!canRedo} onClick={() => st.redo()}>↷<span>やり直し</span></button>
      </nav>
    </div>
  );
}

function kindLabel(k: string) {
  return ({ end: '端点', joint: '接続', elbow: '曲がり', tee: '分岐', cross: '十字', valve: 'バルブ', fixture: '設備' } as Record<string, string>)[k] ?? k;
}

function useWide() {
  const q = '(min-width: 900px)';
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

// E2Eテスト用に共通ストアを公開（技術検証版のみ。本実装で除去する）
(window as unknown as { __pc: typeof useStore }).__pc = useStore;
