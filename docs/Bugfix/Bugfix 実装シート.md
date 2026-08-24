# Bugfix 実装シート 2026-08-24（作業台版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-24（要約版）  
**このシートの役割:** 今まさに着手している修正の対象・変更方針・実装順・検証観点・実機ログ観点を 1 枚に集約する。Step 7 中核、Step 12〜15 は完了済みのため、このシートは **Step 16 以降の薄化フェーズと後続ワークストリーム** を管理する作業台として使う。

***

## 今回の作業テーマ

### 主テーマ

**M-3: 字幕同期 decision 統合後の薄化フェーズ**

`subtitle-sync-controller.js` を正本とした decision ベース統合の中核実装と、退行防止テスト追加、recovery state 命名整理までは完了した。現在はその次段階として、`content.js` に残っている dictionary popup / subtitle panel / blocks の責務と、`cue-controller.js` に残っている cue sequence 構築責務を、既存モジュールへ寄せて薄くするフェーズである。

### 副テーマ

- F-5: lifecycle ごとの secondary cleanup / mode restore の確認。
- F-8: decision 単位のログ整理と、トグル ON/OFF 相関ログの追加。
- M-1: 長時間再生時メモリ増加の継続観測。
- F-4: 初回 async response エラーの持ち越し調査。
- F-9: 拡張トグル時の完全リセット実装。
- F-10: 大きな seek 後の track 参照消失と `secondary-track-unbind-skipped` の調査。
- S-1: `content.js` の dictionary popup 薄化。
- S-2: `content.js` の subtitle panel / blocks 薄化。
- S-3: `cue-controller.js` の cue sequence 構築責務の builder 完全移譲。

***

## 現在の症状

| # | 症状 | 観察事実 | 関連 ID | 状態 |
|---|---|---|---|---|
| 1 | メッセージチャネルクローズエラー（初回のみ） | `A listener indicated an asynchronous response...` はまだ残るが、UI 復旧自体は達成済み。 | F-4 | 🟠 持ち越し  |
| 2 | ネイティブ字幕メニューに干渉せず OFF 後復元を成立させたい | secondary cleanup / mode restore は binder 側へ集約済み。ネイティブ UI を一度触るとトグル復帰率が上がる観察があり、トグル単独復帰はまだ未確認。 | F-5 | 🟠 検証継続  |
| 3 | DevConsole にログが残りやすい | noisy ログは一部 suppress 済みだが、トグル ON/OFF を一意に追えるログ相関は未整備。OFF 側は段階ログがあるが、ON 側は `restart begin` 中心で完了ログが弱い。 | F-8 | 🟠 継続整理中  |
| 4 | 長時間再生で Renderer メモリ使用量が大きく増える | cleanup 多重実行対策は入ったが、listener / observer / timer 蓄積は継続観測が必要。完全リセットは未実装。 | M-1 | 🟠 調査継続  |
| 5 | 大きな seek 後に一時的に字幕情報が失われる | `secondary-track-unbind-skipped` は monitorState にも boundTrack にも track 参照が無いときに出る。大きな seek 直後に `hadCleanup:false`, `hadTrack:false` が連続し、unbind 対象自体が失われている可能性がある。 | F-10 | 🟠 新規調査  |
| 6 | トグル ON/OFF 操作がログに残り切らない | 実ログでは `extensionEnabled:false` やトグル単独操作の痕跡が不足し、観測基盤が弱い。 | F-9 | 🟠 観測基盤不足  |
| 7 | `content.js` がまだ大きい | popup 関連 state と UI shell、subtitle panel / blocks 管理が `content.js` に残っている。 | S-1 / S-2 | 🟠 次作業  |
| 8 | `cue-controller.js` に sequence 構築責務が残っている | `rebuildCurrentSceneSubtitleBlocks()` と `cueSequenceBuilder.rebuildSequence()` の併存があり、builder 完全移譲は未完了。 | S-3 | ⬜ 未着手  |
| 9 | recovery state モジュール名は整理済み | 旧 `secondary-track-recovery.js` は Step 15 で `lane-recovery-state` 系へ整理済みで、残るのは説明・参照の追従確認である。 | R-1 | ✅ 完了  |
| 10 | decision 統合の中核と退行防止は整った | Step 12〜14 の退行防止テスト追加まで完了しており、今は責務整理へ進む段階である。 | M-3 | ✅ 完了済み土台  |

***

## 今回の到達目標

### 完了済み項目

- `subtitle-sync-controller.js` に secondary decision の正本がある。
- `cue-controller.js` が `staleMonitor` / `shouldRebind` を自前で組み立てない構成へ寄った。
- action が `clear` / `keep` / `wait-and-bind` / `bind` の 4 種に整理された。
- 同一 track の一時 unreadable で即 rebind しない方針を維持している。
- bind / cleanup / mode restore は binder 側に留める方針を維持している。
- selection 共通化、direct bind 共通化、native fallback role 共通化、pending sync task cancel、restart cleanup 一元化、listener cleanup の責務固定までは完了済みである。
- Step 12〜14 の退行防止テスト追加は完了済みである。
- Step 15 の recovery state 命名整理は完了済みである。

### 今回の完了条件

- `content.js` から dictionary popup 実装詳細を切り出す、または既存 `modules/dictionary-popup.js` へ統合する具体案が固まっている。
- `content.js` から subtitle panel / blocks 管理を切り出す、または既存 `modules/subtitle-panel.js` へ統合する具体案が固まっている。
- `cue-controller.js` が cue sequence 構築詳細を持たず orchestration 中心になる具体案が固まっている。
- 新規モジュール追加ではなく、既存ファイル統合で済む責務が先に整理されている。
- `content.js` と `cue-controller.js` の行数・責務が増えず、減る方向で差し替え案が出せる状態になっている。

***

## 今回やらないこと

- 多重 session-start のデバウンス・直列化の恒久対応。
- トグル完全リセットのまとめ実装。
- large seek 問題のまとめ実装。
- panel UI / overlay UI / layout 調整。
- Step 8（`content.js` 配線専用化の総点検）を今回まとめて完了させること。
- Step 9（dead code / debug 整理）を今回まとめて完了させること。
- Step 10（lifecycle 網羅確認）を今回まとめて完了させること。
- 長時間再生時のメモリ増加観測を今回まとめて結論づけること。

***

## 触るファイル

### 今回の主対象

- `content.js`
- `cue-controller.js`
- `modules/dictionary-popup.js`
- `modules/subtitle-panel.js`
- `modules/cue-sequence-builder.js`

### 整合確認対象

- `modules/subtitle-sync-controller.js`
- `modules/lane-recovery-state.js`
- `modules/subtitle-recovery-manager.js`
- `modules/cue-track-binder.js`
- `modules/playback-session-cleanup.js`
- `manifest.json`

### 後続ワークストリームで触る対象

- `settings-runtime.js` — トグル ON/OFF の相関ログ追加、ON 側完了ログ追加。
- `modules/playback-session-cleanup.js` — 完全リセット実行前後の cleanup 範囲確認、ログ補強。
- `modules/subtitle-state-reset.js` — runtime subtitle state の完全クリア API 強化。
- `modules/cue-track-binder.js` — listener / binding / originalMode 参照の完全解放確認・補強。

***

## 実装方針

### 現在の構成

secondary の selection、readability、monitor health、recovery 要求、前回 bind 状態との差分は、`subtitle-sync-controller.js` の decision builder へ集約した。`cue-controller.js` はその結果を見て、bind / keep / clear / wait-and-bind を実行する構成へ寄せている。

一方で、次フェーズでは secondary 固有の整理に留めず、`content.js` に残っている popup / panel / blocks の UI 実装詳細と、`cue-controller.js` に残っている sequence build 詳細を、既存モジュールへ戻して責務境界を明確にする。

### 判断基準

- **メモリーリーク対策として妥当か** を最優先にする。
- `content.js` は配線専用、`cue-controller.js` は orchestration 専用を維持する。
- popup の実処理は `modules/dictionary-popup.js` 側へ、panel / blocks の実処理は `modules/subtitle-panel.js` 側へ、cue sequence 構築詳細は `modules/cue-sequence-builder.js` 側へ寄せる。
- **新規モジュール追加は最後の手段** とし、まず既存ファイルへの統合・改名で解決できるかを確認する。
- listener attach / cleanup、track mode apply / restore の責務を controller 側へ戻さない。
- sameTrackUnreadable を再び bind 理由へ戻さない。
- 一時的な空 cue 状態だけで recovery が force rebind する挙動へ戻さない。

### Step 16: dictionary popup 薄化方針

`content.js` に残っている popup の state / style / shell / event / render は、まず既存 `modules/dictionary-popup.js` へ統合できるかを優先して評価する。

寄せたい責務:

- popup host 作成。
- shell HTML / style 生成。
- outside click / tab / word link / resize observer。
- display state reset / open / position / reposition。
- dictionary / translation の非同期反映。

`content.js` に残すのは、popup API の DI、起動配線、cleanup 時の dispose 呼び出し程度に留める。

### Step 17: subtitle panel / blocks 薄化方針

subtitle panel / blocks も、まず既存 `modules/subtitle-panel.js` への統合を優先する。

寄せたい責務:

- panel host/root 生成と DOM 更新。
- block sequence の正本保持。
- current block 更新。
- panel open 時の block rebuild 入口。
- trim / normalize / render。

`content.js` に残すのは、panel API の初期化、visibility 設定配線、sequence 更新依頼の受け渡しに留める。

### Step 18: cue sequence build 完全移譲方針

`cue-controller.js` は orchestration 専用とし、sequence build 詳細は `modules/cue-sequence-builder.js` へさらに集約する。

寄せたい責務:

- cue 抽出。
- 並び替え。
- trim / current scene block rebuild。
- sequence 再構築の正本 API。

`cue-controller.js` に残すのは、いつ rebuild するかの判断と、builder から返った結果を panel 側へ流す処理だけにする。

***

## 実装ステップ

| Step | 内容 | 目的 | 状態 |
|---|---|---|---|
| 12 | `subtitle-sync-controller.test.js` に primary / secondary 共通 selection API、track identity、requested language 判定の退行防止テストを追加する | 共通 selection コア固定 | ✅ 完了  |
| 13 | `subtitle-sync-controller.test.js` に pending sync task cancel の退行防止テストを追加する | 古い async 結果の無効化固定 | ✅ 完了  |
| 14 | `subtitle-sync-controller.test.js` に primary native fallback の成功・失敗・cancel テストを追加する | fallback 共通経路固定 | ✅ 完了  |
| 15 | `secondary-track-recovery` 系を `lane-recovery-state` へ命名整理する | 実態と責務名を一致させる | ✅ 完了  |
| 16 | `content.js` から dictionary popup の state / style / shell / event / render を既存構成へ統合・再配置する | `content.js` 薄化 | 🟠 次に着手  |
| 17 | `content.js` から subtitle panel / blocks の管理責務を既存構成へ統合・再配置する | `content.js` 薄化 | ⬜ 未着手  |
| 18 | `cue-controller.js` から cue sequence build 詳細を `cue-sequence-builder.js` へ完全移譲する | `cue-controller.js` 薄化 | ⬜ 未着手  |

***

## 確認結果メモ

### Step 12〜15 の扱い

- Step 12〜14 の退行防止テストは完了済みとして扱う。
- Step 15 の recovery state 命名整理は完了済みとして扱う。
- 今後の docs / 差し替え案 / 会話内説明では、旧 `secondary-track-recovery.js` ではなく `lane-recovery-state` 系を正本名として記述する。

### 次にやること

**次にやることは Step 16 の dictionary popup 薄化である。** `content.js` から popup 関連の詳細責務を外し、既存 `modules/dictionary-popup.js` を統合先として具体案を作るところから始める。

### 新規ファイル追加の扱い

今回の薄化では、**新規モジュール追加を目的化しない**。
まず既存 `modules/dictionary-popup.js`、`modules/subtitle-panel.js`、`modules/cue-sequence-builder.js` に統合できる責務を優先し、それで責務境界が明確になるなら新規ファイルは増やさない。

### メモリーリーク対策との関係

今回の対象は UI の見た目調整ではなく、**参照の正本と cleanup 経路を明確にする構造整理** である。
`content.js` や `cue-controller.js` に詳細 state・listener・observer・sequence 配列保持が残るほど、破棄漏れや責務誤認が起きやすく、長時間再生時のメモリ増加原因の切り分けが難しくなる。

***

## 後続で扱う論点

### 今回の Step 16〜18 に含めないもの

- トグル完全リセットの実装修正そのもの。
- large seek 問題の実装修正そのもの。
- Step 8（`content.js` 配線専用化の総点検）。
- Step 9（dead code / debug 整理）。
- Step 10（lifecycle 網羅確認）。
- 長時間再生時のメモリ増加観測の総括。

### 後続ワークストリーム

| ワークストリーム | 対象 | メモ |
|---|---|---|
| F-9 | トグル ON/OFF 相関ログ、完全リセット | 観測基盤と解放実装は別フェーズで扱う  |
| F-10 | large seek / `secondary-track-unbind-skipped` | track 参照消失条件の切り分けを優先  |
| Step 8 | `content.js` 配線専用化の総点検 | Step 16–17 完了後に全体見直し  |
| Step 9 | dead code / debug 整理 | 置換後の不要分岐・不要ログ整理  |
| Step 10 | lifecycle 網羅確認 | cleanup 経路が落ち着いてから実施  |
| M-1 | 長時間再生時メモリ増加観測 | 構造改善後に再観測  |

***

## 直近の進め方

1. `content.js` の popup 責務を棚卸しし、既存 `modules/dictionary-popup.js` に寄せる差し替え案を作る。
2. `content.js` の panel / blocks 責務を棚卸しし、既存 `modules/subtitle-panel.js` に寄せる差し替え案を作る。
3. `cue-controller.js` の sequence build 詳細を `modules/cue-sequence-builder.js` へ寄せる差し替え案を作る。
4. Step 16〜18 の差し替え後に、Step 8 / 9 / 10 と F-9 / F-10 の後続フェーズへ移る。

この順なら、すでに固めた decision 統合と退行防止テストを土台にしつつ、`content.js` / `cue-controller.js` を安全に薄くしていける。

