# Bugfix 実装シート 2026-08-22（作業台版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-22（要約版）  
**このシートの役割:** 今まさに着手している修正の対象・変更方針・実装順・検証観点・実機ログ観点を 1 枚に集約する。Step 7 の中核実装は完了済みのため、このシートは「Step 7 実装後の検証・残課題・次修正」を管理する作業台として使う。

***

## 今回の作業テーマ

### 主テーマ

**M-2: secondary 条件統合の実装後フォロー（Step 7-11 以降）**

secondary の selection、readability、monitor health、recovery、rebind 条件の正本を `subtitle-sync-controller.js` 側へ集約する作業は中核実装まで完了した。現在は、その decision ベース実装を前提に、wait-and-bind 停滞時の復帰、トグル観測、完全リセット、大きな seek 後の一時破綻を整理する段階に入っている。

### 副テーマ

- F-5: lifecycle ごとの secondary cleanup / mode restore の確認。
- F-8: decision 単位のログ整理と、トグル ON/OFF 相関ログの追加。
- M-1: 長時間再生時メモリ増加の継続観測。
- F-4: 初回 async response エラーの持ち越し調査。
- F-9: 拡張トグル時の完全リセット実装。 
- F-10: 大きな seek 後の track 参照消失と `secondary-track-unbind-skipped` の調査。

***

## 現在の症状

| # | 症状 | 観察事実 | 関連 ID | 状態 |
|---|---|---|---|---|
| 1 | メッセージチャネルクローズエラー（初回のみ） | `A listener indicated an asynchronous response...` はまだ残るが、UI 復旧自体は達成済み。  | F-4 | 🟠 持ち越し |
| 2 | ネイティブ字幕メニューに干渉せず OFF 後復元を成立させたい | secondary cleanup / mode restore は binder 側へ集約済み。ネイティブ UI を一度触るとトグル復帰率が上がる観察があり、トグル単独復帰はまだ未確認。  | F-5 | 🟠 検証継続 |
| 3 | DevConsole にログが残りやすい | noisy ログは一部 suppress 済みだが、トグル ON/OFF を一意に追えるログ相関は未整備。OFF 側は段階ログがあるが、ON 側は `restart begin` 中心で完了ログが弱い。  | F-8 | 🟠 継続整理中 |
| 4 | 長時間再生で Renderer メモリ使用量が大きく増える | cleanup 多重実行対策は入ったが、listener / observer / timer 蓄積は継続観測が必要。完全リセットは未実装。  | M-1 | 🟠 調査継続 |
| 5 | secondary の条件判断が複数モジュールに分散していた | `buildSecondarySyncDecision()` と `resolveSecondaryWaitOutcome()` を導入し、decision ベース統合は実装済み。現在は後続検証フェーズ。  | M-2 | ✅ 中核実装完了 |
| 6 | 大きな seek 後に一時的に字幕情報が失われる | `secondary-track-unbind-skipped` は monitorState にも boundTrack にも track 参照が無いときに出る。大きな seek 直後に `hadCleanup:false`, `hadTrack:false` が連続し、unbind対象自体が失われている可能性がある。  | F-10 | 🟠 新規調査 |
| 7 | トグルON/OFF操作がログに残り切らない | 実ログでは `extensionEnabled:false` やトグル単独操作の痕跡が不足し、2回連続で「未記録」になっている。  | F-9 | 🟠 観測基盤不足 |

***

## 今回の到達目標

### 完了済み項目

- `subtitle-sync-controller.js` に secondary decision の正本がある。
- `cue-controller.js` が `staleMonitor` / `shouldRebind` を自前で組み立てない構成へ寄った。
- action が `clear` / `keep` / `wait-and-bind` / `bind` の 4 種に整理された。
- 同一 track の一時 unreadable で即 rebind しない方針を維持している。
- bind / cleanup / mode restore は binder 側に留める方針を維持している。

### 今回の未完了目標

- wait-and-bind 停滞後の復帰が複数パターンで安定することを確認する。 
- トグル ON/OFF を一意に追えるログ相関 ID を入れる。
- トグル押下時に listener / timer / Map参照 / track binding を明示的に解放する完全リセットを実装する。 
- 大きな seek 後の `secondary-track-unbind-skipped` と track 参照消失の条件を切り分ける。
- トグル単独復帰、軽い seek 単独、track 不在 clear の実機確認を埋める。 

***

## 触るファイル

### 今回の主対象

- `modules/subtitle-sync-controller.js`
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

### 必要に応じて触る

- `modules/subtitle-recovery-manager.js`
- `modules/secondary-track-recovery.js`
- `content.js`  
  原則は配線専用を維持するが、実際には Step 7 実装で decision API の依存注入変更を入れているため、配線変更の範囲では対象になりうる。

***

## 実装方針

### 現在の構成

secondary の selection、readability、monitor health、recovery 要求、前回 bind 状態との差分は、`subtitle-sync-controller.js` の decision builder へ集約した。`cue-controller.js` はその結果を見て、bind / keep / clear / wait-and-bind を実行する構成へ寄せている。

### decision result 例

```js
{
  track,
  snapshot,

  selection: {
    sameTrackRef,
    requestedLanguageChanged,
  },

  monitor: {
    healthy,
    stale,
  },

  recovery: {
    requested,
    forceRebind,
    reason,
  },

  derived: {
    trackFound,
    readable,
    shouldClear,
    needsReadableWait,
    needsRebind,
    canKeepCurrentBinding,
  },

  action: {
    type: "clear" | "keep" | "wait-and-bind" | "bind",
    reason,
    requestedMode: "hidden",
  },
}
```

この構成自体は維持し、今後は `resolveSecondaryWaitOutcome()` による wait-and-bind 停滞後の再評価経路と、トグル時の完全リセット経路を補強する。

### action の意味

| action | 使用条件 | controller 側の処理 |
|---|---|---|
| `clear` | secondary track が存在しない | unbind、render clear、scene 再構築。  |
| `keep` | 同一 track かつ monitor 健全、recovery 要求なし | 現在の binding を維持。  |
| `wait-and-bind` | track はあるが readable 待ちが必要 | `waitForReadableTrack()` 後に bind。必要なら `resolveSecondaryWaitOutcome()` で再評価する。  |
| `bind` | track 変更、requested language 変更、monitor stale、force rebind など | binder 経由で bind / replace。  |

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

***

## 実装順（更新版）

1. `modules/subtitle-sync-controller.js` に `buildSecondarySyncDecision()` を追加する。 ✅
2. selection result と readability snapshot を decision builder の入力に寄せる。 ✅
3. monitor state を decision 入力へ渡せるようにする。 ✅
4. recovery manager の結果を decision 入力へ渡す。 ✅
5. `clear` / `keep` / `wait-and-bind` / `bind` の action を返す。 ✅
6. `cue-controller.js` の secondary sync を action switch ベースへ置き換える。 ✅
7. `staleMonitor` / `shouldRebind` / rationale 組み立てを controller から削る。 ✅
8. decision 単位のログを追加する。 ✅ 一次完了。トグル相関ログは未完。
9. wait-and-bind 停滞時に `resolveSecondaryWaitOutcome()` で再選択・再評価できるようにする。 ✅
10. 実機検証を行い、結果をこのシートへ追記する。 🟡 継続中。

***

## 実装時の制約

- 同一 track の一時 unreadable を `bind` の直接理由に戻さない。
- 一時的な空状態で recovery force rebind を返す挙動へ戻さない。
- listener attach / cleanup、mode apply / restore を controller 側へ戻さない。
- `content.js` に selection / recovery / cleanup 判定を増やさない。
- native 字幕 UI の状態を拡張側で直接書き換えない。
- トグル完全リセットは `window.gc()` のような強制 GC ではなく、参照断ち切りで実装する。 

***

## 検証チェックリスト

### 基本動作

- [x] primary / secondary 字幕が同時に表示される。 
- [x] secondary 言語を `ja → ko`、`ko → ja` と切り替えられる。session2〜4 では良好。 
- [ ] `ja → en` は今回未確認。 
- [x] 同一 track の一時 unreadable で unbind / bind が繰り返されない。`ja → ko` 1回目では wait-and-bind 4回後に正常収束し、unbind-skipped は出ていない。 
- [x] track 変更時だけ secondary bind が走る。decision ベースへ移行済み。
- [x] requested language 変更時に正しい track へ移る。 
- [x] monitor stale 時に必要な bind / replace が走る構造になっている。
- [x] recovery force rebind 時に必要な bind が走る構造になっている。
- [ ] track 不在時に secondary listener と表示が clear される実機確認は未完。コード確認は済み。 

### lifecycle

- [ ] short seek 後に字幕が復帰する。軽い seek 単独は未記録で、まだ分離確認できていない。 
- [x] hard seek 後に old listener / retry が残らない基盤は入っている。
- [x] SPA 遷移後に previous session の cleanup が多重実行されない基盤は入っている。
- [x] panel close / open 後も secondary monitor の前提は維持される。既知の主問題ではなくなっている。 
- [x] extension OFF 時に secondary listener が cleanup され、track mode が復元される経路はある。
- [ ] extension ON 復帰時に secondary 字幕が再表示されることはネイティブ UI 操作併用で一部確認済み。トグル単独は未確認。 
- [x] playback close / restart 時に cleanup が 1 回だけ実行される基盤は整っている。

### ログ

- [x] `subtitleSyncController.buildSecondarySyncDecision` の decision ログがある。
- [x] OFF 側には `ネイティブトグル OFF apply start / restore call before / restore call after / apply done` がある。
- [ ] ON 側の `restart done` 相当ログは未追加。
- [ ] `toggleOpId` のようなトグル相関 ID は未追加。 
- [ ] cleanup 前後で listener / timer / Map参照 解放件数を出すログは未追加。 

***

## 実機確認結果メモ（7-10 以降）

| ステップ | 対象ファイル | 実施内容 | 状態 |
|---|---|---|---|
| 7-10 | 実機確認 | secondary 言語変更を確認する。 | ❌ NG。言語変更後に wait-and-bind が継続し、字幕が復帰しない。  |
| 7-11 | `modules/subtitle-sync-controller.js` / `cue-controller.js` / `content.js` | wait-and-bind が readable 化しない場合の共通復帰経路を追加する。言語切替時と拡張 OFF→ON 復帰時の両方で、最新 track 状態から再選択・decision 再評価・必要時 bind へ進める。 | ✅ 完了。  |
| 7-12 | 実機確認 | 7-11 修正後、secondary 言語を複数回切り替えて復帰することを確認する。 | ✅ 部分確認済み。`ja → ko`、`ko → ja`、再度 `ja → ko` は session2〜4 で復帰確認。  |
| 7-13 | 実機確認 | 7-11 修正後、拡張 OFF→ON 復帰でも secondary 字幕が再表示されることを確認する。 | 🟡 一部確認。ネイティブ UI 操作併用で復帰。トグル単独復帰は未確認。  |
| 7-14 | 実機確認 | 7-11 修正後、軽い seek や通常再生で不要な bind / unbind が増えていないことを確認する。 | ⬜ 軽 seek 単独の分離確認は未実施。  |
| 7-15 | 実機確認 | track 不在時の clear を実機で再現可能なら確認する。再現できなければコード確認済みとして保留記録する。 | 🟡 実機保留・コード確認済み。  |
| 7-16 | `modules/cue-track-binder.js` / `modules/subtitle-state-reset.js` | 拡張ON/OFFトグル押下時に listener・timer・Map参照・track binding をすべて明示的に解放し、GCが確実に回収できる状態にする「完全リセット」処理を実装する。 | ⬜ 新規追加・未実施。  |
| 7-17 | `settings-runtime.js` | トグル操作を一意に追跡できるよう、OFF側の完了ログとON側の完了ログを対にし、`toggleOpId` で相関付ける。 | ⬜ 新規追加・未実施。  |
| 7-18 | `modules/playback-session-cleanup.js` | `detachForDisabled()` / `teardownForRestart()` の呼び出し前後に、完全リセットの実施範囲をログへ出力し、リセットが実際に効いたかを検証可能にする。 | ⬜ 7-16 実装後に着手。  |
| 7-19 | `cue-controller.js` | 大きな seek / スキップ直後に `primaryBoundTrack` が空になり字幕情報が一時消失する問題を調査する。 | ⬜ 新規追加・未実施。  |
| 7-20 | `cue-controller.js` / `modules/cue-track-binder.js` | 7-19 の原因調査を踏まえ、大きな seek 直後の再初期化で `hasCurrentBlock:false` を経由してから復帰する現状フローを見直す。 | ⬜ 7-19 調査後に着手。  |
| 7-21 | 実機確認 | 軽 seek 単独の影響を分離確認する。 | ⬜ 新規追加・未実施。  |
| 7-22 | 実機確認 + `settings-runtime.js` | 拡張 ON/OFF トグルの実操作をログに残す。7-17 実装後、トグル単独の実機確認をやり直す。 | ⬜ 7-17 実装後に実施。  |

***

## 次にやること

1. `settings-runtime.js` にトグル相関ログを追加する。最優先は `toggleOpId` と ON 側完了ログである。
2. `modules/subtitle-state-reset.js` / `modules/cue-track-binder.js` / `modules/playback-session-cleanup.js` を使って、トグル時の完全リセット API を実装する。
3. そのうえで、トグル単独復帰の実機確認を再実施する。 
4. 並行して、大きな seek 後の `secondary-track-unbind-skipped` と track 参照消失を調査する。
