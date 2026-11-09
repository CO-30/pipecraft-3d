/// <reference lib="webworker" />
/**
 * Jw_cad（.jww）の解析。ezjww（MIT）の WebAssembly を Worker で動かす。
 * ezjww の npm 配布物は Node.js 向け（fs で .wasm を読む）なので、
 * 同じ読み込みコードに「fetch した .wasm を返す require」を渡してブラウザで動かす。
 */
import glue from '../../node_modules/ezjww/wasm/ezjww_wasm.js?raw';
import wasmUrl from '../../node_modules/ezjww/wasm/ezjww_wasm_bg.wasm?url';
import { jwwToDrawing, type JwwLike } from '../model/cadDrawing';

type Ezjww = { detectFileFormat(d: Uint8Array): string | null; readDocument(d: Uint8Array): JwwLike };
let lib: Promise<Ezjww> | null = null;

function load(): Promise<Ezjww> {
  lib ??= (async () => {
    const res = await fetch(wasmUrl);
    if (!res.ok) throw new Error('図面を読む部品を読み込めませんでした');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const exports = {} as Ezjww;
    const require = () => ({ readFileSync: () => bytes });
    new Function('exports', 'require', '__dirname', glue)(exports, require, '');
    return exports;
  })();
  return lib;
}

export type JwwRequest = { data: ArrayBuffer };
export type JwwResponse = { ok: true; drawing: ReturnType<typeof jwwToDrawing> } | { ok: false; error: string };

const OTHER: Record<string, string> = {
  jwc: 'JWC 形式（古い Jw_cad）には対応していません。Jw_cad で開いて .jww で保存し直してください',
  jws: 'JWS（図形ファイル）には対応していません。図面（.jww）を選んでください',
};

self.onmessage = async (e: MessageEvent<JwwRequest>) => {
  let out: JwwResponse;
  try {
    const ez = await load();
    const data = new Uint8Array(e.data.data);
    const fmt = ez.detectFileFormat(data);
    if (fmt !== 'jww') out = { ok: false, error: OTHER[fmt ?? ''] ?? 'Jw_cad の図面（.jww）ではないようです' };
    else out = { ok: true, drawing: jwwToDrawing(ez.readDocument(data)) };
  } catch (err) {
    out = { ok: false, error: `図面を解析できませんでした（${err instanceof Error ? err.message : String(err)}）` };
  }
  (self as DedicatedWorkerGlobalScope).postMessage(out);
};
