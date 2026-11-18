/**
 * ZIP（無圧縮・ファイル名は UTF-8）。提出書類をまとめて 1 つのファイルで保存するために使う。
 * PDF・Excel は中身がもう圧縮されているので、無圧縮でも大きさはほとんど変わらない。
 */
export type ZipFile = { name: string; bytes: Uint8Array };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 同じ名前が重なったら「名前 (2).pdf」のようにして両方残す */
function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let out = name;
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let n = 2; used.has(out); n++) out = `${stem} (${n})${ext}`;
    used.add(out);
    return out;
  });
}

export function zipStore(files: ZipFile[], date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const names = uniqueNames(files.map((f) => f.name)).map((n) => enc.encode(n));
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const size = files.reduce((n, f, i) => n + 30 + 46 + names[i].length * 2 + f.bytes.length, 22);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  const central: { off: number; crc: number }[] = [];
  let p = 0;
  /** ローカルとセントラルで同じ並びの部分: 版・フラグ（UTF-8）・無圧縮・時刻・CRC・大きさ・名前の長さ */
  const common = (i: number, crc: number) => {
    dv.setUint16(p, 20, true); dv.setUint16(p + 2, 0x0800, true); dv.setUint16(p + 4, 0, true);
    dv.setUint16(p + 6, dosTime, true); dv.setUint16(p + 8, dosDate, true);
    dv.setUint32(p + 10, crc, true); dv.setUint32(p + 14, files[i].bytes.length, true); dv.setUint32(p + 18, files[i].bytes.length, true);
    dv.setUint16(p + 22, names[i].length, true); dv.setUint16(p + 24, 0, true);
    p += 26;
  };
  files.forEach((f, i) => {
    const crc = crc32(f.bytes);
    central.push({ off: p, crc });
    dv.setUint32(p, 0x04034b50, true); p += 4;
    common(i, crc);
    out.set(names[i], p); p += names[i].length;
    out.set(f.bytes, p); p += f.bytes.length;
  });
  const cdStart = p;
  files.forEach((_f, i) => {
    dv.setUint32(p, 0x02014b50, true); dv.setUint16(p + 4, 20, true); p += 6;
    common(i, central[i].crc);
    // コメント長・ディスク番号・内部属性・外部属性・ローカルヘッダの位置
    dv.setUint16(p, 0, true); dv.setUint16(p + 2, 0, true); dv.setUint16(p + 4, 0, true); dv.setUint32(p + 6, 0, true); dv.setUint32(p + 10, central[i].off, true);
    p += 14;
    out.set(names[i], p); p += names[i].length;
  });
  dv.setUint32(p, 0x06054b50, true); dv.setUint16(p + 8, files.length, true); dv.setUint16(p + 10, files.length, true);
  dv.setUint32(p + 12, p - cdStart, true); dv.setUint32(p + 16, cdStart, true);
  return out;
}
