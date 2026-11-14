/**
 * 住所から 航空写真（国土地理院）・地番図（法務省 登記所備付地図）・建物外形（OpenStreetMap）を取り込むダイアログ。
 */
import { useState } from 'react';
import { useStore } from '../state/store';
import { GSI_ATTRIBUTION, OSM_ATTRIBUTION, polygonArea, pointInRing, rotatePoint, type Footprint } from '../model/geo';
import { planSiteImport } from '../model/siteImport';
import { fetchAerial, fetchFootprints, searchAddress, type Place } from '../import/site';
import { PARCEL_ATTRIBUTION, PARCEL_NOTE } from '../model/parcels';
import type { Underlay } from '../model/underlay';

const LATLON = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/;

export function SiteImportDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [fps, setFps] = useState<Footprint[] | null>(null);
  const [fpIdx, setFpIdx] = useState(0);
  const [aerial, setAerial] = useState(true);
  // 地番図: 現場で隣地・道路との境が分かる（2026-11-14 ユーザー要望）
  const [parcels, setParcels] = useState(true);
  const [outline, setOutline] = useState(true);
  const [eave, setEave] = useState('0');
  const [align, setAlign] = useState(true);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr('');
    try { await fn(); } catch (e) {
      setErr(`${label}できませんでした: ${navigator.onLine === false ? '通信できません（オフライン）' : e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(''); }
  };

  const search = () => run('検索', async () => {
    setPlace(null); setFps(null);
    const m = LATLON.exec(q);
    if (m && !(Math.abs(Number(m[1])) <= 90 && Math.abs(Number(m[2])) <= 180)) throw new Error('緯度は −90〜90、経度は −180〜180 で「緯度,経度」の順に入力してください');
    const list = m ? [{ lat: Number(m[1]), lon: Number(m[2]), title: `緯度 ${m[1]}・経度 ${m[2]}` }] : await searchAddress(q.trim());
    setPlaces(list);
    if (list.length === 1) await choose(list[0]);
  });
  const choose = async (p: Place) => {
    setPlace(p); setFps(null); setFpIdx(0);
    if (outline) await run('建物外形の取得', async () => setFps(await fetchFootprints(p)));
  };

  const doImport = () => run('取り込み', async () => {
    if (!place) return;
    const st = useStore.getState();
    const fp = outline && fps?.length ? fps[fpIdx]?.polygon ?? null : null;
    const plan = planSiteImport(fp, { eaveMm: Number(eave) || 0, align });
    if ('error' in plan) throw new Error(plan.error);
    const hasWalls = Object.values(st.doc.building.walls).some((w) => w.floorId === st.activeFloorId);
    if (plan.polygon && hasWalls && !window.confirm('この階にはすでに壁があります。建物外形の外壁を追加しますか？')) return;
    let underlay;
    let missing = 0;
    if (aerial) {
      const a = await fetchAerial(place);
      missing = a.missing;
      // 画素に丸めた切り出しのずれを、建物と同じ回転で補正
      const off = rotatePoint(a.centerOffset, plan.rotation);
      underlay = {
        floorId: st.activeFloorId, kind: 'aerial' as const, label: `航空写真 ${place.title}`.slice(0, 60), src: a.src, widthPx: a.widthPx, heightPx: a.heightPx,
        center: { x: plan.aerialCenter.x + off.x, y: plan.aerialCenter.y + off.y }, mmPerPx: a.mmPerPx, rotation: plan.rotation, opacity: 0.7, scaled: true,
        attribution: fp ? `${GSI_ATTRIBUTION}／${OSM_ATTRIBUTION}` : GSI_ATTRIBUTION,
      };
    }
    // 地番図は航空写真の上に重ねる（同じ中心・同じ回転。地点が原点）
    let parcelUnderlay: Omit<Underlay, 'id'> | undefined;
    let parcelNote = '';
    if (parcels) {
      try {
        // 地番図の読み込み部品は使うときだけ読む（最初の表示を重くしない）
        const { drawParcels, fetchParcels } = await import('../import/parcels');
        const list = await fetchParcels(place);
        if (list.length) {
          const d = drawParcels(list);
          parcelUnderlay = {
            floorId: st.activeFloorId, kind: 'parcels', label: `地番図 ${place.title}`.slice(0, 60), src: d.src, widthPx: d.widthPx, heightPx: d.heightPx,
            center: plan.aerialCenter, mmPerPx: d.mmPerPx, rotation: plan.rotation, opacity: 0.9, scaled: true, attribution: `${PARCEL_ATTRIBUTION}。${PARCEL_NOTE}`,
          };
        } else parcelNote = 'この場所の地番図はありません（地図に重ねられない「公図」の地域など）';
      } catch {
        parcelNote = '地番図を取得できませんでした（通信を確認してください）';
      }
    }
    const list = [underlay, parcelUnderlay].filter((x): x is NonNullable<typeof x> => !!x);
    if (!plan.polygon && !list.length) throw new Error(parcelNote || '取り込むものがありません');
    const r = useStore.getState().importSite({ polygon: plan.polygon, underlays: list });
    if (!r) throw new Error(useStore.getState().notice ?? '取り込めませんでした');
    const notes = [missing ? `航空写真の一部（${missing}/9 区画）を取得できず灰色になっています` : '', parcelNote].filter(Boolean);
    if (notes.length) useStore.setState({ notice: notes.join('。') });
    if (plan.polygon) st.setTool('select');
    onClose();
  });

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" data-testid="site-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>航空写真・建物外形の取り込み</h2>
        <div className="row">
          <input className="grow" data-testid="site-q" placeholder="住所（例: 那覇市泉崎1-2-2）または 緯度,経度" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) void search(); }} />
          <button className="primary" data-testid="site-search" disabled={!q.trim() || !!busy} onClick={() => void search()}>検索</button>
        </div>
        {places && places.length === 0 && <p className="muted">見つかりませんでした。番地まで入れるか、緯度・経度で指定してください。</p>}
        {places && places.length > 1 && !place && (
          <ul className="plist">{places.map((p, i) => <li key={i}><button className="pmain" data-testid="site-place" data-fb="住所の候補を選ぶ" onClick={() => void choose(p)}>{p.title}</button></li>)}</ul>
        )}
        {place && (
          <>
            <div className="small" data-testid="site-chosen">📍 {place.title}（{place.lat.toFixed(5)}, {place.lon.toFixed(5)}）</div>
            <label className="field inline"><input type="checkbox" checked={aerial} onChange={(e) => setAerial(e.target.checked)} /> 航空写真を下敷きにする（国土地理院・約0.5m/画素）</label>
            <label className="field inline"><input type="checkbox" data-testid="site-parcels" checked={parcels} onChange={(e) => setParcels(e.target.checked)} /> 地番図（隣地・道路との境と地番）を重ねる（法務省・参考）</label>
            <label className="field inline"><input type="checkbox" checked={outline} onChange={(e) => { setOutline(e.target.checked); if (e.target.checked && !fps) void choose(place); }} /> 建物外形から外壁を作る（OpenStreetMap）</label>
            {outline && fps && (fps.length === 0
              ? <p className="warn small">この付近の建物外形が OpenStreetMap にありません。航空写真をなぞって壁を描いてください。</p>
              : (
                <>
                  <label className="field inline">建物
                    <select data-testid="site-fp" data-fb-skip value={fpIdx} onChange={(e) => setFpIdx(Number(e.target.value))}>
                      {fps.map((f, i) => <option key={f.id} value={i}>{pointInRing({ x: 0, y: 0 }, f.polygon) ? '★ 検索地点の建物' : `建物${i + 1}`}{f.name ? `（${f.name}）` : ''} 約{Math.round(polygonArea(f.polygon) / 1e6)}㎡・{f.polygon.length}角</option>)}
                    </select></label>
                  <label className="field inline">軒の出の補正（内側へ）<span className="unit-input"><input type="number" inputMode="numeric" data-testid="site-eave" value={eave} onChange={(e) => setEave(e.target.value)} /><span>mm</span></span></label>
                  <label className="field inline"><input type="checkbox" checked={align} onChange={(e) => setAlign(e.target.checked)} /> 建物を図面の縦横に合わせて回転</label>
                  <p className="muted small">外形は屋根の形のことが多いので、軒の出の分（例: 450mm）だけ内側へ補正し、取り込み後に壁の位置を確認・修正してください。</p>
                </>
              ))}
          </>
        )}
        {busy && <p className="muted">{busy}中…</p>}
        {err && <p className="err" role="alert">{err}</p>}
        <p className="muted small">{GSI_ATTRIBUTION}。{PARCEL_ATTRIBUTION}（{PARCEL_NOTE}）。{OSM_ATTRIBUTION}（ODbL）。Google マップ・ストリートビューは利用規約上、取り込みに使えません。</p>
        <p className="muted small" data-testid="site-privacy">検索のため、入力した住所を国土地理院（住所検索）に、選んだ地点の緯度・経度を OpenStreetMap（Overpass API）と国土地理院（地図タイル）、地番図のデータの置き場所（Source Cooperative）に送信します。現場名などそれ以外の情報は送りません。</p>
        <div className="modal-btns">
          <button onClick={onClose}>閉じる</button>
          <button className="primary" data-testid="site-import" disabled={!place || !!busy || (!aerial && !parcels && !(outline && fps?.length))} onClick={() => void doImport()}>取り込む</button>
        </div>
      </div>
    </div>
  );
}
