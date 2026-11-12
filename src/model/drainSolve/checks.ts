/**
 * 排水の検査と直し方の候補（純関数）。高さは solveHeights の結果（doc）から読む。
 * 直し方（fix.apply）は「ピン・属性」だけを変える。当てたあとはもう一度計算する（solveDrain）。
 */
import type { Doc } from '../doc';
import type { DrainRuleSet } from '../drainRules';
import { groundZAt, isManhole } from '../fixtures';
import type { Segment } from '../network';
import { defaultSlope as indoorMinSlope, isRiserLike, isSlopePinned, outerDiameter, planLength } from '../slope';
import { insideBuilding, isUnderfloorDrain, underfloorLevels } from '../underfloorSlope';
import type { DrainTree } from './tree';

export type DrainIssueKind = 'minSlope' | 'maxSlope' | 'cover' | 'depthMax' | 'depthMin' | 'diameterReverse' | 'underfloorTooHigh' | 'reverse' | 'noPublic' | 'loop' | 'unverifiedRule';
export type DrainFix = { label: string; apply: (doc: Doc) => Doc };
export type DrainIssue = {
  kind: DrainIssueKind;
  level: 'error' | 'warn' | 'info';
  target: { kind: 'segment' | 'node' | 'fixture' | 'site'; id: string };
  message: string;
  fixes: DrainFix[];
};

const pct = (r: number) => `${(Math.round(r * 1000) / 10).toString()}/100`;
const isPublicType = (t: string) => t === 'publicSewage' || t === 'publicRain';

/** 区間の勾配を固定する */
const pinSlope = (segIds: string[], r: (s: Segment) => number) => (doc: Doc): Doc => {
  const segments = { ...doc.network.segments };
  let hit = false;
  for (const id of segIds) { const s = segments[id]; if (s) { hit = true; const { slopeLocked: _l, ...rest } = s; segments[id] = { ...rest, slope: r(s), slopePin: true }; } }
  return hit ? { ...doc, network: { ...doc.network, segments } } : doc;
};
/** 区間の勾配の固定を外す（自動に戻す） */
export const unpinSlope = (segIds: string[]) => (doc: Doc): Doc => {
  const segments = { ...doc.network.segments };
  let hit = false;
  for (const id of segIds) { const s = segments[id]; if (s && (s.slopePin || s.slopeLocked)) { hit = true; const { slopePin: _p, slopeLocked: _l, ...rest } = s; segments[id] = rest; } }
  return hit ? { ...doc, network: { ...doc.network, segments } } : doc;
};
/** 点・マスの高さの固定を外す */
export const unpinNode = (nodeId: string) => (doc: Doc): Doc => {
  const n = doc.network.nodes[nodeId];
  if (!n) return doc;
  const f = n.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
  if (!n.zPin && !f?.params?.invertPin) return doc;
  const { zPin: _z, ...rest } = n;
  const network = { ...doc.network, nodes: { ...doc.network.nodes, [nodeId]: rest } };
  if (f?.params?.invertPin) { const { invertPin: _i, ...params } = f.params; return { ...doc, network, fixtures: { ...doc.fixtures, [f.id]: { ...f, params } } }; }
  return { ...doc, network };
};

export function checkDrain(doc: Doc, rules: DrainRuleSet, trees: DrainTree[], opts: { underfloorOver?: number } = {}): DrainIssue[] {
  const net = doc.network;
  const lv = underfloorLevels(doc);
  const issues: DrainIssue[] = [];
  const fxOf = (id: string) => { const f = net.nodes[id]?.fixtureId; return f ? doc.fixtures[f] : undefined; };
  for (const t of trees) {
    const anchorOf = (id: string) => { const n = net.nodes[id]; const f = fxOf(id); return n?.zPin || (f && isManhole(f.type) && f.params?.invertPin); };
    /** 点から下流へ、最初の固定点（根を除く）まで */
    const pathDown = (from: string) => {
      const segs: string[] = [];
      let cur = from, pin: string | undefined;
      while (cur !== t.root) {
        if (cur !== from && anchorOf(cur)) { pin = cur; break; }
        const sid = t.parent.get(cur);
        if (!sid) break;
        segs.push(sid);
        const s = net.segments[sid];
        cur = s.a === cur ? s.b : s.a;
      }
      return { segs, pin };
    };
    /** 区間 → その上流の最初の固定点（固定点から下流へ、次の固定点・根までをたどって一度で作る） */
    const anchorAbove = new Map<string, string>();
    for (const id of t.order) {
      if (id === t.root || !anchorOf(id)) continue;
      for (const sid of pathDown(id).segs) if (!anchorAbove.has(sid)) anchorAbove.set(sid, id);
    }
    const pinAbove = (segId: string) => anchorAbove.get(segId);
    /** 点 → 木の区間 */
    const nodeSegs = new Map<string, Segment[]>();
    for (const [k, sid] of t.parent) {
      const sg = net.segments[sid];
      for (const id of new Set([k, sg.a, sg.b])) nodeSegs.set(id, [...(nodeSegs.get(id) ?? []), sg]);
    }
    for (const [n, sid] of t.parent) {
      const s = net.segments[sid];
      const p = s.a === n ? s.b : s.a;
      const L = planLength(net, s);
      if (L < 1 || isRiserLike(net, s)) continue;
      const pf = fxOf(p);
      const downZ = net.nodes[p].pos.z + (pf && isManhole(pf.type) ? net.nodes[p].dropIn ?? 0 : 0);
      const slope = (net.nodes[n].pos.z - downZ) / L;
      const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos;
      const uf = !!lv && isUnderfloorDrain(net, s, lv);
      const indoorAbove = !!lv && a.z >= lv.floor - 1 && b.z >= lv.floor - 1 && insideBuilding(lv, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const min = uf ? rules.underfloorSlope(s.diameter, true) : indoorAbove ? indoorMinSlope(s.diameter) : rules.minSlope(s.diameter);
      const max = rules.maxSlope(s.diameter);
      const pin = pinAbove(sid);
      const unpinFixes: DrainFix[] = [
        ...(pin ? [{ label: '高さの固定を外す（自動に戻す）', apply: unpinNode(pin) }] : []),
        ...(isSlopePinned(s) ? [{ label: '勾配を自動に戻す', apply: unpinSlope([sid]) }] : []),
      ];
      if (slope < -1e-6) {
        issues.push({ kind: 'reverse', level: 'error', target: { kind: 'segment', id: sid }, message: `逆勾配（φ${s.diameter}）。下流より上流が低くなっています`, fixes: unpinFixes });
      } else if (slope + 1e-6 < min) {
        issues.push({ kind: 'minSlope', level: 'error', target: { kind: 'segment', id: sid }, message: `勾配 ${pct(slope)} は φ${s.diameter} の最小勾配 ${pct(min)} より緩い`, fixes: unpinFixes });
      } else if (slope >= max - 1e-9) {
        const fixes: DrainFix[] = [...unpinFixes];
        // 下流端がマスなら、ます内の落差で高さを取って勾配を既定に戻す（ドロップます）
        if (pf && isManhole(pf.type) && !isPublicType(pf.type)) {
          const want = rules.defaultSlope(s.diameter);
          const drop = Math.round(net.nodes[n].pos.z - net.nodes[p].pos.z - want * L);
          fixes.unshift({ label: `下流のマスを落差ます（落差 ${drop}mm）にする`, apply: (d) => (d.fixtures[pf.id] ? { ...d, fixtures: { ...d.fixtures, [pf.id]: { ...d.fixtures[pf.id], params: { ...(d.fixtures[pf.id].params ?? {}), drop } } } } : d) });
        }
        issues.push({ kind: 'maxSlope', level: 'error', target: { kind: 'segment', id: sid }, message: `勾配 ${pct(slope)} は φ${s.diameter} の最大勾配 ${pct(max)} 以上（急すぎると水だけ流れて汚物が残ります）`, fixes });
      }
      // 管径の逆転: 上流より下流が細い
      const ds = t.parent.get(p) ? net.segments[t.parent.get(p)!] : undefined;
      if (ds && ds.diameter < s.diameter) {
        issues.push({ kind: 'diameterReverse', level: 'error', target: { kind: 'segment', id: ds.id }, message: `下流の φ${ds.diameter} が上流の φ${s.diameter} より細い`,
          fixes: [{ label: `管径を φ${s.diameter} に上げる`, apply: (d) => (d.network.segments[ds.id] ? { ...d, network: { ...d.network, segments: { ...d.network.segments, [ds.id]: { ...d.network.segments[ds.id], diameter: s.diameter } } } } : d) }] });
      }
    }
    // 土かぶり・ますの深さ（建物の外の点）
    for (const id of t.order) {
      const n = net.nodes[id];
      if (lv && insideBuilding(lv, n.pos)) continue;
      const segs = nodeSegs.get(id) ?? [];
      if (!segs.length || segs.every((s) => planLength(net, s) < 1)) continue;
      const od = Math.max(...segs.map((s) => outerDiameter(s.diameter)));
      const gz = groundZAt(doc.building, doc.site, n.pos);
      const f = fxOf(id);
      const cover = gz - (n.pos.z + od);
      if (f && isManhole(f.type)) {
        const depth = gz - n.pos.z;
        if (rules.maxDepth !== undefined && depth > rules.maxDepth) issues.push({ kind: 'depthMax', level: 'warn', target: { kind: 'fixture', id: f.id }, message: `マスの深さ ${Math.round(depth)}mm が上限 ${rules.maxDepth}mm を超える`, fixes: [] });
      }
      if (cover + 0.5 < rules.cover) {
        // 直し方の対象（下流の横の区間）は、当てるときに求める（検査のたびに全部たどらない）
        const loosen = () => pathDown(id).segs.filter((sid) => planLength(net, net.segments[sid]) >= 1 && !(lv && isUnderfloorDrain(net, net.segments[sid], lv)));
        const kind = f && isManhole(f.type) ? 'depthMin' : 'cover';
        issues.push({ kind, level: 'error', target: f && isManhole(f.type) ? { kind: 'fixture', id: f.id } : { kind: 'node', id }, message: `土かぶり ${Math.round(cover)}mm（${rules.cover}mm 以上必要）`,
          fixes: t.parent.has(id) ? [{ label: '下流の勾配を最小勾配まで緩める', apply: (d) => pinSlope(loosen(), (sg) => rules.minSlope(sg.diameter))(d) }] : [] });
      }
    }
    for (const sid of t.loops) issues.push({ kind: 'loop', level: 'warn', target: { kind: 'segment', id: sid }, message: '配管が輪になっています（この区間は勾配を計算していません）', fixes: [] });
    const hasOutdoor = lv ? t.order.some((id) => !insideBuilding(lv, net.nodes[id].pos)) : true;
    if (!t.public && hasOutdoor) issues.push({ kind: 'noPublic', level: 'warn', target: { kind: 'node', id: t.root }, message: '公共ますがありません（配置図から読めなければ「器具」から公共ますを置いてください）', fixes: [] });
  }
  if (opts.underfloorOver && lv) {
    for (const s of Object.values(net.segments)) {
      if (!isUnderfloorDrain(net, s, lv)) continue;
      if (Math.max(net.nodes[s.a].pos.z, net.nodes[s.b].pos.z) + outerDiameter(s.diameter) > lv.top + 0.5) {
        issues.push({ kind: 'underfloorTooHigh', level: 'warn', target: { kind: 'segment', id: s.id }, message: '床下で配管の上が基礎天端を超えます（ルートを短く・外へ出す所を増やしてください）', fixes: [] });
      }
    }
  }
  if (trees.length && rules.unverified.length) issues.push({ kind: 'unverifiedRule', level: 'info', target: { kind: 'site', id: '' }, message: `要確認: ${rules.unverified.join('・')}`, fixes: [] });
  return issues;
}
