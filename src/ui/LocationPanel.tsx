/**
 * 申請画面の「見取図」の操作欄。住所（または 緯度,経度）で工事場所を探し、縮尺を選ぶ。
 * 地図をタップしたときの位置の移動は ShinseiScreen 側（プレビューの上）で行う。
 */
import { useState } from 'react';
import { MAP_ZOOMS, type MapSettings } from '../model/locationMap';
import { searchAddress, type Place } from '../import/site';

const LATLON = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/;

type Props = { settings: MapSettings; defaultQuery: string; onChange: (patch: Partial<MapSettings>) => void };

export function LocationPanel({ settings, defaultQuery, onChange }: Props) {
  const [q, setQ] = useState(settings.title ?? defaultQuery);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const choose = (p: Place) => { setPlaces(null); onChange({ lat: p.lat, lon: p.lon, title: p.title }); };
  const search = async () => {
    setErr(''); setPlaces(null); setBusy(true);
    try {
      const m = LATLON.exec(q);
      if (m && !(Math.abs(Number(m[1])) <= 85 && Math.abs(Number(m[2])) <= 180)) throw new Error('「緯度,経度」の順に入れてください（例: 26.334, 127.805）');
      const list = m ? [{ lat: Number(m[1]), lon: Number(m[2]), title: `緯度 ${m[1]}・経度 ${m[2]}` }] : await searchAddress(q.trim());
      if (list.length === 1) choose(list[0]); else setPlaces(list);
    } catch (e) {
      setErr(`検索できませんでした: ${navigator.onLine === false ? '通信できません（オフライン）' : e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };
  const has = settings.lat !== undefined && settings.lon !== undefined;
  return (
    <>
      <span className="field inline grow">
        <input className="grow" style={{ minWidth: 0 }} data-testid="mitori-q" placeholder="工事場所の住所（例: 沖縄市仲宗根町26-1）または 緯度,経度" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) void search(); }} />
        <button className="primary" style={{ whiteSpace: 'nowrap', flex: 'none' }} data-testid="mitori-search" disabled={!q.trim() || busy} onClick={() => void search()}>{busy ? '検索中…' : '🔍 探す'}</button>
      </span>
      <div className="seg-btns" role="group" aria-label="地図の縮尺">
        {MAP_ZOOMS.map((m) => <button key={m.z} data-testid={`mitori-zoom-${m.z}`} className={settings.zoom === m.z ? 'on' : ''} onClick={() => onChange({ zoom: m.z })}>{m.label}</button>)}
      </div>
      {places && places.length === 0 && <span className="warn small" role="status">見つかりませんでした。番地まで入れるか、緯度,経度で指定してください</span>}
      {places && places.length > 1 && (
        <span className="field inline">候補
          <select data-testid="mitori-place" value="" onChange={(e) => { const p = places[Number(e.target.value)]; if (p) choose(p); }}>
            <option value="" disabled>{places.length} 件から選ぶ</option>
            {places.map((p, i) => <option key={i} value={i}>{p.title}</option>)}
          </select>
        </span>
      )}
      {has && <span className="small" data-testid="mitori-chosen">📍 {settings.title ?? '工事場所'}（{settings.lat!.toFixed(5)}, {settings.lon!.toFixed(5)}）<span className="muted"> 地図をタップすると、そこへ工事場所の印を移します</span></span>}
      {err && <span className="err small" role="alert">{err}</span>}
      <span className="muted small" data-testid="mitori-privacy">住所は国土地理院（住所検索）に、工事場所の緯度・経度は国土地理院（地図タイル）に送ります。現場名など他の情報は送りません。</span>
    </>
  );
}
