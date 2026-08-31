# Bugfix 設計整理対応表 2026-08-31

**目的:**  
再構築の入口を `modules/playback-startup-coordinator.js` に一本化し、終了処理を `modules/playback-session-cleanup.js` に一本化するために、各ファイルで「残す責務」「移す責務」「削除対象関数」「置換先 API」「確認ログ」を明確化する。

**設計原則:**  
目指す形は **1 playback target = 1 playback session = 1 owner** であり、settings 変更・SPA 遷移・track invalidation・restart 要求のどれから入っても、最終的に同じ rebuild 経路へ流すことにある。  
一方で、UI 再マウントは単独で session rebuild 理由にはせず、session / target / track 条件の変化を伴う場合だけ rebuild 判定へ接続する。

**進捗要約:**  
起動入口の一本化は完了している。`settings-runtime.js` にあった tracks readiness 待ち、`addtrack` 監視、直接 `startBilingual(...)`、`restartBilingual(...)` の実 start 経路は coordinator 側へ集約済みである。  
cleanup owner 側は、`modules/playback-session-cleanup.js` を session teardown の唯一入口として説明・API の両面で整理し、`content.js` の主要 direct cleanup callsite も owner API 経由へ置換済みである。  
ただし、`reinitialize-coordinator.js` に残る `clearInternalSubtitleState(...)` の直呼び、および `content.js` に残る helper / DI の縮退は未完了である。したがって cleanup owner 一本化は完了扱いにせず、**owner 側受け皿と主要 callsite 集約が完了し、残差整理フェーズへ移行した状態**として扱う。

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
| `content.js` 内 `startBilingual(...)` 本体 | session 実構築、tracks 解決、listener 接続、secondary DOM 構築、panel 初期化 | readiness 判定、再起動判断、target change 監視 | 外側の rebuild 判断を抱え込む構造 | `startBilingual(options)` を build 専用に縮退 | **一部完了**。主要 direct cleanup は owner 経由へ置換済み。helper / DI 縮退が残る | start begin、track resolved、listener attached、panel mounted |
| `modules/playback-session-cleanup.js` | session teardown、dispose 入口、panel / debug / subtitle state / observer の cleanup 集約 | `reinitialize-coordinator.js` の実 cleanup、散在した timer / listener / observer / DOM 解放 | session 外からの部分 teardown、各所の個別 cleanup 主導 | `detachForDisabled(...)`、`prepareForRestart(...)`、`resetForContentSwitch(...)`、`clearPlaybackSessionUiState(...)` | **一部完了**。owner API と説明層は整備済み、残存 direct cleanup の最終集約が残る | cleanup requested、cleanup begin、cleanup skipped、cleanup done |
| `settings-runtime.js` | 設定読込、設定保存、runtime state 更新、再評価依頼 | readiness 待ち、`addtrack` listener、直接 start、独自 retry / timeout | `startBilingualWhenTracksReady()`、直接 `startBilingual(...)`、`restartBilingual(...)` の実 start 部分 | `coordinator.attachAndMaybeStart(...)`、`requestStartupReevaluation(reason)` / `requestRebuild(reason)` | **完了**。direct start 経路を coordinator へ移管済み | settings changed、state applied、rebuild requested |
| `reinitialize-coordinator.js` | 再起動理由の分類、reason code の整形、rebuild 要求発行 | 実 cleanup、内部 state 強制破棄、実再構築 | `clearInternalSubtitleState(...)` の direct call、二重 teardown / rebuild | `requestRebuild(reason, options)`、cleanup owner API | **未完了**。cleanup owner 境界の残差整理の主対象 | rebuild reason、reason classified、rebuild requested |
| `modules/panel-ui.js` | panel lifecycle、render、state apply、UI dispose 実装 | session 全体 cleanup 統括 | panel から session 全体 start / rebuild / cleanup を逆流制御する経路 | cleanup owner から `panelUi.dispose(...)` を呼ぶ | **説明層完了**。session subordinate UI module として整理済み | panel mounted、panel refreshed、panel disposed |
| `modules/debug-panel-runtime.js` | debug UI の mount / subscribe / dispose | dispose 呼び出し統括、session owner 判断 | debug runtime が session 寿命を支配する構造 | cleanup owner から dispose 呼び出し | **説明層完了**。session subordinate debug runtime として整理済み | debug mounted、debug updated、debug disposed |

***

## cleanup owner の責務境界

### `modules/playback-session-cleanup.js`

`modules/playback-session-cleanup.js` は playback session cleanup owner の唯一入口である。  
panel UI、debug runtime、subtitle state、observer、timer、listener、secondary DOM など、session にひも付く状態の撤収は、原則としてこの module の公開 API を経由する。

公開 API の役割は次のように固定する。

| API | 用途 | 呼び出し元の扱い |
|---|---|---|
| `detachForDisabled(...)` | 拡張 OFF 時の session teardown | OFF 要求は owner に渡し、個別 dispose を行わない |
| `prepareForRestart(...)` | restart 前の session teardown | manual restart や再初期化前の撤収に使う |
| `resetForContentSwitch(...)` | content / episode / target 切替時の teardown | 旧 session を次 target へ持ち越さない |
| `clearPlaybackSessionUiState(...)` | session に属する UI / subtitle state の撤収 | `content.js` からの clear 要求はこの API に委譲する |

`content.js` は wiring / request の責務を持つが、panel / debug / subtitle state の direct cleanup owner にはならない。  
`clearInternalSubtitleState(...)` は残してよいが、cleanup owner が利用する内部 helper として扱い、外向き cleanup API として渡さない。

### `modules/panel-ui.js`

`modules/panel-ui.js` は session 従属 UI module である。  
panel の mount、render、state apply、dispose はこの module が実装するが、session 全体の cleanup 判断や teardown 開始の owner にはしない。

`dispose()` は panel session UI の撤収を担当する。  
呼び出し元の増加を許容せず、通常は `modules/playback-session-cleanup.js` の配下から呼ばれる構造を維持する。

### `modules/debug-panel-runtime.js`

`modules/debug-panel-runtime.js` は session 従属の debug UI runtime である。  
observer、timer、DOM、subscription の内部 cleanup は runtime 内に閉じるが、session を終了するかどうかの判断や teardown の開始は持たない。

debug runtime の lifecycle は playback session cleanup owner に従う。  
`dispose()` は debug runtime 自身の撤収に限定し、session cleanup owner と同じ意味の用語や責務を持たせない。

***

## 進捗整理

### 完了済み

| 区分 | 完了内容 |
|---|---|
| 起動入口 | `settings-runtime.js` から readiness wait、`addtrack` watch、direct start、実 start を伴う `restartBilingual(...)` 経路を外し、`coordinator.attachAndMaybeStart(...)` へ集約した |
| cleanup owner 説明層 | `modules/playback-session-cleanup.js` を session cleanup owner の唯一入口として明示し、公開 API の JSDoc を session cleanup reason の入口文脈へ整理した |
| content.js の主要 cleanup callsite | `clearSubtitles` を cleanup owner API 呼び出しへ差し替え、manual restart cleanup の direct `panelUi.dispose(...)` を `prepareForRestart(...)` 経由へ置換した |
| panel UI | `modules/panel-ui.js` を cleanup owner ではなく、session 従属 UI module として説明した |
| debug runtime | `modules/debug-panel-runtime.js` を cleanup owner ではなく、session 従属 debug UI runtime として説明した |

### 未完了

| 区分 | 残タスク | 完了条件 |
|---|---|---|
| `reinitialize-coordinator.js` | `clearInternalSubtitleState(...)` の直呼びを cleanup owner API へ置換する | coordinator が reason 分類と rebuild request に限定される |
| `content.js` helper | `clearInternalSubtitleState(...)` の位置づけを cleanup owner 内部 helper として明確化する | content.js が外向き direct cleanup API を提供しない |
| `content.js` DI | subtitle clear 関連の injection を cleanup owner API 基準へ縮退する | `clearInternalSubtitleState(...)` を外部 module へ直接渡さない |
| 不要コード削除 | 旧 watcher / timer / wrapper / 補助 cleanup を削除する | 使用箇所がなく、owner API へ移行済みである |
| 経路検証 | OFF / ON、manual restart、content switch、SPA 遷移、track invalidation を検証する | 多重 cleanup、旧 session 残留、native subtitle 復元不整合がない |

***

## 削除・縮退順

### 1. `settings-runtime.js` の start 経路を coordinator へ移管

**状態: 完了**

削除・縮退対象:

- `startBilingualWhenTracksReady()`
- 直接 `startBilingual(...)`
- `textTracks.addEventListener("addtrack", ...)`
- local poll / timeout / retry による start owner 化
- 実 start を伴う `restartBilingual(...)` 経路

置換先:

- `coordinator.attachAndMaybeStart(video, reason, options)`
- `requestStartupReevaluation(reason)`
- `requestRebuild(reason, options)`

### 2. `content.js` の主要 subtitle clear を cleanup owner へ委譲

**状態: 完了**

削除・縮退対象:

- `clearSubtitles: () => clearInternalSubtitleState({ preserveSecondaryDom: false })` のような、外向き direct subtitle state clear

置換先:

- `playbackSessionCleanup.clearPlaybackSessionUiState(...)`

### 3. `content.js` の manual panel dispose を cleanup owner へ委譲

**状態: 完了**

削除・縮退対象:

- language selection incomplete 分岐などでの `panelUi.dispose({ reason: "manual-restart-cleanup" })`

置換先:

- `playbackSessionCleanup.prepareForRestart({ reason: "manual-restart-cleanup" })`

### 4. `panel-ui.js` / `debug-panel-runtime.js` の説明層を subordinate 化

**状態: 完了**

整理内容:

- `panel-ui.js` は session 従属 UI module として mount / render / dispose に限定する
- `debug-panel-runtime.js` は session 従属 debug runtime として mount / update / dispose に限定する
- session cleanup の開始判断は両 module に持たせない
- dispose の最終呼び出しは cleanup owner 配下に寄せる

### 5. `reinitialize-coordinator.js` の direct cleanup を除去

**状態: 未完了**

削除・縮退対象:

- `clearInternalSubtitleState(...)` の direct call
- coordinator 自身が実 cleanup を担う構造
- cleanup と rebuild request が同一層で混在する経路

置換先:

- `playbackSessionCleanup.prepareForRestart(...)`
- `playbackSessionCleanup.resetForContentSwitch(...)`
- reason を正規化した `requestRebuild(reason, options)`

### 6. `content.js` の subtitle helper / DI を cleanup owner 内部へ寄せる

**状態: 未完了**

整理対象:

- `clearInternalSubtitleState(reasonOrOptions = {})` の関数コメント
- subtitle clear 関連 dependency injection
- cleanup owner を通さない helper の公開・受け渡し

完了後の位置づけ:

- `clearInternalSubtitleState(...)` は session subtitle state reset の内部 helper
- owner が preserveSecondaryDom を含む cleanup 方針を決定する
- `content.js` は helper の実装を保持しても、外部へ direct cleanup API として公開しない

### 7. 旧 watcher / timer / wrapper / 補助 cleanup を物理削除

**状態: 未完了**

削除候補:

- coordinator と cleanup owner の責務移管後に不要になった local watcher
- timeout / polling の重複経路
- 旧 direct cleanup を補助する thin wrapper
- reason の重複変換や既存 owner を迂回する helper

完了条件:

- 呼び出し元が残っていない
- owner API が同じ用途を担える
- 実機ログで cleanup / rebuild 経路を追跡できる

### 8. 長期 lifecycle 検証と観測整理

**状態: 未着手**

対象条件:

- cleanup owner 一本化の残差整理が完了している
- 旧 watcher / wrapper / helper が削除済みである
- 通常ケースのログが経路別に読める状態である

検証対象:

- 長時間再生
- SPA 遷移反復
- episode / content switch
- OFF / ON 反復
- manual restart 反復
- track invalidation と secondary track recovery
- listener / observer / timer / DOM の残留有無

***

## 関数別の最終責務

| 関数・API | 最終責務 | 許可する呼び出し元 | 禁止する使い方 |
|---|---|---|---|
| `coordinator.attachAndMaybeStart(video, reason, options)` | target 確認、readiness 待ち、start 要求の一本化 | settings runtime、target change 検知、rebuild 後 attach | settings runtime が独自 readiness wait を実装する |
| `startBilingual(options)` | session 実構築 | startup coordinator 経由 | settings runtime / UI 層が直接 start する |
| `playbackSessionCleanup.detachForDisabled(...)` | 拡張 OFF 時の teardown | extension enabled state の変更経路 | panel 単体を直接 dispose して代替する |
| `playbackSessionCleanup.prepareForRestart(...)` | restart 前の teardown | restart request、manual restart cleanup | content.js が `panelUi.dispose(...)` を直接呼ぶ |
| `playbackSessionCleanup.resetForContentSwitch(...)` | content / target switch 時の teardown | target change、content switch 経路 | coordinator が subtitle helper を直呼びする |
| `playbackSessionCleanup.clearPlaybackSessionUiState(...)` | session UI / subtitle state の撤収 | content.js の clear 要求 | `clearInternalSubtitleState(...)` を外部 API として渡す |
| `clearInternalSubtitleState(...)` | cleanup owner が利用する subtitle state reset helper | cleanup owner 経由 | reinitialize coordinator や外部 module が直接呼ぶ |
| `panelUi.dispose(...)` | panel session UI の撤収 | cleanup owner | content.js の個別分岐から直接呼ぶ |
| `debugPanelRuntime.dispose(...)` | debug runtime の内部 resource 解放 | cleanup owner | debug runtime 自身が session teardown を開始する |
| `requestRebuild(reason, options)` | reason を伴う rebuild 要求発行 | reinitialize coordinator、settings 変更経路 | request 層で実 cleanup を行う |

***

## 実装後の確認観点

### 起動経路

- settings 変更時に `settings-runtime.js` が独自に `startBilingual(...)` を呼ばない
- `addtrack`、polling、timeout による readiness 待ちが coordinator 以外に残っていない
- target change、SPA 遷移、track invalidation、restart request が coordinator の再評価へ集約される
- 同一 video / 同一 target に対して start が重複しない
- readiness 未達時の retry が旧 session に残留しない

### cleanup 経路

- `content.js` が panel / debug / subtitle state を direct cleanup しない
- `reinitialize-coordinator.js` が `clearInternalSubtitleState(...)` を direct call しない
- cleanup owner の公開 API が reason ごとの teardown 入口として使われる
- OFF、manual restart、content switch、SPA 遷移で旧 session の listener / observer / timer / DOM が残らない
- `preserveSecondaryDom` を含む subtitle state reset 方針が cleanup owner 側で判断される

### UI 経路

- panel 再描画だけでは session rebuild が起きない
- debug panel の mount / update / dispose が session lifecycle に従う
- panel / debug runtime の dispose が session cleanup owner 配下に収束する
- native subtitle UI と拡張 UI の表示切替で teardown 経路が二重に走らない

### 実機ログ

- start / rebuild / cleanup の reason が一貫した形式で出力される
- `cleanup requested`、`cleanup begin`、`cleanup skipped`、`cleanup done` の順序が追跡できる
- old session の retry、watch、observer、timer が新 session に残留していないことを確認できる
- restart / content switch 後に secondary subtitle の復帰状態を追跡できる

