import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { DexieProjectRepository } from '../storage/repository';
import { SCHEMA_VERSION } from '../model/schema';

export const SPIKE_PROJECT_ID = 'spike';
const repo = new DexieProjectRepository();

export type SaveState = 'loading' | 'saving' | 'saved' | 'error';

/** 起動時に読み込み、編集のたびに自動保存（500ms デバウンス） */
export function useAutosave(): SaveState {
  const [state, setState] = useState<SaveState>('loading');
  const ready = useRef(false);
  const createdAt = useRef(Date.now());

  useEffect(() => {
    // iOS Safari 等でのストレージ自動削除を避けるため永続化を要求（許可されなくても動作は継続）
    navigator.storage?.persist?.().catch(() => undefined);
    repo.load(SPIKE_PROJECT_ID)
      .then((p) => {
        if (p) {
          createdAt.current = p.createdAt;
          useStore.getState().load(p.network);
        }
        setState('saved');
      })
      .catch(() => setState('error'))
      .finally(() => { ready.current = true; });
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    const flush = () => {
      clearTimeout(timer);
      if (!pending) return;
      pending = false;
      repo.save({ schemaVersion: SCHEMA_VERSION, id: SPIKE_PROJECT_ID, name: '技術検証', createdAt: createdAt.current, updatedAt: Date.now(), network: useStore.getState().network })
        .then(() => setState('saved'))
        .catch(() => setState('error')); // 不正データは保存されず、直前の正常データが残る
    };
    const unsub = useStore.subscribe((s, prev) => {
      if (!ready.current || s.revision === prev.revision) return;
      pending = true;
      setState('saving');
      clearTimeout(timer);
      timer = setTimeout(flush, 500);
    });
    // アプリ切替・タブを閉じる直前に即保存
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      unsub();
      flush();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  return state;
}
