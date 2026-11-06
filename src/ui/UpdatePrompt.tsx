/**
 * オフライン対応（PWA）。Service Worker を登録し、新しい版が届いたら知らせる。
 * 編集中のデータは IndexedDB に自動保存されているので、再読み込みしても消えない。
 */
import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW();
  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="pwa-toast" role="status" data-testid="pwa-toast">
      {needRefresh ? (
        <>
          <span>新しい版があります</span>
          <button onClick={() => updateServiceWorker(true)}>更新する</button>
          <button onClick={() => setNeedRefresh(false)}>あとで</button>
        </>
      ) : (
        <>
          <span>オフラインでも使えるようになりました</span>
          <button onClick={() => setOfflineReady(false)}>OK</button>
        </>
      )}
    </div>
  );
}
