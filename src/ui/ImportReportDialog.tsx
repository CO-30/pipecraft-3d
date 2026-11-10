import type { ImportReport } from '../model/planRead/assemble';

/** 図面から自動で作った直後に、何を読めて何を確かめてほしいかを見せる */
export function ImportReportDialog({ report, onClose }: { report: ImportReport; onClose: () => void }) {
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
        <p className="hint">平面図を下に敷いてあります。違っている壁はタップして「削除」、足りない壁は「壁」の道具でなぞって足せます。「3D」で立体を確かめてください。</p>
        <div className="modal-btns">
          <button type="button" className="primary big" data-testid="ir-ok" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}
