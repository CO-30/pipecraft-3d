import { describe, expect, it } from 'vitest';
import { dropSiteDuplicates } from './assemble';
import type { PlacedCandidate } from './assemble';

const cand = (type: PlacedCandidate['type'], x: number, y: number): PlacedCandidate =>
  ({ type, x, y, rotation: 0, source: '「立水栓」の文字', near: true, floorId: 'f1' });

describe('配置図で置いた器具と同じ物を、平面図の文字から重ねて出さない', () => {
  it('配置図の立水栓（記号）の近くにある「立水栓」の文字の候補は出さない', () => {
    const out = dropSiteDuplicates([cand('outdoorFaucet', 1200, 300), cand('toilet', 1200, 300)], { items: [{ type: 'outdoorFaucet', x: 0, y: 0 }], levels: [] });
    expect(out.map((c) => c.type)).toEqual(['toilet']);
  });
  it('離れた所の立水栓（別の水栓）は残す', () => {
    const out = dropSiteDuplicates([cand('outdoorFaucet', 6000, 0)], { items: [{ type: 'outdoorFaucet', x: 0, y: 0 }], levels: [] });
    expect(out).toHaveLength(1);
  });
  it('配置図が無ければそのまま', () => {
    expect(dropSiteDuplicates([cand('outdoorFaucet', 0, 0)], undefined)).toHaveLength(1);
  });
});
