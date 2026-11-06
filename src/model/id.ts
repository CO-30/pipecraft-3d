/**
 * ID生成。crypto.randomUUID は非セキュアコンテキスト（LAN上のhttp等）で使えないため、
 * getRandomValues が使えればそれを、なければ Math.random を使う。
 */
let counter = 0;

export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  let rand = '';
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(2);
    c.getRandomValues(buf);
    rand = buf[0].toString(36) + buf[1].toString(36);
  } else {
    rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
