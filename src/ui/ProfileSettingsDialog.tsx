/**
 * 自治体プロファイルの管理（一覧・複製・編集・JSON 読み込み/書き出し・削除）。
 * 同梱分は読み取り専用（複製して編集）。ユーザー分は IndexedDB に保存。
 */
import { useEffect, useRef, useState } from 'react';
import { FIXTURE_CATALOG, FIXTURE_TYPES } from '../model/fixtures';
import {
  duplicateProfile, isBuiltinProfile, municipalityProfileSchema, parseProfileJson, PROFILE_ROW_KEYS, PROFILE_ROW_LABEL, SYMBOL_IDS, SYMBOL_LABEL,
  type MunicipalityProfile, type ProfileRowKey,
} from '../model/municipality';
import { useProfiles } from './useProfiles';

export function ProfileSettingsDialog({ onClose }: { onClose: () => void }) {
  const profiles = useProfiles();
  const [editing, setEditing] = useState<MunicipalityProfile | null>(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!profiles.loaded) void profiles.load(); }, [profiles]);

  const dup = async (p: MunicipalityProfile) => {
    const d = duplicateProfile(p, `${p.name} のコピー`);
    const e = await profiles.save(d);
    if (e) setMsg(e); else setEditing(d);
  };
  const exportJson = async (p: MunicipalityProfile) => {
    const { downloadBytes, safeName } = await import('../export/download');
    downloadBytes(new TextEncoder().encode(JSON.stringify(p, null, 2)), `${safeName(p.name)}_profile.json`, 'application/json');
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parseProfileJson(await f.text());
    if ('error' in r) { setMsg(r.error); return; }
    const p = isBuiltinProfile(r.profile.id) || profiles.user.some((x) => x.id === r.profile.id) ? duplicateProfile(r.profile, r.profile.name) : r.profile;
    const e = await profiles.save(p);
    setMsg(e ?? `「${p.name}」を読み込みました`);
    if (fileRef.current) fileRef.current.value = '';
  };
  const remove = async (p: MunicipalityProfile) => {
    if (!window.confirm(`「${p.name}」を削除しますか？`)) return;
    await profiles.remove(p.id);
    setMsg('');
  };

  if (editing) {
    return (
      <ProfileForm
        profile={editing}
        onCancel={() => setEditing(null)}
        onSave={async (p) => { const e = await profiles.save(p); if (e) setMsg(e); else { setEditing(null); setMsg('保存しました'); } }}
      />
    );
  }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="自治体プロファイル" data-testid="profile-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>自治体プロファイル</h2>
        <p className="small muted">縦断図・立面図の体裁（表の行・勾配の書き方・縮尺・最小勾配・土被り・記号・用紙）を自治体ごとに持ちます。同梱分は複製して編集してください。確認できていない項目は「要確認」として図面に出ます。</p>
        {msg && <p className="small" role="status" data-testid="profile-msg">{msg}</p>}
        <ul className="plain-list" data-testid="profile-list">
          {profiles.all().map((p) => (
            <li key={p.id} className="row" data-testid={`profile-row-${p.id}`}>
              <span className="grow"><b>{p.name}</b> {isBuiltinProfile(p.id) && <span className="badge">同梱</span>} <span className="muted small">v{p.version}{p.unverified.length ? `・要確認 ${p.unverified.length}件` : ''}</span></span>
              {!isBuiltinProfile(p.id) && <button data-testid={`profile-edit-${p.id}`} onClick={() => setEditing(p)}>編集</button>}
              <button data-testid={`profile-dup-${p.id}`} onClick={() => dup(p)}>複製{isBuiltinProfile(p.id) ? 'して編集' : ''}</button>
              <button data-testid={`profile-export-${p.id}`} onClick={() => exportJson(p)}>書き出し</button>
              {!isBuiltinProfile(p.id) && <button className="danger" data-testid={`profile-delete-${p.id}`} onClick={() => remove(p)}>削除</button>}
            </li>
          ))}
        </ul>
        <div className="row">
          <label className="small">JSON を読み込む <input ref={fileRef} type="file" accept="application/json,.json" data-testid="profile-import" onChange={(e) => importFile(e.target.files?.[0])} /></label>
        </div>
        <div className="modal-btns"><button onClick={onClose} data-testid="profile-close">閉じる</button><span /></div>
      </div>
    </div>
  );
}

/** 項目ごとのフォーム。保存時に Zod で検証する */
function ProfileForm({ profile, onSave, onCancel }: { profile: MunicipalityProfile; onSave: (p: MunicipalityProfile) => void; onCancel: () => void }) {
  const [p, setP] = useState<MunicipalityProfile>(() => structuredClone(profile));
  const [err, setErr] = useState('');
  const pt = p.profileTable;
  const setPt = (patch: Partial<MunicipalityProfile['profileTable']>) => setP({ ...p, profileTable: { ...pt, ...patch } });
  const rows = pt.rows;
  const moveRow = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setPt({ rows: next });
  };
  const unusedKeys = PROFILE_ROW_KEYS.filter((k) => !rows.some((r) => r.key === k));
  const minSlopeText = Object.entries(pt.minSlopeByDiameter).map(([d, n]) => `${d}:${n}`).join(', ');
  const [minSlope, setMinSlope] = useState(minSlopeText);
  const save = () => {
    const table: Record<string, number> = {};
    for (const part of minSlope.split(/[,、\n]/)) {
      const m = /^\s*(\d+)\s*[:：]\s*(\d+)\s*$/.exec(part);
      if (m) table[m[1]] = Number(m[2]);
      else if (part.trim()) { setErr(`最小勾配の書き方: 口径:分母（例 100:100）。「${part.trim()}」が読めません`); return; }
    }
    const candidate = { ...p, profileTable: { ...pt, minSlopeByDiameter: table } };
    const r = municipalityProfileSchema.safeParse(candidate);
    if (!r.success) { setErr(`入力が正しくありません: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`); return; }
    onSave(r.data);
  };
  const symbolTypes = FIXTURE_TYPES.filter((t) => FIXTURE_CATALOG[t].ports.some((x) => x.system === 'water' || x.system === 'hotWater' || x.system === 'sewage' || x.system === 'drain'));
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" role="dialog" aria-label="プロファイルの編集" data-testid="profile-form" onClick={(e) => e.stopPropagation()}>
        <h2>プロファイルの編集</h2>
        {err && <p className="warn small" role="alert" data-testid="profile-form-error">{err}</p>}
        <label className="field">名前 <input data-testid="pf-name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
        <label className="field">参照した手引き <input value={p.source.title} onChange={(e) => setP({ ...p, source: { ...p.source, title: e.target.value } })} placeholder="○○市 排水設備工事の手引き" /></label>
        <div className="row">
          <label className="field grow">URL <input value={p.source.url ?? ''} onChange={(e) => setP({ ...p, source: { ...p.source, url: e.target.value || undefined } })} /></label>
          <label className="field">確認日 <input value={p.source.checkedAt ?? ''} onChange={(e) => setP({ ...p, source: { ...p.source, checkedAt: e.target.value || undefined } })} placeholder="2026-11-09" /></label>
        </div>
        <label className="field">要確認の項目（1行に1つ。図面に「要確認」と出ます）
          <textarea rows={2} data-testid="pf-unverified" value={p.unverified.join('\n')} onChange={(e) => setP({ ...p, unverified: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
        </label>
        <h3>縦断図の表</h3>
        <ul className="plain-list" data-testid="pf-rows">
          {rows.map((r, i) => (
            <li key={r.key} className="row">
              <span className="muted small">{PROFILE_ROW_LABEL[r.key]}</span>
              <input className="grow" value={r.label} onChange={(e) => setPt({ rows: rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <button onClick={() => moveRow(i, -1)} aria-label="上へ">↑</button>
              <button onClick={() => moveRow(i, 1)} aria-label="下へ">↓</button>
              <button onClick={() => setPt({ rows: rows.filter((_, j) => j !== i) })} aria-label="行を消す">✕</button>
            </li>
          ))}
        </ul>
        {unusedKeys.length > 0 && (
          <label className="field inline">行を追加
            <select value="" onChange={(e) => { const k = e.target.value as ProfileRowKey; if (k) setPt({ rows: [...rows, { key: k, label: PROFILE_ROW_LABEL[k] }] }); }}>
              <option value="">選ぶ…</option>
              {unusedKeys.map((k) => <option key={k} value={k}>{PROFILE_ROW_LABEL[k]}</option>)}
            </select>
          </label>
        )}
        <div className="row">
          <label className="field">勾配の書き方
            <select data-testid="pf-slope-format" value={pt.slopeFormat} onChange={(e) => setPt({ slopeFormat: e.target.value as typeof pt.slopeFormat })}>
              <option value="ratio">1/100</option><option value="permille">10.0‰</option><option value="percent">1.00%</option><option value="per100">1.0/100</option>
            </select>
          </label>
          <label className="field">単位
            <select value={pt.unit} onChange={(e) => setPt({ unit: e.target.value as 'm' | 'mm' })}><option value="m">m（小数3位）</option><option value="mm">mm</option></select>
          </label>
          <label className="field">横 1/<input type="number" data-testid="pf-hscale" value={pt.hScale} onChange={(e) => setPt({ hScale: Number(e.target.value) })} /></label>
          <label className="field">縦 1/<input type="number" value={pt.vScale} onChange={(e) => setPt({ vScale: Number(e.target.value) })} /></label>
        </div>
        <label className="field">最小勾配（口径:分母 をカンマ区切り）<input data-testid="pf-minslope" value={minSlope} onChange={(e) => setMinSlope(e.target.value)} placeholder="75:100, 100:100, 150:200" /></label>
        <label className="field">最小土被り(mm) <input type="number" value={pt.minCover} onChange={(e) => setPt({ minCover: Number(e.target.value) })} /></label>
        <div className="row">
          <label className="field">高さの基準
            <select value={pt.datum} onChange={(e) => setPt({ datum: e.target.value as 'absolute' | 'publicInvert' })}><option value="absolute">1階 FL 基準</option><option value="publicInvert">公共桝の管底を ±0</option></select>
          </label>
          <label className="field">管種口径の書き方
            <select value={pt.pipeSpecFormat} onChange={(e) => setPt({ pipeSpecFormat: e.target.value as 'materialFirst' | 'diameterFirst' })}><option value="materialFirst">VUφ100</option><option value="diameterFirst">100VU</option></select>
          </label>
          <label className="field">距離の桁
            <select value={pt.lengthDecimals} onChange={(e) => setPt({ lengthDecimals: Number(e.target.value) as 2 | 3 })}><option value={3}>0.000</option><option value={2}>0.00</option></select>
          </label>
          <label className="field">桝の名前
            <select value={pt.manholeLabel} onChange={(e) => setPt({ manholeLabel: e.target.value as 'table' | 'above' })}><option value="table">表に書く</option><option value="above">図の上に NO.1〜</option></select>
          </label>
          <label className="field">下流端（公共桝）の位置
            <select data-testid="pf-downstream-side" value={pt.downstreamSide} onChange={(e) => setPt({ downstreamSide: e.target.value as 'left' | 'right' })}><option value="right">右（上流を左から）</option><option value="left">左（沖縄市の実例）</option></select>
          </label>
          <label className="field inline"><input type="checkbox" checked={pt.drainageIsometric} onChange={(e) => setPt({ drainageIsometric: e.target.checked })} /> 縦断図の上に排水のアイソメ図</label>
        </div>
        <h3>立面図</h3>
        <div className="row">
          <label className="field">描き方
            <select data-testid="pf-riser-style" value={p.riser.lineStyle} onChange={(e) => setP({ ...p, riser: { ...p.riser, lineStyle: e.target.value as 'single' | 'isometric' } })}><option value="single">系統図（平ら）</option><option value="isometric">アイソメ図（展開図）</option></select>
          </label>
          <label className="field">口径の位置
            <select value={p.riser.diameterLabelPos} onChange={(e) => setP({ ...p, riser: { ...p.riser, diameterLabelPos: e.target.value as 'above' | 'side' } })}><option value="above">線の上</option><option value="side">横</option></select>
          </label>
          <label className="field">高さの基準
            <select value={p.riser.heightLabel} onChange={(e) => setP({ ...p, riser: { ...p.riser, heightLabel: e.target.value as 'FL+' | 'GL+' } })}><option value="FL+">FL（各階の床）</option><option value="GL+">GL（設計地盤）</option></select>
          </label>
          <label className="field inline"><input type="checkbox" checked={p.riser.showFloorLines} onChange={(e) => setP({ ...p, riser: { ...p.riser, showFloorLines: e.target.checked } })} /> 階の線を描く</label>
        </div>
        <h3>色分け（申請書の指示: 新設・増設＝赤、既設＝青、公共下水道＝黒。公共桝は新設/既設の色、黒は市下水管用）</h3>
        <div className="row">
          {([['newWork', '新設・増設'], ['existing', '既設'], ['public', '公共下水道']] as const).map(([k, label]) => (
            <label key={k} className="field inline">{label} <input type="color" data-testid={`pf-color-${k}`} value={p.colors[k]} onChange={(e) => setP({ ...p, colors: { ...p.colors, [k]: e.target.value } })} /></label>
          ))}
        </div>
        <h3>用紙</h3>
        <div className="row">
          <label className="field">サイズ <select value={p.paper.size} onChange={(e) => setP({ ...p, paper: { ...p.paper, size: e.target.value as 'A3' | 'A4' } })}><option>A3</option><option>A4</option></select></label>
          <label className="field">向き <select value={p.paper.orientation} onChange={(e) => setP({ ...p, paper: { ...p.paper, orientation: e.target.value as 'landscape' | 'portrait' } })}><option value="landscape">横</option><option value="portrait">縦</option></select></label>
        </div>
        <label className="field">表題欄の項目（カンマ区切り。工事名・図面名・縮尺・作成日は自動で入ります）
          <input value={p.paper.titleBlockFields.join(', ')} onChange={(e) => setP({ ...p, paper: { ...p.paper, titleBlockFields: e.target.value.split(/[,、]/).map((s) => s.trim()).filter(Boolean) } })} />
        </label>
        <label className="field">右上の受付欄（カンマ区切り。空なら描かない。縮尺は自動で入ります）
          <input data-testid="pf-header-fields" value={p.paper.headerFields.join(', ')} onChange={(e) => setP({ ...p, paper: { ...p.paper, headerFields: e.target.value.split(/[,、]/).map((s) => s.trim()).filter(Boolean) } })} />
        </label>
        <h3>記号</h3>
        <div className="symbol-grid">
          {symbolTypes.map((t) => (
            <label key={t} className="field small">{FIXTURE_CATALOG[t].label}
              <select value={p.symbols[t] ?? ''} onChange={(e) => setP({ ...p, symbols: { ...p.symbols, [t]: e.target.value } })}>
                <option value="">（既定）</option>
                {SYMBOL_IDS.map((id) => <option key={id} value={id}>{SYMBOL_LABEL[id]}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="modal-btns">
          <button onClick={onCancel}>やめる</button>
          <button className="primary" data-testid="pf-save" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
