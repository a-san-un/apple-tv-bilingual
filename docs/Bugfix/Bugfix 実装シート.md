# Bugfix 実装シート 2026-08-26（作業台版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-26（要約版）  
**最新反映コミット:** `6977bab refactor: panel dispose 契約と panel API 境界を固定する (Issue #32, Step 17-A-8)`  
**このシートの役割:** 今まさに着手している修正の対象・変更方針・実装順・検証観点・実機ログ観点を 1 枚に集約する。Step 7 中核、Step 12〜16 は完了済みであり、このシートは **Step 17-A の継続作業、Step 17 の panel 統合、Step 18 の term inspector 分離、および後続ワークストリーム** を管理する作業台として使う。

***

## 今回の作業テーマ

### 主テーマ

**M-3: 字幕同期 decision 統合後の薄化フェーズ**

`subtitle-sync-controller.js` を正本とした decision ベース統合の中核実装、退行防止テスト追加、recovery state 命名整理、cue sequence builder への導出集約までは完了した。

現在はその次段階として、Step 17-A で以下を実施済みである。

- 旧 root 直下の `debug-logger.js` と `debug-panel.js` を削除した。
- `modules/debug-logger.js`、`modules/debug-panel-runtime.js`、`modules/debug-panel-shell.js` を追加した。
- `content.js` から `updateLiveDebugPanel()` と logger callback 経由の debug panel 更新を削除した。
- `debugPanelRuntime.mount()` を使う debug panel runtime 経路へ切り替えた。
- `modules/subtitle-block-state.js` を追加し、subtitle block sequence の取得、current block の解決、current block mirror 同期、panel open 時の再同期を state owner に集約した。
- `content.js` にあった `getSubtitleBlockSequence`、`getCurrentSubtitleBlockFromSequence`、`setCurrentSubtitleBlock`、`rebuildSubtitleBlocksForPanelOpen` の wrapper 関数を削除した。
- `panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` を `modules/` 配下へ移動した。
- `manifest.json` の `content_scripts` 参照を移行先の module path に更新し、読み込み順を維持した。
- `content.js` から panel renderer の共有 state 直接依存を外し、`panelRenderer` と `getPanelRenderInput()` を `createPanelUi()` へ DI する構成に整理した。
- subtitle block facade から panel list の直接描画を外し、block rebuild と subtitle snapshot 更新までを担当する形へ縮小した。
- `panel.css` は `chrome.runtime.getURL("panel.css")` で参照する web accessible resource のため root 配置を維持した。
- `manifest.json`、options、settings、cleanup、state reset 周辺を新しい runtime 構成へ整合させた。
- `npm run lint` を実行し、`eslint *.js modules/*.js` がエラーなしで完了した。
- 変更は `3f33804` として commit / push 済みである。
- `modules/panel-ui.js` の `panelUi.dispose()` を panel 系 cleanup の高レベル入口として固定した。
- `panelUi.dispose()` は panel host、ShadowRoot、toggle button、native toggle observer、resize listener、render timer、render snapshot、renderer owner state、overlay DOM を対称に cleanup する。
- `removeHost()` は低レベルな DOM host 除去だけを担当し、observer / timer / render state / overlay cleanup は `panelUi.dispose()` に集約した。
- `content.js` に `destroyUiHosts()` / `destroyFeatureUiHosts()` が残っていないことを確認した。
- 再起動・拡張機能 OFF・content switch は `modules/playback-session-cleanup.js` 経由で、手動再起動 cleanup は `content.js` から、いずれも `panelUi.dispose()` に到達する経路として固定した。
- `applyPanelState()` は state effects を含む panel 状態の再適用、`refreshPanel()` は既存 state に基づく render のみを行う API として JSDoc を固定した。
- `modules/subtitle-state-reset.js` の complete reset と `modules/playback-session-cleanup.js` の restart 前軽量整理について、render snapshot を clear する理由を明文化した。
- 変更は `6977bab` として commit / push 済みである。

Step 17 全体としては未完了である。Step 17-A-8 の panel dispose 契約固定は完了し、次は Step 17-A-10 として `content.js` に残る panel / block API の高レベル中継境界を棚卸し・確定する。

### 副テーマ

- F-5: lifecycle ごとの secondary cleanup / mode restore の確認。
- F-8: decision 単位のログ整理と、トグル ON/OFF 相関ログの追加。
- M-1: 長時間再生時メモリ増加の継続観測。
- F-4: 初回 async response エラーの持ち越し調査。
- F-9: 拡張トグル時の完全リセット実装。
- F-10: 大きな seek 後の track 参照消失と `secondary-track-unbind-skipped` の調査。
- S-2: panel 系既存ファイルの `modules/` 統合、panel owner / dispose 契約の固定、`content.js` の panel / blocks API 境界整理。
- S-3: `content.js` の term inspector 薄化。

***

## 現在の症状

| # | 症状 | 観察事実 | 関連 ID | 状態 |
|---|---|---|---|---|
| 1 | メッセージチャネルクローズエラー（初回のみ） | `A listener indicated an asynchronous response...` はまだ残るが、UI 復旧自体は達成済み。 | F-4 | 🟠 持ち越し |
| 2 | ネイティブ字幕メニューに干渉せず OFF 後復元を成立させたい | secondary cleanup / mode restore は binder 側へ集約済み。ネイティブ UI を一度触るとトグル復帰率が上がる観察があり、トグル単独復帰はまだ未確認。 | F-5 | 🟠 検証継続 |
| 3 | DevConsole にログが残りやすい | noisy ログは一部 suppress 済み。debug logger / runtime は module 化済みだが、トグル ON/OFF を一意に追える相関ログは未整備。 | F-8 | 🟠 継続整理中 |
| 4 | 長時間再生で Renderer メモリ使用量が大きく増える | cleanup 多重実行対策は入ったが、listener / observer / timer / debug runtime の残留は継続観測が必要。完全リセットは未実装。 | M-1 | 🟠 調査継続 |
| 5 | 大きな seek 後に一時的に字幕情報が失われる | `secondary-track-unbind-skipped` は monitorState にも boundTrack にも track 参照が無いときに出る。大きな seek 直後に `hadCleanup:false`, `hadTrack:false` が連続し、unbind 対象自体が失われている可能性がある。 | F-10 | 🟠 新規調査 |
| 6 | トグル ON/OFF 操作がログに残り切らない | 実ログでは `extensionEnabled:false` やトグル単独操作の痕跡が不足し、観測基盤が弱い。 | F-9 | 🟠 観測基盤不足 |
| 7 | `content.js` がまだ大きい | debug update callback、旧 block wrapper、panel renderer の shared state 直接依存は外したが、term inspector 関連 state / shell と panel / block の高レベル中継 API が残る。 | S-2 / S-3 | 🟠 継続作業 |
| 8 | panel cleanup の owner 境界は固定済み | panel UI / renderer / blocks / resolver の `modules/` 移行に加え、`panelUi.dispose()` を UI cleanup の高レベル入口として固定した。block state は subtitle 側 owner の責務として分離した。 | S-2 | ✅ 完了 |
| 9 | subtitle block state の公開 API 境界が未固定 | `modules/subtitle-block-state.js` は sequence/current block の読み取り・解決・同期を担当する。`content.js` に残る `getSubtitleBlockSequence`、`getCurrentSubtitleBlockFromSequence`、`renderCurrentSnapshot`、`applyPanelStateEffects` の利用元を棚卸しし、owner API と高レベル中継の境界を固定する必要がある。 | S-2 | 🟠 次作業 |
| 10 | panel renderer の state 直接参照は解消済み | `modules/panel-renderer.js` は `createPanelRenderer()` と `getPanelRenderInput()` から入力を受け、共有 state を直接参照しない。 | S-2 | ✅ 完了 |
| 11 | panel dispose 契約を固定済み | `panelUi.dispose()` を panel UI cleanup の高レベル入口とし、host、ShadowRoot、toggle、observer、resize listener、timer、render snapshot、renderer owner state、overlay DOM の責務を明文化した。block state は subtitle 側 owner に残す。 | S-2 | ✅ 完了 |
| 12 | recovery state モジュール名は整理済み | 旧 `secondary-track-recovery.js` は Step 15 で `lane-recovery-state` 系へ整理済みで、残るのは説明・参照の追従確認である。 | R-1 | ✅ 完了 |
| 13 | decision 統合、cue sequence builder、退行防止は整った | Step 12〜16 の実装・退行防止テスト追加まで完了しており、現在は panel / term inspector の責務整理フェーズである。 | M-3 | ✅ 完了済み土台 |
| 14 | debug runtime と subtitle block state の基盤整理 | debug logger / panel runtime / shell の module 化、旧 root debug files 削除、subtitle block state owner 導入、lint 成功、commit / push を完了した。 | Step 17-A | ✅ 基盤整理完了 |
| 15 | panel / block 系4ファイルの `modules/` 統合 | `modules/panel-ui.js`、`modules/panel-renderer.js`、`modules/subtitle-blocks.js`、`modules/subtitle-block-resolver.js` を `modules/` 配下へ移動し、manifest の参照更新と load order 維持を完了した。 | Step 17-A | ✅ 完了 |
| 16 | `panel.css` の配置方針は固定済み | `panel.css` は ShadowRoot 内から `chrome.runtime.getURL("panel.css")` で参照する web accessible resource であるため、root 配置維持を正とする。 | Step 17-A | ✅ 完了 |

***

## 今回の作業項目

- `content.js` に残る `getSubtitleBlockSequence`、`getCurrentSubtitleBlockFromSequence`、`renderCurrentSnapshot`、`applyPanelStateEffects` の利用元を棚卸しする。
- `content.js` に残す高レベル中継 API と、panel owner / block state owner に閉じる API を固定する。
- Step 17-B の visibility cleanup owner 固定と、Step 18 の term inspector 抽出へ渡す API 境界を記録する。

***

## 実装順序

### Step 17-A-8: panel dispose 契約の固定（完了）

| 順序 | 対象ファイル | 実施内容 | 結果 |
| :-- | :-- | :-- | :-- |
| 1 | `modules/panel-ui.js` | host / ShadowRoot / toggle / native toggle observer / resize listener / timer / overlay / render snapshot / renderer owner state の owner を棚卸しした。 | `panelUi.dispose()` を panel UI cleanup の高レベル入口として固定した。 |
| 2 | `content.js` | `destroyUiHosts()` / `destroyFeatureUiHosts()` の残存と、`removeHost()` / `panelUi.dispose()` の責務を確認した。 | 旧 cleanup 関数は残っておらず、`removeHost()` は低レベル DOM host 除去だけを担当する。 |
| 3 | `modules/playback-session-cleanup.js`、`modules/subtitle-state-reset.js`、`reinitialize-coordinator.js` | detach、content switch、無効化、再起動の cleanup 経路と snapshot clear を確認した。 | lifecycle ごとの `panelUi.dispose()` 到達経路と、complete reset / lightweight restart の snapshot clear 理由を明文化した。 |
| 4 | `modules/panel-ui.js`、`content.js` | panel owner を cleanup 入口とする dispose 契約と API 境界を JSDoc に固定した。 | `panelUi.dispose()` は冪等な UI cleanup、block state は subtitle 側 owner として分離した。 |
| 5 | `modules/panel-ui.js` | `applyPanelState()` / `refreshPanel()` の使い分けを JSDoc に固定した。 | 前者は effects を含む state 再適用、後者は既存 state に基づく描画のみと明文化した。 |

### Step 17-A-10: panel / block API 境界の固定

| 順序 | 対象ファイル | 実施内容 | 完了条件 |
| :-- | :-- | :-- | :-- |
| 1 | `content.js` | `getSubtitleBlockSequence`、`getCurrentSubtitleBlockFromSequence`、`renderCurrentSnapshot`、`applyPanelStateEffects` の利用元を列挙する。 | 全利用元と呼び出し目的を説明できる。 |
| 2 | `modules/subtitle-block-state.js`、`modules/subtitle-blocks.js`、`modules/subtitle-block-resolver.js` | block state / block build / render block resolve の API を分類する。 | `content.js` が block internals を読まない境界を定義できる。 |
| 3 | `modules/panel-ui.js`、`modules/panel-renderer.js` | `applyPanelState()` と `refreshPanel()` の責務と入力を固定する。 | public API が state 再適用と描画更新に整理される。 |
| 4 | `content.js` | DI、起動シーケンス、入力転送、dispose 呼び出しだけを残す方針を確認する。 | panel DOM / render / block internals が増えない。 |
| 5 | `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md` | Step 17-B / 18 へ渡す visibility / lifecycle / term inspector の境界を記録する。 | 後続ステップの API 前提が明文化される。 |

***

## 変更対象の責務マップ

| 領域 | 正本 owner | 主な対象 | `content.js` に残す範囲 | dispose / cleanup の境界 |
| :-- | :-- | :-- | :-- | :-- |
| panel visibility | `modules/panel-visibility-state.js` | `panelOpen` / `panelDefaultOpen` の load / persist | state 遷移の高レベル中継 | DOM / render / snapshot / block state を持たない |
| panel host / shell | `modules/panel-ui.js` | host、ShadowRoot、toggle、header action、native toggle observer、panel refresh | DI、起動、入力転送、`dispose()` 呼び出し | `panelUi.dispose()` を panel cleanup の入口にする |
| panel render | `modules/panel-renderer.js` | render input から DOM / snapshot を生成する | render input の提供 | host 作成、visibility 保存、lifecycle cleanup を持たない |
| subtitle block resolve | `modules/subtitle-block-resolver.js` | panel 表示用 block の normalize / resolve | renderer への高レベル入力転送 | DOM、state mutation、panel lifecycle を持たない |
| subtitle block build / state | `modules/subtitle-blocks.js`、`modules/subtitle-block-state.js` | block build、sequence、current block、panel open 時再同期 | builder / state owner を DI する | block state は subtitle 側 owner が clear し、`panelUi.dispose()` は block state を破棄しない |
| debug runtime | `modules/debug-panel-runtime.js`、`modules/debug-panel-shell.js` | debug host、logger 更新、debug lifecycle | mount / unmount の起動中継 | panel cleanup と host 範囲を混ぜない |
| term inspector | `content.js`（Step 17-A 時点） | term inspector state / shell / listener | 既存実装を維持する | Step 18 で panel owner と分離する |

***

## 実機確認手順

### Step 17-A-8: dispose 契約の回帰確認

1. 拡張機能を ON にし、panel host、ShadowRoot、toggle、overlay が1組だけ生成されることを確認する。
2. panel を開閉し、`panelOpen`、toggle 表示、overlay の位置・幅、panel snapshot が整合することを確認する。
3. 拡張機能を OFF にし、panel host、ShadowRoot、observer、listener、timer、render snapshot、overlay DOM が破棄されることを確認する。subtitle block state は subtitle lifecycle/reset owner の経路で次回 session へ持ち越されないことを確認する。
4. OFF → ON を複数回繰り返し、panel host、toggle、listener、observer が二重化しないことを確認する。
5. Apple TV+ 内で作品またはエピソードを切り替え、SPA 遷移後に旧 panel host、旧 ShadowRoot、旧 observer、旧 listener が残らないことを確認する。
6. playback detach、再起動、字幕 track 切替後にも panel cleanup が重複せず、次回 mount が正常に行えることを確認する。
7. Heap Snapshot または DevTools の Event Listeners / Performance Monitor で、繰り返し操作後に detached host や増加し続ける listener / timer がないことを確認する。

### Step 17-A-10: API 境界

1. `content.js` の panel / block 関連 API の利用元を一覧化し、各利用元を panel state、panel render、block state、subtitle snapshot のいずれかに分類する。
2. panel open / close 時に `panelUi.applyPanelState()` が state 再適用と必要な block rebuild を扱うことを確認する。
3. 現在の state を使った panel list 更新では `panelUi.refreshPanel()` のみが呼ばれることを確認する。
4. `content.js` が panel host / ShadowRoot / block internals を直接触らず、高レベル中継だけに留まっていることを確認する。
5. Step 17-B / Step 18 へ渡す visibility cleanup、term inspector API を別表または方針メモへ記録する。

***

## 作業メモ

- `content.js` は DI・起動シーケンス・高レベル中継に留める。
- `modules/panel-visibility-state.js` は開閉 state の正本であり、DOM / render / snapshot / block state と混ぜない。
- panel host、ShadowRoot、listener、observer、snapshot、block state の owner と dispose 経路を明確にする。
- 新規 module は安易に増やさず、既存 panel 系ファイルの統合を優先する。
- Step 16 の builder 正本化、selection 共通化、decision 統合、pending task cancel、lane recovery state 命名整理を壊さない。
- panel UI / overlay UI / layout の見た目調整は混ぜない。
- track / toggle / lifecycle の別スコープ修正は混ぜない。
- 別スコープの test failure 修正は混ぜない。
- Step 17-B 以降、Step 18 の実装そのものは行わない。

***

## 次に開くファイル

- `content.js`
- `modules/panel-ui.js`
- `modules/panel-renderer.js`
- `modules/subtitle-block-state.js`
- `modules/subtitle-blocks.js`
- `modules/subtitle-block-resolver.js`
- `modules/panel-visibility-state.js`
- `modules/playback-session-cleanup.js`
- `modules/subtitle-state-reset.js`
- `reinitialize-coordinator.js`
- `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md`
