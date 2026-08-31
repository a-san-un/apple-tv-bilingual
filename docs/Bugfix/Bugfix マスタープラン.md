# Bugfix マスタープラン 2026-08-31（要約版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-31 ／ **ブランチ:** `issue-32-content-core-split`  
**入口資料:** 新しいスレッドでもこの資料 1 枚を読めば、プロジェクトの目標・現在地・優先順位・次に着手する作業が分かる状態を保つ。  
**反映済みの主な節目:** Step 15 の `lane-recovery-state` 命名整理、Step 16 の `cue-sequence-builder` への導出集約、Step 17-A-7 / 17-A-8 / 17-A-9 / 17-A-10 の panel 系整理、Step 17-A-11 の `extensionEnabled` runtime state 分離、Panel / Startup / Recovery の詳細観測ログの既存 probe への追加移管、Step17-C として残存 `logContent` の棚卸しと probe 制御方針整理メモの作成、さらに playback session lifecycle の責務再設計として **startup owner の一本化、cleanup owner 側の API / 説明層整備、`content.js` の主要 direct cleanup callsite 集約** まで反映済みである。 現在は、**cleanup owner 一本化の残差整理フェーズ**に入っており、`reinitialize-coordinator.js` に残る `clearInternalSubtitleState(...)` 直呼びと、`content.js` に残る helper / DI の最終整理を進める段階である。

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
`extensionEnabled` は永続設定ではなく、現在の playback session に限定した runtime state である。 ページ再読込または SPA 遷移後の新しい playback session では、前セッションの ON/OFF 状態を `chrome.storage.sync` から復元しない。 Step 17-A-11 で、`modules/settings-store.js` / `modules/settings-schema.js` / popup / options の全経路からこの前提を確定済みである。
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
- `modules/playback-session-cleanup.js` は session cleanup owner の受け皿として API と説明層が整備され、`content.js` 側の主要 direct cleanup callsite であった `clearSubtitles` と manual restart cleanup は cleanup owner API 経由へ置換済みである。
- `modules/panel-ui.js` と `modules/debug-panel-runtime.js` は、cleanup owner ではなく playback session に従属する subordinate UI module / runtime として、ヘッダーおよび dispose / unmount の説明層を更新済みである。

### いま着手している主作業

現在の主作業は、**playback session lifecycle の owner を単一路線へ寄せる責務再設計の残差整理**である。 これは、起動 owner の一本化が完了したあとに、cleanup owner 一本化をコード上でも完全に読める状態へ寄せるための後半フェーズである。

この段階では、`modules/playback-startup-coordinator.js` を唯一の起動前段 owner とする方針は実装に反映済みであり、`settings-runtime.js` から直接 start する経路は整理済みである。 一方で、cleanup 側は `modules/playback-session-cleanup.js` を teardown owner とする受け皿整備と主要 callsite 集約までは完了したが、`reinitialize-coordinator.js` に残る `clearInternalSubtitleState(...)` 直呼びと、`content.js` に残る helper / DI の縮退がまだ残っている。

したがって、現時点の表現として正確なのは、**startup owner 一本化は完了、cleanup owner 一本化は一部完了**である。 完了済み事項は「owner 側受け皿と主要 callsite 集約まで」、残課題は「cleanup 内部専用 helper への格下げと、reinitialize / content 側の残存直呼び整理」として扱う。

### 次回の着手点

次回は、cleanup owner 一本化の残課題から再開する。

優先順位は次のとおりである。

1. `reinitialize-coordinator.js` に残る `clearInternalSubtitleState(...)` 直呼びを除去し、cleanup owner 経由へ置換する。
2. `content.js` に残る `clearInternalSubtitleState(...)` の helper / DI を、cleanup 内部専用 helper として読める形へ縮退する。
3. 上記整理の完了後、不要になった watcher / timer / wrapper / 補助 cleanup を物理削除する。
4. その後、関連ドキュメント間で「startup = coordinator」「cleanup = playback-session-cleanup」「content.js = wiring」「panel/debug = subordinate module」という表現を揃える。

***

## 優先順位

### いま最優先の作業

最優先は、**playback session lifecycle の owner 一本化を cleanup 側まで完結させること**である。 現在は起動入口の一本化が済んでいるため、残る重点は cleanup owner の境界を `reinitialize-coordinator.js` / `content.js` / `modules/playback-session-cleanup.js` 間で完全にそろえることにある。

### その次にやる作業

その次は、不要になった watcher / timeout / wrapper / 補助 cleanup を物理削除し、実装と設計文書の差分を詰めることである。 あわせて、`Bugfix 実装シート.md`、`Bugfix 将来作業計画.md`、`Bugfix 設計整理対応表.md` 側の進捗表記も、今回完了した範囲に合わせて更新する。

### 後続の作業

owner 一本化が完了したら、次は browser test とログ確認を通じて、settings 変更・SPA 遷移・track invalidation・restart 要求のどれから入っても同じ rebuild 経路へ収束することを再確認する。 そのうえで、残存 `logContent` 整理と probe 制御方針に沿った観測経路の軽量化を継続する。

***

## 今回の判断基準

今回の責務再設計で重視している判断基準は次のとおりである。

- **1 playback target = 1 playback session = 1 owner** を説明と実装の両方で読めること。
- settings 変更、SPA 遷移、track invalidation、restart 要求のどれから入っても、最終的に同じ rebuild 経路へ流れること。
- `content.js` が wiring / request のハブに戻り、start / cleanup の owner 顔をしないこと。
- `panel-ui.js` / `debug-panel-runtime.js` は subordinate UI module として mount / render / dispose に責務を限定し、session owner を名乗らないこと。
- `clearInternalSubtitleState(...)` は物理削除を急ぐのではなく、cleanup 内部専用 helper へ格下げして owner 境界を明確にすること。

***

## 次スレッド開始時の確認ポイント

次スレッドでは、まず次の 3 点を確認する。

- `reinitialize-coordinator.js` に `clearInternalSubtitleState(...)` の直呼びが残っていないか。
- `content.js` に残る `clearInternalSubtitleState(...)` が、外向き cleanup API ではなく cleanup 内部 helper として読める状態か。
- cleanup 完了後の rebuild 経路が、`request → cleanup owner → attachAndMaybeStart(...) → startBilingual(...)` の順で追えるか。

この 3 点が揃えば、playback session lifecycle の owner 一本化は cleanup 側までかなり前進したと判断できる。

