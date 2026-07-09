# AI Session Templates

このファイルは、VS Code の GitHub Copilot（Serena MCP 連携を含む）に渡す指示文テンプレートと、
このチャット（Perplexity）とのセッション運用ルールをまとめたものです。

- ユーザー → このチャット に渡す「次スレ冒頭テンプレ」
- このチャットが確認すべきチェックリスト
- このチャット → VS Code の Copilot / Serena に渡す指示文テンプレ（調査 / 実装 / docs）

をまとめた AI セッション用テンプレ集です。

---

## 1. セッション運用方針

- この文書は「VS Code の GitHub Copilot / Serena に何をどう渡すか」のテンプレ集として使う。
- Serena MCP は、2 ファイル以上に波及する・影響範囲が読みにくい・参照関係を追いたい作業で使う。
- 1 ファイルだけの軽微修正は、通常の Copilot 提案で十分な場合が多い。
- 指示文の冒頭で「調査のみ」か「実装まで進める」かを必ず宣言する。
- 指示文では「現在位置」「目的」「変更しない範囲」「完了条件」を明示する。
- このチャットは調査・切り分け・方針整理・Copilot / Serena 用指示文作成を担当し、
  VS Code 側の Copilot / Serena はコード修正・docs 反映・コミット準備を担当する。
- 毎回の指示文で、**不要コード削除・重複回避** を明示する。
- 新しい処理を足す前に、既存 helper / 既存フロー / 既存 state へ寄せられないかを確認する。
- 旧ロジックを残したまま新ロジックを継ぎ足さず、置き換え可能なものは置き換える。
- ただし、削除は **確実に不要と判断できるコードだけ** に限定し、広い整理は issue の責務外なら行わない。
- docs は「ズレが見つかった場合のみ最小差分」の原則で更新する。
- docs の役割は分ける:
  - `docs/dev-roadmap.md`: issue / phase / 実装順の管理
  - `docs/atv-design.md`: UI / 設計意図 / 表示ルールの整理
  - `docs/ai-session-templates.md`: AI セッション運用テンプレ整理
- Phase 3 で #18 は切り分け完了・close 済み。残課題の primary UI 非対称は Phase D の #19 で扱う前提で指示文を組み立てる。

---

## 2. このチャット用チェックリスト

- 対象リポジトリ / ブランチ / 関連 Issue / Phase を確認したか？
- 今回は戻らない範囲（再調査・再実装しないもの）を理解しているか？
- 今回の目的を分類したか？
  - 調査 / 実装 / docs 整備 / push だけ など
- 触らない責務を把握しているか？
  - 例: resolver / secondaryLang fallback / content.js 全面分割 など
- docs は「ズレが見つかった場合のみ最小差分」のルールを意識しているか？
- 重複コードを増やさないルールを意識しているか？
- 今回の変更で不要コード・旧分岐・未使用変数・死んだ説明文が発生しないか意識しているか？
- 「既存処理へ寄せる」のか「新規追加が本当に必要」なのかを切り分けたか？
- 今回の作業が Serena MCP を使う条件に当てはまるか確認したか？
  - 2 ファイル以上に波及
  - 影響範囲が読みにくい
  - 既存ルールとの整合確認が重要
- 条件に当てはまる場合、下のテンプレから適切なものを選んで Copilot / Serena 用指示文を作ったか？
- docs 更新時に、どの内容を `dev-roadmap` に書き、どの内容を `atv-design` に書くべきか切り分けたか？
- Phase D の UI 仕様ラフのような「表示パターン / 描画ルール」は `docs/atv-design.md` 側へ寄せる前提を意識したか？

---

## 3. 次スレ冒頭テンプレ（ユーザー → このチャット）

```text
今回のセッションの前提:

- 対象リポジトリ:
- 対象ブランチ:
- 関連する Issue / Phase:
- すでに完了しているタスク:
  -
  -
- 今回は戻らない範囲（再調査・再実装しないもの）:
  -
  -

今回の目的:
-

今回このスレでやりたいこと:
1.
2.
3.

このセッションの終了条件:
-

今回のルール:
- docs 更新はズレがある場合のみ、最小差分で
- content.js は全面分割に進まない（分割ロードマップは変えない）
- resolver / secondaryLang fallback の仕様は変更しない
- 重複コードを増やさない（共通 helper / 既存フローを優先）
- 不要コードを残さない（置き換え後の旧分岐・未使用変数・古い文言は削除候補として確認）
```

---

## 4. 共通ルール（実装・docs 共通）

- 変更は最小差分を優先する。
- 既存 helper / 既存フロー / 既存 state を再利用し、別経路のコピペ実装を増やさない。
- 同じ責務の処理を分岐ごとに複製しない。
- 今回の issue の責務を超える全面リファクタリングは行わない。
- docs 更新は、内容のズレが見つかった箇所に限定し、短い追記・文言修正に留める。
- 実装でも docs でも、変更によって不要になった旧記述・旧分岐・未使用変数・死んだ説明は削除候補として確認する。
- 旧ロジックを残したまま新ロジックを追加する形は避け、置き換えられるものは置き換える。
- ただし、削除は「確実に不要」と判断できるものだけに限定し、不確実なものは残して報告する。
- commit / push を含む場合は、指示文の早い段階で「今回は commit まで」「今回は push まで」と明示する。
- docs の粒度は役割で分ける:
  - 実装順 / 優先順位 / phase 管理 → `docs/dev-roadmap.md`
  - 画面仕様 / UI ルール / 描画パターン / 責務境界 → `docs/atv-design.md`
  - AI への渡し方 / テンプレ / セッション進行ルール → `docs/ai-session-templates.md`

---

## 5. 調査テンプレート（このチャット → Copilot / Serena）

```text
VS Code の GitHub Copilot / Serena MCP でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: phase-3

今回は調査のみです。コード変更はまだしないでください。

現在位置:
- Phase:
- Issue:
- ここまで完了していること:

目的:
-

確認対象:
-

見てほしい観点:
-
-
-

変更しない範囲:
-
-

不要コード削除・重複回避の観点:
- 今回の対象範囲で、不要になっている旧ロジックや未使用変数がないか
- 同じ責務の処理が別経路に重複していないか
- 新規 helper を足さずに既存 helper / 既存フローへ寄せられる余地があるか

出力してほしい内容:
- 現状整理
- 問題点
- 最小変更案
- 影響範囲
- 不要コードや重複の懸念箇所
```

### 5.1 Phase D 調査テンプレート（#19 向け）

```text
VS Code の GitHub Copilot / Serena MCP でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: phase-3

今回は調査のみです。コード変更はまだしないでください。

現在位置:
- Phase: Phase D
- Issue: #19「binder/sidebar 側で primary cue が UI に反映されない非対称を解消する」
- ここまで完了していること:
  - #17 は完了済み（current 行 + 左マーク欄 + threshold-scroll）
  - #18 は完了済み（resolver / content.js の signal レイヤーまで切り分け済み）
  - 残課題は binder / sidebar / renderPanel 側にある前提

目的:
- primary cue が live に存在しているのに、右字幕パネルの primary 行が空になる経路を特定する
- current / history / future の block 構築が primary / secondary で非対称になっている箇所を特定する
- 最小変更で直せる責務境界を整理する

確認対象:
- content.js
  - binder 相当の block 構築経路
  - sidebar / renderPanel の描画経路
  - lastPanelRenderSnapshot / current/history/future の再利用条件
- docs/atv-design.md
  - Phase D の描画パターン・UI 仕様ラフとの整合

見てほしい観点:
- primary cue が live にあるとき、どの条件で primary 行テキストが欠落するか
- secondary-only current が正規経路として残っていないか
- block の identity / merge / update の条件が primary / secondary で揃っているか

変更しない範囲:
- resolver の言語一致仕様
- secondaryLang fallback の仕様
- #17 で確定した current 行 + 左マーク欄 + threshold-scroll モデル
- layout / observer / bootstrap の広い整理

不要コード削除・重複回避の観点:
- binder / sidebar / renderPanel の近傍に、旧分岐や似た描画分岐が重複していないか
- current/history/future の block 処理が別経路でコピペ化していないか
- renderPanel に寄せられる処理と binder に寄せるべき処理が分裂していないか

出力してほしい内容:
- 現状整理
- primary 行が空になる条件
- 非対称の原因候補
- 最小変更案
- 影響範囲
- 不要コードや重複の懸念箇所
```

---

## 6. 実装テンプレート（このチャット → Copilot / Serena）

```text
VS Code の GitHub Copilot / Serena MCP でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: phase-3

今回は実装まで進めてください。

現在位置:
- Phase:
- Issue:
- Step:
- ここまで完了していること:
  -
  -

目的:
-

対象ファイル:
-

要件:
-
-
-

変更しない範囲:
- 今回は触らない責務:
  -
- 仕様を変えない部分:
  -
- roadmap / docs の記述と矛盾させないこと

不要コード削除・重複回避（毎回必須）:
- 今回の変更で不要になった旧分岐・未使用変数・死んだ処理があれば削除する
- 既存 helper / 既存フロー / 既存 state に寄せられるなら寄せる
- 同じ責務の処理を別経路に複製しない
- 旧ロジックを残したまま新ロジックを継ぎ足さない
- ただし、確実に不要と判断できるものだけ削除する

commit / push 方針:
- 今回は commit まで / push まで
- どの単位で commit するか:
  -

完了条件:
- 変更ファイル一覧
- 変更内容
- 理由
- テスト観点
- 削除した不要コード
- 重複回避のために整理した点
- 必要なら docs / issue 更新案
```

### 6.1 Phase D 実装テンプレート（#19 向け）

```text
VS Code の GitHub Copilot / Serena MCP でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: phase-3

今回は実装まで進めてください。

現在位置:
- Phase: Phase D
- Issue: #19「binder/sidebar 側で primary cue が UI に反映されない非対称を解消する」
- ここまで完了していること:
  - #17 は完了済み（current 行 + 左マーク欄 + threshold-scroll）
  - #18 は完了済み（resolver / content.js signal レイヤーまで切り分け済み）
  - docs/atv-design.md に Phase D 用の描画パターン・UI 仕様ラフを記載済み

目的:
- primary cue が live に存在する場合に、右字幕パネルの primary 行へ正しく反映されるようにする
- current / history / future の block 構築で primary / secondary の整合を取り、secondary-only current の残留を減らす

対象ファイル:
- content.js
- 必要なら docs/atv-design.md
- 必要なら docs/dev-roadmap.md（ズレが出た場合のみ最小差分）

要件:
- primary cue が live に存在する場合、primary 行が空のまま描画されないこと
- primary / secondary を可能な限り同一 block の中で扱うこと
- secondary-only block は、primary が本当に欠落している場合の暫定表示に留めること
- #17 の current 行モデル（左マーク欄 + threshold-scroll）は変更しない
- resolver / fallback 仕様は変更しない

変更しない範囲:
- resolver の言語一致仕様
- secondaryLang fallback の仕様
- layout / observer / bootstrap の整理
- content.js 全面分割ロードマップ

不要コード削除・重複回避（毎回必須）:
- 今回の変更で不要になった旧分岐・未使用変数・死んだ処理があれば削除する
- 既存 helper / 既存フロー / 既存 state に寄せられるなら寄せる
- 同じ責務の処理を別経路に複製しない
- 旧ロジックを残したまま新ロジックを継ぎ足さない
- ただし、確実に不要と判断できるものだけ削除する

commit / push 方針:
- 今回は commit まで / push まで
- どの単位で commit するか:
  - 実装
  - 必要なら docs 最小差分

完了条件:
- 変更ファイル一覧
- 変更内容
- 理由
- テスト観点
- 削除した不要コード
- 重複回避のために整理した点
- 必要なら docs / issue 更新案
```

### 6.2 Phase E 実装テンプレート（#20 向け）

```text
VS Code の GitHub Copilot / Serena MCP でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: phase-3

今回は実装まで進めてください。

現在位置:
- Phase: Phase E
- Issue: #20「content.js panel / overlay セクションの責務分離」
- Step:
  1) 入口整理（境界コメント整理 / create 責務整理）
  2) render 責務線追加（shell 作成ではなく既存 shell への state 反映を明示）
  3) shell 分離本体（panel / overlay / subtitle popup を段階的に切り出す）

用語ポリシー:
- content.js の popup は subtitle popup（字幕上の辞書 popup）と表記する
- extension popup（拡張 UI の popup.html / popup.js）は別物として扱い、#20 差分へ混ぜない
```

---

## 7. docs 更新テンプレート（このチャット → Copilot / Serena）

```text
VS Code の GitHub Copilot / Serena MCP でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: phase-3

今回は docs 更新のみです。実装コードは変更しません。

目的:
-

対象ファイル:
- docs/...

やってほしいこと:
1.
2.

制約:
- 変更は最小差分
- 既存文を大きく書き換えない
- トーンは既存 docs に合わせる
- 内容が最新実装と矛盾していないかを確認してから書き換える

不要記述削除・重複回避（毎回必須）:
- 実装変更で古くなった説明があれば削除または更新する
- 同じ説明を複数ファイルに重複して書きすぎない
- docs ごとの役割に合わせて粒度を分ける
- ただし、必要な背景説明まで削らない

完了時の報告:
- 変更ファイル一覧
- 各ファイルで何を変えたか
- 削除した古い記述や重複記述
- 変更不要と判断したファイル
```

### 7.1 docs 役割別テンプレート

```text
docs 更新時の役割分担:

- docs/dev-roadmap.md
  - Issue / Phase / 状態 / 優先順位 / 次バッチの実装順を書く
  - 設計詳細や UI ラフは書き込みすぎない

- docs/atv-design.md
  - UI 仕様、primary / secondary 描画パターン、責務境界、表示ルールを書く
  - Phase D のような描画非対称問題の設計ラフはこちらに寄せる

- docs/ai-session-templates.md
  - AI への依頼テンプレ、運用ルール、調査/実装/docs テンプレを書く
  - 個別 issue の詳細仕様は書き込みすぎず、再利用可能な形に保つ
```

### 7.2 Phase 3〜D docs 更新テンプレート

```text
VS Code の GitHub Copilot / Serena MCP でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: phase-3

今回は docs 更新のみです。実装コードは変更しません。

目的:
- #17 / #18 / #19 の現状に合わせて docs を整合させる
- dev-roadmap / atv-design / ai-session-templates の役割分担を明確にする

対象ファイル:
- docs/dev-roadmap.md
- docs/atv-design.md
- docs/ai-session-templates.md

やってほしいこと:
1. docs/dev-roadmap.md で #18 を完了、#19 を Phase D として反映する
2. docs/atv-design.md で #17 完了後の current 行モデル、#18 切り分け結果、#19 向け UI 仕様ラフを反映する
3. docs/ai-session-templates.md で Phase D 向けの調査 / 実装テンプレと docs の役割分担を反映する

制約:
- 変更は最小差分
- 既存文を大きく書き換えない
- トーンは既存 docs に合わせる
- 内容が最新実装と矛盾していないかを確認してから書き換える

不要記述削除・重複回避（毎回必須）:
- #18 未着手前提、`__atvbDumpTracks()` 前提など古くなった説明があれば更新する
- 同じ詳細を 3 ファイルすべてに重複して書きすぎない
- dev-roadmap は実装計画、atv-design は UI/設計、ai-session-templates は運用テンプレに寄せる

完了時の報告:
- 変更ファイル一覧
- 各ファイルで何を変えたか
- 削除した古い記述や重複記述
- 変更不要と判断したファイル
```
