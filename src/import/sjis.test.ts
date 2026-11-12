import { describe, expect, test } from 'vitest';
import { encodeSjis } from './sjis';

const dec = (b: Uint8Array) => new TextDecoder('shift_jis').decode(b);

describe('Shift_JIS への符号化', () => {
  test('漢字・かな・記号・英数・半角カナが往復する', () => {
    for (const s of ['排水設備 竣工縦断図', 'VUφ100 1/50', 'ＰｉｐｅＣｒａｆｔ　ｱｲｳ', '①②（給水）〒※▽GL±0']) expect(dec(encodeSjis(s))).toBe(s);
  });
  test('CP932 の拡張文字（髙・﨑・①）は使える。無い字（𠮷・絵文字）は ? にして数える', () => {
    expect(dec(encodeSjis('髙橋﨑①'))).toBe('髙橋﨑①');
    const miss = new Set<string>();
    expect(dec(encodeSjis('𠮷野😀', miss))).toBe('?野?');
    expect([...miss].sort()).toEqual(['𠮷', '😀'].sort());
  });
});
