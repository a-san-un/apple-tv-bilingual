# Serena Templates

このファイルは、VSCode Copilot で Serena を使うときの指示文テンプレート集です。

方針:

- Serena を使うのは、判断コストが高い作業のときだけ
- 基本ルールは「2 ファイル以上に波及しそうなら Serena、1 ファイルだけの軽微修正なら通常の Copilot」
- ただし、1 ファイルだけでも、影響範囲が読みにくい場合、参照関係を正確に追いたい場合、既存ルール整合が必要な場合は Serena を使ってよい
- まず通常の GitHub / コード確認を行い、必要なときだけ Serena 向け指示文へ変換する
- Serena を使うのは、VSCode Copilot に出す指示文を作るときだけ

---

## 1. 調査だけテンプレート

```text
Serena でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: v2.5-dev

今回は調査のみです。コード変更はまだしないでください。

その後の依頼:
目的:
確認対象:
-

見てほしい観点:
-
-
-

出力してほしい内容:
- 現状整理
- 問題点
- 最小変更案
- 影響範囲
```

---

## 2. 実装込みテンプレート

```text
Serena でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: v2.5-dev

今回は実装まで進めてください。


その後の依頼:
目的:
対象ファイル:
-

要件:
-
-
-

変更しない範囲:
- 関係ない UI は触らない
- issue の責務分担を崩さない
- roadmap / docs の記述と矛盾させない

完了条件:
- 変更ファイル一覧
- 変更内容
- 理由
- テスト観点
- 必要なら issue / roadmap / docs 更新案
```

---

## 3. 影響範囲確認テンプレート

```text
Serena でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: v2.5-dev

まず変更はせず、影響範囲だけ確認してください。

調べてほしい内容:
-
-
-

結果は次の形式で出してください:
1. 触るべきファイル
2. 触らなくてよいファイル
3. 危険な副作用ポイント
4. 最小変更の実装順
```

---

## 4. #7 調査用サンプル

```text
Serena でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: v2.5-dev

今回は調査のみです。コード変更はまだしないでください。

最初に確認してください:
1. README.md / docs/v2.5-dev-roadmap.md / docs/atv-v25-design.md / popup.js / options.js / content.js / issue #7 を直接読めているか
3. 読めない場合は、その旨と理由を最初に明示する

その後の依頼:
目的: #7 secondaryLang fallback の現状確認

確認対象:
- popup.js
- options.js
- content.js
- README.md
- docs/atv-v25-design.md
- docs/v2.5-dev-roadmap.md
- issue #7

見てほしい観点:
- secondaryLang の空値保存はどこで扱っているか
- browser language fallback はどこで適用しているか
- popup / options / content で責務がずれていないか
- roadmap / docs / issue #7 と衝突がないか

出力してほしい内容:
- 現状整理
- 問題点
- 最小変更案
- 影響範囲
```

---

## 5. #7 実装用サンプル

```text
Serena でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: v2.5-dev

今回は実装まで進めてください。

最初に確認してください:
1. README.md / docs/v2.5-dev-roadmap.md / docs/atv-v25-design.md / popup.js / options.js / content.js / issue #7 を直接読めているか
3. 読めない場合は、その旨と理由を最初に明示する

その後の依頼:
目的: #7 secondaryLang の空値保存と browser language fallback の挙動統一

対象ファイル:
- popup.js
- options.js
- content.js
必要なら:
- README.md
- docs/atv-v25-design.md
- docs/v2.5-dev-roadmap.md

要件:
- secondaryLang の空値保存を許容する
- content 側で browser language fallback を一貫適用する
- popup / options では固定言語一覧だけを見せる
- 既存の #6 完了内容を壊さない
- issue #7 の意図と衝突しない
- 変更理由と影響範囲を簡潔に説明する

変更しない範囲:
- #3 のレイアウト調整へ先に踏み込まない
- #9 / #10 の責務まで広げない
- 関係ない UI 文言は触らない

完了条件:
- 変更ファイル一覧
- 変更内容
- 理由
- テスト観点
- 必要なら issue / roadmap / docs 更新案
```

---

## 6. 使い分けの目安

基本ルール:

- 2 ファイル以上に波及しそうなら Serena
- 1 ファイルだけの軽微修正なら通常の Copilot

Serena を使うべき場面:

- 2 ファイル以上に波及しそうな変更
- 影響範囲が読みにくい変更
- 呼び出し関係を正確に追いたい調査
- 既存ルールや過去判断に合わせたい実装
- 修正理由や検証内容まで整理して残したいとき

Serena を使わなくてもよい場面:

- 単純な 1 ファイル軽微修正
- 影響範囲が明白な見た目だけの小修正
- すでに修正方針が完全に固まっている置換作業

例外:

- 1 ファイルだけでも、参照関係の確認が必要、既存ルール整合が重要、説明責任が重い場合は Serena を使ってよい
