import { useState } from 'react';

export type NewProjectInput = {
  name: string;
  address: string;
  mode: 'sketch' | 'dims' | 'photo' | 'auto' | 'facade' | 'blank';
  /** 「図面を取り込む」で選んだ図面（PDF・Jw_cad・写真）。作成後に下敷きとして取り込む */
  file?: File;
  /** 「図面から自動で3Dにする」で選んだ PDF（平面図・基礎伏図・立面図など） */
  files?: File[];
  width: number; depth: number; floors: number; floorHeight: number; wallThickness: number; slabThickness: number;
};

const FIELDS: { key: keyof NewProjectInput; label: string; unit: string; min: number; max: number }[] = [
  { key: 'width', label: '幅（東西）', unit: 'mm', min: 1000, max: 100000 },
  { key: 'depth', label: '奥行（南北）', unit: 'mm', min: 1000, max: 100000 },
  { key: 'floors', label: '階数', unit: '階', min: 1, max: 10 },
  { key: 'floorHeight', label: '階高', unit: 'mm', min: 2000, max: 6000 },
  { key: 'wallThickness', label: '外壁の厚さ', unit: 'mm', min: 50, max: 500 },
  { key: 'slabThickness', label: '床の厚さ', unit: 'mm', min: 0, max: 500 },
];

const MODES: { id: 'sketch' | 'dims' | 'photo' | 'auto' | 'facade'; icon: string; title: string; desc: string; recommended?: boolean }[] = [
  { id: 'sketch', icon: '✏️', title: '指でなぞって描く', desc: '建物の外周を1周なぞると外壁になります。寸法はあとで実測を入れます', recommended: true },
  { id: 'dims', icon: '📐', title: '寸法を入れて作る', desc: '幅と奥行を入れると四角い建物ができます', },
  { id: 'photo', icon: '🗺️', title: '図面を取り込む', desc: '会社から届いた図面（PDF・Jw_cad）や間取り図の写真を下に敷いて、なぞって描きます' },
  { id: 'auto', icon: '🏠', title: '図面から自動で3Dにする', desc: '会社から届いた PDF（平面図・基礎伏図・立面図）をまとめて選ぶと、壁と基礎を読み取って立体にします' },
  { id: 'facade', icon: '📷', title: '外壁の写真から測る', desc: '外壁を撮った写真を正面に直し、縦管などを指でなぞって長さを出します（3Dの壁にも貼ります）' },
];

export function NewProjectDialog({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (v: NewProjectInput) => void }) {
  const [v, setV] = useState<NewProjectInput>({
    name: '', address: '', mode: 'sketch', width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200,
  });
  const files = v.files ?? [];
  const fields = v.mode === 'auto' ? [] : v.mode === 'sketch' || v.mode === 'photo' || v.mode === 'facade' ? FIELDS.filter((f) => f.key === 'floors' || f.key === 'floorHeight') : FIELDS;
  const invalid = fields.filter((f) => {
    const n = v[f.key] as number;
    return !(Number.isFinite(n) && n >= f.min && n <= f.max && (f.key !== 'floors' || Number.isInteger(n)));
  });
  const ok = v.name.trim() !== '' && (v.mode === 'blank' || invalid.length === 0) && (v.mode !== 'auto' || files.length > 0);

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="新しい工事">
      <form className="modal" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit({ ...v, name: v.name.trim(), address: v.address.trim(), file: v.mode === 'photo' ? v.file : undefined, files: v.mode === 'auto' ? files : undefined }); }}>
        <h2>新しい工事</h2>
        <label className="field">工事名<input data-testid="np-name" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="例: 山田様邸 給排水" /></label>
        <label className="field">住所（任意）<input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></label>
        <div className="field-label">建物の作り方を選んでください</div>
        <div className="mode-cards" role="radiogroup" aria-label="建物の作り方" onKeyDown={(e) => {
          const ids = MODES.map((m) => m.id);
          const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const i = ids.indexOf(v.mode as typeof ids[number]);
          const next = ids[(Math.max(0, i) + d + ids.length) % ids.length];
          setV({ ...v, mode: next });
          (e.currentTarget.querySelector(`[data-testid="np-mode-${next}"]`) as HTMLElement | null)?.focus();
        }}>
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={v.mode === m.id} tabIndex={v.mode === m.id || (v.mode === 'blank' && m.id === 'sketch') ? 0 : -1} data-testid={`np-mode-${m.id}`} className={`mode-card ${v.mode === m.id ? 'on' : ''}`} onClick={() => setV({ ...v, mode: m.id })}>
              <span className="mtitle">{m.icon} {m.title}{m.recommended && <span className="badge">おすすめ</span>}</span>
              <span className="mdesc">{m.desc}</span>
            </button>
          ))}
        </div>
        <button type="button" className={`linkish ${v.mode === 'blank' ? 'on' : ''}`} onClick={() => setV({ ...v, mode: 'blank' })}>白紙から描く</button>
        {v.mode === 'blank' && <p className="hint">壁も階も自由に描きます（慣れた人向け）。</p>}
        {v.mode === 'photo' && (
          <label className="field">図面ファイル（PDF・Jw_cad の .jww・写真）
            {/* accept を付けない: iPhone は .jww を選べなくするため */}
            <input type="file" data-testid="np-file" onChange={(e) => setV({ ...v, file: e.target.files?.[0] })} />
            <span className="hint">作成するとこの図面が下に敷かれます。あとから選ぶこともできます。</span>
          </label>
        )}
        {v.mode === 'auto' && (
          <div className="field">図面の PDF（何枚でも。あとから足せます）
            <input type="file" multiple accept="application/pdf,.pdf" data-testid="np-files" onChange={(e) => {
              // 別のフォルダの図面も続けて足せるよう、選ぶたびに追加する（同じファイルは 1 回だけ）
              const add = [...(e.target.files ?? [])].filter((f) => !files.some((x) => x.name === f.name && x.size === f.size));
              e.target.value = '';
              setV({ ...v, files: [...files, ...add] });
            }} />
            {files.length > 0 && (
              <ul className="file-list" data-testid="np-file-list">
                {files.map((f) => (
                  <li key={`${f.name}:${f.size}`}>{f.name} <button type="button" className="linkish" aria-label={`${f.name} を外す`} onClick={() => setV({ ...v, files: files.filter((x) => x !== f) })}>外す</button></li>
                ))}
              </ul>
            )}
            <span className="hint">平面図は必須です。基礎伏図があれば基礎の立上りを、立面図があれば高さを読み取ります。CAD から出力した PDF が対象です（紙をスキャンした PDF は「図面を取り込む」で下に敷いてください）。</span>
          </div>
        )}
        {v.mode !== 'blank' && fields.length > 0 && (
          <div className="grid2">
            {fields.map((f) => (
              <label key={f.key} className={`field ${invalid.includes(f) ? 'bad' : ''}`}>{f.label}
                <span className="unit-input">
                  <input type="number" inputMode="numeric" data-testid={`np-${f.key}`} value={Number.isFinite(v[f.key] as number) ? (v[f.key] as number) : ''}
                    onChange={(e) => setV({ ...v, [f.key]: e.target.value === '' ? NaN : Number(e.target.value) })} />
                  <span>{f.unit}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {v.mode !== 'blank' && invalid.length > 0 && <p className="err">{invalid.map((f) => `${f.label}は${f.min}〜${f.max}${f.unit}`).join('、')}で入力してください</p>}
        <div className="modal-btns">
          <button type="button" className="big" onClick={onCancel}>やめる</button>
          <button type="submit" className="primary big" data-testid="np-create" disabled={!ok}>作成</button>
        </div>
      </form>
    </div>
  );
}
