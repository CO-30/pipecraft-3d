/**
 * 「まとめてPDF」: 申請図面をまとめて 1 つの PDF にする。
 * 図面ごとに作れるか（注意の数・作れない理由）を一目で出し、作れるものは最初からチェック。1 押しで出力する。
 * 中身は各タブの PDF と同じ作図（buildFor）を使う。
 */
import { useEffect, useMemo, useState } from 'react';
import { BUNDLE_KINDS, KIND_LABEL, type Kind, type ShinseiBuild } from './shinseiBuild';

type BKind = (typeof BUNDLE_KINDS)[number];

/** 一行の状態: 作れる・注意あり・読み込み中・作れない */
function rowStatus(b: ShinseiBuild): { ready: boolean; loading: boolean; text: string } {
  if (b.error) return { ready: false, loading: false, text: `作れません: ${b.error}` };
  if (!b.sheets.length) {
    const loading = b.warnings.some((w) => w.includes('読み込んでいます'));
    return { ready: false, loading, text: loading ? '読み込み中…' : `作れません${b.warnings[0] ? `: ${b.warnings[0]}` : ''}` };
  }
  const n = b.warnings.length;
  return { ready: true, loading: false, text: n ? `⚠ 注意 ${n} 件（「見る」で確かめられます）` : '✓ 作れます' };
}

export function ShinseiBundleDialog({ buildFor, busy, asBuilt, onPdf, onShow, onClose }: {
  buildFor: (k: BKind) => ShinseiBuild;
  busy: boolean;
  /** 竣工図の設定がオン（題名に出す） */
  asBuilt: boolean;
  onPdf: (builds: ShinseiBuild[]) => void;
  onShow: (k: Kind) => void;
  onClose: () => void;
}) {
  const rows = useMemo(() => BUNDLE_KINDS.map((k) => { const b = buildFor(k); return { k, b, st: rowStatus(b) }; }), [buildFor]);
  /** 使う人が変えたチェック（変えていない図面は「作れるならチェック」） */
  const [picked, setPicked] = useState<Partial<Record<BKind, boolean>>>({});
  const on = (r: (typeof rows)[number]) => r.st.ready && (picked[r.k] ?? true);
  const chosen = rows.filter(on);
  const pages = chosen.reduce((n, r) => n + r.b.sheets.length, 0);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="申請図面をまとめてPDF" data-testid="shinsei-bundle-dialog" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal bundle">
        <h2>申請図面をまとめて PDF にする{asBuilt ? '（竣工図）' : ''}</h2>
        <p className="small muted">チェックした図面を 1 つの PDF に入れます。下流端・起点・分岐の選び方は各タブで選んだとおりです。</p>
        <ul className="bundle-list">
          {rows.map((r) => (
            <li key={r.k} data-testid={`shinsei-bundle-row-${r.k}`} className={r.st.ready ? (r.b.warnings.length ? 'warn' : 'ok') : 'ng'}>
              <label>
                <input type="checkbox" checked={on(r)} disabled={!r.st.ready} onChange={(e) => setPicked({ ...picked, [r.k]: e.target.checked })} />
                <b>{KIND_LABEL[r.k]}</b>
                {r.st.ready && <span className="small muted">（{r.b.sheets.length} 枚）</span>}
              </label>
              <span className="bundle-status small" title={r.b.warnings.join('\n') || undefined}>{r.st.text}</span>
              <button type="button" className="linkish small" aria-label={`${KIND_LABEL[r.k]}を見る`} onClick={() => onShow(r.k)}>見る ›</button>
            </li>
          ))}
        </ul>
        <p className="small muted">申請書（Excel・様式の PDF）と道路の書類は「申請書」タブから出します。</p>
        <div className="modal-btns">
          <button type="button" className="big" onClick={onClose}>閉じる</button>
          <button type="button" className="primary big" data-testid="shinsei-bundle-pdf" disabled={busy || chosen.length === 0} onClick={() => onPdf(chosen.map((r) => r.b))}>
            {busy ? '作成中…' : `🖨 PDF にする（${chosen.length} 種類・${pages} 枚）`}
          </button>
        </div>
      </div>
    </div>
  );
}
