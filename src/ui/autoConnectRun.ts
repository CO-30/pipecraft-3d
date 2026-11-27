/**
 * 「🔗 汚水・水・湯をまとめてつなぐ」を実行する（配管の道具の欄と、手順ガイドの「自動でつなぐ」で同じものを使う）。
 * 外の排水管の土かぶり・勾配、給水の埋設深さは、申請図面で選んでいる自治体と現場の住所に合わせる。
 */
import { useStore } from '../state/store';
import { minSlopeFor, resolveProfile } from '../model/municipality';
import { useProfiles } from './useProfiles';
import { resolveSupplyRules } from '../model/hydraulics/supplyRules';

/** 計算を待っている間（2 回続けて押しても 1 回だけつなぐ） */
let pending = false;

/** dropDepth: 床下へ落とす深さ（mm）。無ければ既定の深さ */
export function runAutoConnect(dropDepth?: number): void {
  if (pending) return;
  const st = useStore.getState();
  const p = resolveProfile(st.doc.site?.municipalityProfileId, useProfiles.getState().user);
  const supply = resolveSupplyRules({ profileName: p.id === 'standard' ? undefined : p.name, address: st.meta?.address });
  pending = true;
  useStore.setState({ notice: '汚水・水・湯をまとめてつないでいます…' });
  // お知らせを先に描いてから計算する（長くかかっても止まって見えないように）
  setTimeout(() => {
    try {
      useStore.getState().autoConnectAll({ drainRules: { cover: p.profileTable.minCover, slopeFor: (d) => minSlopeFor(p, d) }, supply, dropDepth });
    } catch (e) {
      useStore.setState({ notice: `つなげませんでした: ${(e as Error).message}。1 つずつのボタンで試してください` });
    } finally {
      pending = false;
    }
  }, 30);
}
