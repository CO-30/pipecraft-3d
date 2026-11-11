import { useState } from 'react';
import { FIXTURE_CATALOG } from '../model/fixtures';
import type { ImportReport, PlacedCandidate } from '../model/planRead/assemble';

/** learned: 直し方の記録に合わせて置き直した候補（参考にした記録の数） */
export type LearnedCandidate = PlacedCandidate & { learned?: number };

/**
 * 図面から自動で作った直後に、何を読めて何を確かめてほしいかを見せる。
 * 器具は「候補」として出し、チェックしたものだけを置く（onClose に置くものを渡す）。
 */
export function ImportReportDialog({ report, fixtures, floorNames, learnedCount = 0, onForget, onClose }: {
  report: ImportReport; fixtures: LearnedCandidate[]; floorNames: Record<string, string>;
  /** この端末が覚えている直し方の数と、それを消す */
  learnedCount?: number; onForget?: () => void;
  onClose: (place: LearnedCandidate[]) => void;
}) {
  const [on, setOn] = useState(() => fixtures.map(() => true));
  const picked = fixtures.filter((_, i) => on[i]);
  const multiFloor = new Set(fixtures.map((f) => f.floorId)).size > 1;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="図面の読み取り結果">
      <div className="modal import-report" data-testid="import-report">
        <h2>図面を読み取りました</h2>
        {report.found.length > 0 && (
          <>
            <div className="field-label">読み取れたもの</div>
            <ul data-testid="ir-found">{report.found.map((t) => <li key={t}>✅ {t}</li>)}</ul>
          </>
        )}
        {fixtures.length > 0 && (
          <>
            <div className="field-label">器具の候補（置くものにチェック）
              {fixtures.length > 3 && <> <button type="button" className="linkish" data-testid="ir-all" onClick={() => setOn(on.map(() => true))}>すべて選ぶ</button> <button type="button" className="linkish" data-testid="ir-none" onClick={() => setOn(on.map(() => false))}>すべて外す</button></>}
            </div>
            <ul className="cands" data-testid="ir-fixtures">
              {fixtures.map((f, i) => (
                <li key={i}>
                  <label className="inline">
                    <input type="checkbox" data-testid={`ir-fx-${i}`} checked={on[i]} onChange={(e) => setOn(on.map((v, k) => (k === i ? e.target.checked : v)))} />
                    <span><b>{FIXTURE_CATALOG[f.type].label}</b> <span className="muted">— {multiFloor ? `${floorNames[f.floorId] ?? ''} ` : ''}{f.source}{f.near ? '' : f.learned ? `（これまでの直し方 ${f.learned} 件に合わせた位置）` : '（位置は大まか）'}</span></span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="hint">部屋の名前と文字から出した候補です。置いたあと、下の図面の絵に合わせてドラッグで動かし、選んで「⟳ 90°回転」で向きを直してください。足りない器具は「器具」から足せます。</p>
            <p className="hint" data-testid="ir-learn">部屋の名前から出した器具の向き・位置を直すと、この端末が覚えて次から合わせます。
              {learnedCount > 0 && onForget && <> <button type="button" className="linkish" data-testid="ir-forget" onClick={onForget}>覚えた直し方を消す（{learnedCount} 件）</button></>}
            </p>
          </>
        )}
        {report.check.length > 0 && (
          <>
            <div className="field-label">確かめてほしいこと</div>
            <ul className="warn" data-testid="ir-check">{report.check.map((t) => <li key={t}>⚠ {t}</li>)}</ul>
          </>
        )}
        <div className="field-label">選んだ図面</div>
        <ul className="small" data-testid="ir-sheets">
          {report.sheets.map((s, i) => (
            <li key={i} className={s.used ? '' : 'muted'}>{s.used ? '●' : '○'} {s.name}：{s.label}{s.note && ` — ${s.note}`}</li>
          ))}
        </ul>
        <p className="hint">平面図を下に敷いてあります。違っている壁はタップして「削除」、足りない壁は「壁」の道具でなぞって足せます。器具の位置が決まったら「器具」→「🔽 器具の真下に配管を落とす」で床下まで配管が入ります。「3D」で立体を確かめてください。</p>
        <div className="modal-btns">
          {fixtures.length > 0 && picked.length > 0 && <button type="button" className="big" data-testid="ir-skip" onClick={() => onClose([])}>器具は置かない</button>}
          <button type="button" className="primary big" data-testid="ir-ok" onClick={() => onClose(picked)}>{picked.length ? `器具 ${picked.length} 個を置いて閉じる` : 'OK'}</button>
        </div>
      </div>
    </div>
  );
}
