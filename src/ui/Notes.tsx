/** ⑨ 図面・3D のメモ: 編集欄・一覧・「📝 メモ」ボタン */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { floorById } from '../model/building';
import { NOTE_MAX_TEXT, noteNumbers, notesText, noteTargetMissing, type NoteTarget } from '../model/notes';
import { noteTargetLabel } from './noteLabel';

/** 選んでいるものにメモを付けるボタン（選択中の帯に出す） */
export function AddNoteButton() {
  const sel = useStore((s) => s.selection);
  if (!sel || sel.kind === 'note') return null;
  return <button data-testid="note-add-sel" aria-label="選んでいるものにメモを付ける" onClick={() => useStore.getState().addNoteFromSelection()}>📝 メモ</button>;
}

/** 選んだメモの編集欄 */
export function NoteEditor({ id }: { id: string }) {
  const note = useStore((s) => s.doc.notes?.[id]);
  const doc = useStore((s) => s.doc);
  const num = useMemo(() => noteNumbers(doc.notes).get(id), [doc.notes, id]);
  const [text, setText] = useState(note?.text ?? '');
  // 元に戻す等で本文が変わったら入力欄もそろえる（描画中の調整）
  const [base, setBase] = useState(note?.text ?? '');
  if ((note?.text ?? '') !== base) { setBase(note?.text ?? ''); setText(note?.text ?? ''); }
  const ref = useRef<HTMLTextAreaElement>(null);
  // 欄が消えるとき（図面をタップして選択が変わった等。blur は起きない）にも書いた本文を保存する
  const typed = useRef(note?.text ?? ''), saved = useRef(note?.text ?? '');
  useEffect(() => { typed.current = note?.text ?? ''; saved.current = note?.text ?? ''; }, [note?.text]);
  useEffect(() => () => {
    if (typed.current !== saved.current && useStore.getState().doc.notes?.[id]) useStore.getState().updateNote(id, { text: typed.current });
  }, [id]);
  // 置いた直後（本文が空）はすぐ書けるように
  useEffect(() => { if (note && !note.text) ref.current?.focus({ preventScroll: true }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!note) return null;
  const st = useStore.getState();
  const save = () => { saved.current = text; if (text !== note.text) st.updateNote(id, { text }); };
  const missing = noteTargetMissing(doc, note);
  const tl = note.target && !missing ? noteTargetLabel(doc, note.target) : null;
  const floor = floorById(doc.building, note.floorId)?.name ?? '';
  return (
    <div className="props note-editor" data-testid="note-editor">
      <div className="ptitle"><span className={`note-badge ${note.done ? 'done' : ''}`}>{num}</span> メモ <span className="muted small">{floor}{tl ? `・${tl}に付けています` : ''}</span></div>
      {missing && <div className="warn small" data-testid="note-target-missing">付けた先は消えています（メモは最後の場所に残しています）</div>}
      <textarea ref={ref} data-testid="note-text" className="note-text" rows={4} maxLength={NOTE_MAX_TEXT} placeholder="現場への指示・確認すること（例: 梁を避けて下から回す）"
        value={text} onChange={(e) => { setText(e.target.value); typed.current = e.target.value; }} onBlur={save} />
      <div className="row">
        <label className="field inline"><input type="checkbox" data-testid="note-done" checked={!!note.done} onChange={(e) => { save(); st.updateNote(id, { done: e.target.checked }); }} /> 済（対応した）</label>
        {tl && note.target && <button data-testid="note-select-target" onClick={() => { save(); st.select({ kind: note.target!.kind, id: note.target!.id }); }}>付けた先を選ぶ</button>}
        <button className="danger" data-testid="note-delete" onClick={() => st.removeNote(id)}>🗑 メモを消す</button>
      </div>
      <div className="muted small">図面の黄色い番号の丸をドラッグすると動かせます（付けた先からは外れます）。申請図面・DXF には出ません</div>
    </div>
  );
}

/** メモの一覧（表示パネルの下）。タップでその階へ移って選ぶ。文字でコピー・共有 */
export function NotesList() {
  const doc = useStore((s) => s.doc);
  const name = useStore((s) => s.meta?.name ?? '');
  const show = useStore((s) => s.showNotes);
  const selId = useStore((s) => (s.selection?.kind === 'note' ? s.selection.id : null));
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const nums = useMemo(() => noteNumbers(doc.notes), [doc.notes]);
  const all = [...nums.keys()].map((id) => doc.notes![id]);
  const open = all.filter((n) => !n.done).length;
  const list = all.filter((n) => !onlyOpen || !n.done);
  const st = useStore.getState();
  const label = (t: NoteTarget) => noteTargetLabel(doc, t);
  const copy = async () => {
    const text = notesText(doc, name, label, onlyOpen);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: `${name} メモ`, text }); setCopied('共有しました'); return; }
      await navigator.clipboard.writeText(text);
      setCopied('コピーしました');
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      setCopied('コピーできませんでした');
    }
  };
  return (
    <details className="notes-list" data-testid="notes-list" open>
      <summary>📝 メモ <span className="muted small" data-testid="notes-count">未対応 {open} / 全 {all.length}</span></summary>
      <div className="row small">
        <label className="field inline"><input type="checkbox" data-testid="notes-show" checked={show} onChange={(e) => st.setShowNotes(e.target.checked)} /> 図面・3D に出す</label>
        <label className="field inline"><input type="checkbox" data-testid="notes-only-open" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> 未対応だけ</label>
      </div>
      {!all.length && <div className="muted small">道具の「📝 メモ」で図面をタップするか、何かを選んで「📝 メモ」を押すと置けます</div>}
      <ul>
        {list.map((n) => {
          const floor = floorById(doc.building, n.floorId)?.name ?? '';
          const tl = n.target && !noteTargetMissing(doc, n) ? label(n.target) : null;
          const first = n.text.trim().split('\n')[0] || '（本文なし）';
          return (
            <li key={n.id}>
              <button data-testid="note-row" data-note={n.id} className={`${selId === n.id ? 'on' : ''} ${n.done ? 'done' : ''}`}
                onClick={() => { if (st.activeFloorId !== n.floorId) st.setActiveFloor(n.floorId); if (n.under !== st.underFloor && !n.target) st.setUnderFloor(!!n.under); st.setShowNotes(true); st.select({ kind: 'note', id: n.id }); }}>
                <span className={`note-badge ${n.done ? 'done' : ''}`}>{nums.get(n.id)}</span>{n.done && <span className="note-done-mark" aria-label="済">✓</span>}
                <span className="note-row-text"><small>{floor}{tl ? `・${tl}` : ''}</small>{first}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {all.length > 0 && <div className="row"><button data-testid="notes-copy" onClick={copy}>📋 文字でコピー{onlyOpen ? '（未対応だけ）' : ''}</button>{copied && <span className="muted small" role="status">{copied}</span>}</div>}
    </details>
  );
}
