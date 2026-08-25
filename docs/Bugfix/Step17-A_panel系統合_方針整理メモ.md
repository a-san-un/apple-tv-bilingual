# Bugfix Step 17-A 方針整理メモ

対象ブランチ: `issue-32-content-core-split`  
対象ステップ: **Step 17-A: panel 系統合**

## 1. 目的

Step 17-A の目的は、panel に関する DOM参照・listener・observer・render snapshot・block state の owner を整理し、`content.js` から panel / blocks の実装詳細を外して、dispose 経路を明確にすることである。

今回の作業では、次を満たすことを完了条件とする。

- `content.js` に panel / blocks 実装詳細を残さない。
- `modules/panel-visibility-state.js` は panel 開閉 state の正本として維持し、DOM / render owner と混ぜない。
- panel host、shadow root、listener、observer、render snapshot、block state の owner と `dispose()` 経路を明確にする。
- Step 16 の builder 正本化、selection 共通化、decision 統合、pending task cancel、lane recovery state 命名整理を壊さない。

## 2. 現状整理

マスタープランでは、`content.js` に term inspector 関連 state / UI shell に加えて、subtitle panel / blocks 管理責務が残っていること、また panel 系実装が `panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` に分散したまま root 直下に残っていることが継続課題として整理されている。

現在確認できる panel 系主要関数は次の通りである。

### panel-ui.js

- `createPanelUi`
- `ensurePanelSlotLayerStyle`
- `buildPanelDebugShellHTML`
- `buildPanelShellHTML`
- `wirePanelHeaderActions`
- `createRightPanel`
- `createDebugPanel`
- `getPanelUiElements`
- `removeHost`
- `destroyFeatureUiHosts`
- `destroyUiHosts`
- `applyPanelVisibility`
- `togglePanel`
- `applyPanelState`
- `createToggleButton`
- `updateToggleButton`
- `loadPanelVisibility`
- `injectNativeToggle`
- `watchForPlayerTabs`

### panel-renderer.js

- `createPanelRenderer`
- `getSubtitleViewTexts`
- `getBlockTexts`
- `buildPanelBlockHtml`
- `bindPanelWordInteractions`
- `bindPanelBlockInteractions`
- `updatePanelRenderSnapshot`
- `scrollCurrentPanelBlockIntoView`
- `getAllPanelBlocks`
- `renderPanel`

### subtitle-blocks.js

- `toArray`
- `normalizeText`
- `buildSubtitleBlockKey`
- `classifyBlockState`
- `groupCues`
- `groupPrimaryCues`
- `buildSubtitleBlockFromGroups`
- `matchSecondaryText`
- `findNearestGroupAtTime`
- `analyzeSequenceHealth`
- `resolveCurrentIndex`
- `buildSubtitleBlockSequence`

### subtitle-block-resolver.js

- `normalizePanelBlocks`
- `groupBlocksByTimeWindow`
- `applySequentialCurrentWithinGroup`
- `resolveSingleCurrentBlock`
- `findPanelCurrentWindowKey`
- `applyPanelCurrentFlags`
- `dedupeLinesInOrder`
- `buildDisplayBlocksFromGroups`
- `resolvePanelBlocksForRender`

### modules/panel-visibility-state.js

- `load`
- `persist`

### content.js の Step 17-A 関連主要関数

- `_ensurePanelSlotLayerStyle`
- `renderSecondarySubtitle`
- `logSubtitlePanelState`
- `applyLayout`
- `createDebugPanel`
- `rebuildSubtitleBlocksForPanelOpen`
- `persistPanelVisibility`
- `_refreshSettingsOnPanelOpen`
- `renderCurrentSnapshot`
- `getSubtitleBlockSequence`
- `getCurrentSubtitleBlockFromSequence`
- `setCurrentSubtitleBlock`

## 3. 修正方針

### 3-1. owner 境界

Step 17-A では、panel 系責務を次の 4 層に分けて扱う。

1. **Visibility state**
   - `modules/panel-visibility-state.js`
   - panel 開閉 state の load / persist のみを持つ。
   - DOM・render snapshot・block state を持たせない。

2. **Panel owner**
   - `panel-ui.js` を中心とする。
   - panel host、shadow root、toggle button、header actions、observer、UI host cleanup、dispose 入口を持つ。

3. **Render owner / renderer**
   - `panel-renderer.js`
   - renderer は描画専用とし、入力 block 群を DOM へ反映する責務に寄せる。
   - lifecycle 判断や state 正本は持たせない。

4. **Block 計算 / block state**
   - `subtitle-blocks.js`
   - `subtitle-block-resolver.js`
   - `subtitle-blocks.js` は cue sequence 由来の block sequence 構築寄り。
   - `subtitle-block-resolver.js` は panel 表示用の block 形へ変換する計算寄り責務とする。

### 3-2. content.js に残す責務

`content.js` に残すのは、DI・起動シーケンス・高レベルイベント中継・owner 呼び出しだけに絞る。

残す責務:

- panel owner の生成
- visibility state の注入
- scene / snapshot / settings 更新時に panel owner へ入力を渡す
- teardown 時に `dispose()` を呼ぶ

外す責務:

- panel host / shadow root の直接保持
- panel DOM の組み立て
- block state の長期保持
- render snapshot の直接管理
- listener / observer の個別 cleanup
- panel 描画条件の詳細判断

### 3-3. dispose 契約

メモリーリーク対策として、panel 系 cleanup の入口を panel owner 側へまとめる。

想定契約:

- `panel-visibility-state`
  - state の load / persist のみ
  - DOM cleanup は行わない。
- panel owner
  - host detach
  - listener 解放
  - observer disconnect
  - render snapshot clear
  - block state clear
  - shadow root / debug UI / toggle 参照の解放
- `content.js`
  - 個別 cleanup を持たず `panel.dispose()` を呼ぶだけに寄せる

## 4. 実装順序

Step 17-A は次の順序で進める。

| 順序 | 枝番 | 目的 | 前提 |
|---|---|---|---|
| 1 | 17-A-1 | panel / blocks の依存棚卸し | なし |
| 2 | 17-A-2 | visibility 正本の固定 | 17-A-1 |
| 3 | 17-A-3 | panel owner の再整理 | 17-A-1, 17-A-2 |
| 4 | 17-A-4 | renderer 専用化 | 17-A-3 |
| 5 | 17-A-5 | resolver の計算責務化 | 17-A-1, 17-A-4 |
| 6 | 17-A-6 | block state owner の統合 | 17-A-5 |
| 7 | 17-A-7 | `content.js` の薄化 | 17-A-2, 17-A-3, 17-A-4, 17-A-5, 17-A-6 |
| 8 | 17-A-8 | dispose 契約の固定 | 17-A-3, 17-A-4, 17-A-6, 17-A-7 |
| 9 | 17-A-9 | `modules/` 統合と `manifest.json` 整合 | 17-A-7, 17-A-8 |
| 10 | 17-A-10 | Step 17-B / 18 へつなぐ API 固定 | 17-A-8, 17-A-9 |

## 5. 依存関係図

```text
17-A-1 依存棚卸し
   |
   +--> 17-A-2 visibility 正本
   |         |
   |         +--> 17-A-3 panel owner 再整理
   |                     |
   |                     +--> 17-A-4 renderer 専用化
   |                     |
   |                     +--> 17-A-5 resolver 計算責務化
   |                                   |
   |                                   +--> 17-A-6 block state 統合
   |                                                  |
   +--------------------------------------------------+
                                                      |
                                      17-A-7 content.js 薄化
                                                      |
                                      17-A-8 dispose 契約固定
                                                      |
                                      17-A-9 modules 統合 / manifest 整合
                                                      |
                                      17-A-10 API 境界固定
```

## 6. 枝番ごとの変更対象関数マッピング

### 17-A-1 依存棚卸し

- `panel-ui.js`
  - `createPanelUi`
  - `createRightPanel`
  - `applyPanelState`
  - `togglePanel`
- `panel-renderer.js`
  - `createPanelRenderer`
  - `renderPanel`
- `subtitle-blocks.js`
  - `buildSubtitleBlockSequence`
- `subtitle-block-resolver.js`
  - `resolvePanelBlocksForRender`
- `content.js`
  - `renderCurrentSnapshot`
  - `rebuildSubtitleBlocksForPanelOpen`
  - `renderSecondarySubtitle`

### 17-A-2 visibility 正本

- `modules/panel-visibility-state.js`
  - `load`
  - `persist`
- `panel-ui.js`
  - `loadPanelVisibility`
  - `applyPanelVisibility`
  - `togglePanel`
  - `applyPanelState`
- `content.js`
  - `persistPanelVisibility`

### 17-A-3 panel owner 再整理

- `panel-ui.js`
  - `createPanelUi`
  - `createRightPanel`
  - `wirePanelHeaderActions`
  - `createToggleButton`
- `content.js`
  - `createDebugPanel`
  - `applyLayout`
  - `renderSecondarySubtitle`

### 17-A-4 renderer 専用化

- `panel-renderer.js`
  - `createPanelRenderer`
  - `renderPanel`
  - `updatePanelRenderSnapshot`
- `panel-ui.js`
  - `createPanelUi`
- `content.js`
  - `renderCurrentSnapshot`

### 17-A-5 resolver 計算責務化

- `subtitle-block-resolver.js`
  - `resolvePanelBlocksForRender`
  - `normalizePanelBlocks`
  - `buildDisplayBlocksFromGroups`
- `subtitle-blocks.js`
  - `buildSubtitleBlockSequence`
- `content.js`
  - `renderCurrentSnapshot`
  - `rebuildSubtitleBlocksForPanelOpen`

### 17-A-6 block state 統合

- `subtitle-blocks.js`
  - `buildSubtitleBlockSequence`
  - `resolveCurrentIndex`
  - `analyzeSequenceHealth`
- `content.js`
  - `rebuildSubtitleBlocksForPanelOpen`
  - `getSubtitleBlockSequence`
  - `getCurrentSubtitleBlockFromSequence`
  - `setCurrentSubtitleBlock`
- `panel-renderer.js`
  - `getAllPanelBlocks`
  - `renderPanel`

### 17-A-7 content.js 薄化

- `content.js`
  - `renderSecondarySubtitle`
  - `applyLayout`
  - `createDebugPanel`
  - `rebuildSubtitleBlocksForPanelOpen`
  - `renderCurrentSnapshot`
  - `persistPanelVisibility`
- `panel-ui.js`
  - `createPanelUi`
  - `applyPanelState`
  - `togglePanel`
- `panel-renderer.js`
  - `renderPanel`
- `subtitle-block-resolver.js`
  - `resolvePanelBlocksForRender`

### 17-A-8 dispose 契約固定

- `panel-ui.js`
  - `destroyFeatureUiHosts`
  - `destroyUiHosts`
  - `removeHost`
  - `applyPanelVisibility`
- `panel-renderer.js`
  - `updatePanelRenderSnapshot`
  - `renderPanel`
- `content.js`
  - `createDebugPanel`
  - `renderCurrentSnapshot`
  - `persistPanelVisibility`
- `modules/panel-visibility-state.js`
  - `persist`

### 17-A-9 modules 統合 / manifest 整合

- `panel-ui.js`
  - `createPanelUi`
- `panel-renderer.js`
  - `createPanelRenderer`
- `subtitle-blocks.js`
  - `buildSubtitleBlockSequence`
- `subtitle-block-resolver.js`
  - `resolvePanelBlocksForRender`
- `content.js`
  - `renderCurrentSnapshot`
  - `rebuildSubtitleBlocksForPanelOpen`

### 17-A-10 API 境界固定

- `panel-ui.js`
  - `createPanelUi`
  - `togglePanel`
  - `applyPanelState`
  - `applyPanelVisibility`
- `panel-renderer.js`
  - `renderPanel`
- `modules/panel-visibility-state.js`
  - `load`
  - `persist`
- `content.js`
  - `renderCurrentSnapshot`
  - `persistPanelVisibility`

## 7. 枝番ごとのレビュー観点チェックリスト

### 17-A-1 依存棚卸し

- `content.js` にある panel / blocks state の read / write 箇所を列挙できているか。
- `renderSecondarySubtitle()`、`renderCurrentSnapshot()`、`rebuildSubtitleBlocksForPanelOpen()` の呼び出し経路を追跡できているか。
- `createPanelUi()` の deps を、DOM / render / block state / settings / debug に分類できているか。
- `subtitle-blocks.js` と `subtitle-block-resolver.js` の責務差を明文化できているか。
- Step 16 の builder 正本化済み sequence / scene / snapshot を panel 側で再導出していないか。

### 17-A-2 visibility 正本

- `panelOpen` と `panelDefaultOpen` を混同していないか。
- `load()` は fallback 用、`persist()` は panelOpen 保存専用になっているか。
- visibility state モジュールへ DOM / render / block state を追加していないか。
- `loadPanelVisibility()`、`togglePanel()`、`applyPanelState()`、`persistPanelVisibility()` の state 更新が二重化していないか。

### 17-A-3 panel owner 再整理

- panel host 作成 owner が `createRightPanel()` に収束しているか。
- `content.js` が `panelShadowRoot` を直接保持し続けていないか。
- header actions、toggle button、native toggle の listener owner が明確か。
- panel host と overlay / term inspector host の cleanup 範囲を混ぜていないか。

### 17-A-4 renderer 専用化

- `renderPanel()` が描画責務だけを持つか。
- `createPanelRenderer()` が host 作成や visibility 保存を持っていないか。
- `updatePanelRenderSnapshot()` が stale DOM を retain しないか。
- render ごとの listener 重複がないか。

### 17-A-5 resolver 計算責務化

- `resolvePanelBlocksForRender()` が DOM を触らないか。
- `normalizePanelBlocks()` などが state mutation を持たないか。
- current 判定を builder 正本と二重実装していないか。
- resolver の返り値が render 用の shape に留まっているか。

### 17-A-6 block state 統合

- `buildSubtitleBlockSequence()` の出力を panel owner 側で受ける形に寄せられているか。
- `content.js` が block array を直接保持しない方向になっているか。
- `rebuildSubtitleBlocksForPanelOpen()` を panel open 専用副作用の塊にしすぎていないか。
- block state clear 時に past / current / meta / snapshot を一括破棄できるか。

### 17-A-7 content.js 薄化

- `content.js` に残るのが生成・DI・入力転送・dispose 呼び出しだけに近づいているか。
- panel DOM 組み立てや debug mount の詳細が panel owner 側へ移っているか。
- panel 描画条件の解釈を `content.js` に増やしていないか。
- popup / term inspector の実装に今回の変更を混ぜていないか。

### 17-A-8 dispose 契約固定

- panel owner に冪等な `dispose()` があるか。
- `destroyUiHosts()` / `destroyFeatureUiHosts()` / `removeHost()` の責務重複がないか。
- observer / listener / timer / scheduled task の停止順が明確か。
- snapshot clear と block state clear が同じ cleanup 経路に乗っているか。
- lane recovery state や cue binding cleanup に panel 都合の副作用を足していないか。

### 17-A-9 modules 統合 / manifest 整合

- `manifest.json` の読み込み順が依存順を守っているか。
- `window.ATVB` / `globalThis` 公開名が移動後も一致するか。
- duplicate load が起きないか。
- `panel.css` や既存 debug / test 参照が壊れないか。

### 17-A-10 API 境界固定

- panel public API を mount / setOpen / update / dispose 程度に絞れているか。
- `content.js` が renderer 内部や block internals を読まないか。
- `panel-visibility-state` は load / persist 専用のままか。
- Step 17-B の visibility cleanup owner 固定と Step 18 の term inspector 抽出に接続できる形か。

## 8. 実施状況と残作業

### 完了済み

- 17-A-7: `content.js` の panel renderer 直接依存を外し、`panelRenderer` と `getPanelRenderInput()` を panel owner へ DI する形に整理した。
- 17-A-7: subtitle block facade から panel list の直接描画を外し、block rebuild と subtitle snapshot 更新までに縮小した。
- 17-A-9: `panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` を `modules/` 配下へ移動した。
- 17-A-9: `manifest.json` の content_scripts 参照を `modules/` 配下のパスへ更新し、既存の依存順を維持した。
- panel.css は ShadowRoot 内から `chrome.runtime.getURL("panel.css")` で参照する web accessible resource であるため、Step 17-A の JS module 移行対象から除外した。

### 残作業

#### 17-A-8: dispose 契約の固定

- `panelUi.dispose()` が host、toggle、observer、listener、timer、overlay、render snapshot、block state をどこまで破棄するかをコードと JSDoc で確定する。
- `destroyUiHosts()`、`destroyFeatureUiHosts()`、`removeHost()`、`dispose()` の責務重複を確認し、cleanup の入口を `panelUi.dispose()` に寄せる。
- playback detach、SPA 遷移、拡張機能無効化、再起動時に同じ dispose 経路が使われるか確認する。
- dispose 後に stale な ShadowRoot、DOM node、listener、observer、timer、render snapshot、block state が残らないことを確認する。

#### 17-A-10: Step 17-B / 18 向け API 境界の固定

- `content.js` に残る `getSubtitleBlockSequence`、`getCurrentSubtitleBlockFromSequence`、`renderCurrentSnapshot`、`applyPanelStateEffects` の利用元を棚卸しする。
- content.js に残す高レベル中継 API と、panel owner / block state owner に閉じる API を確定する。
- `panelUi.applyPanelState()` と `panelUi.refreshPanel()` の使い分けを API 契約として明文化する。
- Step 17-B で扱う UI / lifecycle / popup / overlay の論点と、Step 17-A で閉じる panel/block owner 論点を分離する。

### 完了判定

- `content.js` が panel DOM、ShadowRoot、listener、observer、render snapshot、block state の実装詳細を持たない。
- `panelUi.dispose()` を単一入口として panel 系の cleanup 経路を追跡できる。
- `modules/` 移行後の manifest 読み込み順、panel open/close、seek、SPA 遷移、再入場を実機確認する。
- Step 17-B / 18 に渡す API と未解決論点が文書化されている。

