/**
 * 書類の状態に出す「検査の結果」（純関数）: 排水の検査（勾配不足など）・給水の水理計算（水圧不足など）・器具のつなぎ忘れ。
 * 書類センター（docCenter.ts）は、これが 1 件でもあれば、関係する書類を「確認が必要」にして理由に並べる。
 * 計算そのものはしない（排水はストアの drainIssues、給水は calcSupply の結果を受け取る）。
 */
import type { Doc } from '../model/doc';
import type { DrainIssue } from '../model/drainSolve';
import type { SupplyCalc } from '../model/hydraulics/calc';
import { FIXTURE_CATALOG, isHeader, isManhole, portNodes } from '../model/fixtures';
import { segmentsAt } from '../model/network';

export type Inspection = { drain: string[]; supply: string[] };

/** 理由に並べる件数の上限（多いときは「ほか N 件」にまとめる。スマホで読み切れる長さに） */
export const MAX_LINES = 4;

const DRAIN_FIX = '図面の「積算」→「要確認」から場所へ移動して直せます';
const SUPPLY_FIX = '申請図面の「水理計算書」で、おすすめの口径に直せます';
const PLUMBING = new Set(['water', 'hotWater', 'sewage', 'drain']);
const DRAIN_SYS = new Set(['sewage', 'drain']);

function capped(lines: string[]): string[] {
  const u = [...new Set(lines)];
  return u.length <= MAX_LINES ? u : [...u.slice(0, MAX_LINES - 1), `ほか ${u.length - (MAX_LINES - 1)} 件`];
}

/** つなぎ忘れの器具の接続口（給水・給湯・排水だけ。既設の器具・ヘッダーの出口・メーターの入口は数えない） */
export function unconnectedPorts(doc: Doc): { fixtureId: string; label: string; port: string; drain: boolean }[] {
  const out: { fixtureId: string; label: string; port: string; drain: boolean }[] = [];
  for (const f of Object.values(doc.fixtures)) {
    const def = FIXTURE_CATALOG[f.type];
    if (!def || f.params?.existing) continue;
    // タンク・ポンプはつなぎ方が工事ごとに違うので数えない
    if (f.type === 'roofTank' || f.type === 'pump') continue;
    const nodes = portNodes(doc.network, f.id);
    const linked = (portId: string) => nodes.some((n) => n.portId === portId && segmentsAt(doc.network, n.id).length > 0);
    for (const p of def.ports) {
      if (!PLUMBING.has(p.system)) continue;
      if (isHeader(f.type) && p.id !== 'in') continue; // ヘッダーの出口は使う分だけつなぐ
      if (f.type === 'waterMeter' && p.id === 'in') continue; // 入口（本管側）は図面の外のことがある
      if (!linked(p.id)) out.push({ fixtureId: f.id, label: def.label, port: isManhole(f.type) ? '' : p.label, drain: DRAIN_SYS.has(p.system) });
    }
  }
  return out;
}

export function inspect(doc: Doc, drainIssues: DrainIssue[], supply: SupplyCalc | { error: string } | null): Inspection {
  const drain: string[] = [];
  const supplyLines: string[] = [];

  // 排水: 注意（error・warn）だけ。お知らせ（info）は出さない
  const issues = drainIssues.filter((x) => x.level !== 'info');
  if (issues.length) drain.push(`排水の検査で注意が ${issues.length} 件あります（${DRAIN_FIX}）`, ...capped(issues.map((x) => x.message)));

  // つなぎ忘れ
  const open = unconnectedPorts(doc);
  const names = (xs: typeof open) => capped(xs.map((x) => (x.port ? `${x.label}の${x.port}` : x.label)));
  const openDrain = open.filter((x) => x.drain);
  const openSupply = open.filter((x) => !x.drain);
  if (openDrain.length) drain.push(`排水がつながっていない器具・マスが ${openDrain.length} か所あります: ${names(openDrain).join('・')}`);
  if (openSupply.length) supplyLines.push(`給水・給湯がつながっていない器具が ${openSupply.length} か所あります: ${names(openSupply).join('・')}`);

  // 給水: 水理計算
  if (supply && 'error' in supply) supplyLines.push(`給水の水理計算ができません（${supply.error}）`);
  else if (supply && !supply.ok) {
    if (supply.required > supply.available + 1e-9) supplyLines.push(`水圧が足りません（必要 ${supply.required.toFixed(2)}m・使える ${supply.available.toFixed(2)}m）。${SUPPLY_FIX}`);
    const over = supply.rows.filter((r) => r.over).length;
    if (over) supplyLines.push(`流速が上限を超える区間が ${over} か所あります。${SUPPLY_FIX}`);
  }
  return { drain, supply: supplyLines };
}
