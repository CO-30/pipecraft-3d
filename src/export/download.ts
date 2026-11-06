/** 生成したファイルを端末に保存（ダウンロード）する */
export function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  // DOM に追加して直後に外すとファイル名が使われないブラウザがあるため、追加せずにクリックする
  a.dispatchEvent(new MouseEvent('click'));
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}

/** ファイル名に使えない文字を除く */
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || '現場';
