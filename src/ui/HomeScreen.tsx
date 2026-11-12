import { useEffect, useRef, useState } from 'react';
import { repo } from '../storage/instance';
import type { ProjectSummary } from '../storage/repository';
import { NewProjectDialog, type NewProjectInput } from './NewProjectDialog';
import { HelpDialog } from './HelpDialog';
import { FeedbackBox } from '../feedback/FeedbackBox';

const fmt = (t: number) => new Date(t).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export function HomeScreen({ onOpen, onCreate, onSample }: { onOpen: (id: string) => void; /** 作れたら true。失敗したら入力（選んだ図面など）を残すためダイアログを開いたままにする */
  onCreate: (input: NewProjectInput) => Promise<boolean>; onSample: () => void }) {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const submitting = useRef(false);
  const [help, setHelp] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => repo.list().then(setList).catch(() => setMsg('工事の一覧を読み込めませんでした'));
  useEffect(() => { void reload(); }, []);

  const filtered = (list ?? []).filter((p) => !q || p.name.includes(q) || (p.address ?? '').includes(q));

  /** 操作を実行し、失敗したらメッセージを表示 */
  const run = (label: string, fn: () => Promise<unknown>) => async () => {
    try { await fn(); } catch (e) { setMsg(`${label}できませんでした: ${(e as Error).message}`); }
  };

  const download = async (p: ProjectSummary) => {
    const json = await repo.exportJson(p.id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `${p.name}_${new Date().toISOString().slice(0, 10)}.pipecraft.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadAll = async () => {
    const { json, skipped } = await repo.exportAll();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `PipeCraft3D_全現場_${new Date().toISOString().slice(0, 10)}.pipecraft-backup.json`;
    a.dispatchEvent(new MouseEvent('click'));
    setTimeout(() => URL.revokeObjectURL(a.href), 40_000);
    setMsg(skipped.length ? `バックアップしました。ただし ${skipped.join('、')} はデータが壊れていて含められませんでした（個別に開いて確認してください）` : 'すべての工事をバックアップしました');
  };

  const importFile = async (f: File) => {
    try {
      const r = await repo.importAny(await f.text());
      setMsg(r.imported.length === 1 && !r.failed ? `「${r.imported[0].name}」を読み込みました` : `${r.imported.length}件の工事を読み込みました${r.failed ? `（${r.failed}件は壊れていて読み込めませんでした）` : ''}`);
      await reload();
    } catch (e) {
      setMsg('読み込めませんでした: ' + (e as Error).message);
    }
  };

  return (
    <div className="home" data-testid="home">
      <header className="home-head">
        <strong>PipeCraft 3D</strong>
        <span className="sub">水道配管の図面・材料集計・見積</span>
      </header>
      <p className="home-lead">間取りを描いて、設備を置き、配管を指でなぞるだけで、材料の数量と見積ができます。</p>
      <div className="home-entry">
        <button className="entry primary" data-testid="new-project" onClick={() => setCreating(true)}>
          <span className="eicon">＋</span><span className="etitle">新しい工事を作る</span><span className="edesc">工事名を入れて始めます</span>
        </button>
        <button className="entry" data-testid="open-sample" onClick={onSample}>
          <span className="eicon">🏠</span><span className="etitle">サンプル工事を見る</span><span className="edesc">完成例を自由に触って練習</span>
        </button>
        <button className="entry" data-testid="open-help" onClick={() => setHelp(true)}>
          <span className="eicon">？</span><span className="etitle">使い方を見る</span><span className="edesc">作業の流れと操作のしかた</span>
        </button>
        <button className="entry" onClick={() => fileRef.current?.click()}>
          <span className="eicon">⤓</span><span className="etitle">バックアップから読み込み</span><span className="edesc">保存しておいたファイルから戻す</span>
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden data-testid="import-file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
      </div>
      <h2 className="home-sec">保存済みの工事{list?.length ? `（${list.length}件）` : ''}</h2>
      {!!list?.length && <button className="backup-all" data-testid="backup-all" onClick={run('バックアップ', downloadAll)}>全工事をまとめてバックアップ（{list.length}件）</button>}
      <input className="search" placeholder="工事名・住所で検索" value={q} onChange={(e) => setQ(e.target.value)} data-testid="search" />
      {msg && <div className="msg" role="status">{msg}</div>}
      {list === null ? <p className="empty">読み込み中…</p> : filtered.length === 0 ? (
        <p className="empty">{list.length ? '該当する工事がありません' : 'まだ保存した工事はありません。上の「新しい工事を作る」か「サンプル工事を見る」から始めてください。'}</p>
      ) : (
        <ul className="plist">
          {filtered.map((p) => (
            <li key={p.id} data-testid="project-item">
              <button className="pmain" data-fb="工事を開く" onClick={() => onOpen(p.id)}>
                <span className="pname">{p.name}</span>
                <span className="pmeta">{p.address ? `${p.address}・` : ''}更新 {fmt(p.updatedAt)}</span>
              </button>
              <div className="pbtns">
                <button onClick={run('複製', async () => { await repo.duplicate(p.id, `${p.name} のコピー`); await reload(); })}>複製</button>
                <button onClick={run('書き出し', () => download(p))}>書き出し</button>
                <button className="danger" onClick={run('削除', async () => {
                  if (!window.confirm(`工事「${p.name}」を削除します。元に戻せません。よろしいですか？\n（必要なら先に「書き出し」でバックアップしてください）`)) return;
                  await repo.delete(p.id);
                  await reload();
                })}>削除</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <section className="home-feedback"><FeedbackBox id="feedback" /></section>
      <div className="muted small build-stamp" data-testid="build-stamp">版: {typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : '開発中'}</div>
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {creating && <NewProjectDialog onCancel={() => setCreating(false)} onSubmit={(v) => {
        // 作成中の二度押しで工事が 2 つできないようにする
        if (submitting.current) return;
        submitting.current = true;
        void onCreate(v).then((ok) => { if (ok) setCreating(false); }).finally(() => { submitting.current = false; });
      }} />}
    </div>
  );
}
