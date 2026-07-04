# v2.5-dev 実装ロードマップ

> **ブランチ**: `v2.5-dev`  
> **最終更新**: 2026-07-04  
> **マージ先**: `main`（`v2.5-dev` 側で機能が安定したタイミングでマージ）

---

## 更新方針

- 既存 issue（#3〜#8）は基本的にそのまま使用する。
- 実機検証の結果を踏まえて、**優先順位・フェーズ・完了状態を更新**する。
- popup / options の言語候補が動画状態に依存して変化する問題について、
  - 設定 UI は固定言語一覧ベース
  - 実トラック選択は content.js 側の resolver
    という役割分担で解消済み。
- そのため、Phase 1 の「設定 UI 安定化」に関する部分は完了として扱う。

---

## Issue 一覧

| #                      | タイトル                                                               | 優先度 | フェーズ   | 状態             | ラベル                                               |
| ---------------------- | ---------------------------------------------------------------------- | ------ | ---------- | ---------------- | ---------------------------------------------------- |
| [#3](../../issues/3)   | 字幕パネル表示時に動画操作レイヤーが右パネルに隠れないよう調整する     | P0     | Phase 1    | **完了**         | `p0` `bug` `enhancement` `area:ui`                   |
| [#4](../../issues/4)   | ATV DEBUG を独立表示から右字幕パネル下部の折り畳みセクションへ統合する | P1     | Phase 2    | 未完了           | `p1` `enhancement` `area:ui` `area:content`          |
| [#5](../../issues/5)   | options の「デバッグログ（開発者向け）」セクションを折り畳み既定にする | P1     | Phase 2    | 完了             | `p1` `enhancement` `area:options`                    |
| [#6](../../issues/6)   | popup / options の字幕言語一覧を動画状態から分離して固定化する         | P0     | Phase 1    | **完了**         | `p0` `bug` `enhancement` `area:popup` `area:content` |
| [#7](../../issues/7)   | secondaryLang の空値保存とブラウザ言語 fallback の挙動を統一する       | P0     | Phase 1    | 実装あり・整理中 | `p0` `bug` `enhancement` `area:popup` `area:content` |
| [#8](../../issues/8)   | Debug ログのカテゴリ設計を整理し、共通ログ基盤を共有する               | P1     | Phase 3    | 未完了           | `p1` `enhancement` `area:options` `area:content`     |
| [#9](../../issues/9)   | content.js の current 表示強化（タイトル・トラック情報の常時表示）     | P1     | 後続タスク | 未完了           | GitHub issue の実内容に合わせて整理                  |
| [#10](../../issues/10) | 単語ポップアップ UI 刷新・AI タブ拡張と dictionaryapi.dev ハンドラ実装 | P2     | 後続タスク | 未完了           | GitHub issue の実内容に合わせて整理                  |

---

## フェーズ構成

### Phase 1: 字幕選択と再生 UI の安定化

**ゴール**: popup / options の言語設定が動画状態に依存せず安定して表示され、secondaryLang の空値運用を含めた設定 UI が一貫して扱えること。  
加えて、動画再生 UI が右字幕パネルに妨げられない状態を作る。

- [x] [#6] 固定言語一覧ベースへの変更と UI からの textTracks 生データ分離
- [ ] [#7] secondaryLang 空値許容とブラウザ言語 fallback 前提の UI 整理
- [x] [#3] 動画操作レイヤーの重なり解消

**#6 完了メモ**

- `SUPPORTED_LANGS` に基づく固定言語一覧を popup / options で使用。
- 動画ごとの `textTracks` の生データは UI に直接出さない。
- 設定保存後、アクティブな Apple TV+ タブへ設定を即時通知する実装を追加。
- content.js 側で `requestedSecondaryLanguage` と `selectedSecondaryTrackLanguage` を分けてログ出力し、resolver の挙動を確認しやすくした。
- 実機検証で、`ja / zh-Hant / ko / fr-FR / de / es-ES` の言語切替が安定して動作することを確認。

**#3 完了メモ**

- 再生開始直後 / 設定反映直後に発生していた操作レイヤーの左右フラつき・右戻りを解消。
- 補正は `scheduleAdjustPlaybackControls` と短時間の settling burst で実施し、常駐監視に依存しない構成に整理。
- `.video-player__footer` / `.unified-controls` / `amp-volume-control-unified` を同一基準で補正し、右字幕パネルとの重なりを回避。
- shift 値を `data-atvb-shift-x` に保持し、再計算時の snap-back（右戻り）を防止。
- ボリューム UI は「字幕パネルに重なる分だけ移動」の仕様に調整済み（中央寄せはしない）。
- `console.table` 計測と実機操作で、再生バー・シーク UI・ボタン群が右パネルに隠れないことを確認。

### Phase 2: Debug UI 整理

**ゴール**: Debug UI が常時浮かず、必要なときだけ右字幕パネルや options から確認できる状態を作る。

- [ ] [#4] ATV DEBUG を字幕パネル下部に統合
- [x] [#5] options の Debug セクション折り畳み既定化

### Phase 3: ログ基盤整理

**ゴール**: options と字幕パネルが同じログソースを共有し、必要なカテゴリだけを既定表示できること。

- [ ] [#8] Debug ログカテゴリ設計整理

---

## 完了済み項目メモ

### #5 options の「デバッグログ（開発者向け）」セクションを折り畳み既定にする

**確認済み内容**

- `options.html` / `options.js` の修正完了
- `debugSectionBody` に `hidden` 属性を追加し、初期状態で非表示化
- `debugSectionToggle` の `aria-expanded` を `false` に変更
- トグルアイコンを `▶`（折り畳み）/ `▼`（展開）に統一

**関連コミット**

- `c09cb42`
- `90153b9`

### #6 popup / options の字幕言語一覧を動画状態から分離して固定化する

**確認済み内容**

- popup / options の言語候補を固定一覧ベースへ変更。
- `primaryLang` / `secondaryLang` を `chrome.storage.sync` に保存し、options / popup どちらからでも編集可能。
- `secondaryLang` 空値保存を許容し、未設定時にブラウザ言語 fallback を適用する前提で UI を整理。
- 設定保存後、アクティブな Apple TV+ タブへ設定を即時通知（manifest に scripting 権限追加）。
- F12 Console で次のログを確認済み:
  - `SETTINGS_CHANGED received`
  - `restartBilingual begin / done`
  - `Selected tracks detail`
  - `startBilingual ready`
  - `content applied settings to tracks`
- WebVTT の cue テキストに含まれていた `<c.styledotitalic>` などのタグ断片について、
  - content.js 側で正規化処理を追加
  - `__atvbDumpTracks()` の `hasTag: false` により、全言語でタグ除去済みであることを確認。

**関連コミット**

- `v2.5-dev` ブランチ上の設定伝達・正規化関連コミット一式

---

## Phase 1 の補足メモ

### 1. 字幕選択 UI

- popup / options の言語選択肢は、動画ごとの `textTracks` の生データをそのまま出さず、固定一覧ベースで扱う。
- 設定 UI では、`en`, `ja`, `de` のような正規化済み言語コードに対応する **1 言語 1 項目** だけを見せる。
- `English (forced)` のような forced 表記は、UI の直接候補にしない。
- `primaryLang` は必須、`secondaryLang` は空保存を許容し、content 側でブラウザ言語 fallback を適用する。

### 2. 今回の #7 の対象範囲

- `secondaryLang` の空値保存とブラウザ言語 fallback 前提の UI 整理を進める。
- options / popup の表示文言として、「ブラウザ言語を使う」選択肢を明示する。
- content.js 側で、`secondaryLang` が空の場合にブラウザ言語を補助表示に使う挙動を統一する。

---

## 実装順メモ

1. `popup.js` / `options.js`
   - 固定言語一覧化（完了）
   - `primaryLang` / `secondaryLang` の UI 整理（継続）
   - 動画依存の字幕候補表示をやめる（完了）

2. レイアウト
   - `video-player__content` 基準の 70 / 30 レイアウトを再確認
   - 動画操作レイヤーの重なりを解消（#3）

3. Debug
   - Debug Panel を右字幕パネル側へ統合（#4）
   - ログカテゴリ設計を整理（#8）

4. 後続タスク
   - `content.js` の current 表示強化（#9）
   - 単語ポップアップ UI 改修と AI タブ拡張（#10）

---

## Phase 完了後の次ステップ（次バッチ）

Phase 1〜3 の主要項目が完了した段階で、次のバッチとして以下を実装する予定。

- `content.js` の current 表示強化（#9）
- 単語ポップアップ UI 改修（辞書 / AI タブ拡張）（#10）
- AI プロバイダー連携（説明する / 例 / 文法タブ）
- `background.js` の `dictionaryapi.dev` ハンドラ実装

---

## 文書管理方針

| ファイル                   | 目的                 | GitHub 保管 |
| -------------------------- | -------------------- | ----------- |
| `docs/v2.5-dev-roadmap.md` | 実装計画・issue 一覧 | ✅ 入れる   |
| `docs/atv-v25-design.md`   | 確定方針・設計整理   | ✅ 入れる   |
| 生の作業ノート             | 会話ベースの経緯記録 | ❌ 入れない |
