# Bugfix 実装シート 2026-08-28（Step 17-B 準備・probe整理版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** `docs/Bugfix/Bugfix マスタープラン.md`  
**対応方針メモ:** `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md`、`docs/Bugfix/Step17-B_visibility-lifecycle_方針整理メモ.md`、`docs/Bugfix/Step17-C_残存ログprobe制御_方針整理メモ.md`  
**最新反映コミット:** `1077e4f refactor: startup・panel・recovery の詳細ログを probe 経由へ追加整理する`  
**現在の作業:** Step 17-B 着手前の準備として、ブラウザテスト前提のログ整備と残存 `logContent` の probe 制御方針整理を完了した。**次回はブラウザテストから始める。**

***

## このシートの役割

このシートは、**Step 17-B 着手前の作業台兼、直近の整理内容の記録**である。  
変更対象、ファイル単位の整理内容、確認観点、ブラウザテスト前提の観測整備、作業中の判断、および次回着手順を記録する。

全体目標、過去 Step の完了履歴、将来作業、各資料の役割は `Bugfix マスタープラン.md` を参照する。  
Step 17-A の owner 判断と panel 系 API 境界は `Step17-A_panel系統合_方針整理メモ.md`、Step 17-B の visibility / lifecycle 整理は `Step17-B_visibility-lifecycle_方針整理メモ.md`、残存ログの probe 整理方針は `Step17-C_残存ログprobe制御_方針整理メモ.md` を正本とする。

***

## 今回の目的

今回のスレッドでは、本来予定していたブラウザテストを行う前提として、観測しづらかった startup / panel / recovery 周辺の詳細ログを整理し、次回すぐテストに入れる状態を作ることを優先した。

今回の作業で行ったことは次のとおりである。

- `settings-runtime.js`、`modules/subtitle-sync-controller.js`、`modules/panel-ui.js`、`modules/playback-startup-coordinator.js`、`modules/subtitle-recovery-manager.js` の詳細観測ログを既存 probe へ追加移管した。
- 残存 `logContent` を棚卸しし、`logLifecycleProbe` / `logRecoveryProbe` / `logSubtitleProbe` / `logLookupProbe` を含む次段階の probe 分類案を整理した。
- ブラウザテスト開始時に、startup / panel / recovery の主要観測点を probe flag で切り替えながら読める状態まで整えた。

今回の作業では、Step 17-B の visibility / lifecycle owner 固定そのものの本実装、広範囲な残存ログの全面移行、ブラウザテスト結果の採取までは行っていない。

***

## 今回の到達点

### 完了したこと

- Panel / Startup / Recovery の詳細観測ログについて、既存 probe へ寄せるべき対象を優先して移管した。
- `Step17-C_残存ログprobe制御_方針整理メモ.md` を作成し、残存 `logContent` の分布、推奨 probe 分類、DI 上の注意点、推奨ワークストリームを整理した。
- 次回ブラウザテストの入口として必要な観測基盤は整った。

### 今回あえてやっていないこと

- このスレッドは本来ブラウザテスト用として開始したが、実際にはテストは未実施である。
- よって、今回の成果は「挙動確認完了」ではなく、「挙動確認に入るためのログ整備完了」である。

***

## 前提

以下は Step 17-A-11 までに完了済みであり、今回の整理でも前提として維持した。

- `state.extensionEnabled` は `chrome.storage.sync` に保存しない runtime state であり、current playback session に限定した拡張全体 ON/OFF の正本である。
- `panelUi.dispose()` は panel host、ShadowRoot、toggle button、native toggle observer、resize listener、render timer、render snapshot、renderer owner state、overlay DOM を対称に cleanup する高レベル入口である。
- `removeHost()` は低レベルな DOM host 除去だけを担当する。
- `applyPanelState()` は state effects を含む panel 状態の再適用である。
- `refreshPanel()` は既存 state に基づく描画のみを担当する。
- `panelRenderer` と `getPanelRenderInput()` は `content.js` から `createPanelUi()` へ DI される。
- `modules/subtitle-block-state.js` は subtitle block sequence、current block 解決、current block mirror 同期、panel open 時の block rebuild を担当する。
- `modules/panel-renderer.js` は共有 state を直接読まず、入力から描画結果と snapshot を返す。
- `modules/panel-visibility-state.js` は `panelOpen` の load / persist 専用であり、DOM、render、snapshot、block state を持たない。

***

## 対象ファイル

| ファイル | 今回確認した責務 | 今回の結果 |
| :-- | :-- | :-- |
| `settings-runtime.js` | startup 前後の runtime 設定反映、起動条件、start skip 観測 | startup readiness 系の詳細観測ログを既存 probe に寄せ、次回テストで start 条件の切り分けがしやすい状態にした。 |
| `modules/subtitle-sync-controller.js` | secondary sync task orchestration、recovery 補助 | recovery 観測ログの一部を既存 probe に寄せ、pending sync task まわりの観測整理を進めた。 |
| `modules/panel-ui.js` | panel lifecycle、panel render / state 適用、dispose | panel render completed / applyPanelState start / done を panel probe 側へ寄せ、panel state の読み分けをしやすくした。 |
| `modules/playback-controls-layout-controller.js` | playback controls と panel visibility のレイアウト調停 | panel visibility change の観測を panel probe 側へ寄せ、レイアウト追従の確認用ログを整理した。 |
| `modules/playback-startup-coordinator.js` | playback target 変化、startup readiness、cleanup 接続 | track readiness の詳細観測を startup probe に寄せ、起動時の状態確認をしやすくした。 |
| `modules/subtitle-recovery-manager.js` | recovery reset / success、字幕復帰 | recovery reset を recovery probe 側へ寄せ、復帰経路観測の土台を作った。 |
| `content.js` | 各 probe の定義、各 module への logger / probe DI | 既存 probe をハブとして各 module に注入する構造を確認し、残存ログ整理の受け皿が `content.js` 側にあることを再確認した。 |
| `docs/Bugfix/Step17-C_残存ログprobe制御_方針整理メモ.md` | 残存ログ棚卸しと次段階の方針整理 | 残存 `logContent` の分布、推奨 probe 分類、DI 変更方針、実装順をまとめた。 |

***

## 判断基準

### ブラウザテストを優先する

今回の時点では、ログの全面移行よりも、まず次回のブラウザテストを始められることを優先した。  
そのため、startup / panel / recovery の主要観測点を先に probe 化し、次回の手動確認で読みやすいところまで整える方針を採った。

### 詳細観測ログと高レベルログを分ける

詳細観測ログは既存 probe へ寄せる。  
一方で、session cleanup や startup skip などの高レベルログは、将来的に `logLifecycleProbe` のような別分類へ切り出す前提で整理する。

### `content.js` を probe の集約点にする

新しい probe を増やす場合も、`content.js` に debug flag と logger 関数を集約し、各 module へ DI する流儀を維持する。  
これにより module ごとに独自 logger を増やさず、ブラウザテスト時の有効化単位を揃えられる。

### ブラウザテスト前に必要な観測だけ整える

今回は残存 `logContent` をすべて probe 化することは目的にしない。  
次回のテストで実際に見る startup / panel / recovery を優先し、字幕再構築系や lookup 系は Step17-C のメモを正本として後続整理に回す。

***

## 実装ステップ

| Step | 対象ファイル | 状態 | 実装内容 | 確認結果 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | `settings-runtime.js` | 完了 | startup readiness 系ログを既存 startup probe に寄せた。 | 起動前後の観測点が probe で読める前提を整えた。 |
| 2 | `modules/subtitle-sync-controller.js` | 完了 | recovery 補助ログを既存 recovery probe に寄せた。 | pending sync task まわりの観測整理が進んだ。 |
| 3 | `modules/panel-ui.js` | 完了 | panel render / applyPanelState 系の詳細観測ログを panel probe に寄せた。 | panel 描画・再適用の切り分けがしやすくなった。 |
| 4 | `modules/playback-controls-layout-controller.js` | 完了 | panel visibility change を panel probe に寄せた。 | playback controls と panel 追従の観測点を整理できた。 |
| 5 | `modules/playback-startup-coordinator.js` | 完了 | track readiness を startup probe に寄せた。 | startup readiness の詳細観測がしやすくなった。 |
| 6 | `modules/subtitle-recovery-manager.js` | 完了 | recovery reset を recovery probe に寄せた。 | recovery reset 系の観測基盤が整った。 |
| 7 | `content.js` | 完了 | 既存 probe 定義と DI の受け渡し構造を再確認した。 | 次段階の probe 追加先を `content.js` に固定できる状態を確認した。 |
| 8 | `docs/Bugfix/Step17-C_残存ログprobe制御_方針整理メモ.md` | 完了 | 残存 `logContent` の棚卸しと probe 分類方針を文書化した。 | 次回以降のログ整理の入口資料を作成した。 |

***

## 残存ログの整理状況

### 既存 probe へ移管済みの主な観測

- panel render completed
- applyPanelState start / done
- layoutController.panelVisibilityChanged
- startup coordinator track readiness
- subtitle recovery manager reset

### まだ残っている主な `logContent`

- session cleanup / reset / ui state clear
- startup skip / playback target changed
- secondary recovery lane / binder / orchestrator 系
- subtitle state reset
- cue rebuild / sequence rebuild
- popup / dictionary / translation などの lookup 系

### 次段階の probe 分類案

- `logLifecycleProbe`
- `logStartupProbe`
- `logPanelProbe`
- `logRecoveryProbe`
- `logSubtitleProbe`
- `logLookupProbe`

***

## ブラウザテスト前提の確認事項

次回は実装整理から入らず、**最初にブラウザテストを行う**。  
今回の時点で、startup / panel / recovery の主要観測点は probe で切り替えられる状態まで整っている。

次回の確認観点は次のとおりである。

- 再生中の ON → OFF → ON が成立するか
- panel open / close と overlay 追従が破綻しないか
- hard seek 後に subtitle / panel / overlay が復帰するか
- SPA 遷移後に cleanup / restart が破綻しないか
- native subtitle fallback と secondary recovery の観測が十分読めるか

***

## 実機検証

### 今回の検証状況

- **未実施**
- 理由は、このスレッドをブラウザテスト用に開始したものの、冒頭で字幕拡張 ON/OFF トグル周辺の修正、runtime state 整理、probe 整理、資料整備を進めたためである。

### 次回の検証開始条件

- panel / startup / recovery の主要観測ログが probe で読めること
- `Bugfix マスタープラン.md` と `Step17-C_残存ログprobe制御_方針整理メモ.md` が次スレッドの入口資料として使えること
- 現在の build を Apple TV+ 再生画面でそのまま動かし、即ブラウザテストに入れること

***

## 作業中の判断メモ

- `extensionEnabled` の runtime state 分離後は、永続設定と session state の混線が大きく減ったため、次の不具合切り分けは visibility / lifecycle 側に集中できる。
- panel / startup / recovery の観測点が probe に寄ったことで、次回テスト時は `logContent` のノイズを減らしながら必要なログだけを見る運用がしやすい。
- 残存ログの全面整理は有益だが、今の優先順位では「テストしながら必要箇所を追加整理する」進め方の方が安全である。
- `console.*` の扱いは今回の `logContent` 整理とは切り分け、別ワークストリームで扱う。

***

## 次回の開始手順

1. Apple TV+ 再生画面でブラウザテストを開始する。  
2. 必要な probe flag を有効化し、startup / panel / recovery の挙動を観測する。  
3. ON → OFF → ON、panel 開閉、hard seek、SPA 遷移の順で確認する。  
4. 問題が再現したら、owner 境界、cleanup 経路、runtime state、recovery 経路のどこでズレているかを切り分ける。  
5. テスト結果をこの `Bugfix 実装シート.md` に追記する。  
6. 追加の観測整理が必要なら `Step17-C_残存ログprobe制御_方針整理メモ.md` に沿って修正対象を決める。  

***

## 次回すぐ見る資料

- `docs/Bugfix/Bugfix マスタープラン.md`
- `docs/Bugfix/Step17-B_visibility-lifecycle_方針整理メモ.md`
- `docs/Bugfix/Step17-C_残存ログprobe制御_方針整理メモ.md`

***

## メモ

- 次回は**ブラウザテストから始める**。
- 今回の時点で、startup / panel / recovery の主要観測ログは整理済みであり、テスト前提のログ整備は完了している。
- 残存 `logContent` の全面 probe 化は未完だが、次回テストに入るための準備としては十分な状態である。

情報源
