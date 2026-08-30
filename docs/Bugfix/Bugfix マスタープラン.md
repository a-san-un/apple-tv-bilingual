# Bugfix マスタープラン 2026-08-30（要約版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-30 ／ **ブランチ:** `issue-32-content-core-split`  
**入口資料:** 新しいスレッドでもこの資料 1 枚を読めば、プロジェクトの目標・現在地・優先順位・次に着手する作業が分かる状態を保つ。  
**反映済みの主な節目:** Step 15 の `lane-recovery-state` 命名整理、Step 16 の `cue-sequence-builder` への導出集約、Step 17-A-7 / 17-A-8 / 17-A-9 / 17-A-10 の panel 系整理、Step 17-A-11 の `extensionEnabled` runtime state 分離、Panel / Startup / Recovery の詳細観測ログの既存 probe への追加移管、Step17-C として残存 `logContent` の棚卸しと probe 制御方針整理メモの作成まで反映済みである。現在は、**playback session lifecycle の owner を単一路線へ寄せる責務再設計に着手した段階**である。次回は**責務移管チェックリストに沿って起動入口と cleanup 入口の一本化を進めるところから着手する**。

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
| 資料① | `docs/Bugfix/Bugfix マスタープラン.md` | 全体俯瞰・目標・優先順位・次スレッドの入口  | 節目ごとに更新  |
| 資料② | `docs/Bugfix/Bugfix 実装シート.md` | 今やっている作業の対象・実装順・検証手順・作業メモ  | 作業中に更新、完了後は整理  |
| 資料③ | `docs/Bugfix/Bugfix 将来作業計画.md` | 後続ステップや保留課題の一覧  | 予定変更時に更新  |
| 資料④ | `docs/Bugfix/Bugfix-仕様確定書.md` | 確定仕様の正本  | 仕様変更時のみ更新  |
| 資料⑤ | `docs/Bugfix/字幕同期・切り替え条件統合と責務再設計メモ.md` | primary / secondary 字幕同期、monitor、recovery、native fallback の統合設計メモ  | 字幕同期設計変更時に更新  |


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
| `state.extensionEnabled` | ランタイムメモリ | 現在の playback session における拡張全体の ON/OFF  | native toggle / runtime 設定反映で更新する。`chrome.storage.sync` には保存しない（Step 17-A-11 で完全に分離済み）。  |
| `panelOpen` | `chrome.storage.local` | 現在の字幕パネル開閉状態  | `modules/panel-visibility-state.js` が load / persist を担当する。  |
| `panelDefaultOpen` | `chrome.storage.sync` | 通常起動時の `panelOpen` 初期値  | ランタイムの現在状態ではない。  |
| `subtitleBlockState.sequence` | ランタイムメモリ | sequence / blocks / currentIndex / meta の正本  | `modules/subtitle-block-state.js` が取得、current block 解決、panel open 時の再同期を担当する。  |
| `state.currentSubtitleBlock` | ランタイムミラー | 現在字幕 block の互換参照  | 既存 renderer / overlay 互換のために残すが正本ではない。  |
| `state.lastPanelRenderSnapshot` | 観測用ランタイム情報 | panel 最終描画 snapshot  | debug / 観測用途。保存・clear は panel owner 側で扱う。  |

**補足**  
`extensionEnabled` は永続設定ではなく、現在の playback session に限定した runtime state である。ページ再読込または SPA 遷移後の新しい playback session では、前セッションの ON/OFF 状態を `chrome.storage.sync` から復元しない。Step 17-A-11 で、`modules/settings-store.js` / `modules/settings-schema.js` / popup / options の全経路からこの前提を確定済みである。
`panelOpen` は現在、`chrome.storage.local` に保存する設計で実装されている。
`panelDefaultOpen` は未保存時の初期値であり、`panelOpen` と混同しない。

***

## DOM ID 正本

| 正式名称 | DOM ID | 役割 |
| :-- | :-- | :-- |
| ネイティブトグル | `atvb-native-toggle` | 現在の playback session における拡張全体の runtime ON/OFF。`state.extensionEnabled` を切り替え、OFF 時も残す。  |
| 字幕パネル開閉ボタン | `atv-toggle-btn` | 右側字幕パネルの開閉のみ。設定保存に関与しない。  |
| 字幕パネル本体 host | `atv-panel-host` | 右側字幕パネル host。表示/非表示と矩形計測の正本。  |
| 字幕パネル本体 root | `atv-panel-root` | 右側字幕パネル本体。  |
| オーバーレイ host | `atv-overlay-host` | 学習補助オーバーレイ host。位置・幅・矩形計測の正本。  |
| オーバーレイ inner root | `data-atvb-overlay-root` | overlay 内部コンテナ。文字要素の親。  |
| 単語詳細 UI host | `atv-term-inspector-host` | term inspector の host。  |

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

### いま着手している主作業

現在の主作業は、**playback session lifecycle の owner を単一路線へ寄せる責務再設計**である。これは、起動・再起動・UI 再マウント・cleanup の入口が複数箇所に分散している状態を解消し、`1 playback target = 1 playback session`、`1 session = 1 owner` の原則に寄せるための作業である。

今回の責務再設計では、`modules/playback-startup-coordinator.js` を唯一の起動前段 owner に寄せ、`settings-runtime.js` から直接 start する経路、tracks readiness 待ち、`addtrack` listener、poll / timeout 起動などの分散入口を外していく。あわせて、`reinitialize-coordinator.js` を再起動理由判定と再評価要求の薄い層へ縮退し、`modules/playback-session-cleanup.js` を session teardown の唯一入口へ寄せる方針で進める。

また、`panel-ui.js` と `debug-panel-runtime.js` は session 従属 UI として cleanup 配下へ揃え、startup / panel / recovery probe を使って rebuild 経路が一筆書きで読める状態を目指す。今回の作業は、字幕同期アルゴリズム自体の全面改修や probe 全面移行の完了、ブラウザテスト結果の確定までは含まず、まず owner と入口の整理を正本化して進める段階である。

***

## 優先順位

1. playback session lifecycle の owner 単一化と、起動入口・再起動入口・cleanup 入口の一本化を進める。
2. `settings-runtime.js` / `reinitialize-coordinator.js` / `modules/playback-startup-coordinator.js` / `modules/playback-session-cleanup.js` の責務境界を再整理し、不要経路を段階的に除去する。
3. session 従属 UI と probe 経路を cleanup 配下へ揃え、rebuild 経路の観測可能性を保ったままブラウザテスト前提を整える。
4. 上記の責務移管が安定した段階で、ブラウザテストに戻って実機で lifecycle / cleanup / recovery の整合性を検証する。

***

## 次回着手

次回は、`Bugfix 実装シート.md` にある責務移管チェックリストを正本として、**起動入口と cleanup 入口の一本化を具体的に進めるところから着手する**。特に、`settings-runtime.js` に残る直接 start 経路、tracks readiness 待ち、`addtrack` listener、poll / timeout 起動の削減対象を確認し、`modules/playback-startup-coordinator.js` を唯一の起動前段 owner に寄せる。

そのうえで、`reinitialize-coordinator.js` を再起動理由判定と再評価要求の薄い層へ縮退できるかを見直し、`modules/playback-session-cleanup.js` を session teardown の唯一入口として固定する。並行して、`panel-ui.js` と `debug-panel-runtime.js` を cleanup 配下の session 従属 UI として揃え、startup / panel / recovery probe で rebuild 経路が一筆書きで追える状態を確認する。

ブラウザテストは、これらの責務移管で入口構造が整理された後に再開する。つまり次回の最初の着手点は「テスト実施」ではなく、**テスト前提を安定化させるための責務再設計の実装反映**である。


