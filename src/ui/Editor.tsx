import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PlanView } from './PlanView';
import { ElevationView } from './ElevationView';
// 3D（three.js）は大きいので必要になった時に読み込む
const View3D = lazy(() => import('./View3D').then((m) => ({ default: m.View3D })));
import { useStore } from '../state/store';
import { totalLength } from '../model/network';
import { NotesList } from './Notes';
import { FloorBar, PropertyPanel, SelectionBar, Toolbar, TraceBar, VisibilityPanel } from './Panels';
import type { SaveState } from './autosave';
import { EstimateBar, EstimateScreen, type EstTab } from './EstimateScreen';
import { ShinseiScreen } from './ShinseiScreen';
import { GuideBar, type EstimateTab } from './GuideBar';
import { HelpDialog } from './HelpDialog';
import { PLAN_HINTS } from './hints';
import { usePrefs } from './prefs';
import { DimWizard } from './DimWizard';
import { ElevationDialog } from './ElevationDialog';

type Layout = '2d' | '3d' | 'split';

export function Editor({ save, onBack, startFacade, onFacadeStarted }: { save: SaveState; onBack: () => void; startFacade?: boolean; onFacadeStarted?: () => void }) {
  const [facadeOpen, setFacadeOpen] = useState(!!startFacade);
  useEffect(() => { if (startFacade) onFacadeStarted?.(); }, [startFacade, onFacadeStarted]);
  const meta = useStore((s) => s.meta);
  const net = useStore((s) => s.doc.network);
  const sel = useStore((s) => s.selection);
  const isWide = useWide();
  const [layout, setLayout] = useState<Layout>('split');
  const [showVis, setShowVis] = useState(false);
  const [showEst, setShowEst] = useState<EstTab | null>(null);
  const [help, setHelp] = useState(false);
  const [showShinsei, setShowShinsei] = useState(false);
  const guideHidden = usePrefs((s) => s.guideHidden);
  const setGuideHidden = usePrefs((s) => s.setGuideHidden);
  const openEst = (tab: EstimateTab | EstTab = 'qty') => setShowEst(tab);
  const unit = usePrefs((s) => s.lengthUnit);
  const elevId = useStore((s) => s.activeElevationId);
  const dimOpen = useStore((s) => s.dimWizard !== null);
  const eff: Layout = !isWide && layout === 'split' ? '2d' : layout;
  // スマホ: 選ぶものが変わったら下のパネルを先頭へ（前の選択のスクロール位置のまま中途半端に見えないように）
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { panelRef.current?.scrollTo?.({ top: 0 }); }, [sel?.kind, sel?.id]);
  // 立面図を開いたら、3Dだけの表示から図面の見える表示へ
  useEffect(() => { if (elevId && layout === '3d') setLayout(isWide ? 'split' : '2d'); }, [elevId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`app ${isWide ? 'wide' : 'narrow'}`} data-testid="editor">
      {facadeOpen && <ElevationDialog wallId={null} onClose={() => setFacadeOpen(false)} />}
      <header>
        <button className="back" data-testid="back-home" onClick={onBack} aria-label="工事の一覧へ戻る">‹<span className="wide-only"> 一覧</span></button>
        <strong className="pname" data-testid="project-name">{meta?.name}</strong>
        <span data-testid="save-state" className={`save ${save}`} title={save === 'saved' ? '自動で保存されています' : undefined}>{save === 'saved' ? '保存済み' : save === 'saving' ? '保存中…' : '保存失敗'}</span>
        <div className="seg-btns">
          {(['2d', 'split', '3d'] as Layout[]).filter((l) => isWide || l !== 'split').map((l) => (
            <button key={l} className={eff === l ? 'on' : ''} onClick={() => setLayout(l)}>{l === '2d' ? '2D' : l === '3d' ? '3D' : '2D+3D'}</button>
          ))}
        </div>
        <button data-testid="open-estimate" className="est-open" aria-label="積算・見積" onClick={() => openEst('qty')}>📋<span className="lbl">積算</span></button>
        <button data-testid="open-shinsei" className="est-open" aria-label="申請図面" onClick={() => setShowShinsei(true)}>📐<span className="lbl">申請図面</span></button>
        {!isWide && <button data-testid="toggle-vis" aria-label="表示の切り替え" className={showVis ? 'on' : ''} onClick={() => setShowVis(!showVis)}>👁<span className="lbl">表示</span></button>}
        {guideHidden && <button data-testid="guide-show" onClick={() => setGuideHidden(false)}>手順</button>}
        <button data-testid="open-help-editor" aria-label="使い方" onClick={() => setHelp(true)}>？</button>
        <span className="sum">総延長 <b data-testid="total-length">{unit === 'm' ? (totalLength(net) / 1000).toFixed(2) : Math.round(totalLength(net))}</b>{unit}／<b data-testid="seg-count">{Object.keys(net.segments).length}</b>区間</span>
      </header>
      <GuideBar onEstimate={openEst} onPlan={() => { if (eff === '3d') setLayout(isWide ? 'split' : '2d'); }} />

      <div className="body">
        {isWide && (
          <aside className="left">
            <h3>階</h3>
            <FloorBar />
            <h3>表示</h3>
            <VisibilityPanel compact />
            <NotesList />
          </aside>
        )}
        <main className={`views ${eff}`}>
          {eff !== '3d' && (elevId ? <ElevationView key={elevId} /> : <PlanView />)}
          {eff !== '3d' && !elevId && <PlanCoach onFacade={() => setFacadeOpen(true)} />}
          {eff !== '2d' && <Suspense fallback={<div className="view3d loading">3D を準備中…</div>}><View3D /></Suspense>}
          {!isWide && showVis && <div className="sheet"><VisibilityPanel /><NotesList /></div>}
          <TraceBar />
        </main>
        {isWide && (
          <aside className="right">
            <h3>設定</h3>
            {!dimOpen && <SelectionBar />}
            {dimOpen ? <DimWizard /> : <PropertyPanel />}
          </aside>
        )}
      </div>

      {!isWide && (
        <section className="panel" ref={panelRef}>
          {!sel && !elevId && !dimOpen && <FloorBar compact />}
          {!dimOpen && <SelectionBar />}
          {dimOpen ? <DimWizard /> : <PropertyPanel />}
        </section>
      )}
      {isWide && <EstimateBar onOpen={() => openEst('qty')} onIssues={() => openEst('issues')} />}
      <Notice />
      <Toolbar />
      {showEst && <EstimateScreen initialTab={showEst} onClose={() => setShowEst(null)} />}
      {showShinsei && <ShinseiScreen onClose={() => setShowShinsei(false)} />}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
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

/**
 * つなげない配管などの短いお知らせ。下の図面の操作を邪魔しない（タッチは通り抜ける）。
 * 長い文ほど長く表示（4秒〜10秒）。✕ で閉じられる
 */
function Notice() {
  const notice = useStore((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useStore.getState().clearNotice(), Math.min(10_000, Math.max(4000, notice.length * 90)));
    return () => clearTimeout(t);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className="toast notice" role="status" data-testid="notice">
      {notice}
      <button className="notice-x" aria-label="お知らせを閉じる" onClick={() => useStore.getState().clearNotice()}>✕</button>
    </div>
  );
}

/** 図面の左上に「いまの操作」を出す。何もない工事では最初にやることを中央に大きく出す */
function PlanCoach({ onFacade }: { onFacade: () => void }) {
  const tool = useStore((s) => s.tool);
  const pendingMerge = useStore((s) => s.pendingMerge);
  const empty = useStore((s) => Object.keys(s.doc.building.walls).length === 0 && Object.keys(s.doc.fixtures).length === 0
    && Object.keys(s.doc.network.segments).length === 0 && Object.keys(s.doc.underlays ?? {}).length === 0);
  const [closed, setClosed] = useState<string | null>(null);
  const text = pendingMerge ? '結合する隣の部屋をタップ（他の所をタップで取り消し）' : PLAN_HINTS[tool];
  const st = useStore.getState();
  if (empty && (tool === 'select' || tool === 'outline')) {
    return (
      <div className="plan-empty" data-testid="plan-empty">
        {tool === 'outline' ? (
          <div className="pe-card pe-passive"><b>ここに建物の外周を指で1周なぞってください</b><span>四角でなくても大丈夫。直線・直角に整えます</span></div>
        ) : (
          <div className="pe-card">
            <b>まず建物の形を作りましょう</b>
            <button className="primary big" data-testid="empty-outline" onClick={() => { st.setTool('outline'); st.select(null); }}>✏️ 外周を指でなぞる</button>
            <button className="big" data-testid="empty-underlay" onClick={() => { st.setTool('underlay'); st.select(null); }}>🗺️ 図面を取り込む</button>
            <button className="big" data-testid="empty-facade" onClick={onFacade}>📷 外壁の写真から測る</button>
          </div>
        )}
      </div>
    );
  }
  if (!text || closed === text) return null;
  return (
    <div className={`plan-coach ${pendingMerge ? 'warn' : ''}`} data-testid="plan-coach" onClick={() => setClosed(text)} role="status">
      {text}<button className="pc-x" data-testid="coach-close" aria-label="案内を閉じる" onClick={(e) => { e.stopPropagation(); setClosed(text); }}>✕</button>
    </div>
  );
}
