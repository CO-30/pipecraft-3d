/** 共通の要望欄を描く場所。部品が読み込めないときは理由を出す（アプリは止めない） */
import { useEffect, useRef, useState } from 'react';
import { loadFeedback } from './feedback';

export function FeedbackBox({ id, testId = 'feedback-box' }: { id?: string; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const alive = { current: true }; // 閉じた後に読み込みが終わったら何もしない
    loadFeedback().then((fw) => {
      if (!alive.current) return;
      if (fw && ref.current) fw.render(ref.current); else setFailed(true);
    });
    return () => { alive.current = false; };
  }, []);
  return (
    <div className="feedback-wrap">
      <div ref={ref} id={id} data-testid={testId} />
      {failed && <p className="muted small" data-testid="feedback-offline">要望欄を読み込めませんでした。電波の良い所で開き直すと出ます。</p>}
    </div>
  );
}
