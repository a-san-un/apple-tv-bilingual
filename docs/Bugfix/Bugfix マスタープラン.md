# Bugfix マスタープラン 2026-08-26（要約版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-26 ／ **ブランチ:** `issue-32-content-core-split`  
**入口資料:** 新しいスレッドでもこの資料 1 枚を読めば、プロジェクトの目標・現在地・優先順位・次に着手する作業が分かる状態を保つ。  
**反映済みの主な節目:** Step 15 の `lane-recovery-state` 命名整理、Step 16 の `cue-sequence-builder` への導出集約、Step 17-A-7 / 17-A-8 / 17-A-9 / 17-A-10 の panel 系整理を反映済みである。

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
| 資料⑩ | `docs/Bugfix/module-load-order.md` | content scripts の module 読み込み順と依存関係 | manifest / module 追加時に更新 |

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
| `extensionEnabled` | `chrome.storage.sync` | 拡張全体の ON/OFF | ネイティブトグルが書き換える。 |
| `panelOpen` | `chrome.storage.local` | 現在の字幕パネル開閉状態 | `modules/panel-visibility-state.js` が load / persist を担当する。 |
| `panelDefaultOpen` | `chrome.storage.sync` | 通常起動時の `panelOpen` 初期値 | ランタイムの現在状態ではない。 |
| `subtitleBlockState.sequence` | ランタイムメモリ | sequence / blocks / currentIndex / meta の正本 | `modules/subtitle-block-state.js` が取得、current block 解決、panel open 時の再同期を担当する。 |
| `state.currentSubtitleBlock` | ランタイムミラー | 現在字幕 block の互換参照 | 既存 renderer / overlay 互換のために残すが正本ではない。 |
| `state.lastPanelRenderSnapshot` | 観測用ランタイム情報 | panel 最終描画 snapshot | debug / 観測用途。保存・clear は panel owner 側で扱う。 |

**補足**  
`panelOpen` は現在、`chrome.storage.local` に保存する設計で実装されている。  
`panelDefaultOpen` は未保存時の初期値であり、`panelOpen` と混同しない。

***

## DOM ID 正本

| 正式名称 | DOM ID | 役割 |
| :-- | :-- | :-- |
| ネイティブトグル | `atvb-native-toggle` | 拡張全体の ON/OFF のみ。OFF 時も残す。 |
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

### 現在の残課題

- **Step 17-B:** Step 17-A-10 で確定した API 境界を前提に、`panelOpen`、`panelDefaultOpen`、通常 open / close、reinitialize、SPA 遷移、拡張 ON/OFF を含む visibility / lifecycle の owner を固定する。
- **Step 18:** term inspector 関連 state / shell を `content.js` から切り離す。

***

## Step 17-A の進捗

| 枝番 | 内容 | 状態 | 補足 |
| :-- | :-- | :-- | :-- |
| 17-A-1 | panel / blocks の依存棚卸し | 完了 | 方針整理メモに owner、依存、関数マッピングを記録済み。 |
| 17-A-2 | visibility 正本の固定 | 完了 | `modules/panel-visibility-state.js` を開閉 state の load / persist 専用に維持する。 |
| 17-A-3 | panel owner の再整理 | 完了 | `modules/panel-ui.js` に host、ShadowRoot、toggle、observer、render 更新の owner を寄せ、dispose 契約も固定済みである。 |
| 17-A-4 | renderer 専用化 | 完了 | `modules/panel-renderer.js` は state を直接読まず、入力から描画結果・snapshot を返す。 |
| 17-A-5 | resolver の計算責務化 | 完了 | `modules/subtitle-block-resolver.js` は panel 表示用 block への計算変換に留める。 |
| 17-A-6 | block state owner の統合 | 完了 | `modules/subtitle-block-state.js` を正本とし、clear / dispose 経路も確認済みである。 |
| 17-A-7 | `content.js` の薄化 | 完了 | renderer 直接依存と panel list 直接描画を外し、DI・高レベル中継へ縮小した。 |
| 17-A-8 | dispose 契約の固定 | 完了 | `panelUi.dispose()` を panel cleanup の高レベル入口として固定した。 |
| 17-A-9 | `modules/` 統合と manifest 整合 | 完了 | panel / block 系 4 ファイルを `modules/` へ移動し、`manifest.json` を更新した。 |
| 17-A-10 | Step 17-B / 18 へつなぐ API 固定 | 完了 | `content.js` に残る panel / block public API と高レベル中継範囲を確定し、旧 sequence getter DI / fallback 削除、`applyPanelOpenEffects()` 集約、block state の描画 callback DI 削除、panel render artifact cleanup 集約、subtitle reset helper 分離、reinitialize reset options 契約化、関連コメント同期まで反映済みである。 |

詳細は `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md` を正本とする。

***

## 実装の優先順位

| 優先度 | ステップ | 目的 | 着手条件 |
| :-- | :-- | :-- | :-- |
| 最優先 | 17-B | visibility / lifecycle の owner と cleanup 境界を固定する | 17-A-10 の API 固定完了後。 |
| 次 | 18 | term inspector 関連 state / shell を `content.js` から分離する | 17-A / 17-B の panel 系境界確定後。 |
| 継続観測 | F-4 / F-5 / F-8 / F-9 / F-10 / M-1 | message channel error、cleanup / mode restore、ログ整理、完全リセット、seek 後の track 参照消失、長時間メモリ観測 | 主作業と混線しない範囲で継続。 |

***

## 次スレッドの入口

次スレッドでは、まず **Step 17-B の visibility / lifecycle owner 固定** に着手する。  
開始時は次の順で確認するとよい。

1. `docs/Bugfix/Step17-B_visibility-lifecycle_方針整理メモ.md` を開き、visibility / lifecycle の論点と対象 state を確認する。
2. `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md` を参照し、17-A-10 で固定済みの API 境界を前提として扱う。
3. `content.js`、`modules/panel-ui.js`、`modules/panel-visibility-state.js`、`reinitialize-coordinator.js`、cleanup 系モジュールを対象に、open / close / reinitialize / SPA 遷移 / ON-OFF の到達経路を洗い出す。
4. `panelOpen` と `panelDefaultOpen` の役割差、および storage / runtime / DOM 表示切り替えの owner を切り分ける。

**この資料で扱わないこと**

- 個別ファイルへの置換手順や JSDoc 差し替え案
- 実機ログや検証ログの詳細
- panel UI / overlay UI / layout の見た目調整
- track / toggle / lifecycle の別スコープ修正
- 別スコープの test failure 修正
- Step 17-B 以降の visibility / lifecycle 実装そのもの
- Step 18 の term inspector 抽出実装そのもの

***

## 結論

現在の最優先は **Step 17-B** であり、Step 17-A-10 で確定した panel / block API 境界を前提に visibility / lifecycle の owner を固定することである。
Step 18 はその次に、panel 系境界と lifecycle 境界の整理後、term inspector 関連 state / shell を `content.js` から切り離す段階である。

