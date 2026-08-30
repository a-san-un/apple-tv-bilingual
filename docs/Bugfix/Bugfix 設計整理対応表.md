# Bugfix 設計整理対応表 2026-08-30

**目的:**  
再構築の入口を `modules/playback-startup-coordinator.js` に一本化し、終了処理を `modules/playback-session-cleanup.js` に一本化するために、各ファイルで「残す責務」「移す責務」「削除対象関数」「置換先 API」「確認ログ」を明確化する。

**設計原則:**  
目指す形は **1 playback target = 1 playback session = 1 owner** であり、settings 変更・SPA 遷移・track invalidation・restart 要求のどれから入っても、最終的に同じ rebuild 経路へ流すことにある。
一方で、UI 再マウントは単独で session rebuild 理由にはせず、session / target / track 条件の変化を伴う場合だけ rebuild 判定へ接続する。

**現状の観測要点:**  
すでに `modules/playback-startup-coordinator.js` には `attachAndMaybeStart(video, reason, options)`、target change 検知、`addtrack` と poll を使った readiness 待ちが存在し、起動一本化の受け皿がある。
一方で `settings-runtime.js` には `startBilingualWhenTracksReady()`、直接 `startBilingual(...)`、`textTracks.addEventListener("addtrack", ...)`、`restartBilingual(...)` がまだ残っており、起動 owner が分散している。
また、`reinitialize-coordinator.js` と `content.js` と `modules/playback-session-cleanup.js` の間で `clearInternalSubtitleState(...)` がまたがっており、cleanup owner の境界もまだ曖昧である。

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
- UI 再マウントを session rebuild と同義に扱うこと

この流れ以外の start / rebuild / teardown 経路は、段階的に削除対象とする。

***

## 対応表

| ファイル | 残す責務 | 移す責務 | 削除対象関数・経路 | 置換先 API / 呼び出し先 | 確認ログ |
|---|---|---|---|---|---|
| `modules/playback-startup-coordinator.js` | playback target change 検知、readiness 待ち、delayed retry、起動要求の一本化 | `settings-runtime.js` 側に残る tracks readiness 待ち、start 補助用 `addtrack` / poll / timeout | coordinator 以外からの個別 start 入口 | `attachAndMaybeStart(video, reason, options)` | `playback target changed`、`cleanup skipped`、readiness wait、retry、start attempt  |
| `content.js` 内 `startBilingual(...)` 本体 | session 実構築、tracks 解決、listener 接続、secondary DOM 構築、panel 初期化 | readiness 判定、再起動判断、target change 監視 | 外側の rebuild 判断を抱え込む構造 | `startBilingual(options)` を build 専用に縮退 | start begin、track resolved、listener attached、panel mounted  |
| `modules/playback-session-cleanup.js` | session teardown、dispose 入口、session 単位の cleanup 集約 | `reinitialize-coordinator.js` の実 cleanup、散在した timer / listener / observer / DOM 解放 | session 外からの部分 teardown、各所の個別 cleanup 主導 | `disposeCurrentSession(reason)` または同等の唯一入口へ整理 | cleanup requested、cleanup begin、cleanup skipped、cleanup done  |
| `settings-runtime.js` | 設定読込、設定保存、runtime state 更新、再評価依頼 | readiness 待ち、`addtrack` listener、直接 start、独自 retry / timeout | `startBilingualWhenTracksReady()`、直接 `startBilingual(...)`、`restartBilingual(...)` の実 start 部分 | `coordinator.attachAndMaybeStart(...)`、将来的に `requestStartupReevaluation(reason)` / `requestRebuild(reason)` | settings changed、state applied、rebuild requested  |
| `reinitialize-coordinator.js` | 再起動理由の分類、reason code の整形、rebuild 要求発行 | 実 cleanup、内部 state 強制破棄、実再構築 | `clearInternalSubtitleState(...)` の実 cleanup owner 化、二重 teardown / rebuild | `requestRebuild(reason, options)` だけを残す方向 | rebuild reason、reason classified、rebuild requested  |
| `modules/panel-ui.js` | panel lifecycle、render、state apply、UI dispose 実装 | session 全体 cleanup 統括 | panel から session 全体 start / rebuild / cleanup を逆流制御する経路 | cleanup 層から `panelUi.dispose(...)` を呼ぶ | panel mounted、panel refreshed、panel disposed  |
| `modules/debug-panel-runtime.js` | debug UI の mount / subscribe / dispose | dispose 呼び出し統括、session owner 判断 | debug runtime が session 寿命を支配する構造 | cleanup 層から dispose 呼び出し | debug mounted、debug unsubscribed、debug disposed（新設候補） |
| `content.js` 内 `clearInternalSubtitleState(...)` | 低レベル状態クリア実装の素材としてのみ残すか再配置検討 | cleanup owner 判断、呼び出し統括 | coordinator / reinitialize / content 本体からの直呼び増殖 | cleanup モジュール経由に限定 | internal state clear begin / done（新設候補） |

***

## ファイル別詳細

## `modules/playback-startup-coordinator.js`

このファイルは、今回の再設計で**起動 owner**に固定する。  
すでに `attachAndMaybeStart(video, reason, options)`、playback target change 検知、`addtrack + poll` による readiness 待ちを持っているため、起動前段の責務はここへ集約する。

### 残す責務

- playback target の検知
- target change の抑制と重複防止
- readiness 待ち
- delayed retry
- start 入口の一本化
- startup attempt の再入防止

### 移す責務

- `settings-runtime.js` に残る readiness 待ち
- `settings-runtime.js` に残る `addtrack` 起点 start
- `settings-runtime.js` に残る timeout / polling による起動補助

### 削除・縮退対象

- coordinator 外からの独自 start owner
- 「必要そうだから start する」系の分散入口
- 同じ target に対する重複 start 判定

### 置換方針

- 起動要求は最終的に `attachAndMaybeStart(video, reason, options)` に集約する
- 直接 `startBilingual(...)` を呼ぶ箇所は、原則 coordinator 呼び出しへ置換する

### 確認ログ

- startup probe
- playback target changed
- readiness wait
- retry scheduled / retry fire
- start attempt
- start suppressed / duplicate prevented

***

## `content.js`

このファイルは**配線と DI のハブ**へ戻す。  
現状では `startBilingual(...)` と `clearInternalSubtitleState(...)` を持ち、さらに手動 cleanup 経路も抱えているため、lifecycle owner 的な責務を剥がす必要がある。

### 残す責務

- 依存性生成
- module wiring
- logger / probe 注入
- 生成順管理
- 公開 API の接続

### 移す責務

- owner 判定
- lifecycle 実装本体
- start / cleanup 直統括
- 再起動判断

### 削除・縮退対象

- `startBilingual(...)` のうち readiness 判定、再起動判断、target change 監視を抱え込む部分
- `clearInternalSubtitleState(...)` を owner 的に扱う構造
- `panelUi.dispose({ reason: "manual-restart-cleanup" })` のような直 cleanup
- 分散した start / rebuild / cleanup 条件分岐

### 置換方針

- `startBilingual(...)` は build 専用関数として残す
- cleanup 系は `modules/playback-session-cleanup.js` 経由に限定する
- `content.js` は接続のみ行う

### 確認ログ

- wiring start
- dependency ready
- module connected
- coordinator injected
- cleanup injected
- start delegated
- cleanup delegated

***

## `modules/playback-session-cleanup.js`

このファイルは、**session teardown の唯一入口**に固定する。  
`clearInternalSubtitleState(...)` を複数箇所から叩く構造をやめ、session cleanup はここ経由でのみ実行する形へ寄せる。

### 残す責務

- session teardown
- cleanup 再入防止
- session 所有物の解放
- UI / listener / observer / timer / retry / DOM の cleanup 集約
- cleanup 実行済み管理

### 移す責務

- `reinitialize-coordinator.js` の実 cleanup
- `content.js` 側の手動 cleanup
- UI 個別モジュールからの owner 不明 dispose 統括

### 削除・縮退対象

- session cleanup を通らず UI だけ落とす経路
- 外部からの部分 teardown の乱立
- 各モジュールが自前 owner 顔で cleanup する構造

### 置換方針

- `disposeCurrentSession(reason)` または同等の唯一入口へ整理する
- `clearInternalSubtitleState(...)` は cleanup 内部実装へ閉じ込める

### 確認ログ

- cleanup requested
- cleanup skipped
- cleanup begin
- cleanup done
- session disposed
- stale resource dropped

***

## `settings-runtime.js`

このファイルは、今回の整理で**設定管理層**へ縮退させる。  
現状では `startBilingualWhenTracksReady()`、直接 `startBilingual(...)`、`textTracks.addEventListener("addtrack", ...)`、`restartBilingual(...)` が残っており、起動 owner を奪っている。

### 残す責務

- 設定読込
- 設定保存
- runtime state 更新
- ON / OFF や設定変更の反映要求
- coordinator への再評価依頼

### 移す責務

- tracks readiness 待ち
- `addtrack` listener ベースの start
- timeout / interval による独自 start 待機
- 実 start 本体
- 実 rebuild 本体

### 削除・縮退対象

- `startBilingualWhenTracksReady(reason = "unknown")`
- `textTracks.addEventListener("addtrack", onAddTrack)` を使う start watcher
- `textTracks.removeEventListener("addtrack", onAddTrack)` を含む start watcher cleanup 一式
- 関数内部の poll / timeout ベースの readiness 待機
- `restartBilingual(settings, reason, options)` のうち実起動・実再構築部分
- 直接 `startBilingual(...)` を呼ぶ経路

### 置換方針

- 当面は `coordinator.attachAndMaybeStart(video, reason, options)` に寄せる
- 将来的には `requestStartupReevaluation(reason)` または `requestRebuild(reason, options)` に統一する
- 「start する」ではなく「再評価または rebuild を依頼する」に責務文言を揃える

### 確認ログ

- settings changed
- state applied
- startup reevaluation requested
- rebuild requested
- direct start removed

***

## `reinitialize-coordinator.js`

このファイルは、**薄い判定層**として再定義する。  
再起動理由の分類と要求発行に責務を限定し、実 cleanup や実再構築は持たせない。

### 残す責務

- 再起動理由の分類
- reason code の正規化
- rebuild 要求の発行
- 判定入口の提供

### 移す責務

- 実 cleanup
- session 破棄
- 内部 state の直接クリア
- 実再構築

### 削除・縮退対象

- `reinitializeSubtitlePipeline(reason)` のうち実 cleanup と実再構築を行う部分
- `clearInternalSubtitleState(...)` の直接呼び出し
- 「理由判定したついでに全部やる」構造
- teardown と rebuild を両方 owner する構造

### 置換方針

- `requestRebuild(reason, options)` のような要求専用 API に寄せる
- cleanup は `modules/playback-session-cleanup.js`
- start は `modules/playback-startup-coordinator.js` / `startBilingual(...)`

### 確認ログ

- rebuild reason received
- reason classified
- rebuild requested
- cleanup delegated
- start delegated

***

## `modules/panel-ui.js`

このモジュールは panel の UI 実装に責務を絞る。  
`removeHost(id)` のような低レベル DOM 除去は残してよいが、session 全体 cleanup の owner にはしない。

### 残す責務

- panel mount
- panel render
- panel state apply
- panel dispose
- host 除去の低レベル実装

### 移す責務

- session 全体 cleanup 統括
- rebuild owner
- start owner
- 他モジュール cleanup の呼び出し統括

### 削除・縮退対象

- panel から session 全体の start / rebuild / cleanup を制御する経路
- panel 起点で session owner を振る舞う構造

### 置換方針

- cleanup 層から `panelUi.dispose(...)` を呼ぶ
- `removeHost(id)` は DOM 低レベル helper に限定する

### 確認ログ

- panel mounted
- panel refreshed
- panel disposed
- panel host removed

***

## `modules/debug-panel-runtime.js`

このモジュールは、**session 従属 UI**として扱う。  
debug runtime 自体が session の寿命を支配する構造は持たせず、dispose は cleanup owner 経由に揃える。

### 残す責務

- debug panel mount
- 購読開始
- 描画更新
- dispose 実装

### 移す責務

- dispose 呼び出し統括
- session owner 判断
- stale session 切断判断

### 削除・縮退対象

- debug runtime が session 生存判定や cleanup owner を兼ねる構造
- stale session を掴み続ける購読
- cleanup 統括を debug runtime 側が持つ経路

### 置換方針

- cleanup 層から dispose 呼び出しに統一する

### 確認ログ

- debug mounted
- debug unsubscribed
- debug disposed
- stale debug subscription dropped

***

## `content.js` 内 `startBilingual(...)`

`startBilingual(...)` は**建設担当**として残すが、readiness 判定や rebuild 判断は持たせない。  
coordinator が attach と start 要否を確定したあとに、session 実構築だけを引き受ける関数へ縮退する。

### 残す責務

- session 実構築
- tracks 解決
- listener 接続
- secondary DOM 構築
- panel 初期化
- debug runtime 初期化
- session 所有物の登録

### 移す責務

- readiness 判定
- 再起動判断
- target change 監視
- settings 変化からの直接 start 判断

### 削除・縮退対象

- tracks が足りないから自分で待つ構造
- rebuild すべきかを自分で決める構造
- target 監視と build を兼務する構造

### 置換方針

- coordinator からのみ呼ばれる build API として固定する

### 確認ログ

- start bilingual begin
- target attached
- tracks resolved
- listener attached
- secondary DOM mounted
- panel mounted
- debug mounted
- session registered

***

## `content.js` 内 `clearInternalSubtitleState(...)`

`clearInternalSubtitleState(...)` は、現状のままでは cleanup owner を曖昧にする。  
したがって、物理削除を急ぐのではなく、**cleanup 内部専用の低レベル helper** へ格下げする。

### 残す責務

- 低レベル状態クリア実装の素材
- cleanup 内部からの限定利用

### 移す責務

- cleanup owner 判断
- 呼び出し統括
- session 境界判定

### 削除・縮退対象

- `reinitialize-coordinator.js` からの直呼び
- `content.js` 本体からの owner 的呼び出し
- 複数 owner から直接叩ける構造
- cleanup 以外の経路からの利用

### 置換方針

- cleanup モジュール経由に限定する
- export / injection / 外部直呼びを段階的に止める

### 確認ログ

- internal state clear begin
- internal state clear done
- internal state clear delegated

***

## 削除順

削除・縮退・移管は、次の順で進める。

1. `settings-runtime.js` の `startBilingualWhenTracksReady(...)` を停止する
2. `settings-runtime.js` の `addtrack` start watcher を停止する
3. `settings-runtime.js` の直接 `startBilingual(...)` を coordinator 呼び出しへ置換する
4. `restartBilingual(...)` を薄い rebuild 要求関数へ縮退する
5. `reinitialize-coordinator.js` から `clearInternalSubtitleState(...)` 直呼びを除去する
6. `content.js` の手動 cleanup 経路を cleanup owner 経由へ移す
7. `clearInternalSubtitleState(...)` を cleanup 内部専用 helper へ格下げする
8. 最後に不要になった watcher、timer、wrapper、補助 cleanup を物理削除する

***

## 関数別削除・縮退一覧

| ファイル | 関数 / 経路 | ステータス | 処置 |
|---|---|---|---|
| `settings-runtime.js` | `startBilingualWhenTracksReady(reason)` | 削除 | coordinator へ移管 |
| `settings-runtime.js` | `textTracks.addEventListener("addtrack", onAddTrack)` | 削除 | coordinator の readiness 待ちへ統合 |
| `settings-runtime.js` | `textTracks.removeEventListener("addtrack", onAddTrack)` | 削除 | 上記 watcher 廃止に伴い不要 |
| `settings-runtime.js` | 直接 `startBilingual(...)` | 直呼び禁止 | `attachAndMaybeStart(...)` へ置換 |
| `settings-runtime.js` | `restartBilingual(settings, reason, options)` | 縮退 | rebuild 要求 wrapper 化 |
| `reinitialize-coordinator.js` | `reinitializeSubtitlePipeline(reason)` | 縮退 | 理由分類 + rebuild 要求のみ残す |
| `reinitialize-coordinator.js` | `clearInternalSubtitleState(...)` 呼び出し | 削除 | cleanup owner へ移管 |
| `content.js` | `clearInternalSubtitleState(reasonOrOptions)` | 移管 / 縮退 | cleanup 内部 helper 化 |
| `content.js` | `startBilingual(options)` の readiness / rebuild 判断部 | 削除 | coordinator へ移管 |
| `content.js` | `panelUi.dispose({ reason: "manual-restart-cleanup" })` | 削除 | cleanup owner 経由へ置換 |
| `modules/panel-ui.js` | `removeHost(id)` | 残す | UI 低レベル helper に限定 |

***

## 削除対象の見つけ方

優先度が高いのは、次の経路である。

- `settings-runtime.js` に残る直接 start 経路
- `settings-runtime.js` に残る tracks readiness 待ち
- `settings-runtime.js` に残る `addtrack` listener 起動
- `reinitialize-coordinator.js` に残る実 cleanup
- session cleanup を通らず UI だけ落とす経路
- owner が曖昧な timeout / interval / observer
- 古い session の state を持ったまま残る panel / debug runtime

一時的な印として、該当箇所に次のコメントを付ける。

- `TODO: owner migration`
- `TODO: move to startup coordinator`
- `TODO: move to session cleanup`
- `TODO: replace with requestRebuild(...)`
- `TODO: remove direct start path`

***

## 確認すべきログ軸

最終的にログは、少なくとも次の責務単位で一筆書きに追える必要がある。

- `startup`: target 検知、readiness、retry、start attempt
- `decision`: rebuild 要否、reason、bind / keep / clear
- `cleanup`: request、begin、skipped、done
- `panel`: mount、refresh、dispose
- `debug`: mount、unsubscribe、dispose
- `session`: sessionId、target、owner、active / disposed

理想の読み順は次のとおりである。

1. rebuild requested
2. startup coordinator evaluate
3. cleanup requested
4. cleanup done
5. attach new target
6. start bilingual begin
7. session mounted

***

## 完了条件

この整理の完了条件は、**どのイベントから入っても同じ rebuild 経路しか通らないこと**である。  
settings 変更でも SPA 遷移でも track invalidation でも、最終的に「要求 → coordinator 評価 → cleanup → attach → start」の一本線に収束する必要がある。

さらに、timer・listener・observer・secondary DOM・panel UI・debug runtime の寿命が、すべて 1 つの playback session owner で説明できる状態になれば、設計と実装が一致したと判断できる。
