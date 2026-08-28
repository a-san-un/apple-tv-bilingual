# Bugfix マスタープラン 2026-08-28（要約版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-28 ／ **ブランチ:** `issue-32-content-core-split`  
**入口資料:** 新しいスレッドでもこの資料 1 枚を読めば、プロジェクトの目標・現在地・優先順位・次に着手する作業が分かる状態を保つ。  
**反映済みの主な節目:** Step 15 の `lane-recovery-state` 命名整理、Step 16 の `cue-sequence-builder` への導出集約、Step 17-A-7 / 17-A-8 / 17-A-9 / 17-A-10 の panel 系整理、Step 17-A-11 の `extensionEnabled` runtime state 分離、Panel / Startup / Recovery の詳細観測ログの既存 probe への追加移管、Step17-C として残存 `logContent` の棚卸しと probe 制御方針整理メモの作成まで反映済みである。次回は**ブラウザテストから着手する**。テスト前提となるログ整備は一通り完了している。

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
| 資料② | コードベース現状スナップショット | ファイル・関数・DOM ID・状態変数の正本一覧 | 実装変更のたびに更新 |
| 資料③ | `docs/Bugfix/Bugfix 実装シート.md` | 今やっている作業の対象・実装順・検証手順・作業メモ | 作業中に更新、完了後は整理 |
| 資料④ | Bugfix 将来作業計画 | 後続ステップや保留課題の一覧 | 予定変更時に更新 |
| 資料⑤ | Bugfix-ABCD-plan | 用語・分類の補助資料 | 必要時のみ参照 |
| 資料⑥ | Bugfix-仕様確定書 | 確定仕様の正本 | 仕様変更時のみ更新 |
| 資料⑦ | `docs/Bugfix/字幕同期・切り替え条件統合と責務再設計メモ.md` | primary / secondary 字幕同期、monitor、recovery、native fallback の統合設計メモ | 字幕同期設計変更時に更新 |
| 資料⑧ | `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md` | Step 17-A の panel owner / block state / debug runtime / API 境界整理の詳細正本 | Step 17-A 作業時に更新 |
| 資料⑨ | `docs/Bugfix/Step17-B_visibility-lifecycle_方針整理メモ.md` | Step 17-B の visibility / lifecycle 整理の詳細正本 | Step 17-B 作業時に更新 |
| 資料⑩ | `docs/Bugfix/Step17-C_残存ログprobe制御_方針整理メモ.md` | 残存 `logContent` の棚卸し、probe 分類、DI 変更方針の詳細正本 | probe 整理方針更新時に更新 |
| 資料⑪ | `docs/Bugfix/module-load-order.md` | content scripts の module 読み込み順と依存関係 | manifest / module 追加時に更新 |

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
- Step 17-A-10 として、`content.js` に残っていた panel / block public API と高レベル中継境界を整理し、owner ごとの責務を固定済みである。具体的には、旧 sequence getter DI / fallback の削除、`applyPanelOpenEffects()` への panel open effect 集約、`modules/subtitle-block-state.js` からの描画 callback DI 削除、`modules/panel-ui.js` の render artifact cleanup 集約、`modules/subtitle-state-reset.js` の mirror / snapshot reset helper 分離、`reinitialize-coordinator.js` の reset options 契約化、関連コメント同期まで反映済みである。
- Step 17-A-11 として、`extensionEnabled` を永続設定から外し、current playback session に限定した runtime state として一本化済みである。
- その後の補助整理として、`settings-runtime.js`、`modules/subtitle-sync-controller.js`、`modules/panel-ui.js`、`modules/playback-startup-coordinator.js`、`modules/subtitle-recovery-manager.js` の詳細観測ログを既存 probe へ追加移管した。
- Step17-C として、残存 `logContent` を棚卸しし、`logLifecycleProbe` / `logRecoveryProbe` / `logSubtitleProbe` / `logLookupProbe` まで含めた probe 制御方針を整理した。
- 次回のブラウザテストに向けて、少なくとも「起動」「panel」「recovery」の主要観測点は probe で切り替えられる状態まで整理済みである。

### 今回スレッドで未実施のこと

- このスレッドは本来ブラウザテスト用として立てたが、実際にはネイティブトグル周辺の修正、runtime state 整理、probe 整理、資料更新を優先したため、**ブラウザテスト自体は未実施**である。
- したがって、今回の到達点は「テストを始められる観測基盤の整備完了」であり、「実機での振る舞い確認完了」ではない。

***

## 現時点の評価

### 安定してきた領域

- panel lifecycle の高レベル入口と低レベル DOM cleanup の責務境界はかなり明確になった。
- runtime ON/OFF と永続設定の混線は、`extensionEnabled` の runtime state 分離により大きく改善した。
- startup / recovery / panel の詳細観測ログは既存 probe へ寄せたため、次回のブラウザテストでは必要な観測だけを有効化しやすい。

### まだ固定し切っていない領域

- Step 17-B の visibility / lifecycle owner 固定は、まだ本格着手前である。
- 残存 `logContent` はまだあり、session cleanup、startup skip、secondary recovery、subtitle reset、cue rebuild などの高レベルログは追加整理余地がある。
- `console.*` のうち debug / warn / error の扱いは、probe 整理とは別ワークストリームで扱う前提である。

***

## 今の優先順位

### 優先 1: ブラウザテストの再開

次回スレッドでは、**最初にブラウザテストを行う**。  
今回のスレッドではテストが未実施のため、まず現在の build で次を確認する。

- 再生中の ON → OFF → ON
- panel open / close と overlay 追従
- hard seek 後の subtitle / panel / overlay 復帰
- SPA 遷移後の cleanup / restart
- native subtitle fallback と secondary recovery の観測

### 優先 2: Step 17-B の実作業着手

ブラウザテストの結果を踏まえつつ、visibility / lifecycle owner の固定に着手する。  
特に、再生状態変化・UI 表示状態・session cleanup の責務境界が、現在の owner 分割で破綻していないかを確認しながら進める。

### 優先 3: Step17-C に沿った残存ログ整理

ブラウザテストで追加観測が必要な箇所が見えたら、`Step17-C_残存ログprobe制御_方針整理メモ.md` に沿って残存 `logContent` を段階的に probe へ寄せる。  
この作業はテストを補助するためのものであり、テストより先に全面移行を完了させること自体を目的にしない。

***

## 次スレッド開始時の着手順

1. Apple TV+ 再生画面でブラウザテストを開始する。  
2. 必要な probe flag を有効化し、startup / panel / recovery の挙動を観測する。  
3. 不具合が再現したら、その時点で owner 境界、cleanup 経路、runtime state、recovery 経路のどこでズレているかを切り分ける。  
4. テスト結果を `Bugfix 実装シート.md` に反映する。  
5. 追加のログ整理が必要なら `Step17-C_残存ログprobe制御_方針整理メモ.md` を参照して修正対象を決める。  

***

## 次回すぐ見る資料

- `docs/Bugfix/Bugfix 実装シート.md`
- `docs/Bugfix/Step17-B_visibility-lifecycle_方針整理メモ.md`
- `docs/Bugfix/Step17-C_残存ログprobe制御_方針整理メモ.md`

***

## メモ

- 次回は**実装整理の続きではなく、先にブラウザテストから入る**。
- 今回の時点で、startup / panel / recovery の主要観測ログは probe 化されているため、テストしながらログを読みやすい。
- 残存ログの全面 probe 化は未完だが、ブラウザテスト開始の前提としては十分な段階まで整理済みである。

情報源
