/**
 * 作業手順ガイド（図面の上の1行）。いまの工程・次にやること・その作業を始めるボタン。
 * タップで8工程の一覧を開き、どの工程へも移れる（経験者は自由に操作できる）。
 */
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { currentShinseiStep, currentStep, guideSteps, shinseiSteps, type GuideStepId, type ShinseiCtx, type ShinseiStep, type ShinseiStepId } from '../model/guide';
import { usePrefs } from './prefs';
import { runAutoConnect } from './autoConnectRun';
import { unconnectedPorts } from './inspection';
import { resolveProfile } from '../model/municipality';
import { useProfiles } from './useProfiles';
import { FORM_SETS } from '../forms/formSets';
import { EMPTY_CONTRACTOR, withDefaults } from '../forms/types';
import { roadValues } from '../road/fields';
import { confirmQuestions } from '../model/confirmQuestions';
import type { Doc } from '../model/doc';

export type EstimateTab = 'qty' | 'quote';

const DO_LABEL: Record<GuideStepId, string> = {
  info: '工事名を確認', drawing: '図面を取り込む', layout: '間取りを描く', fixtures: '設備を置く',
  pipes: '配管を描く', lengths: '長さを入れる', quantities: '集計を見る', quote: '見積を作る',
};

const S_DO_LABEL: Record<ShinseiStepId, string> = {
  sDrawing: '図面を取り込む', sFixtures: '器具を置く', sConnect: '自動でつなぐ', sQuestions: '質問に答える', sDocs: '書類を出す',
};

/** 申請の手順の数（つなぎ忘れ・答えていない質問・自治体）。書類センター（提出書類一式）と同じ数え方 */
export function shinseiCtx(doc: Doc, meta: { name: string; address?: string } | null, userProfiles: Parameters<typeof resolveProfile>[1]): ShinseiCtx {
  const id = doc.site?.municipalityProfileId;
  const profile = resolveProfile(id, userProfiles);
  const set = FORM_SETS[profile.id];
  const m = { name: meta?.name ?? '', address: meta?.address };
  const values = set ? withDefaults(set, doc, m) : (doc.site?.application ?? {});
  const qs = confirmQuestions(set, doc.site?.application, values, roadValues(doc, m, EMPTY_CONTRACTOR, {}));
  return { openPorts: unconnectedPorts(doc).length, openQuestions: qs.filter((q) => !q.answered).length, municipality: !!id && profile.id !== 'standard' };
}

/** 道具を切り替えて図面を見せる */
function goTool(onPlan: () => void, tool: Parameters<ReturnType<typeof useStore.getState>['setTool']>[0], notice?: string) {
  const st = useStore.getState();
  onPlan(); // 3Dだけの表示なら図面の見える表示へ
  if (st.activeElevationId) st.openElevation(null);
  st.setTool(tool);
  st.select(null);
  if (notice) useStore.setState({ notice });
}

/** 申請の工程の作業を始める */
function runShinsei(step: ShinseiStep, onPlan: () => void, onShinsei: () => void) {
  switch (step.id) {
    case 'sDrawing': goTool(onPlan, 'underlay', '「画像・PDFを追加」から建築図面を選びます（壁を指でなぞって描いてもかまいません）'); return;
    case 'sFixtures': goTool(onPlan, 'fixture', '下の一覧から器具を選び、図面の置きたい所をタップ。水道メーター・公共汚水ますも置いてください'); return;
    case 'sConnect': {
      // 器具が無ければつなぐ物が無い。済んでいれば押し直してもつなぎ直さない（元に戻す が増えないように）
      if (!Object.keys(useStore.getState().doc.fixtures).length) { goTool(onPlan, 'fixture', '先に器具を置いてください（下の一覧から器具を選び、図面の置きたい所をタップ）'); return; }
      if (step.done) { goTool(onPlan, 'select', 'もうつながっています。直すときは配管をタップしてください'); return; }
      goTool(onPlan, 'select');
      runAutoConnect();
      return;
    }
    case 'sQuestions': case 'sDocs': onShinsei(); return;
  }
}

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

export function GuideBar({ onEstimate, onPlan, onShinsei }: {
  onEstimate: (tab: EstimateTab) => void; onPlan: () => void;
  /** 申請の手順の「質問」「書類」: 申請図面の画面で「提出書類一式」を開く */
  onShinsei: () => void;
}) {
  const mode = usePrefs((s) => s.guideMode);
  const hidden = usePrefs((s) => s.guideHidden);
  if (hidden) return null;
  if (mode === 'shinsei') return <ShinseiGuide onPlan={onPlan} onShinsei={onShinsei} />;
  return <EstimateGuide onEstimate={onEstimate} onPlan={onPlan} />;
}

/** 手順の切り替え（見積まで／申請の書類まで）。どちらの一覧にも出す */
function ModeSwitch() {
  const mode = usePrefs((s) => s.guideMode);
  const setMode = usePrefs((s) => s.setGuideMode);
  return (
    <div className="guide-mode" role="group" aria-label="手順の種類">
      <button type="button" data-testid="guide-mode-estimate" aria-pressed={mode === 'estimate'} onClick={() => setMode('estimate')}>{mode === 'estimate' ? '● ' : '○ '}見積までの手順</button>
      <button type="button" data-testid="guide-mode-shinsei" aria-pressed={mode === 'shinsei'} onClick={() => setMode('shinsei')}>{mode === 'shinsei' ? '● ' : '○ '}申請の書類までの手順</button>
    </div>
  );
}

function ShinseiGuide({ onPlan, onShinsei }: { onPlan: () => void; onShinsei: () => void }) {
  // 数えるのは少し重いので、ドラッグ中などは後回しにする（表示が少し遅れても操作は止めない）
  const doc = useDeferredValue(useStore((s) => s.doc));
  const meta = useStore((s) => s.meta);
  const user = useProfiles((s) => s.user);
  const steps = useMemo(() => shinseiSteps(doc, shinseiCtx(doc, meta, user)), [doc, meta, user]);
  const cur = currentShinseiStep(steps);
  const [open, setOpen] = useState(false);
  const setHidden = usePrefs((s) => s.setGuideHidden);
  const run = (st: ShinseiStep) => { setOpen(false); runShinsei(st, onPlan, onShinsei); };
  return (
    <div className="guide" data-testid="guide-bar" data-mode="shinsei">
      <div className="guide-row">
        <button className="guide-main" data-testid="guide-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="guide-dots" aria-hidden>{steps.map((s) => <i key={s.id} className={s.id === cur.id ? 'cur' : s.done ? 'done' : ''} />)}</span>
          <span className="guide-text" data-testid="guide-current" data-step={cur.id}>
            <b>申請 {cur.no}/{steps.length} {cur.title}</b>
            <span className="guide-hint">{cur.progress ? `${cur.progress}。` : ''}{cur.hint}</span>
          </span>
          <span className="guide-caret" aria-hidden>{open ? '▴' : '▾'}</span>
        </button>
        <button className="primary guide-do" data-testid="guide-do" onClick={() => run(cur)}>{S_DO_LABEL[cur.id]} ›</button>
      </div>
      {open && (
        <div className="guide-list" data-testid="guide-list">
          <ModeSwitch />
          <ol>
            {steps.map((s) => (
              <li key={s.id} className={s.id === cur.id ? 'cur' : ''}>
                <button data-testid={`guide-step-${s.id}`} onClick={() => run(s)}>
                  <span className={`gmark ${s.done ? 'done' : ''}`}>{s.done ? '✓' : s.no}</span>
                  <span className="gtitle">{s.title}{s.progress && <small className="gprog"> {s.progress}</small>}</span>
                  <span className="gdesc">{s.hint}</span>
                </button>
              </li>
            ))}
          </ol>
          <button className="linkish" data-testid="guide-hide" onClick={() => { setOpen(false); setHidden(true); }}>ガイドを隠す（上の「手順」でまた表示）</button>
        </div>
      )}
    </div>
  );
}

function EstimateGuide({ onEstimate, onPlan }: { onEstimate: (tab: EstimateTab) => void; onPlan: () => void }) {
  const doc = useStore((s) => s.doc);
  const steps = useMemo(() => guideSteps(doc), [doc]);
  const cur = currentStep(steps);
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(false);
  const setHidden = usePrefs((s) => s.setGuideHidden);
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
          <ModeSwitch />
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
