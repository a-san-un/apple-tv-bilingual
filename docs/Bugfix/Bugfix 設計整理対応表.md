# Bugfix 設計整理対応表 2026-09-01

**目的:**  
再構築の入口を `modules/playback-startup-coordinator.js` に一本化し、終了処理を `modules/playback-session-cleanup.js` に一本化するために、各ファイルで「残す責務」「移す責務」「削除対象関数」「置換先 API」「確認ログ」を明確化する。

**設計原則:**  
目指す形は **1 playback target = 1 playback session = 1 owner** であり、settings 変更・SPA 遷移・track invalidation・restart 要求のどれから入っても、最終的に同じ rebuild 経路へ流すことにある。  
一方で、UI 再マウントは単独で session rebuild 理由にはせず、session / target / track 条件の変化を伴う場合だけ rebuild 判定へ接続する。

**進捗要約:**  
起動入口の一本化は完了している。`settings-runtime.js` にあった tracks readiness 待ち、`addtrack` 監視、直接 `startBilingual(...)`、`restartBilingual(...)` の実 start 経路は coordinator 側へ集約済みである。  
cleanup owner 側は、`modules/playback-session-cleanup.js` を session teardown の唯一入口として説明・API の両面で整理し、`content.js` の主要 direct cleanup callsite も owner API 経由へ置換済みである。  
さらに `reinitialize-coordinator.js` に残っていた `clearInternalSubtitleState(...)` の直呼びも cleanup owner API 経由へ置換済みであり、cleanup owner 一本化は残差整理の後半に入っている。  
現在の主対象は、`content.js` に残る helper / DI の最終縮退、起動多重発火の観測強化、70/30 レイアウト時のネイティブ UI 幅追従の原因調査、および未設定時ノーティス限定化である。

***

## 基本フロー

### rebuild / 再評価の正式入口

以下のイベントだけを、再評価または rebuild の正式入口とする。

- `settings-runtime.js` による設定変更、`extensionEnabled` / 言語設定 / 表示設定の反映要求
- `modules/playback-startup-coordinator.js` が検知する playback target change、動画要素差し替え、SPA 遷移後の新 video 検出
- 再生中 video の `textTracks` 再生成、既存 track 無効化、secondary track 消失などの track invalidation
- `reinitialize-coordinator.js` が扱う restart 要求、reason 付き再初期化要求
- cleanup 完了後に再 attach が必要と判定された場合

以下は**単独では** rebuild の正式入口にしない。

- panel の再描画
- debug panel の再生成
- overlay の見た目だけの再配置
- UI host の再マウントだけを理由にした start / teardown 要求

### 入口ごとの扱い

すべてのイベントを即 teardown へ流すのではなく、まず「再評価で足りるか」「rebuild が必要か」を判定する。

- 設定変更: 現 session にそのまま適用できるなら再評価だけ、session 再構築が必要なら rebuild 要求
- playback target change: 原則 rebuild 候補。旧 session を新 target に持ち越さない
- track invalidation: track 再解決または recovery で回復できるかを判定し、必要なら rebuild 要求
- restart 要求: reason を正規化した上で rebuild 要求へ流す
- UI 再生成要求: 単独では start / teardown owner にならず、必要なら coordinator 判定へ委譲する

### 正式フロー

1. 設定変更、playback target change、track invalidation、restart 要求のいずれかが発生する
2. 判定層が、そのイベントを `re-evaluate` / `rebuild` / `ignore` のいずれかに分類する
3. `playback-startup-coordinator` が current target、readiness、進行中 start の有無を確認する
4. rebuild が必要な場合だけ `playback-session-cleanup` が current session を teardown する
5. teardown 完了後、`playback-startup-coordinator` が新 target に attach する
6. readiness が満たされた時点で `startBilingual(...)` を 1 回だけ起動する
7. start 完了後、新 session の owner、listener、panel、debug runtime を新 session にひも付ける

### このフローで禁止すること

- `settings-runtime.js` が独自に readiness を待って直接 `startBilingual(...)` すること
- `settings-runtime.js` の `addtrack` listener や timeout / polling がその場で start owner になること
- `reinitialize-coordinator.js` が実 cleanup を実行してそのまま再構築まで行うこと
- `content.js` が手動で panel だけ dispose して session cleanup を代替すること
- `content.js` が cleanup owner を通さずに外向き API として subtitle state clear を提供すること
- UI 再マウントを session rebuild と同義に扱うこと

この流れ以外の start / rebuild / teardown 経路は、段階的に削除対象とする。

***

## 対応表

| ファイル | 残す責務 | 移す責務 | 削除対象関数・経路 | 置換先 API / 呼び出し先 | 進捗 | 確認ログ |
|---|---|---|---|---|---|---|
| `modules/playback-startup-coordinator.js` | playback target change 検知、readiness 待ち、delayed retry、起動要求の一本化 | `settings-runtime.js` 側に残る tracks readiness 待ち、start 補助用 `addtrack` / poll / timeout | coordinator 以外からの個別 start 入口 | `attachAndMaybeStart(video, reason, options)` | **完了**。起動 owner の受け皿として運用する | `playback target changed`、`cleanup skipped`、readiness wait、retry、start attempt |
| `content.js` 内 `startBilingual(...)` 本体 | session 実構築、tracks 解決、listener 接続、secondary DOM 構築、panel 初期化 | readiness 判定、再起動判断、target change 監視 | 外側の rebuild 判断を抱え込む構造 | `startBilingual(options)` を build 専用に縮退 | **一部完了**。主要 direct cleanup は owner 経由へ置換済み。helper / DI の最終縮退が残る | start begin、track resolved、listener attached、panel mounted |
| `modules/playback-session-cleanup.js` | session teardown、dispose 入口、panel / debug / subtitle state / observer の cleanup 集約 | `reinitialize-coordinator.js` の実 cleanup、散在した timer / listener / observer / DOM 解放 | session 外からの部分 teardown、各所の個別 cleanup 主導 | `detachForDisabled(...)`、`prepareForRestart(...)`、`teardownForRestart(...)`、`resetForContentSwitch(...)`、`clearPlaybackSessionUiState(...)` | **一部完了**。owner API と説明層は整備済み。残差は主に `content.js` 側の helper / DI 縮退 | cleanup requested、cleanup begin、cleanup skipped、cleanup done |
| `settings-runtime.js` | 設定読込、設定保存、runtime state 更新、再評価依頼 | readiness 待ち、`addtrack` listener、直接 start、独自 retry / timeout | `startBilingualWhenTracksReady()`、直接 `startBilingual(...)`、`restartBilingual(...)` の実 start 部分 | `coordinator.attachAndMaybeStart(...)`、`requestStartupReevaluation(reason)` / `requestRebuild(reason)` | **完了**。direct start 経路を coordinator へ移管済み | settings changed、state applied、rebuild requested |
| `reinitialize-coordinator.js` | 再起動理由の分類、reason code の整形、rebuild 要求発行 | 実 cleanup、内部 state 強制破棄、実再構築 | `clearInternalSubtitleState(...)` の direct call、二重 teardown / rebuild | `requestRebuild(reason, options)`、cleanup owner API | **完了**。direct cleanup を除去し、reason 分類層へ縮退済み | rebuild reason、reason classified、rebuild requested |
| `modules/panel-ui.js` | panel host / overlay host / toggle UI の mount / refresh / dispose、native toggle observer、player tabs 監視 | cleanup owner 的な役割、manual panel disposal の統括 | panel 単体で lifecycle owner のように振る舞う説明 | session cleanup owner 配下の subordinate module として使用 | **一部完了**。subordinate 化は完了。native UI 幅追従の責務確認が残る | panel mount、layout applied、panel refresh、panel dispose |
| `modules/debug-panel-runtime.js` | debug panel の mount / update / unmount、debug snapshot 表示 | 独立 cleanup owner のような説明 | direct dispose の主導権 | session cleanup owner 配下の subordinate runtime として使用 | **完了**。cleanup subordinate として整理済み | debug open、debug snapshot、debug dispose |
| `content.js` wiring / lifecycle hub | DI、owner 接続、logger / probe 注入、共通 helper 保持 | direct cleanup、外向き subtitle clear API、manual panel disposal 主導 | `clearInternalSubtitleState(...)` を外部 module へ直接渡す構造、direct cleanup callsite の増殖 | cleanup owner API と coordinator API への request 発行 | **一部完了**。主要 callsite 集約済み。helper / DI の最終縮退と notice-only / layout 調査が残る | startup requested、layout branch、cleanup delegated、probe injected |

***

## cleanup owner の責務境界

### `modules/playback-session-cleanup.js`

`modules/playback-session-cleanup.js` は、**playback session teardown の唯一入口**として扱う。  
この module が担当するのは、次のような session 所有物の teardown である。

- subtitle 関連の runtime state clear
- panel UI / overlay / debug panel の dispose
- timer / listener / observer の解放
- current session にぶら下がる DOM / handler / watch の cleanup
- restart 前 teardown、disable 時 teardown、content switch 時 reset の切り分け

この owner は「何を消すか」を知ってよいが、「いつ start するか」「どの reason で rebuild するか」は持たない。  
つまり、teardown の owner ではあるが、start / rebuild 判定の owner ではない。

想定する主要 API は次のとおりである。

| API | 意図 | 補足 |
|---|---|---|
| `detachForDisabled(...)` | extension OFF 時の teardown | OFF 後は拡張 UI を残さない |
| `prepareForRestart(...)` | restart 前の事前 teardown / 調整 | restart request の高レベル入口 |
| `teardownForRestart(...)` | rebuild 前の正式 teardown | `reinitialize-coordinator.js` からの cleanup 収束先 |
| `resetForContentSwitch(...)` | 動画切り替え・content switch 時の reset | 新 target へ持ち越さない state を落とす |
| `clearPlaybackSessionUiState(...)` | session に属する UI / subtitle state の撤収 | `content.js` からの clear 要求はこの API に委譲する |

`content.js` は wiring / request の責務を持つが、panel / debug / subtitle state の direct cleanup owner にはならない。  
`clearInternalSubtitleState(...)` は残してよいが、cleanup owner が利用する内部 helper として扱い、外向き cleanup API として渡さない。

### `modules/panel-ui.js`

`modules/panel-ui.js` は panel 系 session UI の構築と破棄を担当するが、**cleanup owner ではない**。  
`dispose()` は panel module 内部の高レベル入口であって、session lifecycle 全体の owner を意味しない。

この module が持つべき責務は次のとおりである。

- panel host / overlay host / toggle UI の mount / refresh / dispose
- panel 状態適用、host 計測、UI 反映
- native toggle observer や player tabs 監視など、panel 表示に従属する watcher の局所管理
- ただし、session 全体 teardown の最終判断は `modules/playback-session-cleanup.js` に委譲する

### `modules/debug-panel-runtime.js`

`modules/debug-panel-runtime.js` も debug UI の session 従属 runtime であり、**cleanup owner ではない**。  
debug panel が存在するかどうかは session state に従属し、teardown の最終責任は cleanup owner 側にある。

この module が持つべき責務は次のとおりである。

- debug panel の mount / update / dispose
- debug snapshot の表示
- debug UI 内の局所 timer / listener 管理
- session cleanup 時には owner 呼び出しでまとめて解放される前提にする

***

## 進捗整理

### 完了済み

| 対象 | 完了内容 | 完了の意味 |
|---|---|---|
| `settings-runtime.js` | direct start、readiness wait、`addtrack` 監視、`restartBilingual(...)` 実 start を coordinator 側へ移した | settings runtime が state / request 層に寄った |
| `modules/playback-startup-coordinator.js` | target / readiness / retry / attachAndMaybeStart の起動前段を一本化した | start owner が読みやすくなった |
| `content.js` の主要 cleanup callsite | `clearSubtitles` を cleanup owner API 呼び出しへ差し替え、manual restart cleanup の direct `panelUi.dispose(...)` を `prepareForRestart(...)` 経由へ置換した | `content.js` の direct cleanup 入口が減った |
| `modules/panel-ui.js` / `modules/debug-panel-runtime.js` | subordinate module / runtime としてヘッダー、JSDoc、説明層を更新した | panel / debug が cleanup owner ではないと読める |
| `reinitialize-coordinator.js` | `clearInternalSubtitleState(...)` の直呼びを cleanup owner API へ置換した | coordinator が reason 分類と rebuild request に限定される |

### 未完了

| 対象 | 残課題 | 目標 |
|---|---|---|
| `content.js` helper | `clearInternalSubtitleState(...)` の位置づけを cleanup owner 内部 helper としてさらに明確化する | `content.js` が外向き direct cleanup API を提供しない |
| `content.js` DI | subtitle clear 関連の injection を cleanup owner API 基準へさらに縮退する | `clearInternalSubtitleState(...)` を外部 module へ直接渡さない |
| startup 観測 | startup request / attach / session-start / teardown の相関を compact probe で読めるようにする | 起動多重発火の切り分けができる |
| layout 責務 | `applyLayout(...)` と `watchForPlayerTabs()` のどちらが native UI 幅追従漏れの起点かを整理する | 70/30 レイアウト時の責務境界を明文化する |
| 未設定時 UX | notice-only 状態で `mountToggleOnlyUi()` や session 起動へ流れないよう整理する | 未設定時ノーティス限定化を実現する |

***

## 削除・縮退順

### 1. `settings-runtime.js` の start 経路を coordinator へ移管

**完了。**

削除対象だったもの:

- tracks readiness 待ち
- `addtrack` listener による start 補助
- poll / timeout による直接起動
- `restartBilingual(...)` の実 start 部分

置換先:

- `coordinator.attachAndMaybeStart(video, reason, options)`
- `requestStartupReevaluation(reason)`
- `requestRebuild(reason, options)`

完了条件:

- `settings-runtime.js` が「設定変更を受けて何を再評価するか」を決めるだけになる
- 実際の起動処理は coordinator が握る

### 2. `content.js` の主要 subtitle clear を cleanup owner へ委譲

**完了。**

削除対象だったもの:

- `clearSubtitles: () => clearInternalSubtitleState({ preserveSecondaryDom: false })` のような、外向き direct subtitle state clear
- subtitle state clear を `content.js` 側で直接意味付けしていた callsite

置換先:

- `playbackSessionCleanup.clearPlaybackSessionUiState(...)`

完了条件:

- subtitle clear 系の主要 callsite が owner API 経由になる
- `content.js` が direct cleanup owner として読めなくなる

### 3. `content.js` の manual panel dispose を cleanup owner へ委譲

**完了。**

削除対象だったもの:

- manual restart cleanup の文脈で `panelUi.dispose(...)` を直接呼ぶ分岐
- panel cleanup が session cleanup の代替になっているように見える経路

置換先:

- `playbackSessionCleanup.prepareForRestart(...)`

完了条件:

- panel 単体 cleanup ではなく session teardown の一部として説明できる
- panel dispose の主導権が cleanup owner 側へ戻る

### 4. `panel-ui.js` / `debug-panel-runtime.js` の説明層を subordinate 化

**完了。**

削除対象だったもの:

- panel / debug が独自 owner に見えるヘッダー、JSDoc、説明
- cleanup owner をバイパスするように読める説明

置換先:

- session cleanup owner 配下の subordinate module / runtime という説明層

完了条件:

- `dispose()` が module 内部 cleanup 入口として読める
- lifecycle 全体の owner とは混同されない

### 5. `reinitialize-coordinator.js` の direct cleanup を除去

**完了。**

削除対象だったもの:

- `clearInternalSubtitleState(...)` の direct call
- rebuild request と teardown 実行を同じ層で持つ構造

置換先:

- `playbackSessionCleanup.teardownForRestart(...)`
- `requestRebuild(reason, options)` を中心とした reason 分類層

完了条件:

- `reinitialize-coordinator.js` が実 cleanup owner を持たない
- coordinator は reason の分類と request 発行に集中する

### 6. `content.js` の subtitle helper / DI を cleanup owner 内部へ寄せる

**進行中。**

削除・縮退対象:

- `clearInternalSubtitleState(reasonOrOptions = {})` の関数コメント
- cleanup owner 外から見たときに、subtitle clear helper が外向き API に見える DI
- helper / DI が「再初期化側が直接使う cleanup 関数」に見える痕跡

寄せ先:

- `clearInternalSubtitleState(...)` は session subtitle state reset の内部 helper
- cleanup owner API が外部からの正式入口
- `content.js` は helper の実装を保持しても、外部へ direct cleanup API として公開しない

完了条件:

- helper 名、コメント、注入先が owner 境界として自然に読める
- `content.js` が wiring / hub に戻る

### 7. 旧 watcher / timer / wrapper / 補助 cleanup を物理削除

**未着手。**

削除対象候補:

- owner API へ寄せた後に不要になる wrapper
- 旧 direct cleanup 前提の補助関数
- 使われなくなった watcher / timer cleanup 補助

完了条件:

- 現行 owner API と重複する古い補助経路が残らない
- start / rebuild / teardown の導線が一筆書きで読める

### 8. 長期 lifecycle 検証と観測整理

**未着手。**

対象:

- compact probe 追加による startup 多重発火の切り分け
- 300 件ログ上限でも読める probe 粒度の見直し
- native UI 幅追従漏れの観測と責務棚卸し
- 未設定時 notice-only 化後の起動 / cleanup 経路確認

完了条件:

- startup / rebuild / teardown の相関が短いログで読める
- owner 設計だけでなく実機挙動でも経路が安定している

***

## 関数別の最終責務

| 関数 / API | 最終責務 | 呼ばれる場面 | 呼ばれてはいけない場面 |
|---|---|---|---|
| `coordinator.attachAndMaybeStart(...)` | target / readiness を見た上で start 可否を統制する | settings 変更後の再評価、target change、rebuild 後 attach | `settings-runtime.js` 内で readiness wait の代替なしに bypass される |
| `startBilingual(options)` | session 実構築、tracks 解決、listener 接続、secondary DOM / panel / debug runtime 構築 | startup coordinator からの start | 外側の rebuild 判断や cleanup 判断を抱え込む |
| `playbackSessionCleanup.prepareForRestart(...)` | restart 前の事前 teardown / 調整 | restart request、manual restart cleanup | `content.js` が `panelUi.dispose(...)` を直接呼ぶ |
| `playbackSessionCleanup.teardownForRestart(...)` | rebuild 前の正式 teardown | `reinitialize-coordinator.js` からの cleanup 集約 | coordinator が helper を直呼びする |
| `playbackSessionCleanup.clearPlaybackSessionUiState(...)` | session UI / subtitle state の撤収 | `content.js` の clear 要求 | `clearInternalSubtitleState(...)` を外部 API として渡す |
| `clearInternalSubtitleState(...)` | cleanup owner が利用する subtitle state reset helper | cleanup owner 経由 | reinitialize coordinator や外部 module が直接呼ぶ |
| `panelUi.dispose(...)` | panel session UI の撤収 | cleanup owner | `content.js` の個別分岐から直接呼ぶ |
| `debugPanelRuntime.dispose()` | debug runtime の撤収 | cleanup owner | session cleanup をバイパスする独自経路 |
| `requestRebuild(reason, options)` | reason を伴う rebuild 要求 | settings runtime、reinitialize coordinator、target / track 系判定層 | 実 teardown や start を内部で完結させる |

***

## 実装後の確認観点

### 起動経路

- `settings-runtime.js` から直接 `startBilingual()` していないこと
- target change、settings changed、restart request のどれから入っても startup coordinator を経由すること
- `startBilingual(...)` が同一 target に対して不必要に多重起動していないか、compact probe で追えること

### cleanup 経路

- `reinitialize-coordinator.js` が direct cleanup を持たないこと
- `content.js` の主要 clear / restart cleanup が owner API 経由になっていること
- panel / debug / overlay / subtitle state / timer / listener / observer が cleanup owner 経由で説明できること

### UI 経路

- panel / debug UI は session 従属物として mount / dispose されること
- 70/30 レイアウト時にどの DOM が native UI 幅追従から漏れるかを説明できること
- 未設定時に notice-only 状態へ入り、toggle-only UI や session 起動へ流れないこと

### 実機ログ

- startup request / attach / session-start / teardown の相関が読めること
- 300 件ログ上限でも主要経路が埋もれないこと
- rebuild 理由と cleanup 理由が混ざらず読めること
- 多重起動疑いが「実際の多重起動」なのか「観測の重複」なのか切り分け可能であること
