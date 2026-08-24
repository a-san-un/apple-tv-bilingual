# Bugfix マスタープラン 2026-08-24（要約版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-24 ／ **ブランチ:** `issue-32-content-core-split`  
**入口資料：** 新しいスレッドでもこの資料 1 枚を読めば、プロジェクトの目標・現在地・優先順位・次に着手する作業が分かる状態を保つ。  
**Step 15 更新:** `secondary-track-recovery` 系を `lane-recovery-state` へ改名する命名整理コミット `967b326` を反映済みである。
**Step 16 更新:** `cue-controller.js` と `modules/cue-sequence-builder.js` の責務境界整理コミット `3afcedc` を反映済みである。

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

### 継続課題

- `A listener indicated an asynchronous response...` は初回のみ残ることがあり、F-4 は持ち越しである。
- Chrome Renderer のメモリ使用量増大は継続観測中であり、listener / observer / timer 蓄積の有無を引き続き見たい。
- 拡張 ON/OFF トグル操作は、現状のログでは一意に追えない。OFF 側ログはあるが、ON 側は開始ログ中心で、トグル単独復帰の確認にはまだ弱い。
- 大きな seek 直後に `secondary-track-unbind-skipped` が出るケースがあり、unbind すべき track 参照自体が先に失われている可能性がある。
- `content.js` には term inspector（旧 subtitle popup）関連 state と UI shell が残っており、字幕パネル / blocks の管理責務もまだ残存しているため、配線専用化は未完了である。
- panel 系の実装は `panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` に分散したまま root 直下に残っており、`modules/` への統合と owner 境界整理が未完了である。
- full test 実行では `cue-track-binder`、`playback-session-cleanup`、`playback-startup-coordinator`、`panel-ui-toggle` に別スコープの失敗があり、Step 16 完了とは切り分けて後続ワークストリームで扱う必要がある。

***

## 優先順位

### 最優先

**7-17: トグル ON/OFF ログの相関強化**

- `settings-runtime.js` にトグル操作単位の相関 ID を入れる。
- OFF 側の `apply start / restore before / restore after / apply done` と、ON 側の `restart begin / restart done` を対で追えるようにする。
- 実機でトグル単独復帰を再確認できる観測基盤を先に整える。

### 次点

**7-16: トグル時の完全リセット実装**

- `modules/cue-track-binder.js` / `modules/subtitle-state-reset.js` を中心に、listener・timer・Map参照・track binding を明示的に解放する。
- `window.gc()` のような強制 GC は使わず、参照断ち切りによって回収可能な状態を作る。

**7-19〜7-20: 大きな seek 後の track 参照消失調査**

- `cue-controller.js` の large seek 直後に `primaryBoundTrack` 空状態や `secondary-track-unbind-skipped` が出る条件を切り分ける。
- `dispose` / `unbind` / `rebind` の順序と、track 参照消失タイミングを精査する。

### その次

**Step 17〜18: 薄化フェーズ**

- **Step 17:** root 直下の panel 系既存ファイル（`panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js`）を `modules/` 配下へ統合し、`content.js` から字幕パネル / blocks の管理責務を外す。
- **Step 18:** `content.js` に残る in-player 単語詳細 UI を `term inspector` として別モジュール化し、state / style / shell / event / render を切り出して `content.js` を薄くする。
- Step 17 では単なるパス移動を先行せず、panel DOM / render / block 導出 / visibility state の owner 境界と dispose 経路を先に固定する。
- Step 15 の recovery state 命名整理は完了済みであり、以後は `lane-recovery-state.js` を正本名として扱う。
- Step 16 の sequence build 正本化は完了済みであり、以後 `cue-controller.js` に sequence 構築詳細を戻さない。

### 並行観測

- 長時間再生時の Renderer メモリ増加観測は継続し、Step 17〜18 の責務整理後に listener / observer / timer / Map参照の残留が減っているかを観測する。
- `panel-ui-toggle` は Step 17 の panel modules 統合と同時に、DOM fixture 前提も含めて再設計する。
- `cue-track-binder`、`playback-session-cleanup`、`playback-startup-coordinator` の失敗は別スコープで扱い、今回の薄化フェーズとは混ぜない。

***

## Step 別ステータス

| Step | 状態 | 要点 |
| :-- | :-- | :-- |
| 1 | ✅ 完了 | `modules/subtitle-sync-controller.js` に `getTrackIdentity()` と `trackMatchesRequestedLanguage()` を追加し、track identity・言語一致判定の土台を共通化した。 |
| 2 | ✅ 完了 | primary / secondary selection API の共通化と direct bind 経路の共通化を進めた。 |
| 3 | ✅ 完了 | native fallback role の共通化と pending sync task 導入の土台を入れた。 |
| 4 | ✅ 完了 | cancellable wait 化と secondary 選択の停滞復帰経路の土台を整理した。 |
| 5 | ✅ 完了 | `subtitle-sync-controller.js` の decision shape を整理し、`cue-controller.js` が action switch を扱える形へ寄せた。 |
| 6 | ✅ 完了 | `content.js` の DI 寄せと restart cleanup 一元化、listener cleanup 責務固定を進めた。 |
| 7 | ✅ 完了 | `buildSecondarySyncDecision()` と `resolveSecondaryWaitOutcome()` を中心に secondary sync の action 統合を完了した。 |
| 8 | ✅ 完了 | `cue-controller.js` が `staleMonitor` / `shouldRebind` を自前で組み立てない構成へ寄った。 |
| 9 | ✅ 完了 | 同一 track の一時 unreadable で即 rebind しない方針を維持した。 |
| 10 | ✅ 完了 | bind / cleanup / mode restore は binder 側に留める方針を維持した。 |
| 11 | ✅ 完了 | selection 共通化、direct bind 共通化、native fallback role 共通化、pending sync task cancel を反映した。 |
| 12 | ✅ 完了 | `tests/subtitle-sync-controller.test.js` に selection 共通化・pending sync task cancel の退行防止テストを追加した。 |
| 13 | ✅ 完了 | primary native fallback の退行防止テストを追加した。 |
| 14 | ✅ 完了 | `resolveSecondaryWaitOutcome()` と decision 統合の退行防止観点を整理した。 |
| 15 | ✅ 完了 | `modules/lane-recovery-state.js` への改名、`createLaneRecoveryState` への factory 名統一、`root.createLaneRecoveryState` 参照への整理、`manifest.json`・`content.js`・`modules/subtitle-recovery-manager.js`・`tests/lane-recovery-state.test.js` の追従更新を実施した。 |
| 16 | ✅ 完了 | `modules/cue-sequence-builder.js` を sequence / scene / snapshot の正本に固定した。`cue-controller.js` は `rebuildCurrentSceneSubtitleBlocks()` から builder を呼び、scene 詳細を再計算せず orchestration と互換 shape の提供に留める。 |
| 17 | ⬜ 未着手 | root 直下の panel 系既存ファイルを `modules/` へ統合し、`content.js` から字幕パネル / blocks の DOM 管理・描画・表示更新責務を外す。 |
| 18 | ⬜ 未着手 | `content.js` に残る in-player 単語詳細 UI を `term inspector` として別モジュール化し、state / shell / event / render を切り出す。 |

***

## Step 15 完了内容

| ID | 種別 | 対象 | 状態 |
| :-- | :-- | :-- | :-- |
| 15-1 | ファイル名変更 | `modules/secondary-track-recovery.js` → `modules/lane-recovery-state.js` | ✅ 完了 |
| 15-2 | factory 名変更 | `createSecondaryTrackRecovery` → `createLaneRecoveryState` | ✅ 完了 |
| 15-3 | global export 名変更 | `root.createSecondaryTrackRecovery` → `root.createLaneRecoveryState` | ✅ 完了 |
| 15-4 | ファイル名・役割コメント更新 | `modules/lane-recovery-state.js` | ✅ 完了 |
| 15-5 | import / 参照更新 | `manifest.json` | ✅ 完了 |
| 15-6 | factory 呼び出し名更新 | `content.js` | ✅ 完了 |
| 15-7 | runtime state 名更新 | `laneRecoveryState` | ✅ 完了 |
| 15-8 | manager 側参照更新 | `modules/subtitle-recovery-manager.js` | ✅ 完了 |
| 15-9 | テスト追従更新 | `tests/lane-recovery-state.test.js` | ✅ 完了 |

***

## Step 16 完了内容

| ID | 種別 | 対象 | 状態 |
| :-- | :-- | :-- | :-- |
| 16-1 | builder 拡張 | `modules/cue-sequence-builder.js` | ✅ 完了 |
| 16-2 | scene / snapshot 正本化 | `modules/cue-sequence-builder.js` | ✅ 完了 |
| 16-3 | currentBlock / sequenceHealth 導出集約 | `modules/cue-sequence-builder.js` | ✅ 完了 |
| 16-4 | controller の rebuild 窓口薄化 | `cue-controller.js` | ✅ 完了 |
| 16-5 | controller 側の sequence build 詳細削除 | `cue-controller.js` | ✅ 完了 |
| 16-6 | builder 結果 orchestration への整理 | `cue-controller.js` | ✅ 完了 |
| 16-7 | 役割コメント・依存境界更新 | `cue-controller.js` | ✅ 完了 |

***

## 次に着手すること

1. Step 17-A として、`panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` の依存・export・DOM参照・cleanup 経路を棚卸しする。
2. panel DOM / render / block 導出 / visibility state の owner を定義し、`modules/` への統合順を決める。
3. `content.js` 側の panel 専用 state・host・render 呼び出しを列挙し、DI に残す参照と panel owner に移す参照を分離する。

***

## 今回やらないこと

- 7-17: トグル ON/OFF ログ相関強化の本実装。
- 7-16: トグル完全リセットの本実装。
- 7-19〜7-20: large seek 問題の本実装修正。
- panel UI / overlay UI / layout 調整。
- dead code / debug 整理のまとめ実装。
- lifecycle 網羅確認のまとめ実装。
- 長時間再生時メモリ増加観測の結論づけ。

情報源
