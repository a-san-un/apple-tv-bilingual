# Bugfix 実装シート 2026-08-24（作業台版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-24（要約版）  
**このシートの役割:** 今まさに着手している修正の対象・変更方針・実装順・検証観点・実機ログ観点を 1 枚に集約する。Step 7 中核、Step 12〜15 は完了済みのため、このシートは **Step 16 以降の薄化フェーズと後続ワークストリーム** を管理する作業台として使う。

***

## 今回の作業テーマ

### 主テーマ

**M-3: 字幕同期 decision 統合後の薄化フェーズ**

`subtitle-sync-controller.js` を正本とした decision ベース統合の中核実装と、退行防止テスト追加、recovery state 命名整理までは完了した。現在はその次段階として、`cue-controller.js` に残っている cue sequence 構築責務を `modules/cue-sequence-builder.js` へ戻し、root 直下に残る panel 系既存ファイルを `modules/` へ統合しつつ、`content.js` に残っている term inspector / subtitle panel / blocks の責務を外して薄くするフェーズである。

### 副テーマ

- F-5: lifecycle ごとの secondary cleanup / mode restore の確認。
- F-8: decision 単位のログ整理と、トグル ON/OFF 相関ログの追加。
- M-1: 長時間再生時メモリ増加の継続観測。
- F-4: 初回 async response エラーの持ち越し調査。
- F-9: 拡張トグル時の完全リセット実装。
- F-10: 大きな seek 後の track 参照消失と `secondary-track-unbind-skipped` の調査。
- S-1: `cue-controller.js` の cue sequence 構築責務の builder 完全移譲。
- S-2: panel 系既存ファイルの `modules/` 統合と `content.js` の panel / blocks 薄化。
- S-3: `content.js` の term inspector 薄化。

***

## 現在の症状

| # | 症状 | 観察事実 | 関連 ID | 状態 |
|---|---|---|---|---|
| 1 | メッセージチャネルクローズエラー（初回のみ） | `A listener indicated an asynchronous response...` はまだ残るが、UI 復旧自体は達成済み。 | F-4 | 🟠 持ち越し |
| 2 | ネイティブ字幕メニューに干渉せず OFF 後復元を成立させたい | secondary cleanup / mode restore は binder 側へ集約済み。ネイティブ UI を一度触るとトグル復帰率が上がる観察があり、トグル単独復帰はまだ未確認。 | F-5 | 🟠 検証継続 |
| 3 | DevConsole にログが残りやすい | noisy ログは一部 suppress 済みだが、トグル ON/OFF を一意に追えるログ相関は未整備。OFF 側は段階ログがあるが、ON 側は `restart begin` 中心で完了ログが弱い。 | F-8 | 🟠 継続整理中 |
| 4 | 長時間再生で Renderer メモリ使用量が大きく増える | cleanup 多重実行対策は入ったが、listener / observer / timer 蓄積は継続観測が必要。完全リセットは未実装。 | M-1 | 🟠 調査継続 |
| 5 | 大きな seek 後に一時的に字幕情報が失われる | `secondary-track-unbind-skipped` は monitorState にも boundTrack にも track 参照が無いときに出る。大きな seek 直後に `hadCleanup:false`, `hadTrack:false` が連続し、unbind 対象自体が失われている可能性がある。 | F-10 | 🟠 新規調査 |
| 6 | トグル ON/OFF 操作がログに残り切らない | 実ログでは `extensionEnabled:false` やトグル単独操作の痕跡が不足し、観測基盤が弱い。 | F-9 | 🟠 観測基盤不足 |
| 7 | `content.js` がまだ大きい | term inspector（旧 dictionary popup / subtitle popup）関連 state と UI shell、subtitle panel / blocks 管理が `content.js` に残っている。 | S-2 / S-3 | 🟠 次作業 |
| 8 | panel 系の owner 境界がまだ曖昧 | `panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` が root 直下に残り、`modules/` への統合が未完了である。 | S-2 | 🟠 次作業 |
| 9 | `cue-controller.js` に sequence 構築責務が残っている | `rebuildCurrentSceneSubtitleBlocks()` と `cueSequenceBuilder.rebuildSequence()` の併存があり、builder 完全移譲は未完了。 | S-1 | 🟠 次作業 |
| 10 | recovery state モジュール名は整理済み | 旧 `secondary-track-recovery.js` は Step 15 で `lane-recovery-state` 系へ整理済みで、残るのは説明・参照の追従確認である。 | R-1 | ✅ 完了 |
| 11 | decision 統合の中核と退行防止は整った | Step 12〜14 の退行防止テスト追加まで完了しており、今は責務整理へ進む段階である。 | M-3 | ✅ 完了済み土台 |

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

- `cue-controller.js` から cue sequence 構築詳細を外し、`modules/cue-sequence-builder.js` を正本とする具体案が固まっている。
- root 直下の panel 系既存ファイルを `modules/` へ統合し、`content.js` から subtitle panel / blocks 管理を外す具体案が固まっている。
- `content.js` から term inspector の state / style / shell / event / render を切り出す具体案が固まっている。
- 新規モジュール追加ではなく、既存ファイル統合で済む責務が先に整理されている。
- `content.js` と `cue-controller.js` の行数・責務が増えず、減る方向で差し替え案が出せる状態になっている。
- `lane-recovery-state`、selection 共通化、decision 統合、pending sync task cancel、listener cleanup 責務固定を壊さない移行順が整理されている。

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

- `cue-controller.js`
- `modules/cue-sequence-builder.js`
- `content.js`
- `panel-ui.js`
- `panel-renderer.js`
- `subtitle-blocks.js`
- `subtitle-block-resolver.js`
- `modules/panel-visibility-state.js`
- `manifest.json`

### 今回の新規追加候補

- `modules/term-inspector.js`

### 整合確認対象

- `modules/subtitle-sync-controller.js`
- `modules/lane-recovery-state.js`
- `modules/subtitle-recovery-manager.js`
- `modules/cue-track-binder.js`
- `modules/playback-session-cleanup.js`

### 後続ワークストリームで触る対象

- `settings-runtime.js` — トグル ON/OFF の相関ログ追加、ON 側完了ログ追加。
- `modules/playback-session-cleanup.js` — 完全リセット実行前後の cleanup 範囲確認、ログ補強。
- `modules/subtitle-state-reset.js` — runtime subtitle state の完全クリア API 強化。
- `modules/cue-track-binder.js` — listener / binding / originalMode 参照の完全解放確認・補強。

***

## 実装方針

### 現在の構成

- `subtitle-sync-controller.js` は secondary decision と wait 復帰経路の正本であり、selection 共通化・decision shape・pending sync task cancel まで完了済みである。
- `cue-controller.js` は orchestration を担当するが、現時点では `rebuildCurrentSceneSubtitleBlocks()` に sequence / block 構築詳細が残っている。
- `content.js` は DI / 起動配線へ寄せつつあるが、term inspector、subtitle panel、subtitle blocks の state / shell / render 管理がまだ残っている。
- panel 関連は `panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` に分散して root 直下にある。
- recovery state 名称は `lane-recovery-state` を正本とする。
- bind / cleanup / mode restore の責務は controller 側へ戻さず binder / cleanup 側に維持する。

### 今回の責務再配置方針

#### S-1: cue sequence build の builder 完全移譲

- `cue-controller.js` は action orchestration にとどめる。
- `rebuildCurrentSceneSubtitleBlocks()` に残っている cue 配列走査、scene block 再構築、current / previous block 選定、snapshot 生成などの詳細は `modules/cue-sequence-builder.js` に寄せる。
- `cue-controller.js` には「いつ再構築するか」「builder に何を渡すか」「結果を panel / overlay 側へどう流すか」だけを残す。
- stale 判定や sequence shape の知識を controller 側へ戻さない。

#### S-2: panel 系既存ファイルの `modules/` 統合

- `panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` は単なるファイル移動ではなく、panel owner の責務境界を整理したうえで `modules/` 配下へ統合する。
- `panel-visibility-state.js` は panel 開閉 state の正本として維持し、開閉 state と panel DOM / render を再び混ぜない。
- `content.js` から panel host / render snapshot / subtitle block 派生 state を外し、panel owner へ寄せる。
- `content.js` には panel へ渡す raw input と DI だけを残す。

#### S-3: term inspector の切り出し

- `content.js` に残っている term inspector（旧 dictionary popup / subtitle popup）関連の state / style / shell / event / render を owner ごと切り出す。
- term inspector が保持する listener、observer、DOM 参照は term inspector 側で作成・破棄できる契約にする。
- 新規ファイル追加は最後の手段とし、既存統合で済まない責務だけを `modules/term-inspector.js` へ出す。
- `content.js` には term inspector の生成・破棄・DI だけを残す。

### メモリーリーク対策としての判断基準

- listener / observer / timer / DOM 参照 / track 参照を「誰が所有しているか」を 1 箇所に寄せる。
- restart / cleanup / OFF 時に、owner 単位で dispose できる構造を優先する。
- `window.gc()` のような強制回収前提ではなく、参照を明示的に切れる設計を優先する。
- state の正本を重複させず、panel / term inspector / sequence build の責務を controller / content へ戻さない。

***

## 実装順

1. `modules/cue-sequence-builder.js` の返り値と API を見直し、scene block / snapshot 生成を builder 正本へ寄せる。
2. `cue-controller.js` の `rebuildCurrentSceneSubtitleBlocks()` を builder 呼び出し中心へ寄せ、sequence 構築詳細を削る。
3. panel 系既存ファイルの責務境界を整理し、`modules/` 配下へ統合する構成案を固める。
4. `content.js` から panel / blocks 派生 state と render 詳細を外す。
5. term inspector の owner 境界を整理し、必要最小限で `modules/term-inspector.js` へ切り出す。
6. `content.js` から term inspector の state / shell / render / event 管理を外す。
7. `manifest.json` の読み込み順と参照パスを更新する。
8. 後続でトグル ON/OFF 相関ログ、完全リセット、large seek 調査へ進む。

### 移行順の注意

- selection 共通化、decision 統合、pending sync task cancel、listener cleanup 責務固定を壊さないことを優先する。
- `lane-recovery-state` の命名を旧 `secondary-track-recovery` 前提へ戻さない。
- bind / cleanup / mode restore の責務を controller 側へ戻さない。
- `sameTrackUnreadable` を bind 理由へ戻さない。
- 一時的な空 cue 状態だけで recovery が force rebind する挙動へ戻さない。
- sequence build、panel、term inspector の旧新ロジックを長く併存させない。

***

## 検証観点

### 薄化フェーズの確認

- `cue-controller.js` が sequence build 詳細を持たず、builder 呼び出し中心になっている。
- `content.js` が panel / term inspector の詳細実装を持たず、DI と起動配線中心になっている。
- panel 系ファイルが `modules/` に統合され、owner ごとの責務が追いやすい。
- term inspector の listener / observer / DOM 参照が owner 単位で破棄できる。

### 退行防止の確認

- primary / secondary selection API 共通化が壊れていない。
- `buildSecondarySyncDecision()` と `resolveSecondaryWaitOutcome()` の責務が変わっていない。
- direct bind / native fallback role 共通化が壊れていない。
- binder 側の cleanup / mode restore 責務が controller へ逆流していない。
- `lane-recovery-state` 名称の追従が維持されている。

### 実機で見るログ

- `restart begin` / `restart done`
- `extensionEnabled:false`
- OFF 時の restore before / restore after / apply done
- large seek 直後の `secondary-track-unbind-skipped`
- `hadCleanup` / `hadTrack`
- panel / term inspector dispose の発火有無

***

## 後続ワークストリーム

### F-8 / F-9: トグル ON/OFF 相関ログと完全リセット

- `settings-runtime.js` に相関 ID を入れ、OFF と ON の一連ログを同一操作単位で追えるようにする。
- 完全リセットでは `modules/subtitle-state-reset.js` と `modules/cue-track-binder.js` を中心に、listener / timer / Map参照 / originalMode / track binding を明示解除する。

### F-10: large seek 問題

- `secondary-track-unbind-skipped` が出る直前の state を追跡し、monitorState と boundTrack のどちらで参照が消えているかを切り分ける。
- `dispose` / `unbind` / `rebind` 順序と cleanup 競合を確認する。

### M-1: メモリ観測

- Step 16〜18 後に、長時間再生で listener / observer / timer / DOM 参照の残留が減っているかを観測する。
- メモリ観測は今回の薄化フェーズ完了条件には含めず、後続検証として扱う。

***

## メモ

- `dictionary popup` / `subtitle popup` という旧称は以後 `term inspector` へ寄せる。
- panel 系は新規 `subtitle-panel.js` を安易に増やすより、既存 root ファイルの `modules/` 統合を優先する。
- `cue-controller.js` と `content.js` は薄く保つ。詳細ロジックを戻さない。
- 今回は docs と責務再配置の整理を主眼とし、7-17 / 7-16 / 7-19〜7-20 の本実装は同時にやらない。
