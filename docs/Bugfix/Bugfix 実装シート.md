# Bugfix 実装シート 2026-08-26（作業台版）

**ブランチ:** `issue-32-content-core-split`
**対応マスタープラン:** Bugfix マスタープラン 2026-08-26（要約版）
**最新反映コミット:** `3f33804 refactor: panel 系ファイルを modules へ統合し content.js を薄化する (Issue #32, Step 17-A)`
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

Step 17 全体としては未完了である。次は panel owner の dispose 契約を固定し、`content.js` に残る panel / block API の高レベル中継境界を確定する。

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
| 8 | panel 系の owner 境界がまだ完全ではない | panel UI / renderer / blocks / resolver の `modules/` 移行は完了した。host、ShadowRoot、listener、observer、snapshot、block state の dispose 経路は未固定である。 | S-2 | 🟠 進行中 |
| 9 | subtitle block state の公開 API 境界が未固定 | `modules/subtitle-block-state.js` は sequence/current block の読み取り・解決・同期を担当する。`content.js` には delegate 参照と block 更新の高レベル中継が残るため、owner API と利用元の棚卸しが必要である。 | S-2 | 🟠 次作業 |
| 10 | panel renderer の state 直接参照は解消済み | `modules/panel-renderer.js` は `createPanelRenderer()` と `getPanelRenderInput()` から入力を受け、共有 state を直接参照しない。 | S-2 | ✅ 完了 |
| 11 | panel dispose の owner 集約が未完了 | `modules/panel-ui.js` には `dispose()` があるが、host、ShadowRoot、observer、listener、timer、overlay、snapshot、block state の cleanup が単一経路に統合され切っていない。 | S-2 | 🟠 次作業 |
| 12 | recovery state モジュール名は整理済み | 旧 `secondary-track-recovery.js` は Step 15 で `lane-recovery-state` 系へ整理済みで、残るのは説明・参照の追従確認である。 | R-1 | ✅ 完了 |
| 13 | decision 統合、cue sequence builder、退行防止は整った | Step 12〜16 の実装・退行防止テスト追加まで完了しており、現在は panel / term inspector の責務整理フェーズである。 | M-3 | ✅ 完了済み土台 |
| 14 | debug runtime と subtitle block state の基盤整理 | debug logger / panel runtime / shell の module 化、旧 root debug files 削除、subtitle block state owner 導入、lint 成功、commit / push を完了した。 | Step 17-A | ✅ 基盤整理完了 |
| 15 | panel / block 系4ファイルの `modules/` 統合 | `modules/panel-ui.js`、`modules/panel-renderer.js`、`modules/subtitle-blocks.js`、`modules/subtitle-block-resolver.js` へ移行し、manifest の読み込み順を整合させた。 | Step 17-A-9 | ✅ 完了 |
| 16 | `content.js` の panel renderer 直接依存 | `createPanelRenderer()` の state 直接依存と subtitle block facade の panel list 直接描画を外し、DI・高レベル中継へ縮小した。 | Step 17-A-7 | ✅ 完了 |

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
- Step 16 の cue sequence / scene / snapshot 導出の builder 集約は完了済みである。
- `modules/debug-logger.js`、`modules/debug-panel-runtime.js`、`modules/debug-panel-shell.js` を導入し、root 直下の旧 debug files を削除した。
- `debugPanelRuntime.mount()` を debug panel 更新の runtime 入口として導入した。
- `modules/subtitle-block-state.js` を sequence / current block / panel open 時再同期の正本として導入した。
- `content.js` から `getSubtitleBlockSequence`、`getCurrentSubtitleBlockFromSequence`、`setCurrentSubtitleBlock`、`rebuildSubtitleBlocksForPanelOpen` の wrapper 関数を削除した。
- `modules/panel-ui.js`、`modules/panel-renderer.js`、`modules/subtitle-blocks.js`、`modules/subtitle-block-resolver.js` へ panel / block 系4ファイルを移行した。
- `manifest.json` の content scripts 参照を移行先の module path に更新し、依存順を維持した。
- `modules/panel-renderer.js` は共有 state を直接読まず、入力から描画と snapshot を生成する構成に整理した。
- `content.js` から panel renderer の共有 state 直接依存を外し、`panelRenderer` と `getPanelRenderInput()` を `createPanelUi()` へ DI する構成に整理した。
- subtitle block facade から panel list の直接描画を外した。
- `panel.css` は ShadowRoot から参照する web accessible resource のため、root 配置を維持した。
- `npm run lint` はエラーなしで完了している。
- Step 17-A-7 と Step 17-A-9 の変更は `3f33804` として commit / push 済みである。

### 今回完了させる項目

- `modules/panel-ui.js` の `dispose()` を panel 系 cleanup の単一入口として固定する。
- panel host、ShadowRoot、toggle、native toggle observer、listener、timer、overlay、render snapshot、block state の owner と破棄順を確認する。
- `destroyUiHosts()`、`destroyFeatureUiHosts()`、`removeHost()`、`panelUi.dispose()` の責務を照合し、重複する cleanup を整理する。
- playback detach、SPA 遷移、拡張機能無効化、再起動の各経路で panel cleanup が同じ dispose 契約を通るようにする。
- `content.js` に残る `getSubtitleBlockSequence`、`getCurrentSubtitleBlockFromSequence`、`renderCurrentSnapshot`、`applyPanelStateEffects` の利用元を棚卸しする。
- `content.js` に残す高レベル中継 API と、panel owner / block state owner に閉じる API を固定する。
- `panelUi.applyPanelState()` と `panelUi.refreshPanel()` の使い分けを API 契約として明文化する。
- Step 17-B の visibility cleanup owner 固定と、Step 18 の term inspector 抽出へ渡す API 境界を記録する。

***

## 実装順序

### Step 17-A-8: panel dispose 契約の固定

| 順序 | 対象ファイル | 実施内容 | 完了条件 |
| :-- | :-- | :-- | :-- |
| 1 | `modules/panel-ui.js` | `dispose()`、host / ShadowRoot / toggle / native toggle observer / listener / timer / overlay / snapshot / block state の owner を棚卸しする。 | 破棄対象と owner を列挙できる。 |
| 2 | `content.js` | `destroyUiHosts()`、`destroyFeatureUiHosts()`、`removeHost()` と `panelUi.dispose()` の呼び出し関係を確認する。 | panel cleanup の入口候補と重複範囲を説明できる。 |
| 3 | `modules/playback-session-cleanup.js`、`modules/subtitle-state-reset.js`、`reinitialize-coordinator.js` | detach、SPA 遷移、無効化、再起動の cleanup 経路を確認する。 | 全 lifecycle 経路の panel cleanup 接続を追える。 |
| 4 | `modules/panel-ui.js`、`content.js` | panel owner を唯一の cleanup 入口とする dispose 契約を固定する。 | 冪等な `panelUi.dispose()` に panel 系 cleanup が収束する。 |
| 5 | 実機 / DevTools | ON/OFF、SPA 遷移、作品切替、playback detach、再起動を反復し、stale DOM / listener / observer / timer が残らないことを確認する。 | panel host / ShadowRoot / snapshot / block state の残留がない。 |

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
| subtitle block build / state | `modules/subtitle-blocks.js`、`modules/subtitle-block-state.js` | block build、sequence、current block、panel open 時再同期 | builder / state owner を DI する | block state clear は panel dispose 契約との接続を確認する |
| debug runtime | `modules/debug-panel-runtime.js`、`modules/debug-panel-shell.js` | debug host、logger 更新、debug lifecycle | mount / unmount の起動中継 | panel cleanup と host 範囲を混ぜない |
| term inspector | `content.js`（Step 17-A 時点） | term inspector state / shell / listener | 既存実装を維持する | Step 18 で panel owner と分離する |

***

## 実機確認手順

### Step 17-A-8: dispose 契約

1. 拡張機能を ON にし、panel host、ShadowRoot、toggle、overlay が1組だけ生成されることを確認する。
2. panel を開閉し、`panelOpen`、toggle 表示、overlay の位置・幅、panel snapshot が整合することを確認する。
3. 拡張機能を OFF にし、panel host、ShadowRoot、observer、listener、timer、snapshot、block state が破棄されることを確認する。
4. OFF → ON を複数回繰り返し、panel host、toggle、listener、observer が二重化しないことを確認する。
5. Apple TV+ 内で作品またはエピソードを切り替え、SPA 遷移後に旧 panel host、旧 ShadowRoot、旧 observer、旧 listener が残らないことを確認する。
6. playback detach、再起動、字幕 track 切替後にも panel cleanup が重複せず、次回 mount が正常に行えることを確認する。
7. Heap Snapshot または DevTools の Event Listeners / Performance Monitor で、繰り返し操作後に detached host や増加し続ける listener / timer がないことを確認する。

### Step 17-A-10: API 境界

1. `content.js` の panel / block 関連 API の利用元を一覧化し、各利用元を panel state、panel render、block state、subtitle snapshot のいずれかに分類する。
2. panel open / close 時に `panelUi.applyPanelState()` が state 再適用と必要な block rebuild を扱うことを確認する。
3. 現在の state を使った panel list 更新では `panelUi.refreshPanel()` のみが呼ばれることを確認する。
4. `modules/panel-renderer.js`、`modules/subtitle-block-resolver.js` が shared state、DOM owner、visibility 保存を直接扱わないことを確認する。
5. `modules/panel-visibility-state.js` に DOM、render、snapshot、block state が追加されていないことを確認する。
6. Step 17-B と Step 18 の実装前に、`content.js` が DI、起動シーケンス、入力転送、dispose 呼び出しに留まる境界を文書化する。

***

## ログ確認ポイント

| 場面 | 確認したいログ / 観測 | 合格条件 |
| :-- | :-- | :-- |
| panel mount | host / ShadowRoot / toggle / observer の生成回数 | 各 lifecycle ごとに1回だけ生成される。 |
| panel open | block rebuild、snapshot 更新、current block 解決 | rebuild と render が重複せず、正しい current block を示す。 |
| panel close | visibility state と overlay layout 反映 | panelOpen と UI 表示が一致する。 |
| extension OFF | `panelUi.dispose()`、host remove、listener / observer / timer 停止、snapshot / block state clear | panel 系の残留がない。 |
| SPA 遷移 | 旧 panel dispose と新 panel mount の順序 | 旧 host / observer / listener が残らない。 |
| playback detach / restart | cleanup 冪等性、再初期化後の mount | cleanup の多重実行で例外・二重 mount が起きない。 |
| block click / seek | current block、scroll、snapshot、overlay 更新 | panel API 境界を越えた直接 DOM 操作が増えない。 |

***

## 禁止事項

- `panel.css` を `modules/` 配下へ移動しない。ShadowRoot から参照する web accessible resource として root 配置を維持する。
- `modules/panel-visibility-state.js` に DOM、render、snapshot、block state の責務を追加しない。
- `content.js` に panel DOM 組み立て、renderer 内部詳細、block internals を戻さない。
- `modules/panel-renderer.js` に host 作成、visibility 保存、lifecycle cleanup を持たせない。
- `modules/subtitle-block-resolver.js` に DOM 操作、state mutation、panel lifecycle を持たせない。
- Step 16 の builder 正本化、selection 共通化、decision 統合、pending task cancel、lane recovery state 命名整理を壊さない。
- panel UI / overlay UI / layout の見た目調整を今回の変更に混ぜない。
- track / toggle / lifecycle の別スコープ修正を混ぜない。
- 別スコープの test failure 修正を混ぜない。
- Step 17-B 以降および Step 18 の実装そのものを混ぜない。
