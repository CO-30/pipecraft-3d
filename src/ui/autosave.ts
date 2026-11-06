/**
 * 自動保存。編集（revision 変化）のたびに 500ms デバウンスで保存し、
 * アプリ切替・タブを閉じる直前・ホームへ戻る時は即保存する。不正データは保存されず直前の正常データが残る。
 */
import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { repo } from '../storage/instance';

export type SaveState = 'saved' | 'saving' | 'error';

let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;
let inflight: Promise<void> = Promise.resolve();
const listeners = new Set<(s: SaveState) => void>();
const emit = (s: SaveState) => listeners.forEach((l) => l(s));

/** 保留中の変更を今すぐ保存（完了まで待てる） */
export function flushNow(): Promise<void> {
  clearTimeout(timer);
  if (!pending) return inflight;
  pending = false;
  const p = useStore.getState().toProjectData();
  if (!p) return inflight;
  inflight = inflight
    .then(() => repo.save(p))
    .then(() => emit(pending ? 'saving' : 'saved'))
    .catch((e) => { console.error(e); emit('error'); });
  return inflight;
}

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  navigator.storage?.persist?.().catch(() => undefined); // iOS 等での自動削除対策（許可されなくても継続）
  useStore.subscribe((s, prev) => {
    // 別の現場を開いた直後・閉じた時は保存不要（開いた時点の内容は保存済み）
    if (!s.meta || !prev.meta || s.meta.id !== prev.meta.id || s.revision === prev.revision) return;
    pending = true;
    emit('saving');
    clearTimeout(timer);
    timer = setTimeout(flushNow, 500);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushNow(); });
  window.addEventListener('pagehide', () => void flushNow());
}

export function useSaveState(): SaveState {
  const [state, setState] = useState<SaveState>('saved');
  useEffect(() => {
    install();
    listeners.add(setState);
    return () => { listeners.delete(setState); };
  }, []);
  return state;
}
