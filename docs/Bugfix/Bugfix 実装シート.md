# Bugfix 実装シート 2026-08-30（責務移管チェックリスト版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** `docs/Bugfix/Bugfix マスタープラン.md`  
**対応方針メモ:** `docs/Bugfix/字幕同期・切り替え条件統合と責務再設計メモ.md`、`docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md`、`docs/Bugfix/Step17-B_visibility-lifecycle_方針整理メモ.md`、`docs/Bugfix/Step17-C_残存ログprobe制御_方針整理メモ.md`  
**最新反映コミット:** `1077e4f refactor: startup・panel・recovery の詳細ログを probe 経由へ追加整理する`  
**現在の作業:** Step 17-B / Step 17-C の前提整理として、playback session lifecycle の owner を単一路線へ寄せる責務移管チェックリストを正本化し、`settings-runtime.js`・`reinitialize-coordinator.js`・`modules/playback-startup-coordinator.js`・`modules/playback-session-cleanup.js` を中心に起動入口と cleanup 入口の一本化を進める。

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

| ファイル | 今回の主責務 | 今回やること |
| :-- | :-- | :-- |
| `modules/playback-startup-coordinator.js` | playback target 変化、startup readiness、起動前段の統制 | 単一 start 入口に寄せる |
| `settings-runtime.js` | runtime 設定反映、再評価要求 | 直接 start 経路を外す |
| `reinitialize-coordinator.js` | 再起動理由判定、再評価要求 | 実 cleanup / 実再構築を外す |
| `modules/playback-session-cleanup.js` | session teardown、再入防止 | 唯一の cleanup 入口に寄せる |
| `modules/panel-ui.js` | panel lifecycle、render、dispose | session cleanup 配下に位置づける |
| `modules/debug-panel-runtime.js` | debug UI lifecycle、購読、解除 | session 従属 UI として cleanup 配下に置く |
| `content.js` | probe / logger DI ハブ | 既存 probe 注入構造を維持する |

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

- playback target 変化検知。
- startup readiness 判定。
- readiness 待ち。
- delayed retry。
- start attempt token / 再入防止。
- cleanup 後の attach / start 仲介。

#### 移す責務

- `settings-runtime.js` に残っている tracks readiness 待ち。
- `settings-runtime.js` に残っている `addtrack` 起点の起動判断。
- settings 側の poll / timeout ベース起動補助。

#### 消す経路

- coordinator を通らずに start する入口。
- settings / reinitialize / UI 層からの直接 start owner 化。

#### 実装チェック

- [ ] 単一 start 入口 API を決める。
- [ ] settings 変更時の再評価要求をこの API に集める。
- [ ] track invalidation 時の再評価要求をこの API に集める。
- [ ] delayed retry の owner が coordinator だけになるよう確認する。
- [ ] startup probe で起動前段の流れが追えることを確認する。

### 2. `settings-runtime.js`

#### 残す責務

- 保存設定の読込。
- runtime state 反映。
- language / mode / enabled 状態の更新。
- coordinator への再評価依頼。

#### 移す責務

- `startBilingualWhenTracksReady()` 相当の起動待機。
- `startBilingual()` の直接呼び出し。
- `textTracks.addEventListener("addtrack")` による start 経路。
- `setInterval` / `setTimeout` による readiness 待ち。

#### 消す経路

- settings 変更時に自前で start する経路。
- settings 層が起動 owner になる構造。

#### 実装チェック

- [ ] 直接 `startBilingual()` を呼んでいる箇所を全件洗い出す。
- [ ] `startBilingualWhenTracksReady()` があれば削除または coordinator 呼び出しへ置換する。
- [ ] `addtrack` listener が start のために使われていれば coordinator 側へ移す。
- [ ] poll / timeout による起動待機が settings 側に残っていないか確認する。
- [ ] settings changed 時の動作が「start」ではなく「re-evaluate request」になるよう揃える。

### 3. `reinitialize-coordinator.js`

#### 残す責務

- 再起動理由の分類。
- rebuild 要求の発行。
- reason / option の橋渡し。

#### 移す責務

- `clearInternalSubtitleState()` のような実 cleanup。
- 自前の再接続処理。
- 実 teardown と実再構築の owner 判断。

#### 消す経路

- 判定層がそのまま session を壊して作り直す経路。
- cleanup 層と競合する二重 owner 構造。

#### 実装チェック

- [ ] 実 cleanup をしている関数を洗い出す。
- [ ] cleanup 実装を `modules/playback-session-cleanup.js` へ移す。
- [ ] start 実装を coordinator / start 本体へ寄せる。
- [ ] このファイルは reason 判定と rebuild request 中心になるよう整理する。
- [ ] reset options 契約を壊さず責務だけ薄くする。

### 4. `modules/playback-session-cleanup.js`

#### 残す責務

- session 単位の teardown。
- 再入防止。
- dispose 順序の統制。
- session 所有物の解放。

#### 移す責務

- 各 module に散っている timer / listener / observer 解放。
- UI 側に散っている session teardown の統括。
- `reinitialize-coordinator.js` に残る実 cleanup。

#### 消す経路

- どこかが独自に少しずつ cleanup する経路。
- session cleanup を通らない部分 teardown。

#### 実装チェック

- [ ] cleanup の単一入口 API を決める。
- [ ] session 所有物一覧を明文化する。
- [ ] timer / listener / observer / DOM / UI dispose がここ経由になるよう揃える。
- [ ] cleanup 多重実行防止を確認する。
- [ ] lifecycle probe 候補として高レベル cleanup ログの位置づけを整理する。

### 5. `modules/panel-ui.js`

#### 残す責務

- panel lifecycle。
- panel render。
- state 適用。
- `panelUi.dispose()` 実装。

#### 移す責務

- session 全体 cleanup の統括。
- panel から session lifecycle を逆流制御する責務。

#### 消す経路

- panel UI が独自 owner として session start / rebuild / cleanup を支配する経路。

#### 実装チェック

- [ ] `panelUi.dispose()` は UI dispose 実装として残す。
- [ ] 呼び出し統括は cleanup 層へ寄せる。
- [ ] `removeHost()` は低レベル DOM 除去専用のまま維持する。
- [ ] `applyPanelState()` と `refreshPanel()` の責務境界を崩さない。
- [ ] panel probe の読み方が変わらないことを確認する。

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

- [ ] session start 時 mount、session cleanup 時 dispose の形に揃える。
- [ ] 購読解除・listener 解放・DOM 撤収が cleanup 経由になるよう確認する。
- [ ] stale session 参照が残らないことを確認する。

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

- [ ] probe 注入構造を維持する。
- [ ] 新たな owner ロジックを `content.js` に戻さない。
- [ ] startup / panel / recovery の観測点が引き続き切り替え可能であることを確認する。

***

## 実装ステップ

| Step | 対象ファイル | 状態 | 実装内容 | 確認結果 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | `settings-runtime.js` | 未着手 | 直接 `startBilingual()` を呼ぶ経路、tracks readiness 待ち、`addtrack` listener、poll / timeout 起動経路を棚卸しする。 | start owner が settings 側に残っている箇所を一覧化できること。 |
| 2 | `modules/playback-startup-coordinator.js` | 未着手 | 単一 start 入口 API を決め、settings / reinitialize / track invalidation からの要求をここに寄せる。 | coordinator が起動前段 owner として読めること。 |
| 3 | `settings-runtime.js` | 未着手 | 棚卸しした start 経路を coordinator 呼び出しへ置換し、settings 層から直接起動責務を外す。 | settings changed 時の動作が re-evaluate request に揃うこと。 |
| 4 | `reinitialize-coordinator.js` | 未着手 | 実 cleanup と実再構築を外し、reason 判定と rebuild request 中心へ縮退する。 | 再起動理由の判定層として読めること。 |
| 5 | `modules/playback-session-cleanup.js` | 未着手 | session teardown の単一入口 API を決め、所有物と dispose 順序を明文化する。 | cleanup がここ経由で説明できること。 |
| 6 | `modules/panel-ui.js` | 未着手 | `panelUi.dispose()` の呼び出し統括を cleanup 層へ寄せ、session 従属 UI として位置づけ直す。 | panel UI が独自 owner になっていないこと。 |
| 7 | `modules/debug-panel-runtime.js` | 未着手 | debug runtime を session cleanup 配下へ寄せ、stale session 参照が残らないようにする。 | debug panel が session 従属 UI として読めること。 |
| 8 | `content.js` | 未着手 | probe / logger DI の配線を必要最小限だけ調整し、観測性を維持する。 | startup / panel / recovery probe の読み方を維持できること。 |
| 9 | ブラウザテスト | 未着手 | ON / OFF、SPA 遷移、track invalidation、panel 開閉、debug panel 開閉を実機確認する。 | rebuild 経路が一筆書きで読め、二重化や stale session が出ないこと。 |

***

## ブラウザテスト観点

### startup / rebuild

- [ ] settings changed から同じ rebuild 経路に入る。
- [ ] target change から同じ rebuild 経路に入る。
- [ ] track invalidation から同じ rebuild 経路に入る。
- [ ] coordinator 以外が直接 start owner になっていない。

### cleanup / stale session

- [ ] ON → OFF → ON で listener / timer / UI が二重化しない。
- [ ] SPA 遷移後に旧 session の UI や購読が残らない。
- [ ] cleanup 多重実行時にも破綻しない。
- [ ] debug panel を開いたままでも stale session が残らない。

### panel / debug UI

- [ ] panel 開閉だけでは session owner が増えない。
- [ ] panel UI dispose が cleanup 経由で説明できる。
- [ ] debug panel dispose が cleanup 経由で説明できる。

### probe / 観測

- [ ] startup probe で起動前段の流れを追える。
- [ ] panel probe で panel apply / refresh / dispose の流れを追える。
- [ ] recovery probe で rebuild 前後の復帰経路を追える。
- [ ] 必要なら将来 `logLifecycleProbe` へ切り出せる粒度で高レベルログを残せている。

***

## 今回の作業メモ

- いま優先すべきなのは helper 追加ではなく owner 削減である。
- 特に `settings-runtime.js` の start 系責務と `reinitialize-coordinator.js` の実 cleanup 責務を外すことが最優先である。
- `modules/playback-startup-coordinator.js` と `modules/playback-session-cleanup.js` を両端の正本入口にすることで、途中の module は薄くしやすくなる。
- panel / debug panel / secondary subtitle DOM を session 従属物として扱うと、UI 残留問題を説明しやすくなる。
- 今回の整理は、メモリーリーク対策そのものというより、stale な半死状態 session を残さないための lifecycle 整理として扱う。

***

## 次回着手順

次回は次の順に着手する。

1. `settings-runtime.js` の start 経路棚卸し。
2. `modules/playback-startup-coordinator.js` の単一入口 API 固定。
3. `settings-runtime.js` から直接 start 経路を除去。
4. `reinitialize-coordinator.js` の縮退。
5. `modules/playback-session-cleanup.js` の単一 cleanup 入口化。
6. panel / debug runtime の session cleanup 配下への統合。
7. probe を見ながらブラウザテスト。

この順番で進める理由は、最初に start owner を減らし、その後に cleanup owner を固定した方が、経路差分を追いやすいからである。  
cleanup 側から先に大きく動かすより、起動入口を先に揃えた方が安全に検証しやすい。

