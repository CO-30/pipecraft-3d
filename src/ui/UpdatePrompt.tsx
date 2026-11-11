/**
 * オフライン対応（PWA）。Service Worker を登録し、新しい版が届いたら知らせる。
 * 編集中のデータは IndexedDB に自動保存されているので、再読み込みしても消えない。
 * iPhone のホーム画面アプリは開き直しても再読み込みが走らないことがあるので、
 * 前面に戻ったとき・1 時間ごとに新しい版が無いか確かめる。
 */
import { useRegisterSW } from 'virtual:pwa-register/react';

/** 新しい版の確認の間隔 */
const CHECK_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, r) {
      if (!r) return;
      const check = () => { if (navigator.onLine) void r.update().catch(() => { /* オフラインなどは次の機会に */ }); };
      setInterval(check, CHECK_MS);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    },
  });
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
