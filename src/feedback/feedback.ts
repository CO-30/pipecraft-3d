/**
 * 共通の要望欄（REDSEAL・左官見積などと同じ受付へ送る）。手順書: CO-30/invoice-maker の feedback/README.md
 * 部品は公開 URL から読み込む（読み込めなくてもアプリは動く）。ホーム画面の下と、使い方の画面の下に出す。
 */
import { useStore } from '../state/store';

/** 部品（全アプリ共通。版を変えるときは ?v= も変える） */
export const FEEDBACK_SCRIPT = 'https://co-30.github.io/invoice-maker/feedback/feedback-widget.js?v=1.14.0';
/** 受付（全アプリ共通。Code.gs のウェブアプリ） */
export const FEEDBACK_URL = 'https://script.google.com/macros/s/AKfycbwRiAKzdRhW0SQFyNuoIlGmPQx9rGA199TT0weaKZ-v3-G4nmfdddiot9f45Rs9mSNCQQ/exec';
/** 受付のまとめはこの名前ごとに分かれる */
export const FEEDBACK_APP = '給水';

type Payload = { app: string; version: string; kind: string; text: string; log: { t: string; a: string }[]; errors: { t: string; m: string }[]; context: unknown };
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

/** 調査に役立つ状態だけ（工事名・住所・申請者・単価・メモの本文などは入れない） */
export function feedbackContext(): Record<string, unknown> {
  const st = useStore.getState();
  const d = st.doc;
  return {
    画面: st.meta ? '作業' : 'ホーム',
    階数: d.building.floors.length,
    配管: Object.keys(d.network.segments).length,
    器具: Object.keys(d.fixtures ?? {}).length,
    メモ: Object.keys(d.notes ?? {}).length,
    下敷き: Object.keys(d.underlays ?? {}).length,
    道具: st.tool,
    床下: st.underFloor,
  };
}

let started = false;
/** 部品が読み込まれていれば初期化する（何度呼んでもよい） */
export function initFeedback(): FeedbackWidgetApi | null {
  const fw = feedbackWidget();
  if (!fw) return null;
  if (!started) {
    started = true;
    fw.init({ app: FEEDBACK_APP, version: typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : '開発中', endpoint: FEEDBACK_URL, getContext: feedbackContext });
  }
  return fw;
}

let loading: Promise<FeedbackWidgetApi | null> | null = null;
/** 部品を読み込んで初期化する。読み込めない（電波が無い）ときは null */
export function loadFeedback(): Promise<FeedbackWidgetApi | null> {
  if (feedbackWidget()) return Promise.resolve(initFeedback());
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = FEEDBACK_SCRIPT;
    s.async = true;
    s.onload = () => resolve(initFeedback());
    s.onerror = () => { loading = null; s.remove(); resolve(null); }; // 次に開いたときにもう一度試す
    document.head.appendChild(s);
  });
  return loading;
}

/** 画面の切り替えなどを記録（部品が無ければ何もしない） */
export function fbLog(a: string): void {
  try { if (started) feedbackWidget()?.log(a); } catch { /* 記録できなくてもアプリは止めない */ }
}

/**
 * 画面に出したエラーを記録。「：」「:」「（」より前の文だけ（後ろにファイル名やサーバーの文言が入ることがあるため）
 */
export function fbError(message: string): void {
  const t = String(message || '').split(/[:：（(\n]/)[0].trim().slice(0, 40);
  if (!t) return;
  try { if (started) feedbackWidget()?.logError('表示: ' + t); } catch { /* 同上 */ }
}
