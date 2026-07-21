# Issue #32 Subtitle Sync Design

## 1. 目的

Issue #32 では、Apple TV+ 再生画面における subtitle sync / recovery の設計方針を整理し、右側字幕パネルと画面下部 overlay の表示を安定させる。

この文書の主目的は次の 5 点である。

- 履歴の重複をなくし、「1 セリフ基本 1 表示ブロック」に近づける
- overlay の点滅・短表示・片側欠落時の不自然な clear を止める
- panel / overlay / current / history を、同じ字幕ブロック列モデルで扱えるようにする
- large seek 後の secondary missing / recovery を、truth / runtime / health / resolver / UI の各層で追えるようにする
- `content.js` を subtitle sync / recovery の本体から外し、controller / resolver 側へ責務移送しやすい設計にする

この文書は subtitle sync / recovery の**設計正本**であり、実装差分・進捗管理・調査ログの置き場ではない。

---

## 2. 問題定義

Issue #32 で主に扱う問題は次の 5 つである。

- large seek 後に primary は進むが、secondary が missing のまま戻らない、または戻るまでに時間がかかることがある
- current / history / live cue / resolved block の境界が曖昧だと、過去 secondary の混入や履歴重複が起きやすい
- overlay / panel が単一 current block 依存のままだと、same-window captions や seek 直後の片側欠落を自然に扱いにくい
- large seek 直後の truth 再構築と current 維持が弱いと、一時的に current が空、または片側だけの不自然な block に落ちやすい
- panel の自動追従とユーザスクロールが競合すると、一時停止中や閲覧中にスクロール位置が不自然に戻ることがある

現在の主課題は、「secondary がまったく戻らない」ことの切り分けだけではない。  
重要なのは、**戻るまでの復帰ラグを短くすること**、**戻らない区間を primary-only で静かに処理すること**、そして **通常再生中のちらつきやスクロール競合を抑えること** である。

加えて現時点では、拡張側の recovery 判定・trigger・rebind 試行までは実施できているのに、一部タイトル / 区間では Apple TV+ 側 JA track が active cues を復帰させないケースがある。  
そのため、**拡張側で制御できる範囲と基盤側挙動の境界を明確に保つこと** も重要な設計目的になっている。

---

## 3. 設計原則

Issue #32 の subtitle sync / recovery 設計は、次の原則で進める。

- truth は 1 つに寄せる
- runtime 事実と UI 表示状態を混ぜない
- recovery 判定は controller 側に寄せる
- `content.js` は wiring / trigger / logging に留める
- observer / layout は再評価トリガと配置調整に留める
- panel / overlay は truth を持たず、view を描画する
- large seek 向けの保護と通常再生時の安定化は分けて扱う
- secondary が戻らない区間は、無理に復帰を装わず primary-only で静かに扱う

この文書では、実装を細かい差分単位で分けて説明するのではなく、**truth / controller / resolver / UI / observer の役割分担**を固定することを優先する。

---

## 4. モデルと truth 境界

subtitle UI の正解台帳は **`SubtitleBlockSequence`** に一本化する。

責務は次の 3 段構成とする。

1. **truth:** `SubtitleBlockSequence`
2. **current view:** `UiSubtitleView`
3. **list / history view:** `PanelBlock[]`

### 4.1 SubtitleBlockSequence

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

### 4.2 UiSubtitleView

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

### 4.3 PanelBlock[]

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

### 4.4 truth 境界

truth 境界は次のように固定する。

- strict current の truth は `SubtitleBlockSequence.blocks[currentIndex]`
- overlay / panel current は `UiSubtitleView` を通して組み立てる
- panel list / history は `PanelBlock[]` を描画入力とする
- `subtitleHistory` は current truth や fallback truth に使わない
- runtime 現在表示に history を混ぜない

### 4.5 playback context 境界

subtitle sync 設計の周辺文脈として、playback page context / content key / history context は subtitle truth とは分離して扱う。

- playback page の DOM / track readiness 判定
- content key 解決
- contentKey ごとの history bucket 切替

これらは subtitle sync の truth source ではなく、**再生対象の切替文脈**として扱う。  
そのため、`playbackContext.js` の責務は `SubtitleBlockSequence` や recovery 判定と混ぜず、history 文脈切替の補助に留める。

---

## 5. runtime / recovery 方針

secondary recovery の truth は **runtime first / merged assists** とする。

### 5.1 基本方針

- recovery trigger の最終判定は runtime 側のハード条件で行う
- `MergedSubtitleHealth.derived.*` は recover / forceRebind / probe の補助判断に使う
- merged health を唯一の recovery truth にはしない
- observer は recovery 本体を持たず、再評価トリガだけを持つ
- recovery 本線は **sync interval → controller 判定 → truth rebuild → UI redraw** の順で進める
- controller では、runtime missing の入口判定と lane state の継続時間管理を主担当とし、merged assists は recovery 実行可否の補助判定として重ねる
- `content.js` は recovery 本体を持たず、large seek 時刻や sync interval 起動などの薄い wiring に留める

### 5.2 runtime ハード条件

secondary recovery 候補は、**runtime missing を lane state へ入れる条件**として定義する。

少なくとも次を満たす場合に、secondary を「recover を検討すべき missing」とみなす。

- `hasFreshCurrentPrimary === true`
- `currentSecondaryTextLength === 0`
- `secondaryTrackFound === true`
- `secondaryActiveCues === 0`

実装上は、この条件を `secondaryRuntimeMissing` 相当の判定として扱い、secondary lane の `isMissing` に反映する。

現行の controller 実装では、概ね次の runtime 事実を用いて secondary missing を構成する。

- `derived?.primaryHealthy === true`
- `currentCue?.secondaryTextLength === 0`
- `runtime?.secondaryTrackFound === true`
- `runtime?.secondaryActiveCues === 0`

ここでのポイントは、secondary missing を **runtime 上「primary は進んでいるのに secondary だけ空である」状態**として定義し、history や UI 表示状態には依存させないことである。

継続秒数 N の計測責務は **lane state / controller 側**に置く。  
sync interval は controller 判定を定期的に駆動するが、missing の開始時刻・継続時間・missCount の管理は controller 内で行う。

### 5.3 merged assists

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

`derived.*` は runtime ハード条件の代替ではなく、**runtime missing が成立した後に、その missing が recovery 対象として妥当かを補助的に絞り込む層**とする。

現行方針では、概ね次の考え方で組み立てる。

- `primaryHealthy`: primary track / primary cues / primary text / current primary block のいずれかで primary 側の生存を確認する
- `secondaryHealthy`: secondary track / secondary cues / secondary text / current secondary block のいずれかで secondary 側の生存を確認する
- `shouldRecoverSecondary`: `primaryHealthy && !secondaryHealthy && sequence.currentPairMissingSecondary`
- `shouldForceSecondaryRebind`: `shouldRecoverSecondary && sequence.consecutiveCurrentMissingSecondary`

### 5.4 lane state

recovery の実行状態は lane state で持つ。

- `primary` / `secondary` の lane state を同型で持つ
- 現時点で実行対象は secondary lane のみとする
- lane state は `healthy` / `isMissing` / `missingSince` / `missingDurationMs` / `missCount` / `terminated` / `lastDecision` を持つ
- `terminated` は「この seek window / blockRange では secondary recovery を打ち切る」意味を持つ
- `isMissing` は runtime missing 判定の結果を保持する
- `missingSince` / `missingDurationMs` は missing の継続時間を保持する
- `missCount` は recovery 実行回数の上限管理に使う
- `lastDecision` は `idle` / `recover` / `force-rebind` / `terminated` のどこにいるかを表す

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

secondary lane の評価は、概ね次の順で進める。

1. runtime ハード条件から `isMissing` を決める
2. `isMissing` が false なら `idle`
3. `terminated` なら retry せず `terminated`
4. `missingDurationMs >= recoveryWindow` になるまで待機する
5. 閾値を超えたら `derived.*` を補助条件として見て、`recover` または `force-rebind` を決める
6. `missCount` が上限を超えたら `terminated` に移行する

### 5.5 large seek 方針

large seek 時は、secondary recovery を miss limit 付きの runtime retry として扱う。

- near seek では追加 recovery を前提にしない
- large seek では、primary 復帰後に secondary missing が継続するケースを対象にする
- recovery は一定 window 内で retry する
- missCount が一定回数を超えた場合、その seek window / blockRange では secondary recovery を打ち切る
- 打ち切り後は `terminated` として primary-only 表示へ切り替える
- `terminated` は次 block または新しい seek で reset されうる

terminated に入った seek window では、以後その window 内の secondary missing を「recover 不能」とみなし、UI は primary-only 区間として静かに処理する。

### 5.6 現行採用パラメータ

現行採用値では、次を運用値とする。

- recovery window: 1000ms
- force-rebind 開始: 2 回目
- miss limit: 8 回

これらの値の意図は次のとおり。

- **recovery window 1000ms**: primary 復帰直後の短い揺れを即時 miss として叩かず、secondary cue の自然な遅れを待つ
- **force-rebind 開始 2 回目**: 1 回目は軽量 recovery に留め、連続 miss に入ったときだけ強い再接続へ進む
- **miss limit 8 回**: 無限 retry を避けつつ、戻るケースには複数回の再挑戦を許す

### 5.7 Runtime First 方針

secondary recovery の基本方針は **Runtime First** とする。

これは次を意味する。

- missing の入口判定は runtime 事実で決める
- waiting window までは merged assists を尊重し、軽い待機を許す
- waiting window 超過後は、`derived.shouldRecoverSecondary === true` のみに固定せず、runtime missing が続いているなら recovery を進める
- その後の `recover` / `force-rebind` / `terminated` は lane state と missCount に従って進める

この方針の目的は、large seek 後に

- primary は既に healthy
- secondary track も見つかっている
- `secondaryActiveCues === 0`
- current secondary text も空

という runtime missing が継続しているのに、`derived.shouldRecoverSecondary` の揺れだけで recovery が遅延・停止することを避ける点にある。

### 5.8 large seek 直後の truth 保護

large seek 直後は、secondary sync 後に **近傍 truth rebuild** と **short-lived hold** を許す。

- `content.js` 側は large seek を検知し、`lastLargeSeekAt` を記録する
- `cue-controller.js` 側は `lastLargeSeekAt` を参照し、短い seek window の間だけ nearby hold を利用できる
- hold は truth source ではなく、large seek 直後の UI 空白を避けるための一時 view である
- hold / guard は latest-only とし、新しい nearby rebuild が来たら古い保護は上書きする
- hold は次の `onPrimaryCueChange()` で 1 回だけ使い、その後は通常の truth 解決に戻す

### 5.9 通常再生時の hold 制御

hold / rebuild 系の保護は large seek 向けの補助手段であり、通常再生時の常用ロジックにはしない。

- 通常再生では `nearbyRebuildHold` / `preserveNearbyRebuildHold` の効きを最小限にする
- 一時停止中や通常の cue 進行中に、hold が overlay の短表示やちらつき原因にならないようにする
- large seek 用の強い保護と、通常再生用の軽い安定化は分けて扱う

### 5.10 Known Issue 境界

現時点の設計では、次を **拡張側で担保する範囲**とする。

- runtime missing の検知
- lane state による waiting window / missCount / terminated 管理
- `recover` / `force-rebind` の決定
- secondary track の再同期・再バインド試行
- terminated 後の primary-only 静的処理

一方、次は **現時点では Apple TV+ 側挙動に依存する Known Issue**として扱う。

- `force-rebind` による再同期が実行され、track re-bound も確認できるのに、JA track の active cues が復帰しないケース
- 作品 / 区間依存で secondary が最後まで `secondaryActiveCues: 0` のままになるケース

この Known Issue は、「recovery 判定が出ていない」「sync が走っていない」こととは切り分けて扱う。  
必要なら将来、feature flag 付きの aggressive workaround（track disable/enable や他言語 track 経由の再選択）を別検討するが、本設計には含めない。

---

## 6. UI 方針

### 6.1 overlay

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

### 6.2 panel / history

panel は `PanelBlock[]` を描画入力とする。

- 過去 / 現在 / 未来を同じ列で表示する
- same-window group に対して `isWindowCurrent` / `isPanelEmphasized` / `isSequentialCurrent` を付与する
- panel current と truth current は分離して扱う
- large seek 直後の hold は panel list の truth を書き換えず、current 表示の短期補助としてのみ使う

history は最終的に `blocks.past` 由来へ縮退させる。

- `subtitleHistory` は移行期間の補助構造とする
- history の追加契機は「block key が変わったとき」の 1 回だけとする
- same-window 再評価や secondary 後追いでは追加しない

### 6.3 primary-only / keep-visible / clear ルール

secondary recovery が terminated に入った seek window では、UI は primary-only 区間として扱う。

- primary 側 truth がある限り、overlay / panel current を静的に維持する
- secondary missing を理由に current 全体を空へ落とさない
- secondary 復帰後は通常の current block / view 解決へ戻す

### 6.4 panel スクロール方針

panel スクロールは、truth current への自動追従とユーザ手動操作を分離して扱う。

- panel current の算出は truth / view 側で決める
- 実際の scroll 反映は UI 層の責務とする
- ユーザが手動スクロールした直後は、一時的に自動追従を抑制する
- 一時停止中は自動追従を弱めるか停止し、閲覧中のスクロールを優先する
- auto-follow の再開条件は、再生再開・一定時間経過・明示的 current jump のいずれかに限定する

---

## 7. 実装境界

### 7.1 `content.js`

`content.js` は薄い wiring / lifecycle / sync 呼び出し側に留める。

- イベント購読
- sync interval ベースの呼び出し
- controller の戻り値受け取り
- bootstrap / cleanup / UI 連携
- large seek の検知と時刻記録
- playback context controller や各 resolver の接続
- recovery 判定結果と sync 実行結果の観測ログ出力

`content.js` に recovery state や判定分岐を足し続ける方針は取らない。  
特に、runtime missing / waiting window / missCount / terminated の本体判定は `content.js` に置かない。

### 7.2 `cue-controller.js`

`cue-controller.js` は subtitle sync / health / recovery の主担当とする。

- primary / secondary cuechange 本流
- sequence 再構築
- merged health 集約
- lane state / `evaluateSecondaryRecovery`
- secondary recovery 判定
- missCount / terminated 管理
- nearby rebuild / hold guard / seek window 判定

特に次の責務を `cue-controller.js` に集約する。

- runtime missing の入口判定
- lane state の継続時間管理
- merged assists の補助判定との合成
- large seek window ごとの retry / terminate 制御
- primary-only 表示へ落とすための recovery decision の返却
- Runtime First 方針の gating 実装

### 7.3 resolver / helper

resolver / helper は view / panel / same-window / health 判定の補助を担う。

- `subtitle-blocks.js`: `SubtitleBlockSequence` 構築
- `subtitle-view-resolver.js`: `UiSubtitleView` 生成
- `overlay-block-resolver.js`: same-window group → `OverlayView`
- `subtitle-block-resolver.js`: sequence → `PanelBlock[]`
- `subtitle-track-resolver.js`: secondary track 候補解決と観測
- `playbackContext.js`: playback page context / content key / history context

### 7.4 UI 層

UI 層は truth を直接持たず、view を描画する。

- overlay は `OverlayView` を描画する
- panel は `PanelBlock[]` を描画する
- UI 層は recovery 判定や current truth の書き換えを行わない
- panel のスクロール制御は UI 層で扱うが、truth current の判定は持たない

### 7.5 observer / layout 周辺の境界

observer / layout は subtitle sync / recovery の本体ではなく、再評価トリガと位置調整の層として扱う。

- `runtime-observers.js` は再接続・再評価・再配置の trigger を持つ
- playback controls layout は `playback-controls-layout.js` を正本とし、controls の位置・幅・translate 管理に責務を限定する
- playback controls layout は overlay / panel の見た目責務や subtitle truth を持たない
- `content.js` は layout controller instance を組み立て、observer / overlay 側へ bridge するだけに留める
- subtitle sync の不具合を observer 条件追加だけで吸収しない

### 7.6 接続原則

各層の接続原則は次のとおりとする。

- `content.js`: runtime fact / trigger を controller へ渡す
- controller: 判定と state machine を持つ
- resolver / helper: truth から view / panel / health を作る
- UI: view を描画する
- observer / layout: trigger と配置だけを扱う

---

## 8. 現時点の設計到達点

2026-07-21 時点で、この設計として次が揃っている。

- subtitle truth を `SubtitleBlockSequence` に寄せる方針
- current view / panel list view を truth から分離する方針
- runtime first / merged assists による secondary recovery 判定方針
- lane state による waiting window / missCount / terminated 管理方針
- large seek 直後の nearby rebuild / short-lived hold の位置づけ
- primary-only fallback を「失敗時の静かな表示モード」として扱う方針
- `content.js` を subtitle sync / recovery の本体から外し、controller / resolver / UI / observer の境界を分ける方針
- `playbackContext.js` を subtitle truth とは別の「再生対象文脈」として扱う境界
- playback controls layout を subtitle sync 本体と切り分ける境界
- Apple TV+ 側で active cues が復帰しないケースを Known Issue として切り分ける方針

この文書の役割は、ここから先の調整を「どの値を少し変えるか」ではなく、**どの層が何を担うべきか** の観点でぶれずに進めることである。

---

## 9. 非目標

この文書では次を扱わない。

- UI の細かい見た目調整（フォント、色、微細 layout）
- dev-roadmap / Phase 進捗管理
- セッション単位の調査ログや実況メモ
- runtime パラメータの細かい試行履歴
- grep / filter 文字列のような一時的な debug 手順
- `content.js` 分割順そのもののロードマップ詳細
- aggressive workaround の個別実装案（別 Issue / feature flag 検討事項）
- playback controls layout の詳細な移送手順や行数削減ラウンドの進捗管理

進捗・優先順位は `docs/dev-roadmap.md` を参照する。  
`content.js` 分割の原則は `docs/contentjs-split-roadmap.md` を参照する。

---

## 10. 関連ファイル

- `content.js`
- `playbackContext.js`
- `cue-controller.js`
- `subtitle-blocks.js`
- `subtitle-view-resolver.js`
- `overlay-block-resolver.js`
- `overlay-controller.js`
- `subtitle-block-resolver.js`
- `panel-renderer.js`
- `panel-ui.js`
- `subtitle-track-resolver.js`
- `playback-controls-layout.js`
- `runtime-observers.js`
- `debug-logger.js`
- `debug-panel.js`
