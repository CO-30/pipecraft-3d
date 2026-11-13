/**
 * 実物の図面で精度を測る（手元だけ。図面は個人情報を含むのでリポジトリに入れない）。
 *   npm run bench -- <フォルダ>     （BENCH_DIR を付けて Vitest で動かす）
 * フォルダの中は 1 件 = 1 フォルダ: その工事の PDF 一式と、正解として次のどちらか（両方なら truth.json の値が優先）
 *   - 読み取ったあと人が直して「書き出し」た工事（*.pipecraft.json）→ src/bench/fromDoc.ts
 *   - truth.json（src/bench/truth.ts の形。数量・人の確認の記録・図面の縮尺もここに書く）
 * 結果は <フォルダ>/results.md と画面に出す。BENCH_DIR が無いときは何もしない（ふだんのテストでは飛ばす）。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPlanInputs } from '../import/planSet';
import { parseProject } from '../storage/repository';
import { buildFromSheets } from '../model/planRead/assemble';
import { designFromReading } from './design';
import { evaluate } from './evaluate';
import { truthFromDoc } from './fromDoc';
import { readingOf } from './reading';
import { compareQuantities, formatQuantities } from './quantity';
import { formatScore } from './report';
import { parseTruth } from './truth';

const dir = process.env.BENCH_DIR;

describe.skipIf(!dir)('実物の図面で精度を測る（BENCH_DIR）', () => {
  it('フォルダごとに読み取り → 正解と比べて results.md に書く', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const docOf = (c: string) => readdirSync(join(dir!, c)).find((n) => n.endsWith('.pipecraft.json'));
    const cases = readdirSync(dir!).filter((n) => statSync(join(dir!, n)).isDirectory() && (existsSync(join(dir!, n, 'truth.json')) || docOf(n))).sort();
    expect(cases.length, `${dir} に truth.json か .pipecraft.json の入ったフォルダがありません`).toBeGreaterThan(0);
    const out: string[] = [`# 図面解析の精度（${new Date().toISOString().slice(0, 10)}）`, ''];
    for (const c of cases) {
      const over = existsSync(join(dir!, c, 'truth.json')) ? JSON.parse(readFileSync(join(dir!, c, 'truth.json'), 'utf8')) : { id: c, kind: 'detached' };
      const doc = docOf(c);
      const truth = doc ? truthFromDoc(parseProject(readFileSync(join(dir!, c, doc), 'utf8')), over) : parseTruth(over);
      const files = readdirSync(join(dir!, c)).filter((n) => /\.pdf$/i.test(n)).sort()
        .map((n) => { const b = readFileSync(join(dir!, c, n)); return { name: n, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }; });
      try {
        const { inputs } = await readPlanInputs(files, pdfjs);
        const res = buildFromSheets(inputs);
        out.push(formatScore(truth, evaluate(readingOf(res, inputs), truth)));
        // 実際の数量があれば、読み取り結果から自動でつないだ配管の材料と比べる
        if (truth.quantities?.length) out.push(formatQuantities(compareQuantities(truth.quantities, designFromReading(res).summary)));
      } catch (e) {
        out.push(`## ${truth.id}\n\n読み取りに失敗: ${(e as Error).message}\n`);
      }
    }
    const md = out.join('\n');
    writeFileSync(join(dir!, 'results.md'), md);
    console.log(md);
  }, 600_000);
});
