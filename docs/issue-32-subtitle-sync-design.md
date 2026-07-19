# Issue #32 Subtitle Sync Design

## 1. 目的

Issue #32 では、Apple TV+ 再生画面における subtitle sync / recovery の設計方針を整理し、右側字幕パネルと画面下部 overlay の表示を安定させる。

この文書の主目的は次の 4 点である。

- 履歴の重複をなくし、「1 セリフ基本 1 表示ブロック」に近づける
- overlay の点滅・短表示・片側欠落時の不自然な clear を止める
- panel / overlay / current / history を、同じ字幕ブロック列モデルで扱えるようにする
- large seek 後の secondary missing / recovery を、truth / runtime / health / resolver / UI の各層で追えるようにする

この文書は subtitle sync / recovery の**設計正本**であり、実装差分・進捗管理・調査ログの置き場ではない。

---

## 2. 問題定義

Issue #32 で主に扱う問題は次の 4 つである。

- large seek 後に primary は進むが、secondary が missing のまま戻らない、または戻るまでに時間がかかることがある
- current / history / live cue / resolved block の境界が曖昧だと、過去 secondary の混入や履歴重複が起きやすい
- overlay / panel が単一 current block 依存のままだと、same-window captions や seek 直後の片側欠落を自然に扱いにくい
- large seek 直後の truth 再構築と current 維持が弱いと、一時的に current が空、または片側だけの不自然な block に落ちやすい

現在の主課題は「secondary がまったく戻らない」ことの切り分けだけではなく、**戻るまでの復帰ラグを短くすること**と、**戻らない区間を primary-only で静かに処理すること**である。

---

## 3. モデルと truth 境界

subtitle UI の正解台帳は **`SubtitleBlockSequence`** に一本化する。

責務は次の 3 段構成とする。

1. **truth:** `SubtitleBlockSequence`
2. **current view:** `UiSubtitleView`
3. **list / history view:** `PanelBlock[]`

### 3.1 SubtitleBlockSequence

`SubtitleBlockSequence` は唯一の truth source とする。

- `blocks[] + currentIndex + meta` を持つ
- 過去 / 現在 / 未来の block を同じ列で扱う
- current / history / panel / overlay の起点になる
- `subtitleHistory` は移行期間の補助構造として残してよいが、最終 truth とはみなさない

```js
/**
 * @typedef {"past" | "current" | "future"} SubtitleState
 */

/**
 * @typedef {Object} SubtitleBlock
 * @property {string} key
 * @property {number | null} startTime
 * @property {number | null} endTime
 * @property {string} primaryText
 * @property {string} secondaryText
 * @property {SubtitleState} state
 * @property {boolean} stable
 * @property {boolean} hasPrimarySignal
 * @property {boolean} hasSecondarySignal
 * @property {string} [sourceReason]
 */

/**
 * @typedef {Object} SubtitleSequenceHealth
 * @property {boolean} hasCurrentBlock
 * @property {boolean} hasCurrentPrimary
 * @property {boolean} hasCurrentSecondary
 * @property {boolean} currentPairAligned
 * @property {boolean} currentPairMissingSecondary
 * @property {boolean} previousPairMissingSecondary
 * @property {boolean} consecutiveCurrentMissingSecondary
 */

/**
 * @typedef {Object} SubtitleBlockSequence
 * @property {SubtitleBlock[]} blocks
 * @property {number} currentIndex
 * @property {{
 *   now: number,
 *   rebuildReason: string,
 *   blockCount: number,
 *   sequenceHealth: SubtitleSequenceHealth
 * }} meta
 */
```

`blocks[currentIndex]` が strict current であり、truth 判定の起点になる。

### 3.2 UiSubtitleView

`UiSubtitleView` は overlay / panel current の共通入口となる current 表示用 view である。

- current block を UI 向けに正規化する
- line 配列、可視維持、empty 判定をまとめる
- panel list / history 全体の truth ではない
- large seek 直後には short-lived hold view を一時的に持つことがある

```js
/**
 * @typedef {Object} UiSubtitleView
 * @property {SubtitleBlock | null} currentBlock
 * @property {PanelBlock[]} displayBlocks
 * @property {string[]} mainLines
 * @property {string[]} subLines
 * @property {boolean} isStable
 * @property {boolean} shouldKeepVisible
 * @property {boolean} isEmpty
 * @property {string} [sourceReason]
 */
```

### 3.3 PanelBlock[]

`PanelBlock[]` は panel list / history 用の表示列である。

- `SubtitleBlockSequence` から正規化して作る
- panel current と truth current を分離して扱う
- same-window captions に対する UX 上の current 表示を持てるようにする

```js
/**
 * @typedef {Object} PanelBlock
 * @property {string} key
 * @property {number | null} startTime
 * @property {number | null} endTime
 * @property {string} primary
 * @property {string} secondary
 * @property {string[]} mainLines
 * @property {string[]} subLines
 * @property {SubtitleState} state
 * @property {boolean} stable
 * @property {boolean} isWindowCurrent
 * @property {boolean} isPanelEmphasized
 * @property {boolean} isSequentialCurrent
 */
```

### 3.4 truth 境界

truth 境界は次のように固定する。

- strict current の truth は `SubtitleBlockSequence.blocks[currentIndex]`
- overlay / panel current は `UiSubtitleView` を通して組み立てる
- panel list / history は `PanelBlock[]` を描画入力とする
- `subtitleHistory` は current truth や fallback truth に使わない
- runtime 現在表示に history を混ぜない

---

## 4. runtime / recovery 方針

secondary recovery の truth は **runtime first / merged assists** とする。

### 4.1 基本方針

- recovery trigger の最終判定は runtime 側のハード条件で行う
- `MergedSubtitleHealth.derived.*` は recover / forceRebind / probe の補助判断に使う
- merged health を唯一の recovery truth にはしない
- observer は recovery 本体を持たず、再評価トリガだけを持つ
- recovery 本線は **sync interval → controller 判定 → truth rebuild → UI redraw** の順で進める

### 4.2 runtime ハード条件

少なくとも次を満たす場合に secondary recovery 候補とみなす。

- `hasFreshCurrentPrimary === true`
- `currentSecondaryTextLength === 0`
- `secondaryTrackFound === true`
- `secondaryActiveCues === 0`
- 上記が一定時間以上継続している

継続秒数 N の計測と recovery 実行責務は **sync interval 側** に置く。

### 4.3 merged assists

`MergedSubtitleHealth` は runtime / current cue / sequence health を統合した補助 health である。

```js
/**
 * @typedef {Object} MergedSubtitleHealth
 * @property {{
 *   primaryTrackFound: boolean,
 *   secondaryTrackFound: boolean,
 *   primaryActiveCues: number,
 *   secondaryActiveCues: number
 * }} runtime
 * @property {{
 *   hasPrimaryCue: boolean,
 *   hasSecondaryCue: boolean,
 *   primaryTextLength: number,
 *   secondaryTextLength: number,
 *   hasPrimaryText: boolean,
 *   hasSecondaryText: boolean,
 *   hasFreshCurrentPrimary?: boolean
 * }} currentCue
 * @property {{
 *   hasCurrentBlock: boolean,
 *   hasCurrentPrimary: boolean,
 *   hasCurrentSecondary: boolean,
 *   currentPairAligned: boolean,
 *   currentPairMissingSecondary: boolean,
 *   previousPairMissingSecondary: boolean,
 *   consecutiveCurrentMissingSecondary: boolean
 * }} sequence
 * @property {{
 *   primaryHealthy: boolean,
 *   secondaryHealthy: boolean,
 *   shouldRecoverSecondary: boolean,
 *   shouldForceSecondaryRebind: boolean
 * }} derived
 */
```

`derived.*` の役割は次のとおり。

- `primaryHealthy`: primary 側が通常動作しているかの補助判定
- `secondaryHealthy`: secondary 側が健全かの補助判定
- `shouldRecoverSecondary`: 軽量 recovery を試すべきかの補助判定
- `shouldForceSecondaryRebind`: rebind を伴う強い recovery に進むべきかの補助判定

### 4.4 lane state

recovery の実行状態は lane state で持つ。

- `primary` / `secondary` の lane state を同型で持つ
- 現時点で実行対象は secondary lane のみとする
- lane state は `healthy` / `isMissing` / `missingSince` / `missingDurationMs` / `missCount` / `terminated` / `lastDecision` を持つ
- `terminated` は「この seek window / blockRange では secondary recovery を打ち切る」意味を持つ

```js
/**
 * @typedef {Object} SubtitleLaneState
 * @property {"primary" | "secondary"} lane
 * @property {boolean} healthy
 * @property {boolean} isMissing
 * @property {number} missingSince
 * @property {number} missingDurationMs
 * @property {number} missCount
 * @property {boolean} terminated
 * @property {"idle" | "recover" | "force-rebind" | "terminated"} lastDecision
 */
```

### 4.5 large seek 時の扱い

large seek 時は、secondary recovery を miss limit 付きの runtime retry として扱う。

- near seek では追加 recovery を前提にしない
- large seek では、primary 復帰後に secondary missing が継続するケースを対象にする
- recovery は一定 window 内で retry する
- missCount が一定回数を超えた場合、その seek window / blockRange では secondary recovery を打ち切る
- 打ち切り後は `terminated` として primary-only 表示へ切り替える
- `terminated` は次 block または新しい seek で reset されうる

Phase J の現行調整では、次を暫定の運用値とする。

- recovery window: 1 秒
- force-rebind 開始: 2 回目
- miss limit: 8 回

これらの値は調整対象だが、**無限 retry を避けつつ、戻るケースには再挑戦を許す**ことが設計意図である。

### 4.6 large seek 直後の truth 保護

large seek 直後は、secondary sync 後に **近傍 truth rebuild** と **short-lived hold** を許す。

- `content.js` 側は large seek を検知し、`lastLargeSeekAt` を記録する
- `cue-controller.js` 側は `lastLargeSeekAt` を参照し、短い seek window の間だけ nearby hold を利用できる
- hold は truth source ではなく、large seek 直後の UI 空白を避けるための一時 view である
- hold / guard は latest-only とし、新しい nearby rebuild が来たら古い保護は上書きする
- hold は次の `onPrimaryCueChange()` で 1 回だけ使い、その後は通常の truth 解決に戻す

現在の first cut では、large seek 後の短時間だけ `nearbyRebuildHold` を current 表示に使い、truth 本体の書き換えは行わない。

---

## 5. UI 方針

### 5.1 overlay

overlay は current block 1 件だけに固定せず、必要に応じて same-window group を表示単位とする。

- 通常時は current block 1 件の view を表示する
- same-window / large seek では `OverlayView` を表示単位とする
- main/sub は同じ group 内で順序維持した上で dedupe する
- 片側欠落時は truth を書き換えず、view 組み立て側で空のまま静的維持する
- clear 条件は `isEmpty && !shouldKeepVisible` に限定する

```js
/**
 * @typedef {Object} OverlayView
 * @property {string} groupKey
 * @property {number | null} startTime
 * @property {number | null} endTime
 * @property {string[]} mainLines
 * @property {string[]} subLines
 * @property {boolean} isStable
 * @property {boolean} shouldKeepVisible
 * @property {boolean} isEmpty
 */
```

### 5.2 panel

panel は `PanelBlock[]` を描画入力とする。

- 過去 / 現在 / 未来を同じ列で表示する
- same-window group に対して `isWindowCurrent` / `isPanelEmphasized` / `isSequentialCurrent` を付与する
- panel current と truth current は分離して扱う
- large seek 直後の hold は panel list の truth を書き換えず、current 表示の短期補助としてのみ使う

### 5.3 history

history は最終的に `blocks.past` 由来へ縮退させる。

- `subtitleHistory` は移行期間の補助構造とする
- history の追加契機は「block key が変わったとき」の 1 回だけとする
- same-window 再評価や secondary 後追いでは追加しない

### 5.4 primary-only 区間

secondary recovery が terminated に入った seek window では、UI は primary-only 区間として扱う。

- primary 側 truth がある限り、overlay / panel current を静的に維持する
- secondary missing を理由に current 全体を空へ落とさない
- secondary 復帰後は通常の current block / view 解決へ戻す

---

## 6. 実装境界

### 6.1 `content.js`

`content.js` は薄い wiring / lifecycle / sync 呼び出し側に留める。

- イベント購読
- sync interval ベースの呼び出し
- controller の戻り値受け取り
- bootstrap / cleanup / UI 連携
- large seek の検知と時刻記録

`content.js` に recovery state や判定分岐を足し続ける方針は取らない。

### 6.2 `cue-controller.js`

`cue-controller.js` は subtitle sync / health / recovery の主担当とする。

- primary / secondary cuechange 本流
- sequence 再構築
- merged health 集約
- lane state / evaluateSecondaryRecovery
- secondary recovery 判定
- missCount / terminated 管理
- nearby rebuild / hold guard / seek window 判定

### 6.3 resolver / helper

resolver / helper は view / panel / same-window / health 判定の補助を担う。

- `subtitle-blocks.js`: `SubtitleBlockSequence` 構築
- `subtitle-view-resolver.js`: `UiSubtitleView` 生成
- `overlay-block-resolver.js`: same-window group → `OverlayView`
- `subtitle-block-resolver.js`: sequence → `PanelBlock[]`
- `subtitle-track-resolver.js`: secondary track 候補解決と観測

### 6.4 UI 層

UI 層は truth を直接持たず、view を描画する。

- overlay は `OverlayView` を描画する
- panel は `PanelBlock[]` を描画する
- UI 層は recovery 判定や current truth の書き換えを行わない

---

## 7. 非目標

この文書では次を扱わない。

- UI の細かい見た目調整（フォント、色、微細 layout）
- dev-roadmap / Phase 進捗管理
- セッション単位の調査ログや実況メモ
- runtime パラメータの細かい試行履歴
- grep / filter 文字列のような一時的な debug 手順

進捗・優先順位は `docs/dev-roadmap.md` を参照する。  
`content.js` 分割の原則は `docs/contentjs-split-roadmap.md` を参照する。

---

## 8. 関連ファイル

- `content.js`
- `cue-controller.js`
- `subtitle-blocks.js`
- `subtitle-view-resolver.js`
- `overlay-block-resolver.js`
- `overlay-controller.js`
- `subtitle-block-resolver.js`
- `panel-renderer.js`
- `panel-ui.js`
- `subtitle-track-resolver.js`
- `debug-logger.js`
- `debug-panel.js`
