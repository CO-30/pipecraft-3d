/** Jw_cad（.jww）を読み、下敷き用の線画データにする。解析は Worker（画面を止めない・端末内で完結） */
import type { CadDrawing } from '../model/cadDrawing';
import type { JwwRequest, JwwResponse } from './jww.worker';

const TIMEOUT_MS = 60_000;

export function readJww(data: ArrayBuffer): Promise<CadDrawing> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./jww.worker.ts', import.meta.url), { type: 'module' });
    const done = (fn: () => void) => { clearTimeout(timer); w.terminate(); fn(); };
    const timer = setTimeout(() => done(() => reject(new Error('図面の解析に時間がかかりすぎました'))), TIMEOUT_MS);
    w.onmessage = (e: MessageEvent<JwwResponse>) => done(() => (e.data.ok ? resolve(e.data.drawing) : reject(new Error(e.data.error))));
    w.onerror = (e) => done(() => reject(new Error(e.message || '図面を読む部品を起動できませんでした')));
    const msg: JwwRequest = { data };
    w.postMessage(msg, [data]);
  });
}
