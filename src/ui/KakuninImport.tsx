/**
 * 「確認申請書から入れる」: 建築確認の書類（確認申請書・確認済証。PDF、複数可）の文字を読み、申請書・道路の手続きの空欄に入れる。
 * 入力済みの項目（空にした項目を含む）は変えない。スキャンした PDF は文字が無いので読めないと知らせる。
 */
import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { applyKakunin, parseKakunin, roadFromKakunin } from '../forms/kakunin';
import type { FormSet } from '../forms/types';
import { ROAD_FIELDS } from '../road/fields';

export function KakuninImport({ set, onMessage }: { set?: FormSet; onMessage: (msg: string, error?: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const run = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const { pdfTextLines } = await import('../import/pdfText');
      const lines: string[] = [];
      for (const f of Array.from(files)) lines.push(...await pdfTextLines(await f.arrayBuffer()));
      if (!lines.length) { onMessage('文字が入っていない PDF です（スキャンした PDF は読めません）。CAD や申請システムから出した PDF を選んでください', true); return; }
      const info = parseKakunin(lines);
      const candidates = { ...(set?.kakunin?.(info) ?? {}), ...roadFromKakunin(info) };
      const st = useStore.getState();
      const r = applyKakunin(candidates, st.doc.site?.application ?? {});
      if (!Object.keys(info).length) { onMessage('確認申請書・確認済証の項目が見つかりませんでした（別の書類かもしれません）', true); return; }
      if (!r.filled.length) { onMessage('読めた項目はすべて入力済みでした（入力済みの項目は変えません）'); return; }
      st.updateSite({ application: r.values });
      const labels = [...(set?.fields ?? []), ...ROAD_FIELDS];
      const name = (id: string) => { const f = labels.find((x) => x.id === id); return f ? (id.startsWith('road.') ? `道路の${f.label.replace(/（.*）$/, '')}` : f.label) : id; };
      onMessage(`確認申請書から ${r.filled.length} 項目を入れました: ${r.filled.map(name).join('・')}（入力済みの項目は変えていません）`);
    } catch (e) {
      onMessage(`読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`, true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <button data-testid="forms-kakunin" disabled={busy} title="建築確認の書類（確認申請書・確認済証の PDF）から、建築主・設置場所・確認番号・面積・階数・構造・道路の幅員などを空欄に入れます" onClick={() => input.current?.click()}>{busy ? '読み込み中…' : '📄 確認申請書から入れる'}</button>
      <input ref={input} data-testid="forms-kakunin-file" type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => void run(e.target.files)} />
    </>
  );
}
