# Bugfix 実装シート 2026-08-23（作業台版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-23（要約版）  
**このシートの役割:** 今まさに着手している修正の対象・変更方針・実装順・検証観点・実機ログ観点を 1 枚に集約する。Step 7 の中核実装は完了済みのため、このシートは「decision 統合後の検証・残課題・次修正」を管理する作業台として使う。

***

## 今回の作業テーマ

### 主テーマ

**M-3: 字幕同期 decision 統合後の退行防止・命名整理・薄化フェーズ**

`subtitle-sync-controller.js` を正本とした decision ベース統合の中核実装は完了した。現在はその次段階として、primary / secondary 共通ロジックの退行防止テスト追加、recovery state モジュールの命名整理、`content.js` と `cue-controller.js` に残っている大きな責務の切り出しを進める。

### 副テーマ

- F-5: lifecycle ごとの secondary cleanup / mode restore の確認。
- F-8: decision 単位のログ整理と、トグル ON/OFF 相関ログの追加。
- M-1: 長時間再生時メモリ増加の継続観測。
- F-4: 初回 async response エラーの持ち越し調査。
- F-9: 拡張トグル時の完全リセット実装。
- F-10: 大きな seek 後の track 参照消失と `secondary-track-unbind-skipped` の調査。
- F-11: selection / track identity / requested language 判定の共通テスト追加。
- F-12: pending sync task cancel の退行防止。
- F-13: primary native fallback の退行防止テスト追加。
- R-1: `secondary-track-recovery.js` の命名整理。
- S-1: `content.js` の dictionary popup 切り出し。
- S-2: `content.js` の subtitle panel / blocks 切り出し。
- S-3: `cue-controller.js` の cue sequence 構築責務の builder 完全移譲。

***

## 現在の症状

| # | 症状 | 観察事実 | 関連 ID | 状態 |
|---|---|---|---|---|
| 1 | メッセージチャネルクローズエラー（初回のみ） | `A listener indicated an asynchronous response...` はまだ残るが、UI 復旧自体は達成済み。 | F-4 | 🟠 持ち越し |
| 2 | ネイティブ字幕メニューに干渉せず OFF 後復元を成立させたい | secondary cleanup / mode restore は binder 側へ集約済み。ネイティブ UI を一度触るとトグル復帰率が上がる観察があり、トグル単独復帰はまだ未確認。 | F-5 | 🟠 検証継続 |
| 3 | DevConsole にログが残りやすい | noisy ログは一部 suppress 済みだが、トグル ON/OFF を一意に追えるログ相関は未整備。OFF 側は段階ログがあるが、ON 側は `restart begin` 中心で完了ログが弱い。 | F-8 | 🟠 継続整理中 |
| 4 | 長時間再生で Renderer メモリ使用量が大きく増える | cleanup 多重実行対策は入ったが、listener / observer / timer 蓄積は継続観測が必要。完全リセットは未実装。 | M-1 | 🟠 調査継続 |
| 5 | decision 統合の中核実装は終わっているが、退行防止が未整備 | `buildSecondarySyncDecision()` と `resolveSecondaryWaitOutcome()` による decision ベース統合は実装済みだが、selection 共通化・pending task cancel・primary native fallback の自動テストは未着手。 | M-3 | 🟠 次フェーズ |
| 6 | 大きな seek 後に一時的に字幕情報が失われる | `secondary-track-unbind-skipped` は monitorState にも boundTrack にも track 参照が無いときに出る。大きな seek 直後に `hadCleanup:false`, `hadTrack:false` が連続し、unbind 対象自体が失われている可能性がある。 | F-10 | 🟠 新規調査 |
| 7 | トグル ON/OFF 操作がログに残り切らない | 実ログでは `extensionEnabled:false` やトグル単独操作の痕跡が不足し、2回連続で「未記録」になっている。 | F-9 | 🟠 観測基盤不足 |
| 8 | `content.js` がまだ大きい | popup 関連 state と UI shell、subtitle panel / blocks 管理が `content.js` に残っている。 | S-1 / S-2 | ⬜ 未着手 |
| 9 | `cue-controller.js` に sequence 構築責務が残っている | `rebuildCurrentSceneSubtitleBlocks()` と `cueSequenceBuilder.rebuildSequence()` の併存があり、builder 完全移譲は未完了。 | S-3 | ⬜ 未着手 |
| 10 | recovery state モジュール名が実態とズレている | `secondary-track-recovery.js` は名前に反して primary / secondary 両 lane を持つ。 | R-1 | ⬜ 未着手 |

***

## 今回の到達目標

### 完了済み項目

- `subtitle-sync-controller.js` に secondary decision の正本がある。
- `cue-controller.js` が `staleMonitor` / `shouldRebind` を自前で組み立てない構成へ寄った。
- action が `clear` / `keep` / `wait-and-bind` / `bind` の 4 種に整理された。
- 同一 track の一時 unreadable で即 rebind しない方針を維持している。
- bind / cleanup / mode restore は binder 側に留める方針を維持している。
- selection 共通化、direct bind 共通化、native fallback role 共通化、pending sync task cancel、restart cleanup 一元化、listener cleanup の責務固定までは完了済みである。

### 今回の完了条件

- primary / secondary 共通 selection API の退行防止テストが揃っている。
- pending sync task cancel が再同期時に正しく効くことをテストで保証できる。
- primary native fallback の成功・失敗・cancel がテストで保証できる。
- recovery state モジュール名が primary / secondary 両 lane 前提の責務名に整理される。
- `content.js` から dictionary popup 実装詳細が切り出される。
- `content.js` から subtitle panel / blocks 管理が切り出される。
- `cue-controller.js` が cue sequence 構築詳細を持たず orchestration 中心になる。
- トグル ON/OFF を一意に追えるログ相関 ID が入り、トグル単独復帰確認の観測基盤が整う。
- トグル押下時に listener / timer / Map参照 / track binding を明示的に解放する完全リセットが実装される。
- 大きな seek 後の `secondary-track-unbind-skipped` と track 参照消失の条件を切り分けられる。

***

## 触るファイル

### 今回の主対象

- `tests/subtitle-sync-controller.test.js`
- `modules/secondary-track-recovery.js`
- `content.js`
- `cue-controller.js`

### 次の修正で触る対象

- `settings-runtime.js`  
  トグル ON/OFF の相関ログ追加、ON 側完了ログ追加。
- `modules/playback-session-cleanup.js`  
  完全リセット実行前後の cleanup 範囲確認、ログ補強。
- `modules/subtitle-state-reset.js`  
  runtime subtitle state の完全クリア API を強化。
- `modules/cue-track-binder.js`  
  listener / binding / originalMode 参照の完全解放を確認・補強。
- `modules/dictionary-popup.js`  
  新規切り出し先として popup state / style / shell / event / render を受け持たせる。
- `modules/subtitle-panel.js`  
  新規切り出し先として panel DOM 管理、block 描画、表示更新、周辺 helper を受け持たせる。
- `modules/cue-sequence-builder.js`  
  `cue-controller.js` から sequence 構築詳細を引き取る。

### 必要に応じて触る

- `modules/subtitle-sync-controller.js`
- `modules/subtitle-recovery-manager.js`
- `manifest.json`

***

## 実装方針

### 現在の構成

secondary の selection、readability、monitor health、recovery 要求、前回 bind 状態との差分は、`subtitle-sync-controller.js` の decision builder へ集約した。`cue-controller.js` はその結果を見て、bind / keep / clear / wait-and-bind を実行する構成へ寄せている。

一方で、次フェーズでは secondary 固有の整理に留めず、primary / secondary 共通ロジックのテスト固定、lane recovery 命名整理、`content.js` と `cue-controller.js` の薄化を並行で進める。

### decision result の扱い

現状の decision result は、selection、monitor、recovery、derived、action をまとめて扱う中核インターフェースとして維持する。

次フェーズでは、この decision shape 自体は崩さず、周辺のテスト、命名、責務分離を進める方針とする。

### action の意味

| action | 使用条件 | controller 側の処理 |
|---|---|---|
| `clear` | 対象 track が存在しない | unbind、render clear、scene 再構築。 |
| `keep` | 同一 track かつ monitor 健全、recovery 要求なし | 現在の binding を維持。 |
| `wait-and-bind` | track はあるが readable 待ちが必要 | `waitForReadableTrack()` 後に bind。必要なら再評価する。 |
| `bind` | track 変更、requested language 変更、monitor stale、force rebind など | binder 経由で bind / replace。 |

### 次フェーズの基本原則

- **テストを先に置く。** 退行防止なしで大きな切り出しに入らない。
- **命名は責務に合わせる。** `secondary-track-recovery.js` のような実態不一致を減らす。
- **`content.js` は配線専用へ寄せる。** popup と panel / blocks の実装詳細を直持ちしない。
- **`cue-controller.js` は orchestration に専念させる。** cue sequence 構築詳細は builder へ寄せる。

***

## controller から移したもの / 残したもの

### 移管済み

- `staleMonitor` の判定。
- `shouldRebind` の組み立て。
- bind rationale の分岐。
- unreadable track に対する warmup 判定。
- `waitForReadableTrack()` を呼ぶべきかの判定。
- recovery と selection / monitor を統合した最終 action 決定。

### controller に残すもの

- decision 呼び出し。
- action switch。
- bind / clear / render / scene rebuild の実行。
- 上位 orchestration とログ出力。
- ただし、`rebuildCurrentSceneSubtitleBlocks()` 周辺の cue sequence 構築詳細は今後 builder 側へ完全移譲する。

***

## 実装順（次フェーズ）

1. `tests/subtitle-sync-controller.test.js` に selection 共通化の退行防止テストを追加する。
2. `tests/subtitle-sync-controller.test.js` に pending task cancel の退行防止テストを追加する。
3. `tests/subtitle-sync-controller.test.js` に primary native fallback の成功・失敗・cancel テストを追加する。
4. `modules/secondary-track-recovery.js` と関連テスト・参照箇所の命名を見直す。
5. `content.js` から dictionary popup の state / style / shell / event / render を `modules/dictionary-popup.js` へ切り出す。
6. `content.js` から subtitle panel / subtitle blocks の DOM 管理と描画責務を `modules/subtitle-panel.js` へ切り出す。
7. `cue-controller.js` に残る `rebuildCurrentSceneSubtitleBlocks()` 周辺の cue sequence 構築詳細を `modules/cue-sequence-builder.js` へ完全移譲する。
8. `settings-runtime.js` にトグル ON/OFF 相関ログを追加する。
9. `modules/subtitle-state-reset.js` / `modules/cue-track-binder.js` / `modules/playback-session-cleanup.js` を中心に完全リセット経路を強化する。
10. 大きな seek 後の `secondary-track-unbind-skipped` と track 参照消失条件をログで切り分ける。

***

## 進捗表

| Step | 対象ファイル | 目的 | 主な作業 | 完了条件 | 状態 |
|---:|---|---|---|---|---|
| 1 | `modules/subtitle-sync-controller.js` | Selection 共通化の土台 | `getTrackIdentity()` と `trackMatchesRequestedLanguage()` を追加 | track identity・言語一致判定を controller 内で統一する | 完了  |
| 2 | `modules/subtitle-sync-controller.js` | Secondary selection の共通コア化 | `selectSubtitleTrack()` を抽出し、`selectSecondarySubtitleTrack()` を wrapper 化 | secondary の選択経路が共通 API を通る | 完了  |
| 3 | `modules/subtitle-sync-controller.js` | Primary selection の同一構造化 | `selectPrimarySubtitleTrack()` を追加 | primary / secondary が同じ selection API を使う | 完了  |
| 4 | `modules/subtitle-sync-controller.js` | Direct bind 経路の共通化 | `syncTrackDirectly(role, ...)` を中核化し、primary / secondary wrapper を配置 | role 差分が adapter と option に閉じる | 完了  |
| 5 | `modules/subtitle-sync-controller.js` | Native fallback の role 共通化 | `syncNativeSubtitleSelectionFallback()` を role-aware にする | primary も native UI fallback を共有する | 完了  |
| 6 | `modules/subtitle-sync-controller.js` | Pending task の中核追加 | `pendingSyncTasks`、`cancelPendingSyncTask()`、`cancelAllPendingSyncTasks()` を追加 | 古い polling / fallback task が残留しない | 完了  |
| 7 | `modules/subtitle-sync-controller.js` | Cancellable wait 化 | `waitForReadableTrack()` と direct sync task を連携 | role 再同期時に古い wait を止められる | 完了  |
| 8 | `modules/subtitle-sync-controller.js` | Decision shape の整理 | `buildSecondarySyncDecision()` と `resolveSecondaryWaitOutcome()` の返却形式を整理 | `cue-controller.js` が同じ decision shape を扱える | 完了  |
| 9 | `content.js` | DI 専用への縮小 | `subtitleSyncServices.roles.primary / secondary` adapter を構築 | `content.js` が bind 実装分岐を持たず、依存注入に寄る | 完了  |
| 10 | `content.js` | Restart cleanup の一元化 | `resetSubtitleTrackBindings()` 冒頭で pending task を全キャンセル | restart / reattach 後に timer や polling が残らない | 完了  |
| 11 | `cue-controller.js` と binder 周辺 | Listener cleanup の責務固定 | bind / unbind / mode restore / `binding.cleanup()` へ責務を集約 | listener cleanup の出口が分散しない | 完了  |
| 12 | `tests/subtitle-sync-controller.test.js` | Selection 共通化の退行防止 | primary / secondary の共通 selection API、track identity、言語一致判定のテストを追加 | role 差分で選択結果が壊れない | 未着手  |
| 13 | `tests/subtitle-sync-controller.test.js` | Pending task cancel の退行防止 | 再同期時に旧 task が cancel され、新 task だけが有効なことを検証 | 古い wait / fallback が後から状態更新しない | 未着手  |
| 14 | `tests/subtitle-sync-controller.test.js` | Primary native fallback の退行防止 | primary role の native fallback 成功・失敗・cancel をテスト | primary が secondary 専用実装へ戻らない | 未着手  |
| 15 | `modules/secondary-track-recovery.js` `tests/secondary-track-recovery.test.js` `manifest.json` | recovery state モジュールの命名整理 | ファイル名とコメントを実態に合わせて見直す | primary / secondary 両 lane を持つ責務名になる | 未着手  |
| 16 | `content.js` → `modules/dictionary-popup.js` | dictionary popup 機能の切り出し | popup state、style、HTML shell、イベント処理、表示更新を専用モジュールへ分離 | `content.js` が popup 実装詳細を持たず、初期化と依存注入に寄る | 未着手  |
| 17 | `content.js` → `modules/subtitle-panel.js` | subtitle panel / blocks 管理の切り出し | panel DOM 管理、block 描画、表示更新、周辺 helper を専用モジュールへ分離 | `content.js` が panel 描画ロジックを直持ちしない | 未着手  |
| 18 | `cue-controller.js` `modules/cue-sequence-builder.js` | cue sequence 構築の完全移譲 | `rebuildCurrentSceneSubtitleBlocks()` 内の sequence 構築ロジックを `cueSequenceBuilder.rebuildSequence()` 側へ寄せる | `cue-controller.js` が orchestration に専念し、sequence build 詳細を持たない | 未着手  |

***

## 検証観点

### 実機確認したい項目

- トグル単独で OFF → ON 復帰できるか。
- 軽い seek 単独で字幕同期が崩れないか。
- track 不在時に `clear` が過不足なく動くか。
- primary native fallback が secondary 専用実装へ逆戻りしていないか。
- pending task cancel 後に旧 wait / fallback が後追い更新しないか。
- dictionary popup 切り出し後に hover / click / close / positioning が崩れないか。
- subtitle panel 切り出し後に panel open / close、block 再描画、overlay 追従が崩れないか。
- cue sequence 構築完全移譲後に scene block 再構築が従来通り動くか。

### ログで確認したい項目

- ON/OFF 相関 ID 単位で `apply start / apply done / restart begin / restart done` が追えるか。
- large seek 直後の `hadCleanup` / `hadTrack` / boundTrack 状態がどう遷移するか。
- `wait-and-bind` 停滞後の再評価経路が想定通りに動くか。
- native fallback 実行の有無と成功・失敗理由が区別できるか。

