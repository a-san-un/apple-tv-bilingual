# Bugfix マスタープラン 2026-08-24（要約版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-24 ／ **ブランチ:** `issue-32-content-core-split`  
**入口資料：** 新しいスレッドでもこの資料 1 枚を読めば、プロジェクトの目標・現在地・優先順位・次に着手する作業が分かる状態を保つ。  
**Step 15 更新:** `secondary-track-recovery` 系を `lane-recovery-state` へ改名する命名整理コミット `967b326` を反映済みである。

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
- **OFF 時に残すのは** 「ネイティブトグル・ポップアップ・設定ページ・設定保存」のみである。

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

### 継続課題

- `A listener indicated an asynchronous response...` は初回のみ残ることがあり、F-4 は持ち越しである。
- Chrome Renderer のメモリ使用量増大は継続観測中であり、listener / observer / timer 蓄積の有無を引き続き見たい。
- 拡張 ON/OFF トグル操作は、現状のログでは一意に追えない。OFF 側ログはあるが、ON 側は開始ログ中心で、トグル単独復帰の確認にはまだ弱い。
- 大きな seek 直後に `secondary-track-unbind-skipped` が出るケースがあり、unbind すべき track 参照自体が先に失われている可能性がある。
- `content.js` には popup 関連 state と UI shell が残っており、subtitle panel / blocks 管理もまだ残存しているため、配線専用化は未完了である。
- `cue-controller.js` には `rebuildCurrentSceneSubtitleBlocks()` と `cueSequenceBuilder.rebuildSequence()` の併存があり、cue sequence 構築責務の完全移譲は未完了である。
- full test 実行では `cue-track-binder`、`playback-session-cleanup`、`playback-startup-coordinator`、`panel-ui-toggle` に別スコープの失敗があり、Step 15 完了とは切り分けて後続ワークストリームで扱う必要がある。

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

**Step 16〜18: 薄化フェーズ**

- Step 16: `content.js` から dictionary popup の state / style / shell / event / render を既存構成へ統合・再配置する。
- Step 17: `content.js` から subtitle panel / blocks の管理責務を既存構成へ統合・再配置する。
- Step 18: `cue-controller.js` から cue sequence build 詳細を `cue-sequence-builder.js` へ完全移譲する。
- Step 15 の recovery state 命名整理は完了済みであり、以後は `lane-recovery-state.js` を正本名として扱う。

### 並行観測

- F-4: 初回 async response エラー。
- M-1: 長時間再生時の Renderer メモリ増加。

***

## 実装ステップ進捗

| Step | 状態 | 要約 |
| :-- | :-- | :-- |
| 1 | ✅ 完了 | `modules/subtitle-sync-controller.js` に `getTrackIdentity()` と `trackMatchesRequestedLanguage()` を追加し、track identity・言語一致判定の土台を共通化した。 |
| 2 | ✅ 完了 | `selectSubtitleTrack()` を抽出し、`selectSecondarySubtitleTrack()` を wrapper 化して secondary selection の共通コア化を行った。 |
| 3 | ✅ 完了 | `selectPrimarySubtitleTrack()` を追加し、primary / secondary が同じ selection API を使う構造に寄せた。 |
| 4 | ✅ 完了 | `syncTrackDirectly(role, ...)` を中核化し、primary / secondary wrapper を配置して direct bind 経路を共通化した。 |
| 5 | ✅ 完了 | `syncNativeSubtitleSelectionFallback()` を role-aware にし、primary も native UI fallback を共有する構造へ寄せた。 |
| 6 | ✅ 完了 | `pendingSyncTasks`、`cancelPendingSyncTask()`、`cancelAllPendingSyncTasks()` を追加し、古い polling / fallback task が残留しないようにした。 |
| 7 | ✅ 完了 | `waitForReadableTrack()` と direct sync task を連携し、role 再同期時に古い wait を止められるようにした。 |
| 8 | ✅ 完了 | `buildSecondarySyncDecision()` と `resolveSecondaryWaitOutcome()` の返却形式を整理し、`cue-controller.js` が同じ decision shape を扱えるようにした。 |
| 9 | ✅ 完了 | `content.js` に `subtitleSyncServices.roles.primary / secondary` adapter を構築し、bind 実装分岐を持たず DI に寄せた。 |
| 10 | ✅ 完了 | `resetSubtitleTrackBindings()` 冒頭で pending task を全キャンセルし、restart / reattach 後に timer や polling が残らないようにした。 |
| 11 | ✅ 完了 | bind / unbind / mode restore / `binding.cleanup()` へ listener cleanup の責務を集約した。 |
| 12 | ✅ 完了 | `tests/subtitle-sync-controller.test.js` に primary / secondary 共通 selection API、track identity、requested language 判定の退行防止テストを追加した。 |
| 13 | ✅ 完了 | `tests/subtitle-sync-controller.test.js` に pending task cancel の退行防止テストを追加した。 |
| 14 | ✅ 完了 | `tests/subtitle-sync-controller.test.js` に primary native fallback の成功・失敗・cancel テストを追加した。 |
| 15 | ✅ 完了 | `modules/lane-recovery-state.js` への改名、`createLaneRecoveryState` への factory 名統一、`root.createLaneRecoveryState` 参照への整理、`manifest.json`・`content.js`・`modules/subtitle-recovery-manager.js`・`tests/lane-recovery-state.test.js` の追従更新を実施した。 |
| 16 | 🟠 次に着手 | `content.js` から dictionary popup の state / style / shell / event / render を既存構成へ統合・再配置する。 |
| 17 | ⬜ 未着手 | `content.js` から subtitle panel / blocks の DOM 管理・block 描画・表示更新・周辺 helper を既存構成へ統合・再配置する。 |
| 18 | ⬜ 未着手 | `cue-controller.js` の `rebuildCurrentSceneSubtitleBlocks()` 周辺の sequence 構築ロジックを `modules/cue-sequence-builder.js` へ完全移譲する。 |

***

## Step 15 完了メモ

Step 15 は、recovery state モジュールの責務名を実態へ合わせるための命名整理フェーズとして完了した。

| Step | 内容 | 対象ファイル | 状態 |
| ----- | ---------------------------- | -------------------------------------------------------------------------- | ---- |
| 15-1  | ファイル名変更 | `modules/secondary-track-recovery.js` → `modules/lane-recovery-state.js` | ✅ 完了  |
| 15-2  | 生成関数名の変更 | `createSecondaryTrackRecovery` → `createLaneRecoveryState` | ✅ 完了  |
| 15-3  | root フラット参照への統一 | `root.createLaneRecoveryState` | ✅ 完了  |
| 15-4  | ファイル名・役割コメント更新 | `modules/lane-recovery-state.js` | ✅ 完了  |
| 15-5  | manifest のロードパス変更 | `manifest.json` | ✅ 完了  |
| 15-6  | factory 読み取り部の変更 | `content.js` | ✅ 完了  |
| 15-7  | recovery state インスタンス生成部の変更 | `content.js` | ✅ 完了  |
| 15-8  | recovery manager への DI 渡し部変更 | `content.js` | ✅ 完了  |
| 15-9  | DI 受け取り側と内部参照の変更 | `modules/subtitle-recovery-manager.js` | ✅ 完了  |
| 15-10 | recovery manager のコメント更新 | `modules/subtitle-recovery-manager.js` | ✅ 完了  |
| 15-11 | テストファイルのリネーム | `tests/secondary-track-recovery.test.js` → `tests/lane-recovery-state.test.js` | ✅ 完了  |
| 15-12 | テストの module 読み込みパス更新 | `tests/lane-recovery-state.test.js` | ✅ 完了  |
| 15-13 | テストの factory / root 識別子更新 | `tests/lane-recovery-state.test.js` | ✅ 完了  |
| 15-14 | describe 名の変更 | `describe("lane-recovery-state", ...)` | ✅ 完了  |
| 15-15 | 全体整合確認 | JavaScript / JSON を横断検索 | ✅ 完了  |

***

## 次フェーズの見方

次フェーズは、実質的に 2 段で捉えると整理しやすい。

- **薄化本体:** Step 16〜18。
- **後続ワークストリーム:** F-9、F-10、Step 8 / 9 / 10、M-1。

この順番なら、先に退行防止と命名整理で固めた土台の上に、`content.js` と `cue-controller.js` の大きな責務を安全に戻していける。

***

## 後続ワークストリーム

Step 15 完了時点の full test 実行で見えた failure は、lane recovery rename 自体の退行ではなく、別契約・別 fixture の整理課題として扱う。

| 後続ワークストリーム | 対象 | 優先度 |
| ----------------------- | ------------------------------------------------------------ | ----------- |
| binder API 契約確認 | `modules/cue-track-binder.js` / `tests/cue-track-binder.test.js` | 高  |
| cleanup fixture・契約確認 | `modules/playback-session-cleanup.js` / テスト | 高  |
| startup auto-start 条件確認 | `modules/playback-startup-coordinator.js` / テスト | 中  |
| panel UI テスト再設計 | `tests/panel-ui-toggle.test.js`、後続 Step 17 | Step 17 と同時  |

**補足**

- `cue-track-binder` の secondary 系は monitor 所有者と cleanup 所有者の契約確認が必要であり、テスト都合で controller 委譲へ戻す判断は避ける。
- `playback-session-cleanup` は cleanup payload / fixture / click listener 登録条件の契約を先に揃える。
- `playback-startup-coordinator` は `requestedContentSettings` と auto-start 条件の期待値を再確認する。
- `panel-ui-toggle` は Step 17 の panel 薄化と同時に、DOM fixture 前提も含めて再設計する。

***

## 設計方針メモ

字幕切り替えが不安定になる主因は、`TextTrack` 直接切り替えと native menu fallback の二重経路、および selection / readability / monitor / recovery / fallback の判断が複数モジュールへ分散していることにある。

今後は、secondary 固有の話としてではなく、**primary / secondary 両 lane を含む字幕同期・切り替え全体の設計問題** として扱う。

その正本資料は、旧 `Secondary 条件統合メモ` と `Secondary 統合後の責務再定義一覧` を統合した `字幕同期・切り替え条件統合と責務再設計メモ.md` とする。

また、recovery state についても secondary 専用名ではなく、両 lane を含む `lane-recovery-state.js` を正本名として扱う。

***

## 直近の推奨着手順

直近は、次の順で進めるのが安全である。

1. Step 16 として、`content.js` の popup 責務を棚卸しし、既存 `modules/dictionary-popup.js` に寄せる差し替え案を作る。
2. Step 17 として、`content.js` の panel / blocks 責務を棚卸しし、既存 `modules/subtitle-panel.js` に寄せる差し替え案を作る。
3. Step 18 として、`cue-controller.js` の sequence build 詳細を `modules/cue-sequence-builder.js` へ寄せる差し替え案を作る。
4. その後に、トグル ON/OFF 相関ログ、完全リセット、large seek、Step 8 / 9 / 10、長時間再生時メモリ観測の後続フェーズへ移る。

