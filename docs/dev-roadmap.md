# phase-3 実装ロードマップ

> **ブランチ**: `phase-3`  
> **最終更新**: 2026-07-08  
> **マージ先**: `main`（`phase-3` 側で機能が安定したタイミングでマージ）

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

| #                      | タイトル                                                                           | 優先度 | フェーズ   | 状態     | ラベル                                               |
| ---------------------- | ---------------------------------------------------------------------------------- | ------ | ---------- | -------- | ---------------------------------------------------- |
| [#3](../../issues/3)   | 字幕パネル表示時に動画操作レイヤーが右パネルに隠れないよう調整する                 | P0     | Phase 1    | **完了** | `p0` `bug` `enhancement` `area:ui`                   |
| [#4](../../issues/4)   | ATV DEBUG を独立表示から右字幕パネル下部の折り畳みセクションへ統合する             | P1     | Phase 2    | **完了** | `p1` `enhancement` `area:ui` `area:content`          |
| [#5](../../issues/5)   | options の「デバッグログ（開発者向け）」セクションを折り畳み既定にする             | P1     | Phase 2    | 完了     | `p1` `enhancement` `area:options`                    |
| [#6](../../issues/6)   | popup / options の字幕言語一覧を動画状態から分離して固定化する                     | P0     | Phase 1    | **完了** | `p0` `bug` `enhancement` `area:popup` `area:content` |
| [#7](../../issues/7)   | secondaryLang の空値保存とブラウザ言語 fallback の挙動を統一する                   | P0     | Phase 1    | 完了     | `p0` `bug` `enhancement` `area:popup` `area:content` |
| [#8](../../issues/8)   | Debug ログのカテゴリ設計を整理し、共通ログ基盤を共有する                           | P1     | Phase 3    | **完了** | `p1` `enhancement` `area:options` `area:content`     |
| [#17](../../issues/17) | content.js の current 表示強化（タイトル・トラック情報の常時表示）                | P1     | 次タスク   | 未着手   | `p1` `enhancement` `area:content`                    |
| [#10](../../issues/10) | 単語ポップアップ UI 刷新・AI タブ拡張と dictionaryapi.dev ハンドラ実装             | P2     | 後続タスク | 未完了   | GitHub issue の実内容に合わせて整理                  |
| [#12](../../issues/12) | content.js Phase A: vtt-normalizer.js / debug-logger.js を切り出す                 | P1     | Phase 3    | **完了** | `p1` `enhancement` `area:content`                    |
| [#13](../../issues/13) | content.js Phase B: subtitle-track-resolver.js を切り出す                          | P1     | Phase 3    | 完了     | `p1` `enhancement` `area:content`                    |
| [#14](../../issues/14) | 設定変更時と動画初期化時を基準に字幕設定を反映し、ページ離脱時リセット依存を減らす | P1     | Phase 3    | **完了** | `p1` `enhancement` `area:content`                    |
| [#16](../../issues/16) | Phase C: settings-bridge.js / debug-panel.js を切り出す                            | P1     | Phase C    | **完了** | `p1` `enhancement` `area:content`                    |

---

## フェーズ構成

### Phase 1: 字幕選択と再生 UI の安定化

**ゴール**: popup / options の言語設定が動画状態に依存せず安定して表示され、secondaryLang の空値運用を含めた設定 UI が一貫して扱えること。  
加えて、動画再生 UI が右字幕パネルに妨げられない状態を作る。

- [x] [#6] 固定言語一覧ベースへの変更と UI からの textTracks 生データ分離
- [x] [#7] secondaryLang 空値許容とブラウザ言語 fallback 前提の UI 整理
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

- [x] [#4] ATV DEBUG を字幕パネル下部に統合
- [x] [#5] options の Debug セクション折り畳み既定化

### Phase 3: ログ基盤整理

**ゴール**: options と字幕パネルが同じログソースを共有し、必要なカテゴリだけを既定表示できること。  
加えて、後続の content.js 分割を安全に進められるよう、ログ基盤と独立責務の切り出しを先行して進める。

設定ライフサイクル再整理（#14）は完了し、設定適用トリガーは「設定変更時 / 動画初期化時」を主経路とする方針へ統一済み。
ページ離脱時は cleanup を主目的とし、設定反映の主トリガーとしては扱わない。

- [x] [#8] Debug ログカテゴリ設計整理
- [x] [#12] content.js の Phase A 分割（WebVTT 正規化と Debug logger の切り出し）
- [x] [#13] content.js の Phase B 分割（subtitle-track-resolver の切り出し）
- [x] [#14] 設定ライフサイクル再整理（設定変更時 / 動画初期化時を主トリガー化）
- [x] [#16] Phase C: settings-bridge / debug-panel の責務分離（完了: API 契約確定と content.js 入口委譲の本置換）

---

## 完了済み項目メモ

### #4 ATV DEBUG を独立表示から右字幕パネル下部の折り畳みセクションへ統合する

**確認済み内容**

- ATV DEBUG の独立表示を廃止し、右字幕パネル下部の折り畳みセクションへ統合。
- Debug 統合は完了。
- current 行の再評価タイミングや中央配置の改善は、Issue #4 の完了範囲に含めず、`content.js` 分割 / current 表示強化（#17）側で別途扱う。

**#4 観測済み追記（Step 14 切り分け結果）**

- `after-renderSecondarySubtitle` / `before-secondary-fallback` の追加ログで、`allBlocksCount` / `historyCount` / `hasCurrentBlock` / `currentPrimary` / `currentSecondary` / `secondaryElText` を観測できる状態にした。
- 初期の不具合では、`after-renderSecondarySubtitle` 実行時点で `allBlocksCount: 0` / `historyCount: 0` / `hasCurrentBlock: false` を確認。
- `before-secondary-fallback` でも同様に panel list 用ブロックが 0 件であることを確認し、fallback 到達前から current / history / future 構築が空であると切り分けた。
- 周辺ログでは、`tracks resolved` と `Selected tracks detail` で `primaryTrackFound: false` / `secondaryTrackFound: false` / `primaryTrack: null` / `secondaryTrack: null` を確認する一方、`initial cue recovery render` では `secondaryActiveCues: 1` を確認し、secondary 側だけが recovery/fallback 経路で描画される状態を観測した。
- 修正後は `allBlocksCount` が 1 以上となり、最終的に `38〜71`、`historyCount` も `3〜26`、`hasCurrentBlock: true` を確認。
- secondary-only current を current block に含めつつ、host 直下の独立 secondary 帯を非表示化し、右字幕パネルを `docs/atv-design.md` の「履歴 + 現在 + 未来」の一覧型仕様へ寄せた。
- `sync interval primary recovery` 条件は、旧条件 `!state.primaryTrack && secondaryTrackFound && trackCount > 1` から、「secondary 信号あり」かつ「primary 信号なし」かつ `trackCount > 1` へ拡張した。
- これにより、`state.primaryTrack` オブジェクトが存在していても primary テキストが空のケースで recovery が走ることを確認。
- 右字幕パネル下部の Debug セクションで、`sync interval primary recovery` / `secondary track sync context` を継続観測できることを確認。
- `startBilingual ready` 直後は `primaryTrackFound: false` / `secondaryTrackFound: false` でも、その後 `sync interval primary recovery` により両方 `true` へ回復するケースを確認。
- `after-renderSecondarySubtitle` の snapshot は安定後に大量連投しやすいため、6 項目シグネチャ変化時のみ出力する重複抑制を導入した。
- 以上より、Debug 統合 UI 自体は不具合原因ではなく、問題の本体は `content.js` 側の resolver / recovery / current-history-future 構築経路にあると切り分け済み。
- 今後の観測は、F12 Console の大量 snapshot ではなく、右字幕パネル下部の Debug セクションログを主ログとして使う。

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

3. Debug / content.js 分割準備
   - 設定ライフサイクル再整理（#14, 完了）
   - Debug Panel を右字幕パネル側へ統合（#4）
   - ログカテゴリ設計を整理（#8, 完了）
   - content.js の Phase A 分割（#12）

4. 後続タスク
   - `content.js` の current 表示強化（#17）
   - 単語ポップアップ UI 改修と AI タブ拡張（#10）

---

## 次の優先タスク（次バッチ）

Phase 1〜3 の主要項目（#3/#4/#5/#6/#7/#8/#12/#13/#14/#16）完了後、次の順で進める。

- #17: `content.js` の current 表示強化
- Phase D: binder / sidebar の責務分離
- Phase E: layout / observer / bootstrap の最終整理
- 単語ポップアップ UI 改修（辞書 / AI タブ拡張）（#10）
- AI プロバイダー連携（説明する / 例 / 文法タブ）
- `background.js` の `dictionaryapi.dev` ハンドラ実装

### #17 着手前メモ（対象 / 非対象）

- 対象: 右字幕パネルの current セクションで、タイトル / エピソード情報 / `primaryLang` / `secondaryLang` / selected track label（必要に応じて track detail）を常時表示する。
- 前提 API: settings 状態は `window.ATVB.settingsBridge`、Debug UI / log 導線は `window.ATVB.debugPanel` / `window.ATVB.logger` を再利用する。
- 非対象: `content.js` の current 表示強化本体以外（binder / sidebar / observer / bootstrap 分離、settings-bridge.js / debug-panel.js API 変更、resolver / fallback 仕様変更）は今回のスコープに含めない。
- 重複回避方針: 既存 helper / bridge / logger / debugPanel を再利用し、current 表示強化の中で重複コードを増やさない。

---

## 文書管理方針

| ファイル                       | 目的                                  | GitHub 保管 |
| ------------------------------ | ------------------------------------- | ----------- |
| `docs/dev-roadmap.md`          | 実装計画・issue 一覧                  | ✅ 入れる   |
| `docs/atv-design.md`           | 確定方針・設計整理                    | ✅ 入れる   |
| `docs/ai-session-templates.md` | AI セッション運用ルール・テンプレート | ✅ 入れる   |
| 生の作業ノート                 | 会話ベースの経緯記録                  | ❌ 入れない |
