# Bugfix マスタープラン 2026-08-26（要約版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-26 ／ **ブランチ:** `issue-32-content-core-split`  
**入口資料：** 新しいスレッドでもこの資料 1 枚を読めば、プロジェクトの目標・現在地・優先順位・次に着手する作業が分かる状態を保つ。  
**Step 15 更新:** `secondary-track-recovery` 系を `lane-recovery-state` へ改名する命名整理コミット `967b326` を反映済みである。  
**Step 16 更新:** `cue-controller.js` と `modules/cue-sequence-builder.js` の責務境界整理コミット `3afcedc` を反映済みである。  
**Step 17-A 更新:** panel renderer の直接依存を `content.js` から外し、panel/block 系4ファイルを `modules/` 配下へ移動するコミット `3f33804` を反映済みである。Step 17-A は継続中であり、残作業は dispose 契約の固定と Step 17-B / 18 へ送る API 境界の固定である。

***

## 関連資料インデックス

| # | 資料名 | 役割 | 更新頻度 |
| :-- | :-- | :-- | :-- |
| 資料① | Bugfix マスタープラン | 全体俯瞰・目標・依存関係・優先順位・次スレッドの入口 | 節目ごとに更新 |
| 資料② | コードベース現状スナップショット | ファイル・関数・DOM ID の正本一覧 | 変更のたびに更新 |
| 資料③ | Bugfix 実装シート | 今の症状・今やる修正箇所・検証手順・実機ログ | 作業中は更新、完了で archive |
| 資料④ | Bugfix 将来作業計画 | 将来作業の計画 | 残っている計画だけにする |
| 資料⑤ | Bugfix-ABCD-plan | 辞書 | 参考資料 |
| 資料⑥ | Bugfix-仕様確定書 | 確定仕様の正本 | 仕様変更時のみ更新 |
| 資料⑦ | 字幕同期・切り替え条件統合と責務再設計メモ | primary / secondary を含む字幕同期・切り替え・monitor・recovery・native fallback の統合設計メモ | 設計変更時に更新 |
| 資料⑧ | `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md` | Step 17-A の panel owner / debug runtime / block state 整理方針、実施状況、残課題 | Step 17-A 作業時に更新 |
| 資料⑨ | `docs/Bugfix/module-load-order.md` | content scripts の module 読み込み順と依存関係 | manifest / module 追加時に更新 |

***

## 最終目標

動画再生中に拡張機能をリアルタイムで ON/OFF できるようにする。

- **OFF 時：** 拡張 UI をすべて破棄し、Apple TV+ 本来の字幕機能が使える状態に戻す。
- **ON 時：** 字幕パネル＋オーバーレイで 2 言語字幕を表示する。
- **OFF 時に残すのは** 「ネイティブトグル・拡張ポップアップ・設定ページ・設定保存」のみである。

***

## 状態変数の正本定義（現行方針）

| 変数名 | 保存先 | 役割 | 備考 |
| :-- | :-- | :-- | :-- |
| `extensionEnabled` | `chrome.storage.sync` | 拡張全体の ON/OFF | ネイティブトグルが書き換える。 |
| `panelOpen` | ランタイムメモリ | 現在の字幕パネル開閉状態 | 現在状態として扱い、永続化しない方針へ寄せる。 |
| `panelDefaultOpen` | `chrome.storage.sync` | 通常起動時の `panelOpen` 初期値 | ランタイムの現在状態ではない。 |
| `subtitleBlockState.sequence` | ランタイムメモリ | sequence / blocks / currentIndex / meta の正本 | `modules/subtitle-block-state.js` が取得・current block 解決・panel open 時再同期を担当する。 |
| `state.currentSubtitleBlock` | ランタイムミラー | 現在字幕 block の互換参照 | Step 17-A 時点では既存 renderer / overlay との互換のため残す。正本化しない。 |
| `state.lastPanelRenderSnapshot` | 観測用ランタイム情報 | panel 最終描画 snapshot | debug / 観測用途。renderer は snapshot を計算して返し、保存・clear は panel owner 側へ移管する方針である。 |

**補足**  
過去の資料では `panelOpen` を `chrome.storage.local` 前提で記述していたが、現在の設計方針ではランタイム UI 状態と永続設定を分離し、`panelOpen` は保存しない方向へ寄せている。  
関連する正本は `ATV bilingual subtitles 設計・修正方針.md` を優先する。

***

## DOM ID 正本（厳守）

| 正式名称 | DOM ID | 役割 |
| :-- | :-- | :-- |
| ネイティブトグル | `atvb-native-toggle` | 拡張全体の ON/OFF のみ。OFF 時も残す。 |
| 字幕パネル開閉ボタン | `atv-toggle-btn` | 右側字幕パネルの開閉のみ。設定保存に関与しない。 |
| 字幕パネル本体 host | `atv-panel-host` | 右側字幕パネル host。表示/非表示と矩形計測の正本。 |
| 字幕パネル本体 root | `atv-panel-root` | 右側字幕パネル本体。 |
| オーバーレイ host | `atv-overlay-host` | 学習補助オーバーレイ host。位置・幅・矩形計測の正本。 |
| オーバーレイ inner root | `data-atvb-overlay-root` | overlay 内部コンテナ。文字要素の親。 |
| 単語詳細 UI host | `atv-term-inspector-host` | 字幕パネル／オーバーレイ字幕の単語クリックで開く term inspector の host。 |

***

## 現在地の要約

### 主要な完了事項

- 字幕パネル表示、primary / secondary 同期表示、ON→OFF→ON の基本復帰経路は成立している。
- 二重表示・ちらつきは解消済みで、字幕パネル開閉時の overlay 位置追従、文字サイズ維持、70/30 レイアウト追従も完了済みである。
- primary / secondary の listener binding 共通化、secondary monitor の start / replace / stop、cleanup / mode restore の基盤は binder 側へ集約済みである。
- unreadable 即 rebind 抑制、recovery の継続失敗中心化、hard seek / SPA 遷移時の cleanup 多重実行防止までは完了済みである。
- Step 7 の中核実装として、secondary 字幕同期は `decision` ベースの action 判定へ統合済みであり、`buildSecondarySyncDecision()` と `resolveSecondaryWaitOutcome()` を導入したコミット `0c3f20d` が反映済みである。
- `cue-controller.js` 側の secondary sync は `clear` / `keep` / `wait-and-bind` / `bind` の action switch ベースへ移行済みであり、旧 `staleMonitor` / `shouldRebind` のローカル組み立ては整理済みである。
- さらに、selection 共通化、direct bind 経路共通化、native fallback の role 共通化、pending sync task cancel、中核 decision shape 整理、`content.js` の DI 寄せ、restart cleanup 一元化、listener cleanup の責務固定までは完了済みとして整理できる。
- Step 12〜14 の退行防止テスト追加は完了済みである。
- Step 15 として、`modules/secondary-track-recovery.js` は `modules/lane-recovery-state.js` へ改名済みであり、`createLaneRecoveryState`・`root.createLaneRecoveryState`・`laneRecoveryState` を基準に、`content.js`、`manifest.json`、`modules/subtitle-recovery-manager.js`、`tests/lane-recovery-state.test.js` まで追従更新済みである。
- Step 16 として、`modules/cue-sequence-builder.js` に sequence / scene / snapshot の導出を集約し、`cue-controller.js` から cue 配列抽出・previousBlocks 引き継ぎ・currentBlock 決定などの sequence build 詳細を外した。
- `cue-controller.js` は `rebuildCurrentSceneSubtitleBlocks()` から builder を呼び、scene 詳細を再計算せず orchestration と互換 shape の提供に留まる構成へ整理済みである。
- Step 17-A として、旧 root 直下の `debug-logger.js` と `debug-panel.js` を削除し、`modules/debug-logger.js`、`modules/debug-panel-runtime.js`、`modules/debug-panel-shell.js` へ責務を分割した。
- `content.js` から logger callback 経由の `updateLiveDebugPanel()` を削除し、`debugPanelRuntime.mount()` による debug panel runtime の mount 経路へ切り替えた。
- `modules/subtitle-block-state.js` を block state の正本として導入し、sequence / current block / panel open 時の block rebuild を集約した。
- Step 17-A-7 として、`content.js` から panel renderer の直接依存を外した。`createPanelRenderer()` は共有 state を直接読まず、`panelRenderer` と `getPanelRenderInput()` を `createPanelUi()` へ DI する構成に整理した。
- subtitle block facade は panel list の直接描画を持たず、block rebuild と subtitle snapshot 更新までを担当する形へ縮小した。
- Step 17-A-9 として、`panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` を `modules/` 配下へ移動し、`manifest.json` の `content_scripts` 参照を更新した。
- `manifest.json` の読み込み順は維持しており、panel/block 系モジュールは `content.js` より前に読み込まれる。
- `panel.css` は `modules/panel-ui.js` の ShadowRoot 内から `chrome.runtime.getURL("panel.css")` で参照される web accessible resource であるため、root 配置を維持する。

### 現在の残課題

- Step 17-A-8 として、`panelUi.dispose()` を panel 系 cleanup の中心入口として固定する。host、ShadowRoot、toggle、observer、listener、timer、overlay、render snapshot、block state の各破棄責務と順序を明文化する。
- `destroyUiHosts()`、`destroyFeatureUiHosts()`、`removeHost()`、`panelUi.dispose()` の cleanup 範囲を照合し、責務重複を解消する。
- playback detach、SPA 遷移、拡張機能無効化、再起動の各経路が同じ panel dispose 契約を通ることを確認する。
- Step 17-A-10 として、`content.js` に残る `getSubtitleBlockSequence`、`getCurrentSubtitleBlockFromSequence`、`renderCurrentSnapshot`、`applyPanelStateEffects` の利用元を棚卸しする。
- `content.js` に残す高レベル中継 API と、panel owner / block state owner に閉じる API を固定する。
- `panelUi.applyPanelState()` と `panelUi.refreshPanel()` の使い分けを API 契約として明文化する。
- Step 17-B の visibility cleanup owner 固定と、Step 18 の term inspector 抽出へ渡す API 境界を確定する。

***

## Step 17-A の進捗

| 枝番 | 内容 | 状態 | 補足 |
| :-- | :-- | :-- | :-- |
| 17-A-1 | panel / blocks の依存棚卸し | 完了 | 方針整理メモに owner、依存、関数マッピングを記録済み。 |
| 17-A-2 | visibility 正本の固定 | 完了 | `modules/panel-visibility-state.js` を開閉 state の load / persist 専用に維持する。 |
| 17-A-3 | panel owner の再整理 | 概ね完了 | `modules/panel-ui.js` に host、ShadowRoot、toggle、observer、render 更新の owner を寄せた。dispose 契約の固定は 17-A-8 で行う。 |
| 17-A-4 | renderer 専用化 | 完了 | `modules/panel-renderer.js` は state を直接読まず、入力から描画結果・snapshot を返す。 |
| 17-A-5 | resolver の計算責務化 | 完了 | `modules/subtitle-block-resolver.js` は panel 表示用 block への計算変換に留める。 |
| 17-A-6 | block state owner の統合 | 概ね完了 | `modules/subtitle-block-state.js` を正本とした。clear / dispose 経路の固定は 17-A-8 で確認する。 |
| 17-A-7 | `content.js` の薄化 | 完了 | renderer 直接依存と panel list 直接描画を外し、DI・高レベル中継へ縮小した。 |
| 17-A-8 | dispose 契約の固定 | 未完了 | cleanup の単一入口、責務範囲、各 lifecycle 経路の接続を固定する。 |
| 17-A-9 | `modules/` 統合と manifest 整合 | 完了 | panel/block 系4ファイルを `modules/` へ移動し、`manifest.json` を更新した。 |
| 17-A-10 | Step 17-B / 18 へつなぐ API 固定 | 未完了 | panel / block public API と `content.js` の高レベル中継範囲を確定する。 |

詳細は `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md` を正本とする。

***

## 実装の優先順位

| 優先度 | ステップ | 目的 | 着手条件 |
| :-- | :-- | :-- | :-- |
| 最優先 | 17-A-8 | panel dispose 契約を固定する | 17-A-7 / 17-A-9 完了 |
| 高 | 17-A-10 | panel / block API 境界を固定する | 17-A-8 の owner / cleanup 確定後 |
| 高 | 17-B | visibility cleanup owner と lifecycle 接続を整理する | 17-A-8 / 17-A-10 完了 |
| 中 | 18 | term inspector を抽出する | panel cleanup / API 境界確定後 |
| 継続 | 実機回帰確認 | ON/OFF、seek、SPA 遷移、再入場、字幕切替を確認する | 各変更後 |

***

## 実機確認の最小セット

- 拡張機能を ON にし、字幕パネルと overlay が表示されることを確認する。
- panel を開閉し、`panelOpen` と toggle 表示、overlay の位置・幅が追従することを確認する。
- panel 内の block click による seek 後、current block、scroll、snapshot、overlay が正しく更新されることを確認する。
- Apple TV+ 内の作品・エピソード移動など SPA 遷移後、panel host / toggle / observer / listener が二重化しないことを確認する。
- 拡張機能の OFF → ON 後、ネイティブ字幕、panel、overlay、term inspector の状態が正しく復帰することを確認する。
- playback detach、再起動、無効化の後に stale な panel host、ShadowRoot、timer、observer、render snapshot、block state が残らないことを確認する。

***

## 今回と混ぜない論点

- panel UI / overlay UI / layout の見た目調整。
- track / toggle / lifecycle の別スコープ不具合修正。
- 別スコープの test failure 修正。
- Step 17-B 以降の実装そのもの。
- Step 18 の term inspector 抽出そのもの。
- `panel.css` の `modules/` 配置変更。これは web accessible な静的アセット整理として別スコープにする。

***

## 結論

現在は Step 17-A の仕上げ段階である。  
`content.js` の panel renderer 直接依存除去と panel/block 系 `modules/` 統合は完了しており、次の最優先は `panelUi.dispose()` を中心にした cleanup 契約の固定である。  
dispose 経路と API 境界を先に確定してから Step 17-B と Step 18 へ進む。

