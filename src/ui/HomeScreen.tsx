import { useEffect, useRef, useState } from 'react';
import { repo } from '../storage/instance';
import type { ProjectSummary } from '../storage/repository';
import { NewProjectDialog, type NewProjectInput } from './NewProjectDialog';

const fmt = (t: number) => new Date(t).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export function HomeScreen({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: (input: NewProjectInput) => void }) {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => repo.list().then(setList).catch(() => setMsg('現場一覧を読み込めませんでした'));
  useEffect(() => { void reload(); }, []);

  const filtered = (list ?? []).filter((p) => !q || p.name.includes(q) || (p.address ?? '').includes(q));

  const download = async (p: ProjectSummary) => {
    const json = await repo.exportJson(p.id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `${p.name}_${new Date().toISOString().slice(0, 10)}.pipecraft.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (f: File) => {
    try {
      const p = await repo.importJson(await f.text());
      setMsg(`「${p.name}」を読み込みました`);
      await reload();
    } catch (e) {
      setMsg('読み込めませんでした: ' + (e as Error).message);
    }
  };

  return (
    <div className="home" data-testid="home">
      <header className="home-head">
        <strong>PipeCraft 3D</strong>
        <span className="sub">現場一覧</span>
      </header>
      <div className="home-actions">
        <button className="primary big" data-testid="new-project" onClick={() => setCreating(true)}>＋ 新しい現場</button>
        <button className="big" onClick={() => fileRef.current?.click()}>バックアップから読み込み</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden data-testid="import-file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
      </div>
      <input className="search" placeholder="現場名・住所で検索" value={q} onChange={(e) => setQ(e.target.value)} data-testid="search" />
      {msg && <div className="msg" role="status">{msg}</div>}
      {list === null ? <p className="empty">読み込み中…</p> : filtered.length === 0 ? (
        <p className="empty">{list.length ? '該当する現場がありません' : 'まだ現場がありません。「新しい現場」から作成してください。'}</p>
      ) : (
        <ul className="plist">
          {filtered.map((p) => (
            <li key={p.id} data-testid="project-item">
              <button className="pmain" onClick={() => onOpen(p.id)}>
                <span className="pname">{p.name}</span>
                <span className="pmeta">{p.address ? `${p.address}・` : ''}更新 {fmt(p.updatedAt)}</span>
              </button>
              <div className="pbtns">
                <button onClick={async () => { await repo.duplicate(p.id, `${p.name} のコピー`); await reload(); }}>複製</button>
                <button onClick={() => void download(p)}>書き出し</button>
                <button className="danger" onClick={async () => {
                  if (!window.confirm(`現場「${p.name}」を削除します。元に戻せません。よろしいですか？\n（必要なら先に「書き出し」でバックアップしてください）`)) return;
                  await repo.delete(p.id);
                  await reload();
                }}>削除</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewProjectDialog onCancel={() => setCreating(false)} onSubmit={(v) => { setCreating(false); onCreate(v); }} />}
    </div>
  );
}
