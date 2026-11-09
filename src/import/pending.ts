/**
 * 「新しい工事」で選んだ図面ファイルを、下敷きパネルへ渡すための一時置き場。
 * File は保存データではないのでストアに入れない。受け取ったら空になる。
 */
let pending: File | null = null;

export function setPendingUnderlayFile(f: File | null): void {
  pending = f;
}

export function takePendingUnderlayFile(): File | null {
  const f = pending;
  pending = null;
  return f;
}

export type UnderlayFileKind = 'pdf' | 'jww' | 'image' | 'unsupported';

/** ファイル名と種類から取り込み方を決める（中身の確認は各取り込み処理で行う） */
export function underlayFileKind(f: { name: string; type: string }): UnderlayFileKind {
  const ext = /\.([^.]+)$/.exec(f.name)?.[1].toLowerCase() ?? '';
  if (ext === 'pdf' || f.type === 'application/pdf') return 'pdf';
  // .jwc / .jws も Jw_cad の読み込みへ回す（中身を見て「.jww で保存し直してください」と案内する）
  if (['jww', 'jwc', 'jws'].includes(ext)) return 'jww';
  if (['dxf', 'dwg', 'sfc', 'p21'].includes(ext)) return 'unsupported';
  return 'image';
}
