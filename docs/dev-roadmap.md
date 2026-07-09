# phase-3 実装ロードマップ

> **ブランチ**: `phase-3`  
> **最終更新**: 2026-07-09  
> **マージ先**: `main`（`phase-3` 側で機能が安定したタイミングでマージ）

---

## 更新方針

- 既存 issue（#3〜#8）は基本的にそのまま使用する
- 実機検証の結果を踏まえて、**優先順位・フェーズ・完了状態を更新**する
- popup / options の言語候補が動画状態に依存して変化する問題について
  - 設定 UI は固定言語一覧ベース
  - 実トラック選択は `content.js` 側の resolver
  - という役割分担で解消済み
- そのため、Phase 1 の「設定 UI 安定化」に関する部分は完了として扱う
- #17 は完了済み。字幕一覧内の current 行 + 左側マーク欄、下端しきい値超過時のみ短く smooth に戻す方式、大きい seek 後の再同期を現実装として反映済み
- #18 は Phase 3 の切り分け issue として完了・close 済み。resolver / `content.js` の signal レイヤーまでを確認し、残課題は Phase D の #19 へ移管済み
- #19 は完了済み。残る構造改善の主線は Phase E の #20 → #21 とする
- open issue は #20 / #21 / #10 で、`content.js` の構造改善を先に進め、その後に popup の機能拡張へ進む方針とする

---

## Issue 一覧

| #                      | タイトル                                                                           | 優先度 | フェーズ   | 状態                                | ラベル                                                     |
| ---------------------- | ---------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------- | ---------------------------------------------------------- |
| [#3](../../issues/3)   | 字幕パネル表示時に動画操作レイヤーが右パネルに隠れないよう調整する                 | P0     | Phase 1    | **完了**                            | `p0` `bug` `enhancement` `area:ui`                         |
| [#4](../../issues/4)   | ATV DEBUG を独立表示から右字幕パネル下部の折り畳みセクションへ統合する             | P1     | Phase 2    | **完了**                            | `p1` `enhancement` `area:ui` `area:content`                |
| [#5](../../issues/5)   | options の「デバッグログ（開発者向け）」セクションを折り畳み既定にする             | P1     | Phase 2    | **完了**                            | `p1` `enhancement` `area:options`                          |
| [#6](../../issues/6)   | popup / options の字幕言語一覧を動画状態から分離して固定化する                     | P0     | Phase 1    | **完了**                            | `p0` `bug` `enhancement` `area:popup` `area:content`       |
| [#7](../../issues/7)   | secondaryLang の空値保存とブラウザ言語 fallback の挙動を統一する                   | P0     | Phase 1    | **完了**                            | `p0` `bug` `enhancement` `area:popup` `area:content`       |
| [#8](../../issues/8)   | Debug ログのカテゴリ設計を整理し、共通ログ基盤を共有する                           | P1     | Phase 3    | **完了**                            | `p1` `enhancement` `area:options` `area:content`           |
| [#10](../../issues/10) | 単語ポップアップ UI 刷新・AI タブ拡張と `dictionaryapi.dev` ハンドラ実装           | P2     | 後続タスク | 未完了                              | `enhancement` `area:content` `area:popup` `p2`             |
| [#12](../../issues/12) | content.js Phase A: `vtt-normalizer.js` / `debug-logger.js` を切り出す             | P1     | Phase 3    | **完了**                            | `p1` `enhancement` `area:content`                          |
| [#13](../../issues/13) | content.js Phase B: `subtitle-track-resolver.js` を切り出す                        | P1     | Phase 3    | **完了**                            | `p1` `enhancement` `area:content`                          |
| [#14](../../issues/14) | 設定変更時と動画初期化時を基準に字幕設定を反映し、ページ離脱時リセット依存を減らす | P1     | Phase 3    | **完了**                            | `p1` `enhancement` `area:content`                          |
| [#16](../../issues/16) | Phase C: `settings-bridge.js` / `debug-panel.js` を切り出す                        | P1     | Phase C    | **完了**                            | `p1` `enhancement` `area:content`                          |
| [#17](../../issues/17) | `content.js` の current 表示モデルを整理し、マーク移動と最小スクロールへ移行する   | P1     | 完了       | **完了**                            | `p1` `enhancement` `area:ui` `area:content`                |
| [#18](../../issues/18) | primaryLang を英語以外にした場合に主字幕が表示されない問題を切り分ける             | P1     | Phase 3    | **完了**                            | `p1` `bug` `area:content`                                  |
| [#19](../../issues/19) | Phase D: binder/sidebar 側で primary cue が UI に反映されない非対称を解消する      | P1     | Phase D    | **完了**                            | `p1` `area:content` `area:ui`                              |
| [#20](../../issues/20) | Phase E (1): `content.js` panel / overlay セクションの責務分離                     | P1     | Phase E    | 進行中（overlay/popup 1段整理済み） | `enhancement` `p1` `area:ui` `area:content` `area:options` |
| [#21](../../issues/21) | Phase E (2): `content.js` binder / cue ロジックの整理と分割準備                    | P1     | Phase E    | 未着手                              | `enhancement` `p1` `area:content` `area:options`           |

---

## フェーズ構成

### Phase 1: 字幕選択と再生 UI の安定化

**ゴール**: popup / options の言語設定が動画状態に依存せず安定して表示され、`secondaryLang` の空値運用を含めた設定 UI が一貫して扱えること。  
加えて、動画再生 UI が右字幕パネルに妨げられない状態を作る。

- [x] [#6](../../issues/6) 固定言語一覧ベースへの変更と UI からの `textTracks` 生データ分離
- [x] [#7](../../issues/7) `secondaryLang` 空値許容とブラウザ言語 fallback 前提の UI 整理
- [x] [#3](../../issues/3) 動画操作レイヤーの重なり解消

#### #6 完了メモ

- `SUPPORTED_LANGS` に基づく固定言語一覧を popup / options で使用
- 動画ごとの `textTracks` の生データは UI に直接出さない
- 設定保存後、アクティブな Apple TV+ タブへ設定を即時通知する実装を追加
- `content.js` 側で `requestedSecondaryLanguage` と `selectedSecondaryTrackLanguage` を分けてログ出力し、resolver の挙動を確認しやすくした
- 実機検証で、`ja / zh-Hant / ko / fr-FR / de / es-ES` の言語切替が安定して動作することを確認

#### #3 完了メモ

- 再生開始直後 / 設定反映直後に発生していた操作レイヤーの左右フラつき・右戻りを解消
- 補正は `scheduleAdjustPlaybackControls` と短時間の settling burst で実施し、常駐監視に依存しない構成に整理
- `.video-player__footer` / `.unified-controls` / `amp-volume-control-unified` を同一基準で補正し、右字幕パネルとの重なりを回避
- shift 値を `data-atvb-shift-x` に保持し、再計算時の snap-back（右戻り）を防止
- ボリューム UI は「字幕パネルに重なる分だけ移動」の仕様に調整済み（中央寄せはしない）
- `console.table` 計測と実機操作で、再生バー・シーク UI・ボタン群が右パネルに隠れないことを確認

### Phase 2: Debug UI 整理

**ゴール**: Debug UI が常時浮かず、必要なときだけ右字幕パネルや options から確認できる状態を作る。

- [x] [#4](../../issues/4) ATV DEBUG を字幕パネル下部に統合
- [x] [#5](../../issues/5) options の Debug セクション折り畳み既定化

### Phase 3: ログ基盤整理

**ゴール**: options と字幕パネルが同じログソースを共有し、必要なカテゴリだけを既定表示できること。  
加えて、後続の `content.js` 分割を安全に進められるよう、ログ基盤と独立責務の切り出しを先行して進める。

設定ライフサイクル再整理（#14）は完了し、設定適用トリガーは「設定変更時 / 動画初期化時」を主経路とする方針へ統一済み。  
ページ離脱時は cleanup を主目的とし、設定反映の主トリガーとしては扱わない。

- [x] [#8](../../issues/8) Debug ログカテゴリ設計整理
- [x] [#12](../../issues/12) `content.js` の Phase A 分割（WebVTT 正規化と Debug logger の切り出し）
- [x] [#13](../../issues/13) `content.js` の Phase B 分割（subtitle-track-resolver の切り出し）
- [x] [#14](../../issues/14) 設定ライフサイクル再整理（設定変更時 / 動画初期化時を主トリガー化）
- [x] [#16](../../issues/16) Phase C: settings-bridge / debug-panel の責務分離（完了: API 契約確定と `content.js` 入口委譲の本置換）

#### #18 完了メモ（Phase 3 での切り分け結果）

- `primaryLang = de / ja / zh / ko / fr / es` でも、resolver レイヤーでは `primaryTrackFound: true` になることを確認
- `subtitle-track-resolver.js` では、underscore 区切りの正規化と主要 3 文字コード（`deu` / `jpn` / `zho` / `chi` / `kor` / `fra` / `fre` / `spa`）の 2 文字コード寄せを追加
- `content.js` 側では、`primaryActiveCues` / `hasFreshPrimarySnapshot` / `lastPrimarySnapshotAt` を用いた live 優先 + snapshot 鮮度付きの primary signal 判定に整理
- Debug ログ上では `primaryCueTextLength > 0` / `snapshotPrimaryTextLength > 0` を確認でき、primary cue / text / snapshot までは live で取得できている
- 一方で、右字幕パネルの primary 行には未表示のケースが残り、残課題は binder / sidebar / `renderPanel` 側の UI 層にあると切り分けた
- この残課題は Phase D の [#19](../../issues/19) へ移管し、Phase 3 の #18 は close 済み

#### #19 完了メモ（Phase D）

- `primaryTrack.mode` を `hidden` から `showing` へ変更し、non-en primary（`zh / ko / fr / de / es`）でも cue 可用性を確保
- `findCueAt` の `track.cues` 参照を保護し、mode 遷移時でも安全に cue 探索できるよう堅牢化
- `primary=state.primaryTrack` / `secondary=state.secondaryTrack` の責務分離を維持したまま、current 行の primary 非対称を解消
- panel 周辺は `panel.css` 外だし + `buildPanelShellHTML` / `buildPanelDebugShellHTML` 分離で整理し、`createRightPanel` の責務を縮小
- resolver / `secondaryLang` fallback / #17 の current 行モデル（左マーク欄 + threshold-scroll）は未変更

### Phase E: layout / observer / bootstrap の最終整理

**ゴール**: Phase D までで整理した UI shell / binder / cue の境界を維持したまま、最も密結合で壊れやすい layout / observer / bootstrap 層を最後に整理する。

- [ ] [#20](../../issues/20) Phase E (1): panel / overlay セクションの責務分離（overlay/popup 1段整理済み、panel は safer path で継続）
- [ ] [#21](../../issues/21) Phase E (2): binder / cue ロジックの整理と分割準備

#### Phase E の進め方

- まず「コード整備を含めた挙動を変えない責務整理」から着手する
- #20 では UI shell 側、#21 では binder / cue logic 側を整理し、同じ差分で大きく混ぜない
- `ResizeObserver` / `MutationObserver` / timer / retry は最後まで慎重に扱う
- Apple TV+ の controls / footer / panel 位置調整はこのフェーズの後半まで後回しにする
- observer の二重登録や disconnect 漏れを防ぐ
- 最終的に `content.js` は bootstrap 的な薄い入口に寄せる

#### #20 メモ（Phase E (1)）

- panel / debug / overlay / subtitle popup の UI shell を対象に、構造・template・イベント配線の責務境界を明確にする
- `createRightPanel()` / `createOverlay()` / `createPopupHost()` は、host / shadow 準備、template 適用、イベント配線に集中させる
- 長い template は `build*ShellHTML()` 系へ寄せる
- 入口整理として、境界コメントの簡素化、subtitle popup 命名統一、`wireSubtitlePopupUiEvents()` 抽出、create 系責務整理、render の shell 反映責務線（`renderSecondarySubtitle()` / `renderPanel()` / `updateOverlay()` / `applyCurrentStateToPanel()`）まで反映済み
- overlay は 1 段整理済み（`updateOverlay()` の word click listener を外し、`wireOverlayUiEvents()` の event delegation へ移動。`createOverlay()` は host 作成 → shadow 準備 → shell 適用 → wiring 呼び出しの流れへ寄せた）
- subtitle popup は 1 段整理済み（`buildPopupShellStyleText()` を追加し style を分離、`wireSubtitlePopupUiEvents()` に責務コメント追加、`.atv-word-link` click は early return 形へ整理）
- panel の `panel-debug-anchor` 追加 + debug mount 先変更案は、責務線が曖昧化しうるため今回は見送り
- panel の次手は案A（`buildPanelShellHTML()` / `buildPanelDebugShellHTML()` / `createDebugPanel()` に短い責務コメントを追加して境界を明確化）
- #21（binder / cue）と observer / bootstrap はこのバッチでは未着手
- `renderPanel()` の hover / click / scroll 本体分解はこの後段に送る
- DOM の `id` / `class` / `data-*`、見た目、close 動作、current 行や threshold-scroll の挙動は変えない

#### #21 メモ（Phase E (2)）

- track binding / cue handling / history / current row 連携を binder / cue logic 側のまとまりとして整理する
- `selectPrimaryAndSecondaryTracks()` / `bindPrimarySubtitleTrack()` / `bindSecondarySubtitleTrack()` / `clearTrackBindings()` などの関数群を近接配置する
- `onCueChange()` / `getCurrentCue()` / `findCueAt()` / snapshot 周辺を cue handling として見えるようにする
- この段階でも挙動は変えず、関数グルーピング、コメント境界、早期 return、薄い helper 化に留める
- 実際のファイル分割は Phase E 後半の別 issue に送る

---

## 完了済み項目メモ

### #4 ATV DEBUG を独立表示から右字幕パネル下部の折り畳みセクションへ統合する

#### 確認済み内容

- ATV DEBUG の独立表示を廃止し、右字幕パネル下部の折り畳みセクションへ統合
- Debug 統合は完了
- current 表示モデルの整理は、Issue #4 の完了範囲に含めず、#17 側で別途扱う

#### #4 観測済み追記（Step 14 切り分け結果）

- `after-renderSecondarySubtitle` / `before-secondary-fallback` の追加ログで、`allBlocksCount` / `historyCount` / `hasCurrentBlock` / `currentPrimary` / `currentSecondary` / `secondaryElText` を観測できる状態にした
- 初期の不具合では、`after-renderSecondarySubtitle` 実行時点で `allBlocksCount: 0` / `historyCount: 0` / `hasCurrentBlock: false` を確認
- `before-secondary-fallback` でも同様に panel list 用ブロックが 0 件であることを確認し、fallback 到達前から current / history / future 構築が空であると切り分けた
- 周辺ログでは、`tracks resolved` と `Selected tracks detail` で `primaryTrackFound: false` / `secondaryTrackFound: false` / `primaryTrack: null` / `secondaryTrack: null` を確認する一方、`initial cue recovery render` では `secondaryActiveCues: 1` を確認し、secondary 側だけが recovery / fallback 経路で描画される状態を観測した
- 修正後は `allBlocksCount` が 1 以上となり、最終的に `38〜71`、`historyCount` も `3〜26`、`hasCurrentBlock: true` を確認
- secondary-only current を current block に含めつつ、host 直下の独立 secondary 帯を非表示化し、右字幕パネルを `docs/atv-design.md` の「履歴 + 現在 + 未来」の一覧型仕様へ寄せた
- `sync interval primary recovery` 条件は、旧条件 `!state.primaryTrack && secondaryTrackFound && trackCount > 1` から、「secondary 信号あり」かつ「primary 信号なし」かつ `trackCount > 1` へ拡張した
- これにより、`state.primaryTrack` オブジェクトが存在していても primary テキストが空のケースで recovery が走ることを確認
- 右字幕パネル下部の Debug セクションで、`sync interval primary recovery` / `secondary track sync context` を継続観測できることを確認
- `startBilingual ready` 直後は `primaryTrackFound: false` / `secondaryTrackFound: false` でも、その後 `sync interval primary recovery` により両方 `true` へ回復するケースを確認
- `after-renderSecondarySubtitle` の snapshot は安定後に大量連投しやすいため、6 項目シグネチャ変化時のみ出力する重複抑制を導入した
- 以上より、Debug 統合 UI 自体は不具合原因ではなく、問題の本体は `content.js` 側の resolver / recovery / current-history-future 構築経路にあると切り分け済み
- 今後の観測は、F12 Console の大量 snapshot ではなく、右字幕パネル下部の Debug セクションログを主ログとして使う

### #5 options の「デバッグログ（開発者向け）」セクションを折り畳み既定にする

#### 確認済み内容

- `options.html` / `options.js` の修正完了
- `debugSectionBody` に `hidden` 属性を追加し、初期状態で非表示化
- `debugSectionToggle` の `aria-expanded` を `false` に変更
- トグルアイコンを `▶`（折り畳み）/ `▼`（展開）に統一

#### 関連コミット

- `c09cb42`
- `90153b9`

### #6 popup / options の字幕言語一覧を動画状態から分離して固定化する

#### 確認済み内容

- popup / options の言語候補を固定一覧ベースへ変更
- `primaryLang` / `secondaryLang` を `chrome.storage.sync` に保存し、options / popup どちらからでも編集可能
- `secondaryLang` 空値保存を許容し、未設定時にブラウザ言語 fallback を適用する前提で UI を整理
- 設定保存後、アクティブな Apple TV+ タブへ設定を即時通知（manifest に scripting 権限追加）
- F12 Console で次のログを確認済み
  - `SETTINGS_CHANGED received`
  - `restartBilingual begin / done`
  - `Selected tracks detail`
  - `startBilingual ready`
  - `content applied settings to tracks`
- WebVTT の cue テキストに含まれていた `<c.styledotitalic>` などのタグ断片について
  - `content.js` 側で正規化処理を追加
  - 右字幕パネル下部の Debug セクションで `tracks resolved` / `Selected tracks detail` / `primaryTrackFound` / `secondaryTrackFound` を確認し、issue #18 の観測導線で追える状態にした

#### 関連コミット

- `v2.5-dev` ブランチ上の設定伝達・正規化関連コミット一式

---

## Phase 1 の補足メモ

### 1. 字幕選択 UI

- popup / options の言語選択肢は、動画ごとの `textTracks` の生データをそのまま出さず、固定一覧ベースで扱う
- 設定 UI では、`en`、`ja`、`de` のような正規化済み言語コードに対応する **1 言語 1 項目** だけを見せる
- `English (forced)` のような forced 表記は、UI の直接候補にしない
- `primaryLang` は必須、`secondaryLang` は空保存を許容し、content 側でブラウザ言語 fallback を適用する

### 2. 今回の #7 の対象範囲

- `secondaryLang` の空値保存とブラウザ言語 fallback 前提の UI 整理を進める
- options / popup の表示文言として、「ブラウザ言語を使う」選択肢を明示する
- `content.js` 側で、`secondaryLang` が空の場合にブラウザ言語を補助表示に使う挙動を統一する

---

## 実装順メモ

1. `popup.js` / `options.js`
   - 固定言語一覧化（完了）
   - `primaryLang` / `secondaryLang` の UI 整理（継続）
   - 動画依存の字幕候補表示をやめる（完了）

2. レイアウト
   - `video-player__content` 基準の 70 / 30 レイアウトを再確認
   - 動画操作レイヤーの重なりを解消（#3）

3. Debug / `content.js` 分割準備
   - 設定ライフサイクル再整理（#14, 完了）
   - Debug Panel を右字幕パネル側へ統合（#4）
   - ログカテゴリ設計を整理（#8, 完了）
   - `content.js` の Phase A 分割（#12）
   - `content.js` の Phase B 分割（#13）
   - Phase C: settings-bridge / debug-panel の責務分離（#16）

4. 後続タスク
   - `content.js` の current 表示モデル整理（#17）
   - Phase D: binder / sidebar の非対称解消（#19）
   - Phase E: panel / overlay → binder / cue → layout / observer / bootstrap の順で最終整理
   - 単語ポップアップ UI 改修と AI タブ拡張（#10）

---

## 次の優先タスク（次バッチ）

Phase 1〜3 の主要項目（#3 / #4 / #5 / #6 / #7 / #8 / #12 / #13 / #14 / #16 / #17 / #18）完了後の整理は完了済みとして扱う。

- #20（Phase E (1)） panel / overlay セクションの責務分離
- #21（Phase E (2)） binder / cue ロジックの整理と分割準備
- Phase E 後半: layout / observer / bootstrap の最終整理
- 単語ポップアップ UI 改修（辞書 / AI タブ拡張）（#10）
- AI プロバイダー連携（説明する / 例 / 文法タブ）
- `background.js` の `dictionaryapi.dev` ハンドラ実装

補足:

- #17 は current の表示モデル整理として完了済み
- #18 は resolver / `content.js` の signal レイヤーまでの切り分けを完了して close 済み
- primary UI 表示問題は Phase D の #19 で解消済み
- `You're` → `Youre` のような単語正規化仕様は、Phase E の構造改善ではなく popup / dictionary 系の後続課題として扱う

### #17 完了メモ（対象 / 非対象）

- 対象
  - 右字幕パネルの current 表示モデル整理
  - 左側固定幅マーク欄の導入
  - 字幕本文を変化させずに current を判別できる構造への整理
  - 通常時はリスト固定、下端しきい値到達時のみ最小スクロールする方式への整理
  - 固定ヘッダー / 固定 debug ログセクション / 字幕スクロール領域の 3 層構造を維持したまま、current を見失いにくくすること
- 前提 API
  - settings 状態は `window.ATVB.settingsBridge`
  - Debug UI / log 導線は `window.ATVB.debugPanel` / `window.ATVB.logger` を再利用する
- UI 制約
  - ヘッダー（`字幕履歴` / `⚙️` / `閉じる✕`）の構造・位置・文言は維持する
  - debug ログセクションはヘッダー直下に固定されたままとし、折りたたみ時は 1 行、展開時は数行のログ本文を表示できる状態を維持する
  - current / history / future のテキストは選択・コピー可能な DOM のまま維持する
  - current の判別は字幕本文の色・背景・文字サイズ変更ではなく、左側マーク欄で行う
  - past / current / future の字幕本文は同一スタイルとする
- 非対象
  - current セクション内へのタイトル・エピソード・`primaryLang` / `secondaryLang` / selected track label の追加表示
  - `content.js` の current 表示モデル整理本体以外（binder / sidebar / observer / bootstrap 分離）
  - `settings-bridge.js` / `debug-panel.js` API 変更
  - resolver / fallback 仕様変更
- 重複回避方針
  - 既存 helper / bridge / logger / debugPanel を再利用し、current 表示モデル整理の中で重複コードを増やさない
  - new timer / observer / listener は追加しない
  - 可能な限り `renderPanel()` 周辺に処理を寄せ、重複分岐を増やさない
- 旧 Issue #9 の current 表示強化の設計定義は #17 へ引き継ぎ済みで、#9 は close 済み
- ドイツ語主字幕同期の問題は #17 では直接扱わず、別 Issue で扱う予定とする
- #18 は切り分け完了済み。Phase D（#19）も完了し、残りは Phase E の責務分離・最終整理とする

---

## 文書管理方針

| ファイル                          | 目的                                                                   | GitHub 保管 |
| --------------------------------- | ---------------------------------------------------------------------- | ----------- |
| `docs/dev-roadmap.md`             | phase-3 全体の実装順、issue 状態、フェーズ進捗を管理する親ドキュメント | する        |
| `docs/atv-design.md`              | UI / 表示仕様 / パネル・overlay・popup の設計意図を管理する            | する        |
| `docs/contentjs-split-roadmap.md` | `content.js` 分割・責務整理の実装順とバッチ方針を管理する              | する        |
| `docs/ai-session-templates.md`    | Copilot / AI セッションに渡す定型プロンプトと運用ルールを管理する      | する        |

### 使い分けルール

- 実装順・優先順位・phase 管理は `docs/dev-roadmap.md`
- UI 表示仕様・責務境界の設計意図は `docs/atv-design.md`
- `content.js` の分割順・バッチ粒度・安全策は `docs/contentjs-split-roadmap.md`
- AI への依頼文・セッション運用ルールは `docs/ai-session-templates.md`

### 更新ルール

- 実装を進めたら、コードだけでなく関連 docs も同じバッチで更新する
- 「実施済み」「見送り」「次の方針」が分かる形で書く
- 未実施の案を、完了済みのように書かない
- 最小差分を優先し、無関係な全体整形は避ける
- 既存コメントや既存用語を壊さず、必要な箇所に責務境界コメントや進捗メモを補う

---

## 補足メモ

- content.js の popup は **subtitle popup** を指す
- extension popup（ブラウザ拡張の popup UI）は別物として扱う
- Phase E では、まず #20 で UI shell 側、次に #21 で binder / cue 側を進める
- observer / bootstrap / layout の本格整理は、#20 / #21 の後段で扱う
