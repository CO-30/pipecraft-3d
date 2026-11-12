/**
 * 共通の要望欄（REDSEAL・左官見積と同じ受付へ送る）。
 * 部品 `feedback-widget.js` は CO-30/invoice-maker の `feedback/feedback-widget.js` の写し。直すときは向こうを直してから写す。
 * 使い方の画面（HelpDialog）の下に出す。
 */
import './feedback-widget.js';
import { useStore } from '../state/store';

/** 要望・不具合の受付先（共通の受付 Code.gs をウェブアプリとして公開した …/exec の URL）。空のあいだは送信ボタンが押せない */
export const FEEDBACK_URL = '';

type Payload = { app: string; version: string; kind: string; text: string; log: { t: string; a: string }[]; context: unknown };
export type FeedbackWidgetApi = {
  init(o: Record<string, unknown>): FeedbackWidgetApi;
  render(target: string | Element): void;
  log(a: string): void;
  logError(m: string): void;
  payload(text: string, kind?: string, reply?: string): Payload;
  _labelOf(el: Element): string;
};

export const feedbackWidget = (): FeedbackWidgetApi | undefined =>
  (window as unknown as { FeedbackWidget?: FeedbackWidgetApi }).FeedbackWidget;

/** 調査に役立つ状態だけ（工事名・住所・申請者・単価などは入れない） */
export function feedbackContext(): Record<string, unknown> {
  const st = useStore.getState();
  const d = st.doc;
  return {
    画面: st.meta ? '作業' : 'ホーム',
    階数: d.building.floors.length,
    配管: Object.keys(d.network.segments).length,
    器具: Object.keys(d.fixtures ?? {}).length,
    道具: st.tool,
    床下: st.underFloor,
  };
}

let started = false;
export function initFeedback(): void {
  const fw = feedbackWidget();
  if (!fw || started) return;
  started = true;
  fw.init({ app: '水道見積', version: typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : '開発中', endpoint: FEEDBACK_URL, title: 'ご要望・不具合の報告', getContext: feedbackContext });
}
