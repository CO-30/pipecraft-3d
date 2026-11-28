# 様式ごとの必須項目 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（自動実行・Native）

**Goal:** 「📂 提出書類一式」で、書類ごとに空欄のまま印刷される必須の欄（義務者・工事の種別・接続先 など）と、条件つきの欄（「その他」の内容・除害施設の内容・使用者が別のときの氏名）、工事予定期間の前後の逆転を「確認が必要」の理由に出す。
**Architecture:** 純関数 `src/forms/required.ts` の `formRequiredReasons(doc: 'water'|'nanbu'|'sewer', set: FormSet, v: ApplicationValues): string[]`。様式にある項目だけ調べる。`docRows` が各書類の理由に足す。保存データ・様式の出力は変えない。
**Tech Stack:** TypeScript / Vitest
**Spec:** 定期作業の指示 (e)「様式ごとの必須項目の追加（義務者など）」

## Global Constraints
- 自治体の基準を勝手に決めない: 理由は「〜が未入力です（空欄のまま印刷されます）」と事実だけ書く。値を勝手に埋めない。
- 様式に無い項目は調べない（has.has(id)）。既存の共通の理由（設置場所・申込者）と重ねない。
- 初めての人に分かる言葉。

## Review Focus
- 既定値が入った普通の新築（一般家庭・水道水・除害無し）で、工事予定期間と人員以外は理由が出ない
- 義務者は空でも申込者で補って印刷されるので、両方空のときだけ出す
- 全角・空白だけの値は空とみなす（trim）
- 「至」が「自」より前のときだけ逆転を出す（同じ日は出さない、片方だけは未入力として出す）
- 南部（南風原）の下水道は世帯数が sewerHouseholds、沖縄市は households

### Task 1: formRequiredReasons
**Files:** Create `src/forms/required.ts`, `src/forms/required.test.ts`
- [ ] 失敗するテスト（上の Review Focus を含む）→ 失敗を確認 → 実装 → 合格
### Task 2: docRows へ組み込み
**Files:** Modify `src/ui/docCenter.ts`、Test `src/ui/docCenter.test.ts`
- [ ] 下水道の行だけに下水道の理由、給水の行だけに給水の理由が出るテスト → 実装 → 全単体・型・E2E
