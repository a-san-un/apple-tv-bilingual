# Bugfix Step 17-A 方針整理メモ

対象ブランチ: `issue-32-content-core-split`  
対象ステップ: **Step 17-A: panel 系統合**  
最終実装反映: `43ed673 refactor: Step 17-A-10 の owner 境界整理とコメント同期を反映する`

## 1. 目的

Step 17-A の目的は、panel に関する DOM参照・listener・observer・render snapshot・block state の owner を整理し、`content.js` から panel / blocks の実装詳細を外して、dispose 経路を明確にすることである。

今回の作業では、次を満たすことを完了条件とする。

- `content.js` に panel / blocks 実装詳細を残さない。
- `modules/panel-visibility-state.js` は panel 開閉 state の正本として維持し、DOM / render owner と混ぜない。
- panel host、shadow root、listener、observer、render snapshot、block state の owner と `dispose()` 経路を明確にする。
- Step 16 の builder 正本化、selection 共通化、decision 統合、pending task cancel、lane recovery state 命名整理を壊さない。
- `panelUi.dispose()` を panel 系 cleanup の高レベル入口として固定し、block state は subtitle 側 owner の責務として切り分ける。
- `applyPanelState()` と `refreshPanel()` の API 境界を固定し、Step 17-B / Step 18 へ渡す public surface を明確にする。
- Step 17-A-10 で、`content.js` に残る panel / block public API と高レベル中継境界を確定し、Step 17-B の visibility / lifecycle owner 整理へ渡す。

## 2. 現状整理

Step 17-A の実装は完了している。  
panel / blocks の実装詳細は owner module へ寄せ、`content.js` は DI・起動シーケンス・複数 owner 間の高レベル調停を担う構成へ整理した。

現在の panel 系主要関数は次の通りである。

### modules/panel-ui.js

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
- `clearPanelRenderArtifacts`

### modules/panel-renderer.js

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

### modules/subtitle-blocks.js

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

### modules/subtitle-block-resolver.js

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

- `renderSecondarySubtitle`
- `logSubtitlePanelState`
- `applyLayout`
- `persistPanelVisibility`
- `_refreshSettingsOnPanelOpen`
- `renderCurrentSnapshot`
- `applyPanelOpenEffects`

`getSubtitleBlockSequence()`、`getCurrentSubtitleBlockFromSequence()`、`applyPanelStateEffects()` は、Step 17-A-10 の public API / 高レベル中継境界整理の対象として旧経路を縮小または整理した。

## 3. 修正方針

### 3-1. owner 境界

Step 17-A では、panel 系責務を次の 4 層に分けて扱う。  
この 4 層は panel 系の基本責務を切るための整理であり、後段の cleanup / reset owner 境界ではこれに `playback-session-cleanup.js`、`subtitle-state-reset.js`、`reinitialize-coordinator.js` などの高レベル orchestration を加えた到達経路として扱う。

1. **Visibility state**
   - `modules/panel-visibility-state.js`
   - panel 開閉 state の load / persist のみを持つ。
   - DOM・render snapshot・block state を持たせない。

2. **Panel owner**
   - `modules/panel-ui.js` を中心とする。
   - panel host、shadow root、toggle button、header actions、observer、UI host cleanup、dispose 入口を持つ。
   - render artifact cleanup は `clearPanelRenderArtifacts()` に集約する。

3. **Render owner / renderer**
   - `modules/panel-renderer.js`
   - renderer は描画専用とし、入力 block 群を DOM へ反映する責務に寄せる。
   - lifecycle 判断や state 正本は持たせない。

4. **Block 計算 / block state**
   - `modules/subtitle-blocks.js`
   - `modules/subtitle-block-resolver.js`
   - `modules/subtitle-block-state.js`
   - `modules/subtitle-blocks.js` は cue sequence 由来の block sequence 構築寄り。
   - `modules/subtitle-block-resolver.js` は panel 表示用の block 形へ変換する計算寄り責務とする。
   - `modules/subtitle-block-state.js` は sequence / current block / meta / runtime mirror 同期と panel open 時の rebuild を担い、描画 callback は持たない。

### 3-2. content.js に残す責務

`content.js` に残すのは、DI・起動シーケンス・高レベルイベント中継・owner 呼び出しだけに絞る。

残す責務:

- panel owner の生成
- visibility state の注入
- scene / snapshot / settings 更新時に panel owner へ入力を渡す
- teardown 時に `dispose()` を呼ぶ
- panel open 時に複数 owner にまたがる effect を `applyPanelOpenEffects()` で調停する。

外す責務:

- panel host / shadow root の直接保持
- panel DOM の組み立て
- block state の長期保持
- render snapshot の直接管理
- listener / observer の個別 cleanup
- panel 描画条件の詳細判断
- cue-controller から見た旧 sequence getter DI / fallback
- block state への描画 callback DI
- panel render artifact cleanup の inline 実装
- panel open のためだけの `rebuildForPanelOpen` façade 公開

### 3-3. dispose 契約

メモリーリーク対策として、panel 系 cleanup の入口を panel owner 側へまとめる。

固定した契約:

- `panel-visibility-state`
  - state の load / persist のみ
  - DOM cleanup は行わない。

- panel owner（`modules/panel-ui.js`）
  - `panelUi.dispose()` を panel 系 cleanup の高レベル入口として固定した。
  - panel host / ShadowRoot / toggle button / native toggle observer /
    resize listener / render timer / renderer owner state / render snapshot /
    overlay DOM を対称に破棄する。
  - render timer、render snapshot、renderer owner state などの render artifact cleanup は `clearPanelRenderArtifacts()` を通じて行う。
  - 低レベルな DOM host 除去だけは `removeHost()` を内部利用して行う。
  - 再起動・拡張機能 OFF・content switch は
    `playback-session-cleanup.js` 経由で `panelUi.dispose()` に到達させる。
  - 手動再起動 cleanup は `content.js` から `panelUi.dispose()` を直接呼ぶ。
  - 冪等であり、host・observer・timer が未生成または既に破棄済みでも安全に完了する。
  - subtitle block sequence / current block / block meta などの block state は
    subtitle 側 owner の責務であり、`panelUi.dispose()` では破棄しない。
  - render snapshot の正本 owner は panel owner 側とし、通常の生成・保持・dispose は
    `modules/panel-ui.js` / `modules/panel-renderer.js` 側で完結させる。

- subtitle block state owner（`modules/subtitle-block-state.js`）
  - `sequence`、`currentIndex`、`meta`、current block 解決、runtime mirror 同期を持つ。
  - panel open に必要な block rebuild を担う。
  - render callback / panel DOM / renderer owner state を持たない。
  - complete reset 時の runtime mirror reset は `modules/subtitle-state-reset.js` の helper を経由する。

- reset / reinitialize orchestration
  - `modules/subtitle-state-reset.js` は complete reset の orchestration を担う。
  - panel snapshot reset と block runtime mirror reset は内部 helper に分離する。
  - `reinitialize-coordinator.js` は reset options 契約を通じて reinitialize を調停し、owner 内部 state を直接扱わない。

### 3-4. API 境界

固定する API 境界:

- `panelUi.applyPanelState()`
  - panel open / close に伴う state effect を含む高レベル API。
  - panel visibility、layout、必要な refresh を owner 内部で調停する。
  - `content.js` は高レベルな起動・設定・再初期化文脈で呼ぶ。

- `panelUi.refreshPanel()`
  - 現在の state をもとに panel 表示を更新する render-only API。
  - visibility の保存や block rebuild の判断は持たない。

- `panelUi.dispose()`
  - panel 系完全 cleanup の高レベル API。
  - host、listener、observer、timer、render artifact、overlay DOM を対称に破棄する。
  - block state の clear は subtitle block state / reset owner 側と組み合わせて呼ぶ。

- `applyPanelOpenEffects()`
  - `content.js` 側に残す複数 owner 間の高レベル調停 API。
  - panel open 時の settings refresh、block rebuild、snapshot / render 更新に必要な effect を入口へ集約する。
  - `subtitleBlockApi.rebuildForPanelOpen` の公開 façade は持たない。

- `subtitleBlockState`
  - subtitle block sequence、current block 解決、meta、runtime mirror 同期の owner。
  - sequence getter を cue-controller の DI surface として公開しない。
  - panel UI / renderer の実装詳細を持たない。

- `getPanelRenderInput()`
  - `content.js` が組み立て、`panelUi` へ DI する高レベル render input source。
  - renderer 自身は shared state を直接読まない。

### 3-5. 依存方向

依存方向は次を守る。

```text
content.js
  ├─ modules/panel-visibility-state.js
  ├─ modules/panel-ui.js
  │    └─ modules/panel-renderer.js
  ├─ modules/subtitle-block-state.js
  │    ├─ modules/subtitle-blocks.js
  │    └─ modules/subtitle-block-resolver.js
  ├─ modules/subtitle-state-reset.js
  └─ reinitialize-coordinator.js
```

- `panel-ui.js` は `panel-renderer.js` を利用してよい。
- `panel-renderer.js` は shared runtime state を直接参照しない。
- `subtitle-block-state.js` は block 構築・解決 module を利用してよい。
- `subtitle-block-state.js` は renderer callback を DI で受け取らない。
- `subtitle-block-resolver.js` は state / DOM / render を持たない。
- `subtitle-state-reset.js` は reset helper を通じて runtime mirror / panel snapshot の reset を束ねる。
- `reinitialize-coordinator.js` は reset options 契約を通じて reset を起動する。
- `content.js` は上位の composition root として DI と複数 owner 間の調停を担当する。

## 4. 実装済みの段階的移行

### Phase A: 基本 owner 分離

1. `panel-visibility-state.js` を panel 開閉 state の load / persist 専用に固定した。
2. `panel-ui.js` へ panel host、ShadowRoot、toggle、observer、render 更新、dispose を寄せた。
3. `panel-renderer.js` を描画専用へ寄せ、shared state 直接参照を外した。
4. `subtitle-blocks.js` と `subtitle-block-resolver.js` を block 構築 / 解決専用へ寄せた。

### Phase B: cleanup 契約固定

1. `panelUi.dispose()` を panel 系 cleanup の高レベル入口として固定した。
2. `removeHost()` を低レベル DOM host 除去専用として維持した。
3. restart / OFF / content switch は `playback-session-cleanup.js` から `panelUi.dispose()` に到達させた。
4. manual reinitialize cleanup は `content.js` から `panelUi.dispose()` に到達させた。
5. block state reset は subtitle 側 owner / reset owner に残し、panel dispose と混ぜないようにした。

### Phase C: modules 統合

1. `panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` を `modules/` 配下へ移動した。
2. `manifest.json` の content scripts 読み込み順を更新した。
3. root 直下の旧ファイル参照を除去した。

### Phase D: Step 17-A-10 API 固定

1. `cue-controller.js` から旧 block getter DI と `sequenceApi` fallback を削除した。
2. `content.js` から cue-controller 向けの旧 block getter 注入を削除した。
3. `subtitleBlockApi.rebuildForPanelOpen` の公開 façade を削除し、panel open 時の高レベル effect を `applyPanelOpenEffects()` へ集約した。
4. `modules/subtitle-block-state.js` から `renderCurrentSnapshot` callback DI を削除し、block state を描画起動から切り離した。
5. `content.js` の `renderCurrentSnapshot()` から `state.currentSubtitleBlock` mirror の直接更新を外した。
6. `modules/panel-ui.js` の `dispose()` 内にあった render artifact reset を `clearPanelRenderArtifacts()` へ集約した。
7. `modules/subtitle-state-reset.js` の panel snapshot / block runtime mirror reset を内部 helper に分離した。
8. `reinitialize-coordinator.js` の `clearInternalSubtitleState` 呼び出しを options 契約に揃えた。
9. `content.js`、`cue-controller.js`、`modules/panel-ui.js`、`modules/subtitle-block-state.js`、`modules/subtitle-state-reset.js`、`reinitialize-coordinator.js` のヘッダー、JSDoc、区切りコメントを実装後の責務に同期した。

## 5. owner / 関数マッピング

| 責務 | 正本 owner | 代表 API / state | `content.js` の扱い |
| :-- | :-- | :-- | :-- |
| panel 開閉状態の保存 | `modules/panel-visibility-state.js` | `load()` / `persist()` | DI と高レベル呼び出しのみ |
| panel host / ShadowRoot / toggle | `modules/panel-ui.js` | `createPanelUi()` / `createRightPanel()` / `createToggleButton()` | 直接 DOM 操作を持たない |
| panel state effect | `modules/panel-ui.js` | `applyPanelState()` | 起動・設定・再初期化文脈で呼ぶ |
| panel 描画だけの更新 | `modules/panel-ui.js` | `refreshPanel()` | 高レベル refresh 要求だけを渡す |
| panel render artifact cleanup | `modules/panel-ui.js` | `clearPanelRenderArtifacts()` / `dispose()` | 詳細を持たない |
| panel 描画 | `modules/panel-renderer.js` | `renderPanel()` | `getPanelRenderInput()` を DI する |
| block sequence 構築 | `modules/subtitle-blocks.js` | `buildSubtitleBlockSequence()` | 実装詳細を持たない |
| panel 用 block 解決 | `modules/subtitle-block-resolver.js` | `resolvePanelBlocksForRender()` | 実装詳細を持たない |
| block state / current 解決 / mirror 同期 | `modules/subtitle-block-state.js` | `sequence` / current block / `meta` | 高レベル effect から利用する |
| panel open effect の調停 | `content.js` | `applyPanelOpenEffects()` | 複数 owner にまたがる入口として維持する |
| complete reset | `modules/subtitle-state-reset.js` | panel snapshot / runtime mirror reset helper | reset orchestration を起動する |
| reinitialize 制御 | `reinitialize-coordinator.js` | reset options 契約 | 順序制御を委譲する |

## 6. 完了条件と確認結果

### 6-1. 完了条件

- `content.js` に panel / block の内部実装詳細を残さない。
- panel DOM、render、block state、visibility storage の owner が混ざらない。
- panel cleanup は `panelUi.dispose()` を入口とし、block reset は subtitle / reset owner が担う。
- `applyPanelState()` と `refreshPanel()` の API 意図が混ざらない。
- Step 17-A-10 で、旧 sequence getter DI / fallback、描画 callback DI、panel open rebuild façade、inline render artifact cleanup を整理する。
- reset / reinitialize が owner 内部 state を直接操作せず、helper / options 契約を通る。
- 対象6ファイルのヘッダー、JSDoc、区切りコメントが実装後の責務と整合する。
- Step 17-B が API 境界を再設計せず、visibility / lifecycle owner の整理へ進める状態にする。

### 6-2. 確認結果

- Phase A〜C の owner 分離、cleanup 契約固定、`modules/` 統合は完了済みである。
- Phase D の Step 17-A-10 API 固定は `43ed673` で完了した。
- 旧 sequence getter DI / fallback、`rebuildForPanelOpen` façade、block state の描画 callback DI を削除した。
- `applyPanelOpenEffects()` に panel open 時の高レベル effect を集約した。
- panel render artifact cleanup、panel snapshot reset、block runtime mirror reset、reinitialize reset options の責務境界を整理した。
- 対象6ファイルのコメント同期を完了した。
- Step 17-A の残作業はなく、次の主作業は Step 17-B の visibility / lifecycle owner 固定である。

## 7. Step 17-B への引き継ぎ

Step 17-A-10 完了後は、Step 17-B で visibility / lifecycle の owner を固定する。

対象とする経路:

- `panelOpen`
- `panelDefaultOpen`
- 通常 open / close
- reinitialize
- SPA 遷移
- 拡張 ON/OFF
- cleanup / mode restore

Step 17-B では、Step 17-A で確定した API 境界を前提とし、panel / block public API を再設計しない。  
`content.js`、`modules/panel-ui.js`、`modules/panel-visibility-state.js`、`playback-session-cleanup.js`、`reinitialize-coordinator.js` の間で、state 保存・DOM visibility・render refresh・cleanup・再初期化の owner と到達順を固定する。

## 8. 結論

Step 17-A は完了した。  
panel / blocks の owner 分離、dispose 契約、`modules/` 統合に加え、Step 17-A-10 で `content.js` の高レベル中継と public API の境界を固定したことで、Step 17-B は visibility / lifecycle の整理に集中できる状態になった。
