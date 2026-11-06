/**
 * 下敷き（図面・写真・航空写真）の読み込みと調整。「下敷き」ツールのパネル。
 */
import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { initialPlacement, type Underlay } from '../model/underlay';
import { fileToRaster } from '../import/image';
import type { PdfDoc } from '../import/pdf';
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
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [pdf, setPdf] = useState<{ doc: PdfDoc; name: string; page: number } | null>(null);
  const [site, setSite] = useState(false);

  const add = (r: { src: string; widthPx: number; heightPx: number }, kind: Underlay['kind'], label: string) => {
    st.addUnderlay({ floorId, kind, label, ...r, ...initialPlacement(r.widthPx, r.heightPx, viewCenter()), opacity: 0.6 });
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr('');
    try { await fn(); } catch (e) { setErr(`${label}できませんでした: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(''); }
  };

  return (
    <div className="props underlay-panel" data-testid="underlay-panel">
      <div className="ptitle">下敷き（図面・写真をなぞって壁を描けます）</div>
      <div className="row">
        <button data-testid="ul-image" disabled={!!busy} onClick={() => imgRef.current?.click()}>🖼 写真・画像</button>
        <button data-testid="ul-pdf" disabled={!!busy} onClick={() => pdfRef.current?.click()}>📄 PDF図面</button>
        <button data-testid="ul-site" disabled={!!busy} onClick={() => setSite(true)}>🛰 航空写真・建物外形</button>
        <label className="field inline"><input type="checkbox" data-testid="ul-show" checked={show} onChange={(e) => st.setShowUnderlays(e.target.checked)} /> 表示</label>
      </div>
      <input ref={imgRef} type="file" accept="image/*" hidden data-testid="ul-image-file" onChange={(e) => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (f) void run('読み込み', async () => add(await fileToRaster(f), 'image', f.name.replace(/\.[^.]+$/, '')));
      }} />
      <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden data-testid="ul-pdf-file" onChange={(e) => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (f) void run('PDFの読み込み', async () => {
          const { openPdf } = await import('../import/pdf');
          const doc = await openPdf(await f.arrayBuffer());
          const name = f.name.replace(/\.[^.]+$/, '');
          if (doc.pages === 1) { add(await doc.render(1), 'pdf', name); doc.destroy(); } else setPdf({ doc, name, page: 1 });
        });
      }} />
      {pdf && (
        <div className="row" data-testid="pdf-pages">
          <span>{pdf.name}（{pdf.doc.pages}ページ）</span>
          <NumField label="ページ" unit="" value={pdf.page} min={1} max={pdf.doc.pages} onCommit={(v) => setPdf({ ...pdf, page: Math.round(v) })} />
          <button className="primary" disabled={!!busy} onClick={() => void run('PDFの読み込み', async () => { add(await pdf.doc.render(pdf.page), 'pdf', `${pdf.name} p${pdf.page}`); pdf.doc.destroy(); setPdf(null); })}>このページを取り込む</button>
          <button onClick={() => { pdf.doc.destroy(); setPdf(null); }}>やめる</button>
        </div>
      )}
      {busy && <div className="muted small">{busy}中…</div>}
      {err && <div className="err" role="alert">{err}</div>}

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
            {active.scaled ? `縮尺: 1px = ${Math.round(active.mmPerPx * 10) / 10}mm` : <span className="warn">⚠ 縮尺未確定（寸法は参考。「2点で縮尺」で合わせてください）</span>}
            {active.attribution && <span className="muted">　{active.attribution}</span>}
          </div>
          <label className="field inline">透明度
            <input type="range" min={0.1} max={1} step={0.05} defaultValue={active.opacity} key={`${active.id}-${active.opacity}`} data-testid="ul-opacity"
              onPointerUp={(e) => st.updateUnderlay(active.id, { opacity: Number((e.target as HTMLInputElement).value) })}
              onKeyUp={(e) => st.updateUnderlay(active.id, { opacity: Number((e.target as HTMLInputElement).value) })} />
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
