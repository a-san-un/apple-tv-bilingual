# Bugfix 実装シート 2026-09-01（責務移管チェックリスト版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** `docs/Bugfix/Bugfix マスタープラン.md`  
**対応方針メモ:** `docs/Bugfix/字幕同期・切り替え条件統合と責務再設計メモ.md`、`docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md`、`docs/Bugfix/Step17-B_visibility-lifecycle_方針整理メモ.md`、`docs/Bugfix/Step17-C_残存ログprobe制御_方針整理メモ.md`  
**最新反映コミット:** `297b2ba refactor: reinitialize の teardown を cleanup owner に集約する (Issue #32, Phase B)`  
**現在の作業:** Step 17-B / Step 17-C の前提整理として進めてきた playback session lifecycle の owner 再設計は、**起動入口一本化と cleanup owner 側受け皿の整備に加え、`reinitialize-coordinator.js` の direct teardown 除去まで完了**している。現在は、`content.js` に残る helper / DI の縮退を仕上げつつ、次段として **起動多重発火の観測強化**、**ネイティブ UI 幅追従の原因調査**、**未設定時ノーティス限定化** へ進む段階である。

***

## このシートの役割

このシートは、**責務移管を伴う実装作業の作業台兼チェックリスト正本**である。  
変更対象、残す責務、移す責務、削除対象経路、確認観点、実装順、およびブラウザテスト前提の確認項目を記録する。

全体目標、過去 Step の完了履歴、将来作業、各資料の役割は `Bugfix マスタープラン.md` を参照する。  
責務再設計の基本原則は `字幕同期・切り替え条件統合と責務再設計メモ.md` を正本とし、Step 17-A の panel owner / API 境界は `Step17-A_panel系統合_方針整理メモ.md`、Step 17-B の visibility / lifecycle 整理は `Step17-B_visibility-lifecycle_方針整理メモ.md`、probe 整理は `Step17-C_残存ログprobe制御_方針整理メモ.md` を参照する。

***

## 今回の目的

今回の目的は、字幕切り替え条件の整理だけでなく、**playback session lifecycle の owner を単一化し、起動・再起動・UI 再マウント・cleanup の入口を一本化すること**である。

今回の作業で行うことは次のとおりである。

- `1 playback target = 1 playback session`、`1 session = 1 owner` の前提に合わせ、session 所有物を明文化する。
- `modules/playback-startup-coordinator.js` を唯一の起動前段 owner に寄せる。
- `settings-runtime.js` から直接 start する経路、tracks readiness 待ち、`addtrack` listener、poll / timeout 起動を外す。
- `reinitialize-coordinator.js` を再起動理由判定と再評価要求の薄い層へ縮退する。
- `modules/playback-session-cleanup.js` を session teardown の唯一入口に寄せる。
- `panel-ui.js` と `debug-panel-runtime.js` を session 従属 UI として cleanup 配下に揃える。
- startup / panel / recovery probe を使い、最終的な rebuild 経路が一筆書きで読める状態を目指す。

今回の作業では、字幕同期アルゴリズム自体の全面改修や、probe 全面移行の完了、ブラウザテスト結果の確定までは扱わない。  
まずは責務境界を整理し、各ファイルがどこまでを持つべきかを実装可能な粒度まで落とし込むことを優先する。

***

## 今回の到達目標

### 完了条件

- settings changed / target change / track invalidation のどこから入っても、最終的に同じ rebuild 経路へ流れる。
- `settings-runtime.js` が直接 `startBilingual()` を呼ばない。
- `reinitialize-coordinator.js` が実 cleanup の owner を持たない。
- `modules/playback-startup-coordinator.js` が起動前段の単一入口として機能する。
- `modules/playback-session-cleanup.js` が session teardown の唯一入口として機能する。
- panel UI、debug panel、secondary subtitle DOM、timer、listener、observer が session cleanup 経由で説明できる。
- startup / panel / recovery probe で経路が読み分けできる。

### ここまでの到達状況

- `settings-runtime.js` からの readiness wait / `addtrack` watch / direct start / `restartBilingual(...)` は整理され、起動要求は `coordinator.attachAndMaybeStart(...)` へ集約済みである。
- `modules/playback-startup-coordinator.js` は `attachAndMaybeStart(video, reason, options)` を単一 start 入口として持ち、`addtrack` と poll による readiness 待ちも coordinator 内へ集約している。
- `modules/playback-session-cleanup.js` は owner API 群と説明層の整備が進み、session teardown の受け皿として読める状態に揃っている。
- `content.js` に残っていた主要 direct cleanup callsite である `clearSubtitles` と manual restart cleanup は、cleanup owner API 経由へ置換済みである。
- `modules/panel-ui.js` と `modules/debug-panel-runtime.js` は、session cleanup owner 配下の subordinate UI module / runtime としてヘッダーと JSDoc を更新済みである。
- `reinitialize-coordinator.js` に残っていた `clearInternalSubtitleState(...)` 直呼びは `playbackSessionCleanup.teardownForRestart(...)` 経由へ置換済みであり、実 cleanup owner を持たない状態まで縮退が進んでいる。
- `content.js` 側の `clearInternalSubtitleState(...)` は、cleanup owner が使う内部 helper 文脈への縮退が進んでいるが、最終的な物理整理と説明の明快化は今後の残課題として残る。

### 今回あえてやらないこと

- probe の全面再分類と全面置換。
- 字幕 decision result 形式の全面書き換え。
- すべての後続 module の責務再配置完了。
- ブラウザテスト結果そのものの最終確定。

***

## 前提

以下は Step 17-A-11 までに完了済みであり、今回の責務移管でも前提として維持する。

- `state.extensionEnabled` は `chrome.storage.sync` に保存しない runtime state であり、current playback session に限定した拡張全体 ON/OFF の正本である。
- `panelUi.dispose()` は panel host、ShadowRoot、toggle button、native toggle observer、resize listener、render timer、render snapshot、renderer owner state、overlay DOM を対称に cleanup する高レベル入口である。
- `removeHost()` は低レベルな DOM host 除去だけを担当する。
- `applyPanelState()` は state effects を含む panel 状態の再適用である。
- `refreshPanel()` は既存 state に基づく描画のみを担当する。
- `panelRenderer` と `getPanelRenderInput()` は `content.js` から `createPanelUi()` へ DI される。
- `modules/subtitle-block-state.js` は subtitle block sequence、current block 解決、current block mirror 同期、panel open 時の block rebuild を担当する。
- `modules/panel-renderer.js` は共有 state を直接読まず、入力から描画結果と snapshot を返す。
- `modules/panel-visibility-state.js` は `panelOpen` の load / persist 専用であり、DOM、render、snapshot、block state を持たない。

また、今回の整理では `content.js` を probe / logger DI の集約点として維持する。  
module ごとに独自 logger を増やさず、既存の debug flag と probe 注入の流儀を崩さない。

***

## 対象ファイル

| ファイル | 今回の主責務 | 今回やること | 現在の状態 |
| :-- | :-- | :-- | :-- |
| `modules/playback-startup-coordinator.js` | playback target 変化、startup readiness、起動前段の統制 | 単一 start 入口に寄せる、次段の compact probe 対象にする | 完了。`attachAndMaybeStart(...)` 中心の起動入口へ集約済み。次は観測強化。 |
| `settings-runtime.js` | runtime 設定反映、再評価要求 | 直接 start 経路を外す、未設定時 notice-only 判定の整理対象にする | 完了。direct start / readiness wait / addtrack watch / `restartBilingual(...)` を整理済み。 |
| `reinitialize-coordinator.js` | 再起動理由判定、再評価要求 | 実 cleanup / 実再構築を外す | 完了。`clearInternalSubtitleState(...)` 直呼びを除去し、cleanup owner 経由へ集約済み。 |
| `modules/playback-session-cleanup.js` | session teardown、dispose 入口、owner API | teardown 唯一入口として固定する、次段の compact probe 対象にする | 完了。owner API と説明層の整備済み。次は観測強化。 |
| `modules/panel-ui.js` | session 従属 panel UI、native toggle / tabs 監視 | cleanup subordinate を維持しつつ、native UI 幅追従調査対象にする | 一部完了。subordinate 化は済み。次は `watchForPlayerTabs()` 周辺調査。 |
| `modules/debug-panel-runtime.js` | session 従属 debug runtime | cleanup subordinate を維持する | 完了。説明層整理済み。 |
| `content.js` | DI / wiring / logger / probe 注入のハブ | direct cleanup を増やさず helper / DI を縮退する、`applyLayout(...)` と notice-only 分岐を調査する | 一部完了。主要 callsite 集約は済み。helper / DI の最終整理と次段調査が残る。 |

***

## 判断基準

### 単一路線を優先する

起動要求は `modules/playback-startup-coordinator.js`、終了要求は `modules/playback-session-cleanup.js` に寄せる。  
その場しのぎの direct start / direct cleanup を増やさず、入口は必ず既存 owner API に収束させる。

### state 層と lifecycle 層を分ける

`settings-runtime.js` は state 側、`modules/playback-startup-coordinator.js` と `modules/playback-session-cleanup.js` は lifecycle 側として整理する。  
`reinitialize-coordinator.js` はその中間で reason を正規化する薄い層に保つ。

### UI を session 従属物として扱う

`panel-ui.js` と `debug-panel-runtime.js` は owner ではなく subordinate として扱う。  
panel / overlay / debug UI は session 所有物として cleanup owner 登録の対象にする。

### probe の読みやすさを壊さない

今回の責務移管後も、startup / panel / recovery probe を見れば rebuild 経路が追える状態を保つ。  
次段では compact probe を追加し、300 件ログ制限でも多重起動の切り分けができる粒度を優先する。

***

## ファイル別チェックリスト

### 1. `modules/playback-startup-coordinator.js`

#### 残す責務

- playback target の変化検知後に attach / start 可否を判断する。
- readiness 待ち、retry、poll、`addtrack` 監視を起動前段 owner として持つ。
- start 要求を `attachAndMaybeStart(video, reason, options)` に集約する。
- startup attempt の再入防止。

#### 移す責務

- 追加の direct start 経路は受け持たない。
- 実 session teardown は cleanup owner に委譲する。

#### 消す経路

- coordinator 外からの readiness wait の再導入。
- settings runtime / content 側からの直接 start。

#### 実装チェック

- [x] 単一 start 入口が `attachAndMaybeStart(...)` に揃っている。
- [x] readiness wait と `addtrack` watch が coordinator 内に集約されている。
- [ ] compact probe で request ID / target / retry / attach 成否を読めるようにする。
- [ ] startup 多重発火の切り分けに必要な最小ログ項目を定義する。

### 2. `settings-runtime.js`

#### 残す責務

- 設定読込 / 保存。
- runtime state 反映。
- 再評価要求の発行。

#### 移す責務

- start / restart / readiness wait を startup coordinator へ委譲する。
- 実 cleanup は cleanup owner へ委譲する。

#### 消す経路

- `startBilingual()` の直接呼び。
- `restartBilingual(...)` の直接起動。
- readiness 待ちのための listener / poll / timeout。

#### 実装チェック

- [x] direct start / readiness wait / addtrack watch / `restartBilingual(...)` を整理した。
- [x] 再評価要求だけを lifecycle 側へ渡す構成に揃えた。
- [ ] 言語未設定時 notice-only 方針で必要な state 判定を整理する。
- [ ] notice-only 化後に session 起動要求を出さない条件を明文化する。

### 3. `reinitialize-coordinator.js`

#### 残す責務

- rebuild reason の分類・正規化。
- 再評価要求の発行。
- restart 要求時の lifecycle owner 連携。

#### 移す責務

- 実 cleanup は `modules/playback-session-cleanup.js` へ委譲する。
- 実 start / rebuild 実行は startup coordinator 側へ委譲する。

#### 消す経路

- `clearInternalSubtitleState(...)` の direct call。
- reinitialize 層が独自に teardown owner を持つ構造。

#### 実装チェック

- [x] `clearInternalSubtitleState(...)` の直呼びを除去した。
- [x] restart cleanup を cleanup owner API 経由へ置換した。
- [x] reason 分類層として読める構造に寄せた。
- [x] 実 cleanup owner を持たない状態を確認した。

### 4. `modules/playback-session-cleanup.js`

#### 残す責務

- session teardown の唯一入口。
- timer / listener / observer / DOM / panel / debug / subtitle state cleanup の集約。
- restart 用 cleanup と extension OFF 用 cleanup の区別。
- session 所有物登録の受け皿。

#### 移す責務

- `reinitialize-coordinator.js` に残っていた実 cleanup を引き受ける。
- `content.js` の direct cleanup callsite を owner API 経由へ吸収する。

#### 消す経路

- owner 外からの部分 teardown 主導。
- direct subtitle clear の増殖。

#### 実装チェック

- [x] owner API 群を整理した。
- [x] `content.js` の主要 direct cleanup callsite を集約した。
- [x] `reinitialize-coordinator.js` からの restart cleanup を受ける入口に揃えた。
- [x] `teardownForRestart()` の説明層を reinitialize 経路込みで読める状態にした。
- [ ] compact probe で teardown reason / session ID / preserve DOM 有無を追えるようにする。

### 5. `modules/panel-ui.js`

#### 残す責務

- session 従属 panel UI の mount / refresh / dispose。
- native toggle observer、panel host、overlay host、player tabs 監視の subordinate 管理。
- panel 状態適用と描画 API の提供。

#### 移す責務

- cleanup owner ではなく、session cleanup owner 配下の subordinate として振る舞う。
- native UI 幅追従の補正が必要なら、レイアウト責務として限定的に持つ。

#### 消す経路

- panel module 自身が cleanup owner のように見える説明。
- layout 問題の場当たり的対処。

#### 実装チェック

- [x] subordinate UI module として説明を整理した。
- [x] `dispose()` の高レベル入口を維持している。
- [ ] `watchForPlayerTabs()` が native UI 幅追従漏れの起点かを調査する。
- [ ] 70/30 レイアウト時にどの DOM を補正対象とするかを整理する。

### 6. `modules/debug-panel-runtime.js`

#### 残す責務

- session 従属 debug runtime の mount / unmount / snapshot 表示。
- debug panel DOM / listener / timer の局所管理。

#### 移す責務

- cleanup owner ではなく subordinate runtime として cleanup owner 配下に入る。

#### 消す経路

- debug runtime が独立 owner に見える説明。
- cleanup owner をバイパスする dispose 経路。

#### 実装チェック

- [x] subordinate runtime として説明を整理した。
- [x] cleanup owner 配下で説明できる状態を維持した。

### 7. `content.js`

#### 残す責務

- DI / wiring / logger / probe 注入のハブ。
- 各 owner / subordinate module の接続。
- session 外共通 helper の保持。

#### 移す責務

- direct cleanup を cleanup owner API へ委譲する。
- subtitle state reset helper は cleanup owner 内部利用前提の文脈へ縮退する。
- layout / notice-only の分岐整理ではハブとして最小限の橋渡しだけを持つ。

#### 消す経路

- direct cleanup callsite の再追加。
- reinitialize 層へ渡す不要な cleanup helper DI。
- UI 再マウント単独を rebuild 理由にする分岐。

#### 実装チェック

- [x] `clearSubtitles` を `clearPlaybackSessionUiState("startup-clear-subtitles")` へ差し替えた。
- [x] manual restart cleanup を owner API 経由へ寄せた。
- [x] `clearInternalSubtitleState(...)` のコメントを cleanup owner が使う内部 helper 文脈へ更新した。
- [x] `reinitialize-coordinator.js` へ渡す cleanup helper DI を縮退した。
- [ ] `clearInternalSubtitleState(...)` の物理配置と命名が owner 境界として十分読みやすいかを再点検する。
- [ ] `applyLayout(...)` が native UI 幅追従漏れの起点かを調査する。
- [ ] 未設定時に `mountToggleOnlyUi()` や session 起動へ流れない gate を整理する。

***

## 実装ステップ

| 順序 | 対象 | 状態 | やること | 完了の見え方 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | `settings-runtime.js` | 完了 | direct start / readiness wait / addtrack watch / `restartBilingual(...)` を外し、再評価要求へ寄せた。 | state 層として読める。 |
| 2 | `modules/playback-startup-coordinator.js` | 完了 | 単一 start 入口 API を固定し、settings / target change 系要求をここへ寄せた。 | coordinator が起動前段 owner として読める。 |
| 3 | `modules/playback-session-cleanup.js` | 完了 | owner API 群と説明層を整理し、主要 direct cleanup callsite の受け皿を作った。 | teardown 唯一入口として読める。 |
| 4 | `reinitialize-coordinator.js` | 完了 | `clearInternalSubtitleState(...)` 直呼びを除去し、restart cleanup を cleanup owner 経由へ置換した。 | reason 分類層として読める。 |
| 5 | `content.js` | 進行中 | helper / DI を cleanup owner 内部前提へさらに縮退し、ハブ構造を明確化する。 | direct cleanup を持たない wiring 層へ近づく。 |
| 6 | `modules/playback-startup-coordinator.js` / `content.js` / `modules/playback-session-cleanup.js` | 未着手 | compact probe を追加し、起動多重発火の切り分け観測を行う。 | request / attach / start / teardown の相関が読める。 |
| 7 | `content.js` / `modules/panel-ui.js` | 未着手 | native UI 幅追従漏れの原因を棚卸しし、補正責務を決める。 | 70/30 時の Apple TV+ ネイティブ UI 追従漏れの起点が説明できる。 |
| 8 | `content.js` / `settings-runtime.js` / `modules/panel-ui.js` | 未着手 | 未設定時 notice-only 化を行い、toggle-only UI / session 起動を止める。 | 言語未設定時は notice だけが出る。 |

***

## ブラウザテスト観点

### startup / rebuild

- [x] settings changed / target change / track invalidation から最終的に同じ rebuild 経路へ流れる。
- [x] `settings-runtime.js` が直接 `startBilingual()` を呼ばない。
- [ ] startup probe で request / attach / session-start の相関を追える。
- [ ] 同一 target に対する多重 start が観測上どう見えているか切り分けできる。

### cleanup / stale session

- [x] `modules/playback-session-cleanup.js` が teardown 唯一入口として読める。
- [x] `reinitialize-coordinator.js` が実 cleanup owner を持たない。
- [x] panel / debug / overlay / listener / timer / observer が cleanup owner 経由で説明できる。
- [ ] teardown probe で restart / disable / target change ごとの差が読める。

### panel / debug UI

- [x] panel UI と debug panel が subordinate module / runtime として読める。
- [x] `dispose()` と owner cleanup の責務境界が崩れていない。
- [ ] 70/30 レイアウト時に native UI 幅追従が崩れる箇所を再現・説明できる。

### probe / 観測

- [x] startup / panel / recovery probe の既存観測性は維持されている。
- [ ] compact probe 追加後も 300 件上限内で主要経路が読める。
- [ ] request ID / session ID / reason / teardown 種別が相関できる。

### 未設定時 UX

- [ ] secondary / translated / primary の言語未設定時は notice のみ表示される。
- [ ] `mountToggleOnlyUi()` が未設定時の既定経路に残っていない。
- [ ] notice-only 状態で不要な session 起動や rebuild が走らない。

***

## 今回の作業メモ

- `reinitialize-coordinator.js` に残っていた `clearInternalSubtitleState(...)` 直呼びは、cleanup owner API へ寄せることで実 cleanup 責務を外した。
- `modules/playback-session-cleanup.js` は restart teardown の正式入口として説明できる状態まで整理が進んだ。
- `content.js` の `clearInternalSubtitleState(...)` は、物理削除を急ぐよりも cleanup 内部専用 helper として読める位置づけへ縮退させる方針が妥当である。
- 一方で、実機ログでは startup request / attach / session-start の短時間多発が見えており、次は構造変更より先に compact probe で相関観測を強める必要がある。
- また、70/30 レイアウト時の Apple TV+ ネイティブ UI 幅追従漏れは cleanup owner 整理とは別系統のため、`content.js` と `panel-ui.js` のレイアウト責務として切り分けて調査する。

***

## 次回着手順

1. `modules/playback-startup-coordinator.js`、`content.js`、`modules/playback-session-cleanup.js` に compact probe を追加し、**起動多重発火の
