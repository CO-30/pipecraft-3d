import { useState } from 'react';
import { useStore } from '../state/store';
import { wallLength } from '../model/building';
import { determinedLength, isConfirmed, outlineLoop, type FixedEnd } from '../model/sketch';

const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');

/** 外形の辺を時計回りに1本ずつ、実測の長さを入れていくパネル */
export function DimWizard() {
  const wiz = useStore((s) => s.dimWizard);
  const b = useStore((s) => s.doc.building);
  const rev = useStore((s) => s.revision);
  const wallId = wiz ? outlineLoop(b, wiz.floorId)?.walls[wiz.index] : undefined;
  // 辺が変わった・Undo などで図面が変わったら入力欄などを初期化する
  return wiz ? <WizardBody key={`${wiz.floorId}:${wiz.index}:${wallId ?? ''}:${rev}`} /> : null;
}

function WizardBody() {
  const wiz = useStore((s) => s.dimWizard)!;
  const b = useStore((s) => s.doc.building);
  const loop = outlineLoop(b, wiz.floorId);
  const wallId = loop?.walls[wiz.index];
  const det = wallId ? determinedLength(b, wiz.floorId, wallId) : null;
  const confirmed = wallId ? isConfirmed(b.walls[wallId]) : false;
  const [text, setText] = useState(() => (wallId && (confirmed || det !== null) ? String(Math.round(wallLength(b, wallId))) : ''));
  const [fixedStart, setFixedStart] = useState(true);
  const [conflict, setConflict] = useState<{ gap: number; mm: number } | null>(null);
  const [error, setError] = useState('');

  const st = useStore.getState();
  if (!loop || !wallId) {
    return (
      <div className="props dim-wizard" data-testid="dim-wizard">
        <div className="ptitle">外壁が1周つながっていないため、順番に寸法を入れられません</div>
        <button onClick={() => st.closeDimWizard()}>閉じる</button>
      </div>
    );
  }
  const n = loop.walls.length;
  const remaining = loop.walls.filter((id) => !isConfirmed(b.walls[id])).length;
  const i = wiz.index;
  const P = b.corners[loop.corners[i]], Q = b.corners[loop.corners[(i + 1) % n]];
  const dx = Q.x - P.x, dy = Q.y - P.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const arrow = horizontal ? (dx > 0 ? '→' : '←') : dy > 0 ? '↑' : '↓';
  // 画面での端の呼び方（始点側, 終点側）
  const ends: [string, string] = horizontal ? (dx > 0 ? ['左', '右'] : ['右', '左']) : dy > 0 ? ['下', '上'] : ['上', '下'];
  const fixed: FixedEnd = (b.walls[wallId].a === loop.corners[i]) === fixedStart ? 'a' : 'b';

  const nextUnconfirmed = () => {
    const bb = useStore.getState().doc.building;
    for (let k = 1; k <= n; k++) {
      const j = (i + k) % n;
      if (!isConfirmed(bb.walls[loop.walls[j]])) return j;
    }
    return null;
  };
  const advance = () => {
    const j = nextUnconfirmed();
    if (j === null) st.setDimIndex(i + 1); else st.setDimIndex(j);
  };
  const apply = (mm: number, force: boolean) => {
    const r = st.setOutlineLength(wallId, mm, fixed, force);
    if (r.ok) {
      setConflict(null);
      if (r.unconfirmed.length) useStore.setState({ notice: `実測を採用しました。${r.unconfirmed.length}本の辺を未確定に戻したので測り直してください` });
      advance();
    } else if ('conflict' in r) setConflict({ gap: r.conflict.gap, mm });
    else setError(r.error);
  };
  const submit = () => {
    setError('');
    const t = text.trim();
    if (t === '') { advance(); return; }
    const mm = Number(t);
    if (!Number.isFinite(mm) || mm <= 0) { setError('長さを mm で入力してください'); return; }
    if (confirmed && Math.abs(mm - wallLength(b, wallId)) < 0.5) { advance(); return; }
    apply(mm, false);
  };

  return (
    <div className="props dim-wizard" data-testid="dim-wizard">
      <div className="ptitle">
        寸法入力 <b data-testid="dim-step">{i + 1} / {n}</b>
        {remaining ? <span>未確定 <b data-testid="dim-remaining">{remaining}</b> 本</span> : <span className="dim-rest" data-testid="dim-done">すべて入力済み</span>}
      </div>
      <div className="dim-edge">色が変わっている辺（{arrow}）{det !== null && !confirmed
        ? <span className="dim-auto" data-testid="dim-auto">自動計算 {fmt(det)}mm（他の辺から決まります。実測が違えば入れてください）</span>
        : confirmed ? <span>今 {fmt(wallLength(b, wallId))}mm</span> : <span>寸法は「?」</span>}
      </div>
      <form className="dim-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <span className="unit-input big">
          <input autoFocus type="number" inputMode="numeric" data-testid="dim-value" value={text} placeholder="例 3640"
            onChange={(e) => { setText(e.target.value); setConflict(null); setError(''); }} />
          <span>mm</span>
        </span>
        <button type="submit" className="primary big" data-testid="dim-next">{text.trim() === '' ? 'とばす' : '次の辺'}</button>
      </form>
      {error && <p className="err" role="alert">{error}</p>}
      {conflict && (
        <div className="dim-conflict" role="alert" data-testid="dim-conflict">
          形が閉じません：他の確定した辺から決まる長さより {fmt(Math.abs(conflict.gap))}mm {conflict.gap > 0 ? '長い' : '短い'}です
          <div className="row">
            <button data-testid="dim-force" onClick={() => apply(conflict.mm, true)}>実測を採用（合わない辺は未確定に戻す）</button>
            <button onClick={() => { setConflict(null); setText(String(Math.round(wallLength(b, wallId)))); }}>入れ直す</button>
          </div>
        </div>
      )}
      <div className="row">
        <span className="dim-fixed">動かさない側</span>
        <span className="seg-btns small">
          <button type="button" className={fixedStart ? 'on' : ''} onClick={() => setFixedStart(true)}>{ends[0]}</button>
          <button type="button" className={!fixedStart ? 'on' : ''} onClick={() => setFixedStart(false)}>{ends[1]}</button>
        </span>
      </div>
      <div className="row">
        <button onClick={() => st.setDimIndex(i - 1)}>‹ 前の辺</button>
        <button onClick={() => st.setDimIndex(i + 1)}>次の辺 ›</button>
        <button data-testid="dim-close" onClick={() => st.closeDimWizard()}>{remaining ? 'あとで' : '閉じる'}</button>
      </div>
    </div>
  );
}
