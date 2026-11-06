import { useState } from 'react';

export type NewProjectInput = {
  name: string;
  address: string;
  mode: 'dims' | 'blank';
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

export function NewProjectDialog({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (v: NewProjectInput) => void }) {
  const [v, setV] = useState<NewProjectInput>({
    name: '', address: '', mode: 'dims', width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200,
  });
  const invalid = FIELDS.filter((f) => {
    const n = v[f.key] as number;
    return !(Number.isFinite(n) && n >= f.min && n <= f.max);
  });
  const ok = v.name.trim() !== '' && (v.mode === 'blank' || invalid.length === 0);

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="新しい現場">
      <form className="modal" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit({ ...v, name: v.name.trim(), address: v.address.trim() }); }}>
        <h2>新しい現場</h2>
        <label className="field">現場名<input data-testid="np-name" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="例: 山田様邸 給排水" /></label>
        <label className="field">住所（任意）<input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></label>
        <div className="seg-btns full">
          <button type="button" className={v.mode === 'dims' ? 'on' : ''} onClick={() => setV({ ...v, mode: 'dims' })}>寸法から作る</button>
          <button type="button" className={v.mode === 'blank' ? 'on' : ''} onClick={() => setV({ ...v, mode: 'blank' })}>白紙から描く</button>
        </div>
        {v.mode === 'dims' && (
          <div className="grid2">
            {FIELDS.map((f) => (
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
        {v.mode === 'dims' && invalid.length > 0 && <p className="err">{invalid.map((f) => `${f.label}は${f.min}〜${f.max}${f.unit}`).join('、')}で入力してください</p>}
        <div className="modal-btns">
          <button type="button" className="big" onClick={onCancel}>やめる</button>
          <button type="submit" className="primary big" data-testid="np-create" disabled={!ok}>作成</button>
        </div>
      </form>
    </div>
  );
}
