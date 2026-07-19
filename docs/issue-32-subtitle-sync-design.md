# Issue #32 Subtitle Sync Design

## 要約

### 目的

Issue #32 では、Apple TV+ 再生画面における字幕同期まわりを整理し、右側字幕パネルと画面下部の字幕（overlay）の表示を安定させる。

主な目的は次の 4 点。

- 履歴の重複をなくし、「1 セリフ基本 1 表示ブロック」に近づける
- 下部 overlay の点滅・短表示・片側欠落時の不自然な clear を止める
- panel / overlay / current / history を、同じ字幕ブロック列モデルで扱えるようにする
- large seek 後の「メインだけ進み、サブが復帰しない」ケースを、view / runtime / health / recovery / resolver の各層で追えるようにする

この文書は「何をどう設計したか」をまとめる設計文書であり、実装差分ではなく方針の正本とする。

### 真実源と 3 段構成

字幕 UI の正解台帳は **`SubtitleBlockSequence`（`blocks[] + currentIndex + meta`）** に一本化する。

- 唯一の truth source: `SubtitleBlockSequence`
- current 系の共通 view: `UiSubtitleView`
- panel list / history 用の表示列: `PanelBlock[]`

責務は次の 3 段構成とする。

1. **truth:** `SubtitleBlockSequence`（過去 / 現在 / 未来 + sequenceHealth）
2. **current view:** `UiSubtitleView`（overlay / panel current の共通入口）
3. **list / history view:** `PanelBlock[]`（panel list / history 描画用）

`subtitleHistory` は移行期間の補助構造として残してよいが、最終 truth とはみなさない。

### health / recovery 方針

secondary recovery の truth は **runtime first / merged assists** とする。

- recovery trigger の最終判定は runtime 側のハード条件で行う
- merged subtitle health（`MergedSubtitleHealth.derived.*`）は第 2 段階の判定として使う
  - recover を強める / 抑える
  - forceRebind へ上げる
  - probe を出す
    の補助 truth とする
- merged health を唯一の recovery truth にはしないが、ログ専用にも落とさない

初期ラインとして、runtime ハード条件は次を満たす場合に recovery trigger を許可する。

- `hasFreshCurrentPrimary === true`
  - 初期定義: `runtime.primaryActiveCues > 0` を優先し、必要なら `currentCue.hasPrimaryText === true` を補助条件として扱う
- `currentSecondaryTextLength === 0`
  - `currentCue.secondaryTextLength === 0`
- `secondaryTrackFound === true`
  - `runtime.secondaryTrackFound === true`
- `secondaryActiveCues === 0`
  - `runtime.secondaryActiveCues === 0`
- 上記が **2 秒以上継続**

継続秒数 N（初期値 2 秒）の計測は、**sync interval 側**で行う。  
`buildMergedSubtitleHealth()` は runtime / current cue / sequence の瞬間状態をまとめるが、「同じ runtime 条件が何秒継続したか」の管理と recovery 実行責務は sync interval 側に置く。

このとき `MergedSubtitleHealth.derived.*` は、runtime 条件を置き換えるためではなく、**runtime 条件で recovery 候補になったケースに対して recover / forceRebind / probe の強さを補助的に振り分けるための派生情報**として扱う。

初期整理として、`derived.*` の役割は次のように置く。

- `primaryHealthy`
  - primary 側が通常動作しているかの補助判定
  - secondary recovery を考える前提条件として使う
- `secondaryHealthy`
  - secondary 側が現在正常に流れているかの補助判定
  - runtime 条件上は「止まっている疑い」があっても、merged 上でまだ健全と見なせるかを確認する
- `shouldRecoverSecondary`
  - runtime ハード条件が成立したケースで、軽量 recovery を試すべきかの補助判定
- `shouldForceSecondaryRebind`
  - runtime ハード条件が成立したケースで、rebind を伴う強い recovery に進むべきかの補助判定

probe は、runtime 条件は揃っているが rebind までは上げたくないケースの観測補助として使う。

### overlay / panel / history の責務

- **overlay**
  - 通常時は current block 1 件の view を表示する
  - same-window / large seek では、同じ `startTime + endTime` を持つ表示グループ（`OverlayView`）を表示する
  - main/sub を同じ group 内でそろえ、順序維持した上で重複行を dedupe する
  - 片側欠落時は truth を書き換えず、view 組み立て側で空のまま静的維持する

- **panel**
  - `PanelBlock[]` を描画入力とし、過去 / 現在 / 未来を同じ列で表示する
  - same-window window に対して `isWindowCurrent` / `isPanelEmphasized` / `isSequentialCurrent` を付与し、UX 上の現在行（再生マーク行）を解決する
  - panel current と truth current（`state="current"`）は分離して扱う

- **history**
  - 最終的には `blocks.past` 由来の panel history に縮退させる
  - `subtitleHistory` は移行期間の補助構造とし、read/write 経路は段階的に縮小・削除する
  - history の追加契機は「block key が変わったとき」の 1 回だけとし、same-window 内の再評価や secondary 後追いでは追加しない

### Phase J の主題

Phase J では次を主題とする。

- `docs/issue-32-subtitle-sync-design.md` の JSDoc / 型名・フィールド名を、`subtitle-blocks` / `overlay-block-resolver` / `subtitle-view-resolver` / `subtitle-block-resolver` / `cue-controller` の現行実装に同期する
- runtime ハード条件の式と継続秒数 N を、large seek 代表ケースを踏まえて確定する
- `MergedSubtitleHealth.derived.*` の役割（recover 強化・forceRebind・probe 条件）を固定する
- `SubtitleBlockSequence / UiSubtitleView / PanelBlock[]` の 3 段構成に沿って current 系 cleanup を開始する
- panel history を `blocks.past` / `PanelBlock[]` 由来へ寄せる初期計画を立てる
- `subtitleHistory` の read/write を current / fallback から外し、history 描画専用へ縮小する最初のステップを決める
- sync interval 側で runtime 条件の継続秒数を管理し、recovery 実行責務を明確化する

### Phase J: large seek 時の secondary recovery 方針

large seek 時（シークバーで大きくジャンプした場合など）は、primary と secondary で挙動を分けて扱う。

- same-window（近距離）の移動では、現状どおり primary / secondary 両方の signal と text length が安定していることを前提に、追加の recovery は行わない
- large seek では、`secondaryTrackFound === true` でも `currentSecondaryTextLength === 0` のまま missCount が増え続けるケースがあるため、sync interval ベースの secondary recovery に上限を設ける
- secondary recovery の missCount が一定回数（例: 5〜8 回）を超えた場合、その blockRange では secondary recovery を打ち切り、secondary が表示されない区間として扱う
- recovery 打ち切り時には、内部 state（例: `secondaryRecoveryState`）に「この contentKey / blockRange では secondary を諦めた」ことを記録し、同じ blockRange に対する sync interval からの再 recovery は行わない
- 次の `onPrimaryCueChange` で block が変わったとき、またはユーザ操作による新しい large seek が発生したときに、secondary recovery の state をリセットし、再チャレンジを許可する
- panel / overlay 上は、secondary を諦めた blockRange では primary のみを表示し、secondary 行は空（UI 上は非表示または空行）として扱う
- secondary recovery のログには、missCount / forceRebind に加えて打ち切り判定の有無（例: `terminated` / `missLimit`）を含め、Phase J のテストで「どこまで recovery してどこで諦めたか」を観測できるようにする

---

## 用語とモデル

### 字幕ブロック列（SubtitleBlockSequence）

字幕 UI 全体の正解台帳。  
shape は次とする。

```js
/**
 * @typedef {"past" | "current" | "future"} SubtitleState
 */

/**
 * @typedef {Object} SubtitleBlock
 * @property {string} key
 * @property {number} startTime
 * @property {number} endTime
 * @property {string} primaryText
 * @property {string} secondaryText // 片側欠落時は "" を使う
 * @property {SubtitleState} state
 * @property {boolean} stable
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
 * @property {boolean} shouldRecoverSecondary
 */

/**
 * @typedef {Object} SubtitleBlockSequence
 * @property {SubtitleBlock[]} blocks
 * @property {number} currentIndex // current が存在しない場合は -1
 * @property {{
 *   now: number,
 *   rebuildReason: string,
 *   blockCount: number,
 *   sequenceHealth: SubtitleSequenceHealth
 * }} meta
 */
```

- `state`: `past/current/future` の位置づけ
- `stable`: seek / track 再解決 / secondary 後追いで再評価する余地
- `meta.sequenceHealth`: current block と直前 current block の組み合わせから、secondary 欠落の継続有無を観測する補助 health 情報

block の基本 key は少なくとも次の 3 要素を組み合わせる。

```js
function buildBlockKey(block) {
  return `${block.startTime}::${block.endTime}::${block.primaryText}`;
}
```

実装上は `startTime` / `endTime` を固定小数点化し、`primaryText` を正規化した key を使う。  
docs 上では概念表現として上記の 3 要素を示す。

### current block / current view

- **current block:** `blocks[currentIndex]`
  - runtime の現在データ
  - `currentSubtitleBlock` は当面互換コピーとして残すが、truth 判定の起点にはしない
- **current view（UiSubtitleView）:** overlay / panel current から見る共通 view

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
 */
```

`UiSubtitleView` は **current 表示用の共通 view** であり、実装上は `currentBlock` / `displayBlocks` / line 配列 / 可視維持フラグを持つ正規化 shape にそろえる。  
panel list / history 全体の唯一 truth 列ではなく、panel list / history は `PanelBlock[]` を truth とする。

### same-window / 表示グループ

- **same-window:** 同じ `startTime + endTime` を持つ複数 block
- **表示グループ:** overlay / panel で same-window を 1 つの表示単位として扱うまとまり
  - key: `${startTime}::${endTime}`
  - group 内で main/sub の行配列を組み立て、順序維持 + 内容重複の dedupe を行う

### overlay view（OverlayView）

画面下部字幕用の表示モデル。

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

- `mainLines` / `subLines`: same-window group 内の順序維持 + dedupe 済み行
- `shouldKeepVisible`: `isEmpty === true` でも clear せず維持すべき場合のフラグ
- clear 条件は `isEmpty && !shouldKeepVisible` に限定する

overlay は通常 `currentBlock` に基づく 2 行表示を行うが、same-window / large seek では `OverlayView` を描画単位とする。

### panel block（PanelBlock）

panel list / history 用の表示列。

```js
/**
 * @typedef {Object} PanelBlock
 * @property {string} key
 * @property {number} startTime
 * @property {number} endTime
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

- `state`: truth 上の `past/current/future`
- `isWindowCurrent`: same-window window が現在表示 window に属するか
- `isPanelEmphasized`: panel 上で「今再生中」と見せる強調行か
- `isSequentialCurrent`: group 内 line-level current として選ばれた行

panel current と truth current は分離し、再生マーク行は `isSequentialCurrent` と `isWindowCurrent` の組み合わせで決める。

### merged subtitle health（MergedSubtitleHealth）

runtime / current cue / sequence health を統合した health 情報。

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
 *   hasSecondaryText: boolean
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

派生値の役割:

- `primaryHealthy`: primary 側が通常動作しているかの補助判定
- `secondaryHealthy`: 現在の secondary 状態の健康判定
- `shouldRecoverSecondary`: 軽量 recovery を試すべきかの補助判定
- `shouldForceSecondaryRebind`: rebind を伴う強い recovery に進むべきかの補助判定

ここでの `derived.*` は recovery trigger の唯一条件ではない。  
runtime 条件で「secondary が止まっている可能性が高い」と判断した後に、recover 強化 / forceRebind / probe を振り分けるための **merged assists** として扱う。

---

## 現在確認できている主な問題

### 1. large seek 後の secondary 不復帰

large seek 代表ケースでは、次の状態が観測されている。

- `secondaryTrackFound = true`
- `secondaryActiveCues = 0`
- `currentSecondaryTextLength = 0`
- content 側 fallback recovery は継続発火する
- それでも sub が復帰しない

同じ区間で merged 側では、次のようになることがある。

- `derived.secondaryHealthy = true`
- `derived.shouldRecoverSecondary = false`

このため、runtime と merged health の判定がズレている。  
これを runtime first / merged assists の方針で揃える必要がある。

また、Phase J の large seek 実測では、`secondary recovery trigger` が `sync_interval` で継続発火し、missCount が増えても `currentSecondaryTextLength = 0` のまま副字幕が復帰しないケースが確認されている。  
このため、large seek 時は「取れそうなら取るが、一定回数で諦める」上限制御が必要である。

### 2. current truth に過去 secondary が混入しうる

以前は `computeCurrentSubtitleBlock()` で `lastSecondaryText` や previous current の secondary を current truth に混ぜる経路があり、large seek 後や same-time で「今の字幕」ではない secondary が current に残りうる状態だった。

現在は history fallback を current truth から外す方向へ寄せているが、「runtime 現在表示に history を混ぜない」方針をモデルレベルでも明示する必要がある。

### 3. overlay が current block 1 件依存で same-window / seek を吸収しきれていない

overlay が `blocks[currentIndex]` 1 件だけを描画していたため、same-window の複数行や large seek 直後で「メインだけの block」「サブ欠落 block」が見える時間帯が残った。

same-window group を `OverlayView` で扱う方向へ移行したが、次の点は引き続き整理が必要である。

- どの条件で group 表示に切り替えるか
- large seek 直後の欠落をどこまで許容するか
- secondary を諦めた blockRange を panel / overlay でどう静かに表現するか

### 4. panel current と truth current のズレ

same-window captions では、panel 上で「最初の行だけ再生マークが付き、後続が飛んで見える」挙動が残りやすい。

これは次の 3 つを `PanelBlock` 側で分けて扱うことで解消する方針とする。

- strict current（truth）
- same-window window current（UX 上の「今この窓を再生中」）
- sequential current（窓内 line-level current）

---

## 短縮版 Phase ログ

### Phase 1〜2（履歴一本化と overlay イベント依存削減）

- history 追加を `setCurrentSubtitleBlock()` に一本化し、二重 append を解消した
- overlay を primary cuechange ベースの current block 更新に揃え、短表示・点滅を抑制した

### Phase 3（blocks ベースの共通基盤）

- `SubtitleBlockSequence` を導入し、正解台帳を `blocks[] + currentIndex + meta` に一本化した
- secondary matching と `sequenceHealth` を導入し、current 整合崩れをモデル上から観測できるようにした
- panel resolver / overlay resolver / current view resolver の責務を分ける土台を作った

### Phase 3-4〜3-6（overlay blocks / view / health）

- overlay を `updateOverlayFromBlock` → `OverlayView` へ段階移行し、same-window group 単位の表示モデルを確立した
- `subtitle-view-resolver.js` を current 系共通入口として置き、panel current / overlay current をここへ寄せる方針を確定した
- `MergedSubtitleHealth` / secondary resolver / fallback recovery を導入し、large seek 後の secondary 不復帰を health / recovery / resolver の不整合として観測できるようにした

### Phase J（進行中）

- docs と現行実装の JSDoc / 型名・フィールド名を同期した
- runtime ハード条件と `MergedSubtitleHealth.derived.*` の役割を固定中
- `SubtitleBlockSequence / UiSubtitleView / PanelBlock[]` の 3 段構成に沿って current cleanup の前提整理を進めている
- history を `blocks.past` 由来へ寄せる前提を維持しつつ、`subtitleHistory` の縮退ステップを検討中
- sync interval 側で runtime 条件の継続秒数を管理する方針を追加した
- large seek 時の secondary recovery に missCount 上限を設け、一定回数で打ち切る方針を追加した

---

## 補助設計メモ

### overlay host と panel host の分離

下部字幕は panel host の表示状態（`display: none` や injected CSS）に巻き込まれない構造にする。

### showSidebar と restart 条件の分離

showSidebar の変更は UI state として扱い、subtitle pipeline restart 条件とは切り離す方がよい。

### debug 観測面の使い分け

- cuechange / signal / track 状態 / recovery trigger / resolver 候補の時系列確認  
  → 設定ページ側 debug log
- panel の表示ブロック / same-window 表示グループ / panel current の観測  
  → 字幕パネル側 debug 表示
- overlay のメインだけ block / サブ欠落 / large seek 後の戻り方確認  
  → 両方を併用する

### Phase J のテスト観点メモ

Phase J では、少なくとも次の 4 系統でテストを揃える。

- `large seek（seekbar 大ジャンプ）`
- `same-window（panel 内 block click を含む近距離移動）`
- `10秒送り戻し（再生コントロールボタン）`
- `panel list / history（通常再生での履歴・current block health）`

large seek では、特に次を観測対象とする。

- `secondary recovery trigger` が missCount 上限で止まるか
- `terminated` / `missLimit` がログに出るか
- panel / overlay が secondary 無し区間で primary-only 表示へ静かに移るか

---

## 関連ファイル

- `content.js`
  - runtime state / currentSubtitleBlock 互換 / sync interval recovery / wiring
- `cue-controller.js`
  - primary / secondary cuechange 本流 / Sequence 再構築 / merged health 集約
- `subtitle-blocks.js`
  - `SubtitleBlockSequence` 構築 / secondary matching / `sequenceHealth`
- `subtitle-view-resolver.js`
  - current 系共通 view（`UiSubtitleView`）生成
- `overlay-block-resolver.js`
  - same-window group → `OverlayView` 生成
- `overlay-controller.js`
  - `OverlayView` の描画と clear 条件
- `subtitle-block-resolver.js`
  - Sequence → `PanelBlock[]`（`displayBlocks`）への正規化と派生フラグ付与
- `panel-renderer.js` / `panel-ui.js`
  - `PanelBlock[]` の描画と panel UI 側の secondary 読み取り
- `subtitle-track-resolver.js`
  - secondary track 候補解決と観測
- `debug-logger.js` / `debug-panel.js`
  - debug log の整形・表示と filter
