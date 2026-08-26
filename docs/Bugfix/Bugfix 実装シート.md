# Bugfix 実装シート 2026-08-26（作業台版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** `docs/Bugfix/Bugfix マスタープラン.md`  
**対応方針メモ:** `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md`  
**最新反映コミット:** `1ce5c3a docs: Step 17-A-8完了と17-B visibility/lifecycle計画を記録する (Issue #32)`  
**現在の作業:** Step 17-A-10 — panel / block public API と `content.js` の高レベル中継境界を固定する。

***

## このシートの役割

このシートは、**現在着手している Step 17-A-10 だけの作業台**である。  
変更対象、ファイル単位の実装順、確認観点、実機検証、作業中の判断を記録する。

全体目標、過去 Step の完了履歴、将来作業、各資料の役割は `Bugfix マスタープラン.md` を参照する。  
Step 17-A の owner 判断、API 契約、詳細な移行根拠は `Step17-A_panel系統合_方針整理メモ.md` を正本とする。

***

## 今回の目的

Step 17-A-10 として、`content.js` に残る panel / block 関連の高レベル中継 API を棚卸しし、次を固定する。

- `content.js` に残すべき起動シーケンス・DI・高レベル中継 API
- `modules/panel-ui.js` に閉じるべき panel UI / render 実行 API
- `modules/subtitle-block-state.js` に閉じるべき block state 読み取り・解決・同期 API
- `modules/panel-renderer.js` に閉じるべき描画専用 API
- Step 17-B の visibility / lifecycle 整理、および Step 18 の term inspector 分離へ渡す public API 境界

今回の作業では、panel の見た目、overlay の見た目、字幕同期ロジック、track 選択、native toggle、Step 17-B の visibility / lifecycle 実装、Step 18 の term inspector 抽出は行わない。

***

## 前提

以下は完了済みであり、今回の変更で壊してはならない。

- `panelUi.dispose()` は panel host、ShadowRoot、toggle button、native toggle observer、resize listener、render timer、render snapshot、renderer owner state、overlay DOM を対称に cleanup する高レベル入口である。
- `removeHost()` は低レベルな DOM host 除去だけを担当する。
- `applyPanelState()` は state effects を含む panel 状態の再適用である。
- `refreshPanel()` は既存 state に基づく描画のみを担当する。
- `panelRenderer` と `getPanelRenderInput()` は `content.js` から `createPanelUi()` へ DI される。
- `modules/subtitle-block-state.js` は subtitle block sequence、current block 解決、current block mirror 同期、panel open 時の block rebuild を担当する。
- `modules/panel-renderer.js` は共有 state を直接読まず、入力から描画結果と snapshot を返す。
- `modules/panel-visibility-state.js` は `panelOpen` の load / persist 専用であり、DOM、render、snapshot、block state を持たない。

***

## 対象ファイル

| ファイル | 今回確認する責務 | Step 17-A-10 で判断すること |
| :-- | :-- | :-- |
| `content.js` | DI、起動シーケンス、高レベル中継、共有 state | 残す public API、module owner へ移す内部 API、削除可能な wrapper |
| `modules/panel-ui.js` | panel host / ShadowRoot / toggle / renderer 呼び出し / render owner state | `content.js` から受ける最小 DI と公開 API |
| `modules/subtitle-block-state.js` | sequence / current block / meta / mirror 同期 / panel open 時の rebuild | block 読み取り・解決・同期 API の公開範囲 |
| `modules/subtitle-blocks.js` | block rebuild facade、subtitle snapshot 更新 | block state owner との境界、panel 描画を持たないことの確認 |
| `modules/subtitle-block-resolver.js` | panel 表示用 block への計算変換 | state / DOM / render を持たないことの確認 |
| `modules/panel-renderer.js` | 描画専用、snapshot 算出 | render 入力と戻り値の契約、shared state 非依存の維持 |
| `modules/panel-visibility-state.js` | `panelOpen` の load / persist | panel UI / block API と混ざっていないことの確認 |
| `modules/playback-session-cleanup.js` | restart / OFF / content switch cleanup | `panelUi.dispose()` と block reset API の呼び分け |
| `modules/subtitle-state-reset.js` | complete reset / render snapshot clear | block state reset と panel render artifact reset の境界 |
| `reinitialize-coordinator.js` | 再初期化の順序制御 | 高レベル中継 API をどこまで持つか |
| `manifest.json` | module 読み込み順 | API 移動で依存順変更が必要になった場合のみ確認 |

***

## API 棚卸し

最初は**コード変更を行わず**、以下の表を実コードで埋める。

| API / state | 現在の定義・保持先 | 利用元 | 本来の owner 候補 | Step 17-A-10 の判断 |
| :-- | :-- | :-- | :-- | :-- |
| `getSubtitleBlockSequence()` | 要確認 | 要確認 | `subtitleBlockState` | public API として残すか、内部呼び出しへ閉じるか |
| `getCurrentSubtitleBlockFromSequence()` | 要確認 | 要確認 | `subtitleBlockState` | `content.js` wrapper を削除できるか |
| `renderCurrentSnapshot()` | 要確認 | 要確認 | `panelUi` / panel render owner | 高レベル中継か、panel UI API に統合するか |
| `applyPanelStateEffects()` | 要確認 | 要確認 | `content.js` または subtitle block owner | panel open 時の block rebuild をどこで調停するか |
| `getPanelRenderInput()` | `content.js` の DI source | `panelUi` | `content.js` の高レベル入力組み立て | state 直接参照を増やさず維持できるか |
| `panelUi.applyPanelState()` | `panelUi` | 要確認 | `panelUi` | state effects を伴う再適用専用として維持するか |
| `panelUi.refreshPanel()` | `panelUi` | 要確認 | `panelUi` | render-only 専用として維持するか |
| `panelUi.dispose()` | `panelUi` | cleanup / restart 系 | `panelUi` | 完全 cleanup 専用として維持するか |
| `state.currentSubtitleBlock` | 共有 runtime mirror | renderer / overlay 等 | `subtitleBlockState` | 正本ではなく互換 mirror として維持するか |
| `state.lastPanelRenderSnapshot` | 共有観測参照 | debug / 観測等 | panel render owner | owner state と共有互換参照の境界を確認する |

***

## 判断基準

### `content.js` に残すもの

- module の生成と DI
- 起動順序と再初期化の高レベル制御
- 複数 owner にまたがる操作の調停
- extension runtime と content script 全体に関わる入口
- 既存 caller を保護するために必要な薄い互換 facade

### `content.js` から外すもの

- panel host / ShadowRoot / toggle の DOM 操作
- panel renderer の実行詳細、snapshot の保存・clear 詳細
- sequence / current block / meta の取得・解決・mirror 同期詳細
- panel list の直接描画
- block resolver の計算詳細
- `panelOpen` の storage read / write 詳細
- cleanup の低レベル DOM / observer / timer 操作

### API を残す条件

- 複数 module owner にまたがる調停が必要である
- 呼び出し元が起動・再初期化・cleanup の高レベル文脈を持つ
- API 名だけで副作用の範囲が理解できる
- owner 内部の state shape や DOM 構造を外へ漏らさない

### API を閉じる条件

- 単一 owner の内部 state や DOM だけを操作する
- caller が owner 内に集約できる
- wrapper が引数をそのまま渡すだけで、調停や互換性を提供していない
- API を通して共有 state の内部構造が露出している

***

## ファイル単位の作業順

### `content.js`

1. panel / block 関連の関数、state 参照、DI、callback を列挙する。  
2. 各項目を「高レベル中継」「panel UI owner」「block state owner」「renderer owner」「不要 wrapper」に分類する。  
3. `getSubtitleBlockSequence()`、`getCurrentSubtitleBlockFromSequence()`、`renderCurrentSnapshot()`、`applyPanelStateEffects()` の呼び出し元と副作用を確認する。  
4. 残す API は高レベルの意味が分かる名称と最小引数に整理する。  
5. owner へ移す API は、共有 state の直接参照を増やさず DI または既存 facade 経由へ寄せる。  

### `modules/subtitle-block-state.js`

1. sequence、current block、meta、mirror 同期、panel open 時の rebuild に関する公開 API を列挙する。  
2. `content.js` に重複する wrapper または state 操作がないか確認する。  
3. panel renderer / panel UI が block state の正本を直接変更していないことを確認する。  
4. public API は読み取り・解決・同期・再構築の用途が分かる最小セットに絞る。  

### `modules/panel-ui.js`

1. `applyPanelState()`、`refreshPanel()`、`dispose()` の caller と副作用を列挙する。  
2. panel open 時の state effects と render-only 更新の境界を確認する。  
3. `getPanelRenderInput()`、`panelRenderer`、`applyPanelStateEffects` の DI 契約を確認する。  
4. panel UI 内部の render owner state、timer、snapshot が外部 API へ漏れていないことを確認する。  
5. `content.js` に残す必要のない UI / renderer helper があれば `panelUi` owner へ閉じる。  

### `modules/panel-renderer.js`

1. 描画入力、戻り値、snapshot、signature、scroll key の契約を確認する。  
2. shared state、DOM host 生成、block state 更新、storage 操作を直接持たないことを確認する。  
3. public API が描画専用のまま維持されることを確認する。  

### `modules/subtitle-blocks.js`

1. block rebuild と subtitle snapshot 更新だけを担当していることを確認する。  
2. panel list 直接描画、panel host 操作、render snapshot 保存が残っていないことを確認する。  
3. `subtitle-block-state.js` と責務が重なる API があれば整理対象として記録する。  

### `modules/subtitle-block-resolver.js`

1. panel 表示用の block 計算だけを担当していることを確認する。  
2. state 保存、DOM 操作、render 実行、lifecycle cleanup が混在していないことを確認する。  
3. 他 module に移す必要がある API があれば、実装前に owner 判断を記録する。  

### `modules/playback-session-cleanup.js`

1. restart、extension OFF、content switch から panel / block cleanup へ到達する経路を確認する。  
2. panel UI の完全 cleanup は `panelUi.dispose()` だけを呼ぶことを維持する。  
3. block state reset と panel render artifact reset の順序が API 境界に矛盾しないことを確認する。  

### `modules/subtitle-state-reset.js`

1. complete reset で clear する block state、mirror、render artifact を列挙する。  
2. `panelUi.dispose()` が所有する UI resource と重複して clear していないことを確認する。  
3. `state.lastPanelRenderSnapshot` など互換観測値の clear owner を明確にする。  

### `reinitialize-coordinator.js`

1. 再初期化時に呼ぶ panel / block API を列挙する。  
2. UI mount、block rebuild、panel state apply、render refresh の順序を確認する。  
3. owner 内部 API を直接呼んでいる箇所があれば、高レベル中継 API へ整理する。  

### `manifest.json`

module の追加・移動を行う場合だけ確認する。  
今回の API 境界固定だけで module 依存順に変更がない場合は、変更しない。

***

## 実装完了条件

- `content.js` に残る panel / block API が、DI・起動シーケンス・高レベル中継に限定されている。
- `content.js` に単純な block state wrapper、panel render wrapper、DOM helper が残っていない。
- panel UI の DOM / render / snapshot / timer / observer の内部詳細が `content.js` から直接操作されない。
- subtitle block state の正本が `subtitle-block-state.js` にあり、panel UI / renderer が正本を更新しない。
- `applyPanelState()`、`refreshPanel()`、`dispose()` の使い分けが caller と JSDoc から判別できる。
- restart、extension OFF、content switch、reinitialize における panel / block API の到達経路が明確である。
- Step 17-B が visibility / lifecycle の実装を開始できる API 境界が確定している。
- Step 18 が term inspector の抽出を開始しても panel / block 内部 API に依存しない。

***

## 実機確認

### 基本再生

1. 拡張 ON 後に panel と overlay の 2 言語字幕が表示されることを確認する。  
2. panel の開閉後に block list、current block、scroll、render snapshot が整合することを確認する。  
3. panel 内の block click による seek 後、current block、scroll、snapshot、overlay が正しく更新されることを確認する。  

### lifecycle

1. panel を開いた状態で再生を開始し、subtitle 更新時に `refreshPanel()` が state effects を重複実行しないことを確認する。  
2. panel を開いた状態と閉じた状態で、作品・エピソード切替を確認する。  
3. extension OFF → ON、手動再起動、content switch 後に panel / overlay / toggle が多重生成されないことを確認する。  
4. hard seek 後に stale な snapshot、current block、scroll state が残らないことを確認する。  

### 静的確認

1. `npm run lint` を実行する。  
2. `content.js` に panel renderer の shared state 直接依存が再導入されていないことを確認する。  
3. `panel-ui.js`、`panel-renderer.js`、`subtitle-block-state.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` の役割を差分で再確認する。  
4. `manifest.json` を変更した場合だけ、`docs/Bugfix/module-load-order.md` と整合することを確認する。  

***

## 作業メモ

### 調査開始時に記録すること

- API 名
- 定義ファイル
- 呼び出し元
- 参照・更新する state
- DOM / render / lifecycle 副作用
- owner 候補
- 残す / 移す / 削除する判断
- 判断理由
- 回帰確認対象

### 保留にする条件

以下に該当する場合は、今回の変更に混ぜず、方針メモへ保留として記録する。

- `panelOpen`、`panelDefaultOpen`、storage、通常開閉、SPA 遷移、extension ON/OFF の visibility / lifecycle 設計に踏み込むもの
- term inspector の state / DOM / event listener の抽出が必要になるもの
- 字幕同期 decision、track 選択、secondary recovery、native fallback の挙動変更を伴うもの
- panel UI / overlay UI / layout の見た目変更を伴うもの
- 別スコープの test failure 修正だけを目的とするもの

***

## 次に開くファイル

調査は次の順で開始する。

1. `content.js`
2. `modules/subtitle-block-state.js`
3. `modules/panel-ui.js`
4. `modules/panel-renderer.js`
5. `modules/subtitle-blocks.js`
6. `modules/subtitle-block-resolver.js`
7. `modules/playback-session-cleanup.js`
8. `modules/subtitle-state-reset.js`
9. `reinitialize-coordinator.js`
10. `manifest.json`（依存順変更の可能性が出た場合のみ）
