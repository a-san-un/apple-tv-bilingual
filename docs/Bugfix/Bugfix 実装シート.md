# Bugfix 実装シート 2026-08-31（責務移管チェックリスト版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** `docs/Bugfix/Bugfix マスタープラン.md`  
**対応方針メモ:** `docs/Bugfix/字幕同期・切り替え条件統合と責務再設計メモ.md`、`docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md`、`docs/Bugfix/Step17-B_visibility-lifecycle_方針整理メモ.md`、`docs/Bugfix/Step17-C_残存ログprobe制御_方針整理メモ.md`  
**最新反映コミット:** startup owner 一本化、cleanup owner API / 説明層整備、`content.js` の主要 direct cleanup callsite 集約まで反映した時点のローカル状態に更新する。
**現在の作業:** Step 17-B / Step 17-C の前提整理として進めてきた playback session lifecycle の owner 再設計は、**起動入口一本化と cleanup owner 側受け皿の整備までは完了**している。 現在は、`reinitialize-coordinator.js` に残る `clearInternalSubtitleState(...)` 直呼びと、`content.js` に残る helper / DI の縮退を中心とした cleanup owner 一本化の残差整理フェーズである。

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
- 一方で、`reinitialize-coordinator.js` に残る `clearInternalSubtitleState(...)` 直呼びと、`content.js` に残る helper / DI の縮退は未完了である。

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
| `modules/playback-startup-coordinator.js` | playback target 変化、startup readiness、起動前段の統制 | 単一 start 入口に寄せる | 完了。`attachAndMaybeStart(...)` 中心の起動入口へ集約済み。 |
| `settings-runtime.js` | runtime 設定反映、再評価要求 | 直接 start 経路を外す | 完了。direct start / readiness wait / addtrack watch / `restartBilingual(...)` を整理済み。 |
| `reinitialize-coordinator.js` | 再起動理由判定、再評価要求 | 実 cleanup / 実再構築を外す | 一部完了。理由分類層への縮退方針は明確だが、`clearInternalSubtitleState(...)` 直呼びが残る。 |
| `modules/playback-session-cleanup.js` | session teardown、再入防止 | 唯一の cleanup 入口に寄せる | 一部完了。owner API / 説明層整備と主要 callsite 集約は完了。 |
| `modules/panel-ui.js` | panel lifecycle、render、dispose | session cleanup 配下に位置づける | 完了。session 従属 UI module として説明層更新済み。 |
| `modules/debug-panel-runtime.js` | debug UI lifecycle、購読、解除 | session 従属 UI として cleanup 配下に置く | 完了。subordinate runtime として説明層更新済み。 |
| `content.js` | probe / logger DI ハブ | 既存 probe 注入構造を維持する | 一部完了。主要 direct cleanup callsite は cleanup owner 経由へ置換済みだが、helper / DI の縮退が残る。 |

***

## 判断基準

### 単一路線を優先する

今回の判断基準は、個々の module をきれいにすることよりも、**起動と teardown の経路を一本化できるか**を優先する。
部分最適で helper を増やすより、owner を減らし、どこから session が始まりどこで終わるかを明確にする方を優先する。

### state 層と lifecycle 層を分ける

設定反映や requested language 更新のような state 操作と、session の start / cleanup のような lifecycle 操作を混ぜない。
`settings-runtime.js` は state 側、`modules/playback-startup-coordinator.js` と `modules/playback-session-cleanup.js` は lifecycle 側として整理する。

### UI を session 従属物として扱う

panel UI や debug panel runtime は独立 owner を持つ UI として扱わず、session に従属する UI として扱う。
session が終わるときは UI も必ず同じ owner が dispose する。

### probe の読みやすさを壊さない

今回の責務移管後も、startup / panel / recovery probe を見れば rebuild 経路が追える状態を保つ。
責務整理のために観測性を落とさないことを前提に進める。

***

## ファイル別チェックリスト

### 1. `modules/playback-startup-coordinator.js`

#### 残す責務

- playback target の検知。
- target change の抑制と重複防止。
- readiness 待ち。
- delayed retry。
- start 入口の一本化。
- startup attempt の再入防止。

#### 移す責務

- `settings-runtime.js` に残っていた readiness 待ち。
- `settings-runtime.js` に残っていた `addtrack` 起点 start。
- `settings-runtime.js` に残っていた timeout / polling による起動補助。

#### 消す経路

- coordinator 外からの独自 start owner。
- 「必要そうだから start する」系の分散入口。
- 同じ target に対する重複 start 判定。

#### 実装チェック

- [x] 単一 start 入口を `attachAndMaybeStart(video, reason, options)` に揃えた。
- [x] readiness 待ちを coordinator 側へ寄せた。
- [x] settings changed 時の起動要求が coordinator 経由で読める状態になった。

### 2. `settings-runtime.js`

#### 残す責務

- 設定読込。
- 設定保存。
- runtime state 更新。
- 再評価依頼。

#### 移す責務

- readiness 待ち。
- `addtrack` listener。
- 直接 start。
- 独自 retry / timeout。

#### 消す経路

- `startBilingualWhenTracksReady()`。
- 直接 `startBilingual(...)`。
- `restartBilingual(...)` の実 start 部分。

#### 実装チェック

- [x] settings runtime 自身が readiness wait / addtrack watch / retry を持たない状態になった。
- [x] 起動要求が `coordinator.attachAndMaybeStart(...)` に集約された。
- [x] `restartBilingual(...)` は削除済みである。

### 3. `reinitialize-coordinator.js`

#### 残す責務

- 再起動理由の分類。
- reason code の整形。
- rebuild 要求発行。

#### 移す責務

- 実 cleanup。
- 内部 state 強制破棄。
- 実再構築。

#### 消す経路

- `clearInternalSubtitleState(...)` の実 cleanup owner 化。
- 二重 teardown / rebuild。

#### 実装チェック

- [ ] `clearInternalSubtitleState(...)` の直呼びを除去する。
- [ ] 理由分類 + rebuild request 中心の薄い層として読めることを確認する。
- [ ] cleanup owner を `modules/playback-session-cleanup.js` へ完全移譲する。

### 4. `modules/playback-session-cleanup.js`

#### 残す責務

- session teardown。
- cleanup 再入防止。
- session 所有物の解放。
- UI / listener / observer / timer / retry / DOM の cleanup 集約。
- cleanup 実行済み管理。

#### 移す責務

- `reinitialize-coordinator.js` の実 cleanup。
- `content.js` 側の手動 cleanup。
- UI 個別モジュールからの owner 不明 dispose 統括。

#### 消す経路

- session cleanup を通らず UI だけ落とす経路。
- 外部からの部分 teardown の乱立。
- 各モジュールが自前 owner 顔で cleanup する構造。

#### 実装チェック

- [x] owner API 群の公開と JSDoc 文脈を cleanup owner に揃えた。
- [x] `content.js` の主要 direct cleanup callsite を owner API 経由へ寄せた。
- [ ] `reinitialize-coordinator.js` 側の残存直呼びがなくなり、唯一入口として読めることを確認する。

### 5. `modules/panel-ui.js`

#### 残す責務

- panel lifecycle。
- render。
- state apply。
- UI dispose 実装。

#### 移す責務

- session 全体 cleanup 統括。

#### 消す経路

- panel から session 全体 start / rebuild / cleanup を逆流制御する経路。

#### 実装チェック

- [x] ヘッダーと factory 文脈を session 従属 UI module に揃えた。
- [x] `dispose()` JSDoc を subordinate UI 側の撤収口として整理した。
- [x] cleanup owner ではなく dispose される側として読める状態を確認した。

### 6. `modules/debug-panel-runtime.js`

#### 残す責務

- debug panel runtime の購読。
- debug UI 描画。
- debug UI の解除処理。

#### 移す責務

- session 寿命の owner 判断。
- cleanup 統括。

#### 消す経路

- debug panel が古い session に残る経路。
- debug UI が独自 owner として残留する構造。

#### 実装チェック

- [x] session 従属 debug runtime としてヘッダー文脈を更新した。
- [x] unmount / dispose の説明を cleanup owner 配下の撤収へ揃えた。
- [x] stale session を支配する owner ではなく subordinate runtime として読める状態を確認した。

### 7. `content.js`

#### 残す責務

- probe / logger DI の集約。
- module 間配線。
- debug flag の管理。

#### 移す責務

- なし。新たな lifecycle owner は持たせない。

#### 消す経路

- owner 判定や実 cleanup を `content.js` へ戻す構造。
- module ごとの独自 logger 乱立。

#### 実装チェック

- [x] `clearSubtitles` を `clearPlaybackSessionUiState("startup-clear-subtitles")` へ差し替えた。
- [x] manual restart cleanup を `prepareForRestart({ reason: "manual-restart-cleanup" })` へ差し替えた。
- [x] `clearInternalSubtitleState(...)` のコメントを cleanup owner が使う内部 helper 文脈へ更新した。
- [ ] helper / DI の残存が、外向き cleanup API ではなく内部 helper として読める最終形になっているかを確認する。

***

## 実装ステップ

| Step | 対象ファイル | 状態 | 実装内容 | 確認結果 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | `settings-runtime.js` | 完了 | 直接 `startBilingual()` を呼ぶ経路、tracks readiness 待ち、`addtrack` listener、poll / timeout 起動経路を整理した。 | start owner が settings 側に残らない状態になった。 |
| 2 | `modules/playback-startup-coordinator.js` | 完了 | 単一 start 入口 API を固定し、settings / target change 系要求をここへ寄せた。 | coordinator が起動前段 owner として読める。 |
| 3 | `settings-runtime.js` | 完了 | start 経路を coordinator 呼び出しへ置換し、settings 層から直接起動責務を外した。 | settings changed 時の動作が re-evaluate request に揃った。 |
| 4 | `reinitialize-coordinator.js` | 一部完了 | 実 cleanup / 実再構築を外す方向へ縮退中。 | 理由分類層への寄せは進んだが、`clearInternalSubtitleState(...)` 直呼びが残る。 |
| 5 | `modules/playback-session-cleanup.js` | 一部完了 | session teardown の owner API と説明層を整備し、所有物と dispose 文脈を明文化した。 | cleanup 受け皿としては読めるが、唯一入口化は残差整理待ちである。 |
| 6 | `modules/panel-ui.js` | 完了 | `panelUi.dispose()` の呼び出し統括を cleanup 層配下の subordinate UI 文脈へ寄せた。 | panel UI が独自 owner になっていないことを説明層で確認した。 |
| 7 | `modules/debug-panel-runtime.js` | 完了 | debug runtime を session cleanup 配下の subordinate runtime 文脈へ寄せた。 | debug panel が session 従属 UI として読める。 |
| 8 | `content.js` | 一部完了 | probe / logger DI の配線を維持しつつ、主要 direct cleanup callsite を cleanup owner API へ置換した。 | 観測性は維持されているが、helper / DI 縮退が残る。 |
| 9 | ブラウザテスト | 未着手 | ON / OFF、SPA 遷移、track invalidation、panel 開閉、debug panel 開閉を実機確認する。 | rebuild 経路が一筆書きで読め、二重化や stale session が出ないことを確認する。  |

***

## ブラウザテスト観点

### startup / rebuild

- [ ] settings changed から同じ rebuild 経路に入る。
- [ ] target change から同じ rebuild 経路に入る。
- [ ] track invalidation から同じ rebuild 経路に入る。
- [x] coordinator 以外が直接 start owner になっていない。

### cleanup / stale session

- [ ] ON → OFF → ON で listener / timer / UI が二重化しない。
- [ ] SPA 遷移後に旧 session の UI や購読が残らない。
- [ ] cleanup 多重実行時にも破綻しない。
- [ ] debug panel を開いたままでも stale session が残らない。

### panel / debug UI

- [ ] panel 開閉だけでは session owner が増えない。
- [x] panel UI dispose が cleanup 経由で説明できる。
- [x] debug panel dispose が cleanup 経由で説明できる。

### probe / 観測

- [ ] startup probe で起動前段の流れを追える。
- [ ] panel probe で panel apply / refresh / dispose の流れを追える。
- [ ] recovery probe で rebuild 前後の復帰経路を追える。
- [ ] 必要なら将来 `logLifecycleProbe` へ切り出せる粒度で高レベルログを残せている。

***

## 今回の作業メモ

- 起動入口一本化は、`settings-runtime.js` 側の direct start 経路を外し、`coordinator.attachAndMaybeStart(...)` に寄せるところまで完了している。
- cleanup owner 側は、`modules/playback-session-cleanup.js` の owner API / JSDoc / 説明層整備と、`content.js` の主要 direct cleanup callsite 集約までは完了している。
- `panel-ui.js` / `debug-panel-runtime.js` は cleanup owner ではなく、session 従属 UI module / runtime として読める状態に更新済みである。
- 現在の最優先は、`reinitialize-coordinator.js` に残る `clearInternalSubtitleState(...)` 直呼びを除去し、cleanup 経路を完全に owner 側へ寄せることである。
- `content.js` の `clearInternalSubtitleState(...)` は物理削除を急ぐのではなく、cleanup 内部専用 helper へ格下げして owner 境界を明確にする方針で進める。
- 今回の整理は、メモリーリーク対策そのものというより、stale な半死状態 session を残さないための lifecycle 整理として扱う。

***

## 次回着手順

次回は次の順に着手する。

1. `reinitialize-coordinator.js` の `clearInternalSubtitleState(...)` 直呼びを cleanup owner 経由へ置換する。
2. `content.js` に残る `clearInternalSubtitleState(...)` の helper / DI を cleanup 内部専用 helper 文脈へさらに縮退する。
3. `modules/playback-session-cleanup.js` が実装・説明の両方で唯一入口として読めることを再確認する。
4. 不要になった watcher / timer / wrapper / 補助 cleanup を物理削除する。
5. probe を見ながらブラウザテストを実施する。

この順番で進める理由は、起動入口はすでに揃っているため、残りは cleanup 側の owner 境界を詰める方が差分を追いやすいからである。
start owner を再度触るより、cleanup 残差を片付けたうえで browser test に入る方が安全に検証しやすい。

