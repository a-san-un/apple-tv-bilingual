# Serena Templates

このファイルは、VSCode Copilot で Serena を使うときの指示文テンプレート集です。

## 方針

- この文書は「VSCode Copilot に何をどう渡すか」のテンプレ集として使う。
- Serena を使うのは、判断コストが高い作業のときだけ。
- 基本ルールは「2 ファイル以上に波及しそうなら Serena、1 ファイルだけの軽微修正なら通常の Copilot」。
- ただし 1 ファイルでも、影響範囲が読みにくい場合や参照関係を正確に追いたい場合は Serena を使ってよい。
- 指示文では「現在位置（Step）」「目的」「変更しない範囲」「完了条件」を明示する。
- 指示文の冒頭で「調査のみ」か「実装まで進める」かを必ず宣言する。
- #14 のような段階実装では、現在位置を「Phase / Issue / Step」で明示すると差分がぶれにくい。
- 基本運用として、Perplexity は調査・切り分け・方針整理・Copilot 用プロンプト作成を担当し、VSCode Copilot は実際のコード修正・docs 反映・コミット準備を担当する。

---

## 1. 調査だけテンプレート

```text
Serena でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: phase-2

今回は調査のみです。コード変更はまだしないでください。

その後の依頼:
現在位置:
-

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
対象ブランチ: phase-2

今回は実装まで進めてください。

その後の依頼:
現在位置:
-

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
対象ブランチ: phase-2

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

## 4. content.js 分割マッピング用テンプレート

```text
Serena でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: phase-2

今回は調査のみです。コード変更はまだしないでください。

役割は「既に決めてある分割ロードマップに対して、content.js のコードをマッピングするアーキテクト」です。

## 前提

- 対象リポジトリ: a-san-un/apple-tv-bilingual
- 対象ブランチ: phase-2（作業開始元は main）
- 対象ファイル: content.js（Apple TV+ 向けの字幕拡張の content script）
- content.js は肥大化しているが、分割方針・フェーズ構成はすでに合意済みであり、ここでは変えない前提です。
- あなたの仕事は「新しい分割案を考えること」ではなく、「既存の分割ロードマップに対して、今の content.js をどうマッピングするかを具体的に整理すること」です。

## 既存の分割ロードマップ（変更しない前提）

Phase A:
- vtt-normalizer.js
- debug-logger.js

Phase B:
- subtitle-track-resolver.js

Phase C:
- settings-bridge.js
- debug-panel.js

Phase D:
- subtitle-track-binder.js
- sidebar-panel.js

Phase E:
- controls-layout.js
- content-bootstrap.js

### 各Phaseのざっくり役割

- Phase A: WebVTT テキスト整形・cue正規化（純関数）と、ログ出力 / debug helper。
- Phase B: textTracks から使う字幕トラックを決める resolver（secondary language fallback など含む）。
- Phase C: popup / options / storage との橋渡し（settings bridge）と、ATV DEBUG UI のパネル部品。
- Phase D: subtitle track とパネルを結びつける binder と、右字幕パネル UI 本体。
- Phase E: 再生コントロール周りのレイアウト調整と、content script 全体の初期化ブートストラップ。

## やってほしいこと（ステップ）

1. content.js のコードを読んで、次の観点で関数・処理をクラスタリングしてください。
   - vtt / cue / text 整形に関係する処理
   - textTracks / secondary language resolver に関係する処理
   - popup / options / storage / message listener に関係する処理
   - ATV DEBUG UI / debug helper / dump / console 出力に関係する処理
   - 右字幕パネル UI / パネル描画 / DOM 挿入に関係する処理
   - 再生コントロールの位置調整 / layout / observer / bootstrap に関係する処理

2. クラスタごとに、
   - 関数名
   - 役割（1〜2行）
   - 依存している state / DOM / 設定
   - 副作用の有無（DOM 書き換え / event 登録 / observer 起動など）
   を一覧にしてください。

3. 次に、上記クラスタを Phase A〜E とそれぞれのファイル名にマッピングしてください。
   - 例: normalizeCue → Phase A / vtt-normalizer.js
   - 例: __atvbDumpTracks、debugLog、dumpState → Phase A / debug-logger.js
   - 例: settings の onMessage / storage.onChanged → Phase C / settings-bridge.js
   - という形で、必ず「Phase」「ファイル名」「理由」を書いてください。

4. 各Phaseごとに、「今の content.js からどの関数を移すべきか」を箇条書きで整理してください。
   - 関数名と役割（短く）
   - 依存関係（何に依存しているか）
   - 移動のときに注意すべき点（副作用や初期化順序）

5. 最後に、「どのPhaseから実際の分割実装を始めるのが安全か」を、次の観点でコメントしてください。
   - 副作用の弱さ（純関数から始める）
   - Issue #4（ATV DEBUG 統合）との関連度
   - 既存挙動への影響の大きさ
   - 段階分割に向いた順番候補（例: Phase A → Phase C → Phase B → Phase D → Phase E）

## 出力フォーマット

次の形式で出してください。

1. 「クラスタ一覧」セクション
   - クラスタ名（例: vtt / cue）
   - 含まれる関数と簡単な説明
   - 依存 state / DOM / 設定
   - 副作用の有無

2. 「Phaseマッピング」セクション
   - Phase A〜E ごとに、
     - 関連クラスタ
     - そこに含まれる関数名
     - 移動先ファイル名
     - マッピング理由

3. 「段階分割の着手順」セクション
   - 推奨順序（例: Phase A → Phase C → Phase B → Phase D → Phase E）
   - 各Stageでの注意点（1〜2行）

## 禁止事項 / 注意点

- 上記の分割ロードマップ（Phase A〜E とファイル名）は、変えない前提です。新しい構成を提案しないでください。
- いきなりコードを書き換える提案はせず、まずは「マッピングと段階分割順の整理」までにとどめてください。
- 既存の挙動を変えるリファクタリング案は、このプロンプトの回答では出さないでください（別プロンプトで扱います）。
```

---

## 5. 使い分けの目安

```text
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
```

---

## 6. Step 現在位置提示テンプレート

```text
Serena でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: phase-2

今回は実装まで進めてください。

前提:
- いま Step N（例: Step 15）です
- Step N-1 までで確認済み:
   -
   -

今回の到達目標:
-

今回やらないこと:
-

完了時に必ず報告してほしい内容:
- 変更ファイル一覧
- 変更内容
- 残課題（あれば）
```

---

## 7. docs だけ最小差分テンプレート

```text
Serena でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: phase-2

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
- README は触らない（必要時のみ事前確認）

完了時の報告:
- 変更ファイル一覧
- 各ファイルで何を変えたか
- 変更不要と判断したファイル
```

---

## 8. 重複防止制約つき実装テンプレート

```text
Serena でこのプロジェクトを有効化してください。
プロジェクト名: apple-tv-bilingual
対象ブランチ: phase-2

今回は実装まで進めてください。

目的:
-

対象ファイル:
-

要件:
-

重複を増やさない実装ルール:
- 既存 helper を再利用し、別経路のコピペ実装を増やさない
- clear / track resolve / listener rebind / panel apply を分岐ごとに複製しない
- onCueChange に直接 textContent 更新コードを増やさない
- panel open 時専用の再描画ロジックを増やさない
- video_changed 時も panel open 時と同じ共通 helper を使う

完了条件:
- 変更ファイル一覧
- 変更内容
- なぜその変更で重複が増えないか
- テスト観点
```
