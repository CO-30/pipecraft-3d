import { useEffect, useState } from 'react';
import { PlanView } from './PlanView';
import { View3D } from './View3D';
import { useStore } from '../state/store';
import { totalLength } from '../model/network';
import { FloorBar, PropertyPanel, Toolbar, VisibilityPanel } from './Panels';
import type { SaveState } from './autosave';
import { EstimateBar, EstimateScreen } from './EstimateScreen';
import { usePrefs } from './prefs';

type Layout = '2d' | '3d' | 'split';

export function Editor({ save, onBack }: { save: SaveState; onBack: () => void }) {
  const meta = useStore((s) => s.meta);
  const net = useStore((s) => s.doc.network);
  const sel = useStore((s) => s.selection);
  const isWide = useWide();
  const [layout, setLayout] = useState<Layout>('split');
  const [showVis, setShowVis] = useState(false);
  const [showEst, setShowEst] = useState(false);
  const unit = usePrefs((s) => s.lengthUnit);
  const eff: Layout = !isWide && layout === 'split' ? '2d' : layout;

  return (
    <div className={`app ${isWide ? 'wide' : 'narrow'}`} data-testid="editor">
      <header>
        <button className="back" data-testid="back-home" onClick={onBack} aria-label="現場一覧へ戻る">‹ 一覧</button>
        <strong className="pname" data-testid="project-name">{meta?.name}</strong>
        <div className="seg-btns">
          {(['2d', 'split', '3d'] as Layout[]).filter((l) => isWide || l !== 'split').map((l) => (
            <button key={l} className={eff === l ? 'on' : ''} onClick={() => setLayout(l)}>{l === '2d' ? '2D' : l === '3d' ? '3D' : '2D+3D'}</button>
          ))}
        </div>
        <button data-testid="open-estimate" className="est-open" onClick={() => setShowEst(true)}>積算</button>
        {!isWide && <button data-testid="toggle-vis" className={showVis ? 'on' : ''} onClick={() => setShowVis(!showVis)}>表示</button>}
        <span className="sum">総延長 <b data-testid="total-length">{unit === 'm' ? (totalLength(net) / 1000).toFixed(2) : Math.round(totalLength(net))}</b>{unit}／<b data-testid="seg-count">{Object.keys(net.segments).length}</b>区間</span>
        <span data-testid="save-state" className={`save ${save}`}>{save === 'saved' ? '保存済み' : save === 'saving' ? '保存中…' : '保存失敗'}</span>
      </header>

      <div className="body">
        {isWide && (
          <aside className="left">
            <h3>階</h3>
            <FloorBar />
            <h3>表示</h3>
            <VisibilityPanel />
          </aside>
        )}
        <main className={`views ${eff}`}>
          {eff !== '3d' && <PlanView />}
          {eff !== '2d' && <View3D />}
          {!isWide && showVis && <div className="sheet"><VisibilityPanel /></div>}
        </main>
        {isWide && (
          <aside className="right">
            <h3>設定</h3>
            <PropertyPanel />
          </aside>
        )}
      </div>

      {!isWide && (
        <section className="panel">
          {!sel && <FloorBar />}
          <PropertyPanel />
        </section>
      )}
      {isWide && <EstimateBar onOpen={() => setShowEst(true)} />}
      <Toolbar />
      {showEst && <EstimateScreen onClose={() => setShowEst(false)} />}
    </div>
  );
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
