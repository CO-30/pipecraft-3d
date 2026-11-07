/**
 * 作業手順ガイド（図面の上の1行）。いまの工程・次にやること・その作業を始めるボタン。
 * タップで8工程の一覧を開き、どの工程へも移れる（経験者は自由に操作できる）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { currentStep, guideSteps, type GuideStepId } from '../model/guide';
import { usePrefs } from './prefs';

export type EstimateTab = 'qty' | 'quote';

const DO_LABEL: Record<GuideStepId, string> = {
  info: '工事名を確認', drawing: '図面を取り込む', layout: '間取りを描く', fixtures: '設備を置く',
  pipes: '配管を描く', lengths: '長さを入れる', quantities: '集計を見る', quote: '見積を作る',
};

/** 工程の作業を始める（道具を切り替える・積算を開く） */
function runStep(id: GuideStepId, onEstimate: (tab: EstimateTab) => void, onInfo: () => void, onPlan: () => void) {
  const st = useStore.getState();
  const go = (tool: Parameters<typeof st.setTool>[0], notice?: string) => {
    onPlan(); // 3Dだけの表示なら図面の見える表示へ
    if (st.activeElevationId) st.openElevation(null);
    st.setTool(tool);
    st.select(null);
    if (notice) useStore.setState({ notice });
  };
  switch (id) {
    case 'info': onInfo(); return;
    case 'drawing': go('underlay', '「画像・PDFを追加」から間取り図を選びます'); return;
    case 'layout': {
      const hasWalls = Object.keys(st.doc.building.walls).length > 0;
      go(hasWalls ? 'wall' : 'outline', hasWalls ? '指でなぞって壁を足せます。部屋・ドア・窓は「建物」から' : '図面に建物の外周を指で1周なぞってください');
      return;
    }
    case 'fixtures': go('fixture', '下の一覧から器具を選び、図面の置きたい所をタップ'); return;
    case 'pipes': go('pipe', '器具の丸（接続口）から指でなぞって配管を描きます'); return;
    case 'lengths': {
      go('select');
      const net = st.doc.network;
      const seg = Object.values(net.segments).find((s) => s.measuredLength === undefined);
      if (!seg) { useStore.setState({ notice: 'すべての配管に実測長が入っています' }); return; }
      const fl = net.nodes[seg.a]?.floorId;
      if (fl && st.doc.building.floors.some((f) => f.id === fl)) st.setActiveFloor(fl);
      st.select({ kind: 'segment', id: seg.id });
      useStore.setState({ notice: '選んだ配管の「実測長」に現場で測った長さを入れてください' });
      return;
    }
    case 'quantities': onEstimate('qty'); return;
    case 'quote': onEstimate('quote'); return;
  }
}

export function GuideBar({ onEstimate, onPlan }: { onEstimate: (tab: EstimateTab) => void; onPlan: () => void }) {
  const doc = useStore((s) => s.doc);
  const steps = useMemo(() => guideSteps(doc), [doc]);
  const cur = currentStep(steps);
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(false);
  const hidden = usePrefs((s) => s.guideHidden);
  const setHidden = usePrefs((s) => s.setGuideHidden);
  if (hidden) return null;
  const run = (id: GuideStepId) => { setOpen(false); runStep(id, onEstimate, () => setInfo(true), onPlan); };
  return (
    <div className="guide" data-testid="guide-bar">
      <div className="guide-row">
        <button className="guide-main" data-testid="guide-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="guide-dots" aria-hidden>{steps.map((s) => <i key={s.id} className={s.id === cur.id ? 'cur' : s.done ? 'done' : s.optional ? 'opt' : ''} />)}</span>
          <span className="guide-text" data-testid="guide-current" data-step={cur.id}>
            <b><span className="wide-only">ステップ </span>{cur.no}/8 {cur.title}</b>
            <span className="guide-hint">{cur.hint}</span>
          </span>
          <span className="guide-caret" aria-hidden>{open ? '▴' : '▾'}</span>
        </button>
        <button className="primary guide-do" data-testid="guide-do" onClick={() => run(cur.id)}>{DO_LABEL[cur.id]} ›</button>
      </div>
      {open && (
        <div className="guide-list" data-testid="guide-list">
          <ol>
            {steps.map((s) => (
              <li key={s.id} className={s.id === cur.id ? 'cur' : ''}>
                <button data-testid={`guide-step-${s.id}`} onClick={() => run(s.id)}>
                  <span className={`gmark ${s.done ? 'done' : ''}`}>{s.done ? '✓' : s.no}</span>
                  <span className="gtitle">{s.title}{s.optional && <small>（任意）</small>}{s.progress && <small className="gprog"> {s.progress}</small>}</span>
                  <span className="gdesc">{s.hint}</span>
                </button>
              </li>
            ))}
          </ol>
          <button className="linkish" data-testid="guide-hide" onClick={() => { setOpen(false); setHidden(true); }}>ガイドを隠す（上の「手順」でまた表示）</button>
        </div>
      )}
      {info && <InfoDialog onClose={() => setInfo(false)} />}
    </div>
  );
}

function InfoDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const meta = useStore((s) => s.meta);
  const [name, setName] = useState(meta?.name ?? '');
  const [address, setAddress] = useState(meta?.address ?? '');
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="工事名・現場情報">
      <form className="modal" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { useStore.getState().renameProject(name.trim(), address.trim() || undefined); onClose(); } }}>
        <h2>工事名・現場情報</h2>
        <label className="field">工事名<input data-testid="info-name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">住所（任意）<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <div className="modal-btns">
          <button type="button" className="big" onClick={onClose}>やめる</button>
          <button type="submit" className="primary big" data-testid="info-save" disabled={!name.trim()}>保存</button>
        </div>
      </form>
    </div>
  );
}
