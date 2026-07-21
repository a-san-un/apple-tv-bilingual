# Docs Guide

このディレクトリは、Apple TV+ Bilingual Subtitles の docs 入口である。

主な目的は次の 3 つである。

- どの文書が何の正本なのかをすぐ分かるようにする
- 実装前に、読むべき文書を最短で辿れるようにする
- 設計・進捗・運用メモ・過去ログを混ぜずに保守できるようにする

この docs では、特に `content.js` 分割、subtitle sync / recovery、Apple TV+ 固有 UI 制約の整理を中心に扱う。

---

## 1. このディレクトリの役割

この docs ディレクトリは、単なるメモ置き場ではなく、開発中に参照する **設計・進捗・運用の入口** として使う。

現在の主な関心は次のとおり。

- `content.js` を thin coordinator に近づけるための責務分割
- subtitle sync / recovery の truth / controller / UI 境界整理
- Apple TV+ 再生画面での panel / overlay / popup の UI 方針
- AI セッションを使った実装フローの標準化

そのため、1 つの文書に何でも書くのではなく、役割ごとに正本を分けて管理する。

---

## 2. 読む順番

### 2.1 まず読むもの

通常は次の順で読む。

1. `docs/README.md`
2. `docs/content-architecture.md`
3. `docs/issue-32-content-core-split.md`

この順に読むと、

- docs 全体の役割
- content 層の設計正本
- 現在進めている Issue #32 の実装運用正本

を短時間で把握できる。

### 2.2 作業タイプ別の入口

作業タイプごとの入口は次のとおり。

- content 層の責務境界や設計を確認したい
  - `docs/content-architecture.md`
- Issue #32 の現在位置、次ラウンド、完了条件を確認したい
  - `docs/issue-32-content-core-split.md`
- AI セッションの始め方、進捗メモ、確認コマンド運用を確認したい
  - `docs/ai-session-templates.md`
- 過去の検討経緯や完了済みログを見たい
  - `docs/archive/`

Apple TV+ 上の UI / 表示方針も、現在は `docs/content-architecture.md` を参照する。

---

## 3. ドキュメント一覧

### 3.1 `README.md`

このファイルは docs 全体の入口である。

役割は次のとおり。

- 各文書の目的を短く案内する
- 正本の分担を明示する
- 新しいセッションで最初に読む順番を示す

ここに詳細設計や進捗ログを増やしすぎない。

### 3.2 `content-architecture.md`

この文書は、content 層の **設計正本** である。

主に次を扱う。

- `content.js` を含む content 層全体のレイヤー構造
- truth / view / panel / overlay / history の境界
- controller / resolver / observer / layout / bootstrap の責務境界
- subtitle sync / recovery の基本設計方針
- Apple TV+ 上の panel / overlay / popup の UI 方針
- 今後の分割でも維持したい原則

Issue 単位の進捗やラウンドの現在位置は、ここでは主役にしない。

### 3.3 `issue-32-content-core-split.md`

この文書は、Issue #32 の **実装運用正本** である。

主に次を扱う。

- Issue #32 の背景と狙い
- 現在位置
- 分割対象の優先順位
- ラウンド単位の進め方
- 完了条件
- 次アクションと確認項目

subtitle sync / recovery の設計詳細そのものは `content-architecture.md` を参照する。

### 3.4 `ai-session-templates.md`

この文書は、AI セッション運用の正本である。

主に次を扱う。

- Perplexity / VS Code ターミナル / NLM の役割分担
- セッション開始時のチェック項目
- 方針相談 → 確認 → 実装 → テスト → git の流れ
- 進捗メモテンプレ
- テスト手順テンプレ
- 設計スレへ戻す条件

実装内容そのものではなく、**実装の進め方** を揃えるために使う。

### 3.5 `archive/`

`archive/` は、完了済みの検討メモや一時的な移行ログの保管先である。

ここに置くものは次のような文書である。

- すでに役割を終えた issue 単位の経緯メモ
- 新しい正本へ内容を移したあとの旧文書
- 将来また参照する可能性はあるが、日常的には更新しない文書
- 旧 Apple TV+ UI 補助設計文書

archive 配下の文書は、基本的に **参照用** であり、現行正本として更新しない。

---

## 4. 正本の分担

現在の docs 正本分担は次のとおり。

| 文書                                  | 正本として持つもの                         |
| ------------------------------------- | ------------------------------------------ |
| `docs/README.md`                      | docs 全体の入口と参照順                    |
| `docs/content-architecture.md`        | content 層の設計・責務境界・UI 方針        |
| `docs/issue-32-content-core-split.md` | Issue #32 の実装運用・現在位置・次ラウンド |
| `docs/ai-session-templates.md`        | AI セッション運用ルール                    |
| `docs/archive/`                       | 過去ログ・参照用文書                       |

分担の原則は次のとおり。

- 設計と UI 方針は `content-architecture.md`
- 進捗と実装ラウンドは `issue-32-content-core-split.md`
- 運用テンプレは `ai-session-templates.md`
- 過去ログは `archive/`

1 つの内容を複数文書で重複管理しない。

---

## 5. 更新ルール

### 5.1 追加より統合を優先する

新しい文書を増やす前に、既存のどこへ統合すべきかを確認する。

特に次は安易に新規ファイル化しない。

- content 層の責務境界メモ
- Issue #32 の進捗更新
- AI セッションのルール追記
- 一時的な実装方針メモ
- Apple TV+ UI 方針の断片メモ

まずは既存の正本へ追記できるかを確認する。

### 5.2 進捗と設計を混ぜない

docs の保守で最も避けたいのは、設計正本に一時的な進捗ログが混ざることである。

原則は次のとおり。

- 設計判断と UI 方針は `content-architecture.md`
- 「今どこまで終わったか」は `issue-32-content-core-split.md`
- セッション運用は `ai-session-templates.md`

設計の正本に「今回やったこと」を大量に書き足さない。

### 5.3 archive へ移す基準

次の条件を満たした文書は `archive/` へ移してよい。

- 主要内容が新しい正本へ移された
- 今後は継続更新しない
- 日常的な入口としては不要になった
- ただし経緯確認のため削除はしたくない

archive 移行時は、必要なら旧文書の先頭に移行先を書き残す。

---

## 6. 現在の主線

現在の主線は、`issue-32-content-core-split` ブランチ上で進めている `content.js` コア分割と subtitle sync / recovery 整理である。

特に次が中心課題になっている。

- `content.js` を thin coordinator に近づけるための段階分割
- secondary recovery の Runtime First 方針の安定化
- `playbackContext`、layout、reinitialize、sync interval などの責務移送
- Apple TV+ 側挙動と拡張側ロジックの切り分け

新しいセッションを始めるときは、まず `content-architecture.md` と `issue-32-content-core-split.md` を確認してから進める。
