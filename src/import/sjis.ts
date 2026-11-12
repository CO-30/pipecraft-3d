/**
 * Shift_JIS（CP932）への符号化。ブラウザの TextEncoder は UTF-8 だけなので、
 * TextDecoder('shift_jis') で 2 バイトの全コードを一度だけ読み、字 → バイトの逆引きの表を作る。
 * DXF（R12・$DWGCODEPAGE ANSI_932）の文字に使う。Jw_cad が読める形。
 */
let table: Map<string, number[]> | null = null;

/** Unicode の別の字形で入ってくる記号を CP932 の字にそろえる（全角マイナス・波ダッシュ・ダッシュ等） */
const ALIAS: Record<string, number[]> = {
  '\u2212': [0x81, 0x7c], '\u301c': [0x81, 0x60], '\u2016': [0x81, 0x61], '\u2014': [0x81, 0x5c],
  '\u00a2': [0x81, 0x91], '\u00a3': [0x81, 0x92], '\u00ac': [0x81, 0xca],
};

function build(): Map<string, number[]> {
  const m = new Map<string, number[]>();
  const dec = new TextDecoder('shift_jis');
  for (let b = 0xa1; b <= 0xdf; b++) m.set(dec.decode(new Uint8Array([b])), [b]); // 半角カナ
  const leads = [...Array.from({ length: 0x9f - 0x81 + 1 }, (_, i) => 0x81 + i), ...Array.from({ length: 0xfc - 0xe0 + 1 }, (_, i) => 0xe0 + i)];
  for (const b1 of leads) for (let b2 = 0x40; b2 <= 0xfc; b2++) {
    if (b2 === 0x7f) continue;
    const ch = dec.decode(new Uint8Array([b1, b2]));
    if (ch.length === 1 && ch !== '�' && !m.has(ch)) m.set(ch, [b1, b2]);
  }
  return m;
}

/** 文字列を Shift_JIS のバイト列に。無い字は ? にして missing に集める */
export function encodeSjis(s: string, missing?: Set<string>): Uint8Array {
  table ??= build();
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) { out.push(c); continue; }
    const b = ALIAS[ch] ?? table.get(ch);
    if (b) out.push(...b);
    else { out.push(0x3f); missing?.add(ch); }
  }
  return new Uint8Array(out);
}
