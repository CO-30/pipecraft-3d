/**
 * 下敷き（図面・写真・航空写真）の読み込みと調整。「下敷き」ツールのパネル。
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { DEFAULT_PAPER_SCALE, PAPER_SCALES, initialPlacement, paperScaleOf, type Underlay } from '../model/underlay';
import { fileToRaster } from '../import/image';
import type { PdfDoc, PdfRaster } from '../import/pdf';
import { takePendingUnderlayFile, underlayFileKind } from '../import/pending';
import { NumField, OptNumField } from './Panels';
import { SiteImportDialog } from './SiteImportDialog';

/** 画面中央付近の図面座標（新しい下敷きを置く位置） */
const viewCenter = () => {
  const { doc, activeFloorId } = useStore.getState();
  const cs = Object.values(doc.building.corners).filter((c) => c.floorId === activeFloorId);
  if (!cs.length) return { x: 5000, y: 4000 };
  return { x: (Math.min(...cs.map((c) => c.x)) + Math.max(...cs.map((c) => c.x))) / 2, y: (Math.min(...cs.map((c) => c.y)) + Math.max(...cs.map((c) => c.y))) / 2 };
};

export function UnderlayPanel() {
  const floorId = useStore((s) => s.activeFloorId);
  const all = useStore((s) => s.doc.underlays);
  const activeId = useStore((s) => s.activeUnderlayId);
  const scalePick = useStore((s) => s.scalePick);
  const show = useStore((s) => s.showUnderlays);
  const st = useStore.getState();
  const list = Object.values(all ?? {}).filter((u) => u.floorId === floorId);
  const active = list.find((u) => u.id === activeId) ?? null;
  const imgRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const cadRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [pdf, setPdf] = useState<{ doc: PdfDoc; name: string; page: number } | null>(null);
  const [site, setSite] = useState(false);

  const add = (r: { src: string; widthPx: number; heightPx: number }, kind: Underlay['kind'], label: string) => {
    // 読み込み中に階を切り替えても、置く階と位置がずれないように今の階を使う
    st.addUnderlay({ floorId: useStore.getState().activeFloorId, kind, label, ...r, ...initialPlacement(r.widthPx, r.heightPx, viewCenter()), opacity: 0.6 });
  };
  /** PDF は紙の大きさが分かるので、図面の縮尺（読めなければ仮に 1/100）を掛けて実寸で置く */
  const addPdfPage = ({ paperMmPerPx, scaleHint, ...r }: PdfRaster, label: string) => {
    const n = scaleHint ?? DEFAULT_PAPER_SCALE;
    const id = st.addUnderlay({ floorId: useStore.getState().activeFloorId, kind: 'pdf', label, ...r, paperMmPerPx, ...initialPlacement(r.widthPx, r.heightPx, viewCenter(), paperMmPerPx * n), scaled: scaleHint !== undefined, opacity: 0.6 });
    if (id) setNote(scaleHint !== undefined
      ? `図面の文字から縮尺 1/${n} を読み取り、実寸で置きました。寸法が合わないときは「図面の縮尺」を選び直すか「2点で縮尺」で合わせてください。`
      : `図面から縮尺を読み取れなかったので、仮に 1/${n} で置きました。「図面の縮尺」を選んでください（縮小印刷された図面は「2点で縮尺」で合わせます）。`);
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(''); setNote('');
    try { await fn(); } catch (e) { setErr(`${label}できませんでした: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(''); }
  };

  const baseName = (f: File) => f.name.replace(/\.[^.]+$/, '');
  const addImage = (f: File) => run('読み込み', async () => add(await fileToRaster(f), 'image', baseName(f)));
  const addPdf = (f: File) => run('PDFの読み込み', async () => {
    const { openPdf } = await import('../import/pdf');
    const doc = await openPdf(await f.arrayBuffer());
    if (doc.pages === 1) { addPdfPage(await doc.render(1), baseName(f)); doc.destroy(); } else setPdf({ doc, name: baseName(f), page: 1 });
  });
  /** Jw_cad（.jww）: 縮尺は図面から分かるので、縮尺確定済みの線画として置く */
  const addCad = (f: File) => run('Jw_cad図面の読み込み', async () => {
    const [{ readJww }, { renderCad }] = await Promise.all([import('../import/jww'), import('../import/cadRender')]);
    const d = await readJww(await f.arrayBuffer());
    if (d.empty) throw new Error('図面に線や文字が見つかりませんでした');
    const { mmPerPx, ...r } = renderCad(d);
    const id = st.addUnderlay({ floorId: useStore.getState().activeFloorId, kind: 'image', label: `${baseName(f)}（1/${d.scale}）`, ...r, ...initialPlacement(r.widthPx, r.heightPx, viewCenter(), mmPerPx), opacity: 0.6 });
    if (id) setNote(d.notes.join(' '));
  });
  const addFile = (f: File) => {
    const kind = underlayFileKind(f);
    if (kind === 'pdf') return addPdf(f);
    if (kind === 'jww') return addCad(f);
    if (kind === 'image') return addImage(f);
    setErr('この形式（DXF・DWG など）には対応していません。PDF か Jw_cad の .jww、または写真を選んでください'); setNote('');
    return Promise.resolve();
  };
  // 「新しい工事」で選んだ図面をそのまま取り込む
  useEffect(() => {
    const f = takePendingUnderlayFile();
    if (f) void addFile(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="props underlay-panel" data-testid="underlay-panel">
      <div className="ptitle">下敷き（図面・写真をなぞって壁を描けます）</div>
      <div className="row">
        <button data-testid="ul-image" disabled={!!busy} onClick={() => imgRef.current?.click()}>🖼 写真・画像</button>
        <button data-testid="ul-pdf" disabled={!!busy} onClick={() => pdfRef.current?.click()}>📄 PDF図面</button>
        <button data-testid="ul-cad" disabled={!!busy} onClick={() => cadRef.current?.click()}>📐 Jw_cad図面</button>
        <button data-testid="ul-site" disabled={!!busy} onClick={() => setSite(true)}>🛰 航空写真・建物外形</button>
        <label className="field inline"><input type="checkbox" data-testid="ul-show" checked={show} onChange={(e) => st.setShowUnderlays(e.target.checked)} /> 表示</label>
      </div>
      <input ref={imgRef} type="file" accept="image/*" hidden data-testid="ul-image-file" onChange={(e) => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (f) void addImage(f);
      }} />
      <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden data-testid="ul-pdf-file" onChange={(e) => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (f) void addPdf(f);
      }} />
      {/* accept を付けない: iPhone は .jww を知らない種類として選べなくするため。種類は名前で判定する */}
      <input ref={cadRef} type="file" hidden data-testid="ul-cad-file" onChange={(e) => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (f) void addFile(f);
      }} />
      {pdf && (
        <div className="row" data-testid="pdf-pages">
          <span>{pdf.name}（{pdf.doc.pages}ページ）</span>
          <NumField label="ページ" unit="" value={pdf.page} min={1} max={pdf.doc.pages} onCommit={(v) => setPdf({ ...pdf, page: Math.round(v) })} />
          <button className="primary" disabled={!!busy} onClick={() => void run('PDFの読み込み', async () => { addPdfPage(await pdf.doc.render(pdf.page), `${pdf.name} p${pdf.page}`); pdf.doc.destroy(); setPdf(null); })}>このページを取り込む</button>
          <button onClick={() => { pdf.doc.destroy(); setPdf(null); }}>やめる</button>
        </div>
      )}
      {busy && <div className="muted small">{busy}中…</div>}
      {err && <div className="err" role="alert">{err}</div>}
      {note && <div className="warn small" data-testid="ul-note">{note}</div>}

      {list.length > 0 && (
        <div className="chips" data-testid="ul-list">
          {list.map((u) => (
            <button key={u.id} className={u.id === activeId ? 'on' : ''} onClick={() => st.setActiveUnderlay(u.id)}>
              {u.label || '下敷き'}{u.scaled ? '' : '（縮尺未確定）'}
            </button>
          ))}
        </div>
      )}
      {active && (
        <>
          <div className="small" data-testid="ul-status">
            {active.scaled ? `縮尺: 1px = ${Math.round(active.mmPerPx * 10) / 10}mm` : active.paperMmPerPx
              ? <span className="warn">⚠ 縮尺は仮です。下の「図面の縮尺」を図面に書いてある縮尺に合わせてください</span>
              : <span className="warn">⚠ 縮尺未確定（寸法は参考。「2点で縮尺」で合わせてください）</span>}
            {active.attribution && <span className="muted">　{active.attribution}</span>}
          </div>
          {active.paperMmPerPx && (
            <label className="field inline">図面の縮尺
              {/* 仮の縮尺のうちは「選んでください」を出す（同じ 1/100 を選んでも確定できるように） */}
              <select data-testid="ul-paper-scale" value={active.scaled ? paperScaleOf(active) ?? '' : ''} onChange={(e) => e.target.value && st.setUnderlayPaperScale(active.id, Number(e.target.value))}>
                {!active.scaled ? <option value="">選んでください（仮 1/{paperScaleOf(active) ?? '?'}）</option> : paperScaleOf(active) === undefined && <option value="">2点で合わせた縮尺</option>}
                {PAPER_SCALES.map((n) => <option key={n} value={n}>1/{n}</option>)}
              </select>
            </label>
          )}
          <label className="field inline">濃さ
            {/* 動かしている間は見た目だけ変え、指を離す・フォーカスが外れると履歴1件で確定 */}
            <input type="range" min={0.1} max={1} step={0.05} value={active.opacity} data-testid="ul-opacity"
              onPointerDown={() => st.beginDrag()}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (useStore.getState().dragBase) st.dragUnderlayOpacity(active.id, v);
                else st.updateUnderlay(active.id, { opacity: v }); // キーボード操作
              }}
              onPointerUp={() => st.endDrag()} onPointerCancel={() => st.endDrag()} onBlur={() => st.endDrag()} />
          </label>
          <div className="row">
            <span className="small">回転</span>
            <button onClick={() => st.updateUnderlay(active.id, { rotation: active.rotation + 90 })}>⟲90°</button>
            <button onClick={() => st.updateUnderlay(active.id, { rotation: active.rotation + 1 })}>＋1°</button>
            <button onClick={() => st.updateUnderlay(active.id, { rotation: active.rotation - 1 })}>−1°</button>
            <OptNumField label="" unit="°" value={Math.round(active.rotation * 10) / 10} onCommit={(v) => v !== undefined && st.updateUnderlay(active.id, { rotation: v })} />
          </div>
          {!scalePick ? (
            <div className="row">
              <button data-testid="ul-scale" onClick={() => st.startScalePick(active.id)}>📏 2点で縮尺</button>
              <button className="danger" data-testid="ul-delete" onClick={() => { if (window.confirm('この下敷きを削除します。よろしいですか？')) st.deleteUnderlay(active.id); }}>削除</button>
            </div>
          ) : (
            <ScalePick />
          )}
          <div className="muted small">下敷きをドラッグして位置を合わせます。壁ツールに切り替えてなぞると壁を描けます。</div>
        </>
      )}
      {site && <SiteImportDialog onClose={() => setSite(false)} />}
    </div>
  );
}

function ScalePick() {
  const sp = useStore((s) => s.scalePick)!;
  const st = useStore.getState();
  const [mm, setMm] = useState('');
  const d = sp.pts.length === 2 ? Math.hypot(sp.pts[1].x - sp.pts[0].x, sp.pts[1].y - sp.pts[0].y) : 0;
  return (
    <div className="row" data-testid="ul-scalepick">
      {sp.pts.length < 2 ? (
        <span className="warn">図面上の寸法が分かる2点をタップしてください（{sp.pts.length + 1}点目）</span>
      ) : (
        <>
          <span className="small">今の長さ {Math.round(d)}mm →</span>
          <label className="field inline">実寸<span className="unit-input"><input type="number" inputMode="decimal" data-testid="ul-scale-mm" value={mm} onChange={(e) => setMm(e.target.value)} /><span>mm</span></span></label>
          <button className="primary" data-testid="ul-scale-apply" disabled={!(Number(mm) > 0)} onClick={() => st.applyScale(Number(mm))}>縮尺を確定</button>
        </>
      )}
      <button onClick={() => st.cancelScalePick()}>やめる</button>
    </div>
  );
}
