/** 使い方（8つの工程・基本操作・用語）。ホームと作業画面の「？」から開く */
import { useEffect, useRef } from 'react';
import { feedbackWidget, initFeedback } from '../feedback/feedback';

const STEPS: [string, string][] = [
  ['工事を作る', 'ホームの「新しい工事を作る」で工事名を入れ、建物の作り方を選びます。'],
  ['図面を取り込む（任意）', '間取り図の写真・PDF を下に敷くと、なぞって描けます。2点の実際の長さを入れると縮尺が合います。'],
  ['間取りを作る', '建物の外周を指で1周なぞると外壁になります。寸法はあとで実測を入れられます。部屋・ドア・窓は「建物」から。'],
  ['設備を置く', '「器具」でメーター・屋上タンク・トイレなどを選び、図面の置きたい所をタップします。'],
  ['配管を描く', '「配管」で種類（給水・給湯・排水…）を選び、器具の丸（接続口）から指でなぞります。配管の途中からなぞると分岐、配管の上で指を離すとつながります。'],
  ['長さを入れる（任意）', '配管をタップして「実測長」に現場で測った長さを入れます。実測が優先して集計されます。'],
  ['材料を確認する', '「積算」で配管の長さ・継手・器具の数を確認します。自動で決められない所は「要確認」に出ます。'],
  ['見積を出す', '単価を確認して、見積書を PDF・Excel で出力します。'],
];

const OPS: [string, string][] = [
  ['間違えたら', '下の「↶戻す」で1つ前に戻ります。「↷やり直し」で戻した操作をもう一度。'],
  ['拡大・移動', 'スマホは2本指で広げる・動かす。PC はホイールで拡大、右ドラッグか何もない所のドラッグで移動。'],
  ['3D の回転', '3D 画面を1本指でなぞると回ります。'],
  ['選ぶ・消す', '「選択」でタップすると上に「選択中」が出ます。そこから削除や変更ができます。'],
  ['保存', '自動で保存されます。右上の「保存済み」で確認できます。'],
];

const TERMS: [string, string][] = [
  ['口径（φ）', '配管の太さ。φ20 は呼び径 20。'],
  ['系統・種類', '給水・給湯・排水・汚水など、配管の用途。色で区別します。'],
  ['立て管', '上下にまっすぐ通る配管。'],
  ['継手', '配管どうしをつなぐ部品（エルボ＝曲がり、チーズ＝分岐など）。'],
  ['実測長', '現場で測った配管の長さ。図面の長さより優先されます。'],
  ['立面図', '壁を正面から見た図。外壁を伝う配管や窓を描くときに使います。'],
  ['下敷き', '取り込んだ図面や写真。なぞるための背景で、集計には入りません。'],
  ['縦断図', '排水管を横から見た図。マスごとの地盤高・管底高・土被りと、区間の距離・勾配を表にします（申請図面）。'],
  ['立面図（系統図）', '水道メーターから各水栓までの配管を縦に並べた図。口径と高さ（FL+○○）を記します（申請図面）。'],
  ['自治体プロファイル', '申請図面の体裁（表の行・勾配の書き方・縮尺・最小勾配・土被り・記号・用紙）。自治体ごとに複製して直せます。'],
  ['マス・管底高', '排水のます。管底高は管の内側の底の高さ。排水の配管は高さを管底高として扱います。'],
];

/** 共通の要望欄（feedback-widget.js）をここに描く */
function FeedbackBox() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { initFeedback(); const fw = feedbackWidget(); if (fw && ref.current) fw.render(ref.current); }, []);
  return <div ref={ref} data-testid="feedback-box" />;
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="使い方" data-testid="help-dialog" onClick={onClose}>
      <div className="modal help" onClick={(e) => e.stopPropagation()}>
        <div className="help-head"><h2>使い方</h2><button className="big" data-testid="help-close" onClick={onClose}>閉じる</button></div>
        <h3>作業の流れ</h3>
        <ol className="help-steps">{STEPS.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ol>
        <p className="muted small">作業画面の上の「ステップ」が、いまの工程と次にやることを案内します。どの工程からでも自由に操作できます。</p>
        <h3>基本操作</h3>
        <dl className="help-dl">{OPS.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
        <h3>用語</h3>
        <dl className="help-dl">{TERMS.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
        <p className="muted small">このアプリは数量・見積の作成を助けるものです。施工・法令・耐圧などの確認は別途行ってください。</p>
        <h3 id="feedback">ご要望・不具合</h3>
        <p className="muted small">送ったときだけ、書いた本文と直前の操作（画面名・ボタン名）・版・端末の種類・配管や器具の数が送られます。工事名・住所・図面・単価・申請者の情報は送られません。</p>
        <FeedbackBox />
      </div>
    </div>
  );
}
