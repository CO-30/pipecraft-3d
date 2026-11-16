/** 高さは 0.1mm に丸めて保存するので、最小勾配ちょうどの管を「より緩い」と言わない（2026-11-16 実物:「勾配 2/100 は最小勾配 2/100 より緩い」） */
import { describe, expect, it } from 'vitest';
import { addPolyline } from '../network';
import { BUILTIN_PROFILES } from '../municipality';
import { resolveDrainRules } from '../drainRules';
import { buildDrainTrees } from './tree';
import { checkDrain } from './checks';
import { testSite } from './testSite';

const NAHA = resolveDrainRules(BUILTIN_PROFILES.find((p) => p.id === 'naha')!);

describe('最小勾配ちょうど（丸めの分だけ緩い）', () => {
  it('2816mm で 2/100 − 0.0007% は「緩い」に数えない。はっきり緩ければ数える', () => {
    const { doc, pub } = testSite();
    const P = doc.network.nodes[pub].pos;
    const L = 2816, min = NAHA.minSlope(100);
    const at = (dz: number) => {
      const r = addPolyline(doc.network, [P, { x: P.x - L, y: P.y, z: P.z + dz }], { system: 'sewage', diameter: 100 }, { startNodeId: pub });
      const d = { ...doc, network: r.net };
      return checkDrain(d, NAHA, buildDrainTrees(d)).filter((i) => i.kind === 'minSlope').length;
    };
    expect(at(min * L - 0.02)).toBe(0);
    expect(at(min * L - 5)).toBe(1);
  });
});
