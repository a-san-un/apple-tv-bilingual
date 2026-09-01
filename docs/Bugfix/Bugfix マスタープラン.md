# Bugfix マスタープラン 2026-09-01（要約版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-09-01 ／ **ブランチ:** `issue-32-content-core-split`  
**入口資料:** 新しいスレッドでもこの資料 1 枚を読めば、プロジェクトの目標・現在地・優先順位・次に着手する作業が分かる状態を保つ。  
**反映済みの主な節目:** Step 15 の `lane-recovery-state` 命名整理、Step 16 の `cue-sequence-builder` への導出集約、Step 17-A-7 / 17-A-8 / 17-A-9 / 17-A-10 の panel 系整理、Step 17-A-11 の `extensionEnabled` runtime state 分離、Panel / Startup / Recovery の詳細観測ログの既存 probe への追加移管、Step17-C として残存 `logContent` の棚卸しと probe 制御方針整理メモの作成、さらに playback session lifecycle の責務再設計として **startup owner の一本化、cleanup owner 側の API / 説明層整備、`content.js` の主要 direct cleanup callsite 集約、`reinitialize-coordinator.js` の direct teardown 除去** まで反映済みである。  
現在は、**cleanup owner 一本化の残差整理後半**に入りつつ、実機ログで見えた **起動多重発火の観測強化** と、70/30 レイアウト時の **ネイティブ UI 幅追従の原因調査** を先に進め、その後に **未設定時ノーティス限定化** を行う段階である。

***

## この資料の役割

この資料は、Bugfix 系作業全体の**入口資料**である。  
ここでは、全体目標、現在地、優先順位、正本の所在、次スレッドで最初に着手すべき作業だけを示す。

この資料では、個別ファイルの詳細実装手順、JSDoc 案、調査メモ、実機ログの細部は持たない。  
それらは `Bugfix 実装シート.md`、各 Step 方針整理メモ、または専用資料を正本とする。

***

## 関連資料インデックス

| # | 資料名 | 役割 | 更新頻度 |
| :-- | :-- | :-- | :-- |
| 資料① | `docs/Bugfix/Bugfix マスタープラン.md` | 全体俯瞰・目標・優先順位・次スレッドの入口 | 節目ごとに更新 |
| 資料② | `docs/Bugfix/Bugfix 実装シート.md` | 今やっている作業の対象・実装順・検証手順・作業メモ | 作業中に更新、完了後は整理 |
| 資料③ | `docs/Bugfix/Bugfix 将来作業計画.md` | 後続ステップや保留課題の一覧 | 予定変更時に更新 |
| 資料④ | `docs/Bugfix/Bugfix-仕様確定書.md` | 確定仕様の正本 | 仕様変更時のみ更新 |
| 資料⑤ | `docs/Bugfix/字幕同期・切り替え条件統合と責務再設計メモ.md` | primary / secondary 字幕同期、monitor、recovery、native fallback の統合設計メモ | 字幕同期設計変更時に更新 |

***

## 最終目標

動画再生中に拡張機能をリアルタイムで ON/OFF できるようにする。

- **OFF 時:** 拡張 UI を完全に破棄し、Apple TV+ 本来の字幕機能が使える状態へ戻す。
- **ON 時:** 字幕パネルとオーバーレイにより 2 言語字幕を安定表示する。
- **OFF 時に残すもの:** ネイティブトグル、拡張ポップアップ、設定ページ、設定保存のみとする。

***

## 状態変数の正本定義

| 変数名 | 保存先 | 役割 | 備考 |
| :-- | :-- | :-- | :-- |
| `state.extensionEnabled` | ランタイムメモリ | 現在の playback session における拡張全体の ON/OFF | native toggle / runtime 設定反映で更新する。`chrome.storage.sync` には保存しない（Step 17-A-11 で完全に分離済み）。 |
| `panelOpen` | `chrome.storage.local` | 現在の字幕パネル開閉状態 | `modules/panel-visibility-state.js` が load / persist を担当する。 |
| `panelDefaultOpen` | `chrome.storage.sync` | 通常起動時の `panelOpen` 初期値 | ランタイムの現在状態ではない。 |
| `subtitleBlockState.sequence` | ランタイムメモリ | sequence / blocks / currentIndex / meta の正本 | `modules/subtitle-block-state.js` が取得、current block 解決、panel open 時の再同期を担当する。 |
| `state.currentSubtitleBlock` | ランタイムミラー | 現在字幕 block の互換参照 | 既存 renderer / overlay 互換のために残すが正本ではない。 |
| `state.lastPanelRenderSnapshot` | 観測用ランタイム情報 | panel 最終描画 snapshot | debug / 観測用途。保存・clear は panel owner 側で扱う。 |

**補足**  
`extensionEnabled` は永続設定ではなく、現在の playback session に限定した runtime state である。ページ再読込または SPA 遷移後の新しい playback session では、前セッションの ON/OFF 状態を `chrome.storage.sync` から復元しない。Step 17-A-11 で、`modules/settings-store.js` / `modules/settings-schema.js` / popup / options の全経路からこの前提を確定済みである。  
`panelOpen` は現在、`chrome.storage.local` に保存する設計で実装されている。  
`panelDefaultOpen` は未保存時の初期値であり、`panelOpen` と混同しない。

***

## DOM ID 正本

| 正式名称 | DOM ID | 役割 |
| :-- | :-- | :-- |
| ネイティブトグル | `atvb-native-toggle` | 現在の playback session における拡張全体の runtime ON/OFF。`state.extensionEnabled` を切り替え、OFF 時も残す。 |
| 字幕パネル開閉ボタン | `atv-toggle-btn` | 右側字幕パネルの開閉のみ。設定保存に関与しない。 |
| 字幕パネル本体 host | `atv-panel-host` | 右側字幕パネル host。表示/非表示と矩形計測の正本。 |
| 字幕パネル本体 root | `atv-panel-root` | 右側字幕パネル本体。 |
| オーバーレイ host | `atv-overlay-host` | 学習補助オーバーレイ host。位置・幅・矩形計測の正本。 |
| オーバーレイ inner root | `data-atvb-overlay-root` | overlay 内部コンテナ。文字要素の親。 |
| 単語詳細 UI host | `atv-term-inspector-host` | term inspector の host。 |

***

## 現在地

### 完了済みの大きな節目

- primary / secondary 同期表示、ON→OFF→ON の基本復帰経路は成立している。
- 二重表示・ちらつきは解消済みで、panel 開閉時の overlay 位置追従、文字サイズ維持、70/30 レイアウト追従も完了している。
- secondary monitor の start / replace / stop、cleanup / mode restore の基盤は binder 側へ集約済みである。
- hard seek / SPA 遷移時の cleanup 多重実行防止、pending sync task cancel、listener cleanup の責務固定までは完了している。
- Step 15 の `lane-recovery-state` 命名整理は完了している。
- Step 16 の `cue-sequence-builder` への sequence / scene / snapshot 導出集約は完了している。
- Step 17-A-7 として、`content.js` から panel renderer の直接依存を外し、`panelRenderer` と `getPanelRenderInput()` を `createPanelUi()` へ DI する構成へ整理済みである。
- Step 17-A-8 として、`panelUi.dispose()` を panel 系 cleanup の高レベル入口として固定し、`removeHost()` との責務境界、cleanup 到達経路、`applyPanelState()` / `refreshPanel()` の API 境界を明文化済みである。
- Step 17-A-9 として、`panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` を `modules/` 配下へ移動し、`manifest.json` の参照を更新済みである。
- Step 17-A-10 として、`content.js` に残っていた panel / block public API と高レベル中継境界を整理し、owner ごとの責務を固定済みである。
- Step 17-A-11 として、`extensionEnabled` を `chrome.storage.sync` から切り離し、playback session 限定の runtime state として確定済みである。
- Panel / Startup / Recovery の詳細観測ログは、既存 probe への追加移管が進み、ブラウザテスト前提となる観測経路の整備は一通り完了している。
- Step 17-C の前提として、残存 `logContent` の棚卸しと probe 制御方針整理メモの作成は完了している。
- playback session lifecycle の責務再設計について、`settings-runtime.js` に残っていた readiness wait / `addtrack` watch / direct start / `restartBilingual(...)` は整理され、起動要求は `coordinator.attachAndMaybeStart(...)` へ集約済みである。
- cleanup owner 側は `modules/playback-session-cleanup.js` を session teardown の唯一入口として説明・API の両面で整理し、`content.js` の主要 direct cleanup callsite も owner API 経由へ置換済みである。
- 最新コミット `297b2ba` により、`reinitialize-coordinator.js` に残っていた `clearInternalSubtitleState(...)` の直呼びは `playbackSessionCleanup.teardownForRestart(...)` へ置換され、`content.js` の DI も cleanup owner 基準へ縮退済みである。

### いま着手している主作業

現在の主作業は、playback session lifecycle の最終収束に向けた **観測強化 → レイアウト原因調査 → notice-only 化** の順序整理である。

- **起動多重発火の観測強化:** 実機ログでは約 0.57 秒の間に `settings runtime startup request`、`attachTracks`、`startup coordinator attach`、`startBilingual session-start` などが各 23 回記録されており、同一 target / 同一設定に対する startup 再入または重複観測の切り分けが必要である。
- **ネイティブ UI 幅追従の原因調査:** 動画 70 / 字幕パネル 30 のレイアウト時に、Apple TV+ ネイティブ UI が動画領域幅へ追従していないため、`applyLayout(...)` と `watchForPlayerTabs()` 周辺の責務を棚卸しする必要がある。
- **未設定時ノーティス限定化:** 言語未設定時は notice だけを表示し、toggle-only UI や session 起動経路を呼ばない構成へ整理する。現状は `attachTracks()` の無条件 `mountToggleOnlyUi()` と、settings runtime 側の分岐整理が残っている。

### 次回の着手点

次回は次の順で進める。

1. **起動多重発火の観測強化**  
   `modules/playback-startup-coordinator.js`、`content.js`、`modules/playback-session-cleanup.js` に compact probe を追加し、request ID / session ID / teardown 有無を相関可能にする。

2. **ネイティブ UI 幅追従の原因調査**  
   `content.js` の `applyLayout(...)` と `modules/panel-ui.js` の `watchForPlayerTabs()` を起点に、どの DOM が 70/30 レイアウトに追従しておらず、どこで補正すべきかを棚卸しする。

3. **未設定時ノーティス限定化**  
   startup 多重起動と native UI レイアウトの見通しが立ったら、`content.js` / `settings-runtime.js` / `modules/panel-ui.js` を対象に、言語未設定時は notice のみを表示するよう整理する。

***

## 優先順位

### いま最優先の作業

**起動多重発火の観測強化** を最優先とする。  
現状の実機ログは 300 件上限に近く、しかも短時間に同一系イベントが多発しているため、まず startup request / attach / session-start / teardown の対応関係を compact log で読み解ける状態にする必要がある。

### その次にやる作業

**ネイティブ UI 幅追従の原因調査** を行う。  
70/30 レイアウト自体は成立しているが、Apple TV+ ネイティブ UI が動画領域幅に追従していないため、見た目と責務境界の両面で棚卸しが必要である。

### 後続の作業

**未設定時ノーティス限定化** を行う。  
これにより、言語未設定時は notice だけを表示し、toggle-only UI や session 起動を止める構成へ整理する。あわせて `prepareForRestart()` と `teardownForRestart()` の役割差をコードとドキュメントの両面で明文化する。

***

## 今回の判断基準

- **1 playback target = 1 playback session = 1 owner** を最優先する。
- startup / rebuild / cleanup の入口は増やさず、既存 owner API へ収束させる。
- UI 再マウントだけを単独 rebuild 理由にしない。
- logger / probe の観測性は壊さず、必要なら compact 化して 300 件ログ制限でも読める形へ寄せる。
- timer / listener / observer / DOM / panel / debug の owner と cleanup 登録先を明確に保つ。
- 未設定時の UX は「notice のみ表示」を目標とし、toggle-only UI や session 起動を混ぜない。
- native UI 追従修正は cleanup owner 整理と混線させず、レイアウト責務として分離して扱う。

***

## 次スレッド開始時の確認ポイント

- 最新コミット `297b2ba` が取り込まれた状態か。
- `reinitialize-coordinator.js` の direct cleanup 除去がドキュメントへ反映済みか。
- startup 多重発火の compact probe をどこへ追加するか、対象ファイルが固まっているか。
- `applyLayout(...)` と `watchForPlayerTabs()` のどちらが native UI 幅追従漏れの起点か、調査観点が明確か。
- 未設定時 notice-only 方針を `content.js` / `settings-runtime.js` / `modules/panel-ui.js` のどこで gate するか、次の作業単位が整理されているか。
