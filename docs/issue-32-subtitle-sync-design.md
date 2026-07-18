# Issue #32 Subtitle Sync Design

## 目的

Issue #32 では、Apple TV+ 再生画面における字幕同期まわりの設計を整理し、右側字幕パネルと画面下部の字幕（overlay）の表示を安定させる。

主な目的は次の 4 点。

- 履歴の重複をなくし、「1 セリフ基本 1 表示ブロック」に近づける
- 下部 overlay の点滅・短表示・片側欠落時の不自然な clear を止める
- panel / overlay / current / history を、同じ字幕ブロック列モデルで扱えるようにする
- large seek 後の「メインだけ進み、サブが復帰しない」ケースを、view / runtime / health / recovery / resolver の各層で追えるようにする

この文書は、Issue #32 の設計メモと修正方針のまとめであり、実装差分そのものではなく、「何をなぜ変えるか」を明確にするための設計文書とする。

---

## 今回の決定

今回の設計では、字幕 UI の正解台帳を **`blocks[] + currentIndex + meta`** に一本化する。  
`currentSubtitleBlock` 単体、`subtitleHistory`、overlay のイベント単位更新を、それぞれ別々の正解台帳として持ち続けない。

設計の芯となる決定事項は次の通り。

- 正解台帳は **字幕ブロック列（subtitle block sequence）** とし、shape は `blocks[] + currentIndex + meta`
- panel / overlay / current / history は、この字幕ブロック列を共通の参照元とする
- overlay / panel current は、まず **共通 view 入口** を通して描画する
- current の共通 view 入口として `subtitle-view-resolver.js` を置く
- overlay は通常時は `blocks[currentIndex]` 相当の current view を表示し、same-window captions や large seek では **表示グループ単位** を表示する
- same-window は **同じ `startTime + endTime` を持つ複数 block** とし、表示グループの key は `${startTime}::${endTime}` とする
- same-window group は UI 上では 1 つの表示ブロックとして扱う
- main/sub は常に同じ表示単位（block または表示グループ）でそろえて扱う
- same-window の複数行は main/sub ともに取得順を基本としつつ、**同じ内容の重複行は表示しない**
- 「行数を揃えること」より、「意味として同じ字幕を重複表示しないこと」を優先する
- runtime 現在表示には、`subtitleHistory` 由来の history fallback を混ぜない
- `currentSubtitleBlock` は互換レイヤーとして当面残してよいが、新しい truth 判定の起点にはしない
- panel の現在行（再生マークが付く行）と、正解台帳上の `state="current"` は分離して扱う
- overlay / panel の特殊な表示ルールは、正解台帳モデル本体ではなく **resolver / view 層** で扱う
- secondary recovery は「showing に寄せる」ことではなく、**secondary track を読める状態へ戻すこと** を目的にする
- Apple TV+ では `hidden` のまま active cue を持つ track があるため、secondary track は一律 `showing` にしない
- large seek 後の sub 不復帰は、view 側だけの問題ではなく、runtime / merged health / recovery trigger / resolver 候補の整合も含めて扱う

---

## 用語定義

この文書では、`blocks[] + currentIndex + meta` を  
字幕状態の **正解台帳** と呼ぶ。  
panel / overlay / current / history は、この正解台帳を基準に表示を組み立てる。

### block（字幕ブロック）

1 つの字幕単位。  
メイン字幕とサブ字幕をまとめて扱うための最小単位として使う。

少なくとも次を持つ。

- `key`
- `startTime`
- `endTime`
- `primaryText`（メイン側テキスト）
- `secondaryText`（サブ側テキスト）
- `state`
- `stable`

---

### 字幕ブロック列（subtitle block sequence / sequence result）

字幕 UI 全体の正解台帳。  
以下は **JSDoc ベースの shape イメージ**。

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
 * @property {string} secondaryText - 片側欠落時は "" を使う
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
 * @property {number} currentIndex - current が存在しない場合は -1
 * @property {{
 *   now: number,
 *   rebuildReason: string,
 *   blockCount: number,
 *   sequenceHealth: SubtitleSequenceHealth
 * }} meta
 */
```

ここでいう「正解台帳」は、この `blocks[] + currentIndex + meta` が  
字幕状態の唯一の基準になる、という意味。

---

### current block（現在の字幕ブロック）

`blocks[currentIndex]` で得られる、現在時刻に対応する block。

- UI 的には「今画面に出すべき 1 セット（メイン/サブ）」を表す
- 当面 `currentSubtitleBlock` はこれの互換コピーとして残してよい
- ただし、新しいロジックの参照元にはせず、**互換レイヤーとしてのみ扱う**
- current の判断は `currentSubtitleBlock` ではなく **字幕ブロック列（blocks / currentIndex）側** を基準に行う

---

### same-window（同じ時間帯の複数ブロック）

同じ `startTime + endTime` を持つ複数の block。

- 「同じ時間帯に属する複数ブロック」を表す概念
- 関数名ではなく、表示上のまとまりを表す用語として使う
- same-window 判定は、元 cue ではなく、**字幕ブロック列に正規化された block の `startTime` / `endTime`** を基準に行う

---

### 表示グループ（group / window）

overlay / panel で same-window の表示単位として扱うブロックのまとまり。

- 「ある時間帯に属する複数ブロックを、UI 上ひとまとまりとして扱う単位」を指す
- 表示グループの key（groupKey / windowKey）には `${startTime}::${endTime}` を使う
- group 内では main/sub の行配列を組み立てる
- group 内では **順序維持 dedupe** を行い、同じ内容の重複行を残さない

---

### パネルの現在行（panel current）

右側字幕パネルで、再生中を示すマークが付く block（行）の状態。

- 正解台帳上の `state="current"` と完全同一ではない
- panel UX 上で「今ここを再生している」と見せるための現在行を指す
- `isWindowCurrent` や `isPanelEmphasized` などの派生フラグで表現し、最終的に「再生マークを付ける行」を決める

---

### current view（UiSubtitleView）

overlay current / panel current が共通で参照する現在表示用 view。

- current block そのものではなく、UI が参照しやすい shape に正規化した表示モデル
- 当面は `subtitle-view-resolver.js` が overlay view ベースの current view を返す入口として振る舞う
- 将来的には panel current / panel list / history を含む共通 UI block resolver へ育てる可能性がある

以下は **JSDoc ベースの shape イメージ**。

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

---

### 画面下部字幕モデル（overlay view）

画面下部の字幕（overlay）用に作る表示モデル。

- overlay は通常 block 1 件を描画するが、same-window や large seek では block ではなく **画面下部字幕モデル** を描画する
- same-window の表示グループでは、main/sub を同じ group の中でそろえて扱う
- 複数行がある場合は、main/sub ともに取得順を基本に複数行表示する
- ただし、**同じ内容の重複行は dedupe する**
- 片側欠落時の補完は truth 側の block を書き換えることではなく、overlay resolver が view を組み立てる段階で行う
- 少なくとも
  - `groupKey`
  - `startTime`
  - `endTime`
  - `mainLines`
  - `subLines`
  - `isStable`
  - `shouldKeepVisible`
  - `isEmpty`
    を持つ

---

### stable（安定度フラグ）

その block または view を、UI に対してどこまで揺らしてよいかの指標。

- 単なる確定/未確定ではなく、  
  「再同期・後追い更新・seek 後再評価をどこまで許容するか」の意味で使う
- `past` 側を中心に `stable=true`
- `current` / `future` は原則 `stable=false`
- seek 直後やトラック再解決直後などの細かい条件は、現時点では **暫定ルール** とし、後続タスクで調整する

---

### merged subtitle health

runtime / current cue / sequence health を統合した、secondary recovery 判定用の health 情報。

- `cue-controller.js` 側で集約し、`getMergedSubtitleHealth()` 経由で外側から参照できるようにする
- 「main は healthy / sub は unhealthy / recover したいか」を、単一のログ shape で観測できるようにするための層
- ただし現時点では、merged health と content 側 fallback recovery の間に判定ズレが残っている

以下は **JSDoc ベースの shape イメージ**。

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

最低限、外側で主に参照する派生値は次の通り。

- `derived.primaryHealthy`
- `derived.secondaryHealthy`
- `derived.shouldRecoverSecondary`
- `derived.shouldForceSecondaryRebind`
- `buildMergedSubtitleHealth()` の `derived.secondaryHealthy` が true になる経路を特定し、health 判定と runtime のズレを潰す

---

### secondary recovery

secondary track が current 表示に追従できていないときに、再同期・再解決・再 bind を試みる処理。

- 目的は「secondary を showing にすること」ではなく、「secondary を読める状態に戻すこと」
- Apple TV+ では `hidden-active` な track があるため、mode 制御は **読める状態優先** で扱う
- recovery には少なくとも次の層がある
  - `cue-controller.js` 側の merged health / sequence health ベースの recovery 意図
  - `content.js` 側の sync interval で行う fallback recovery
  - `resolver` 側での secondary 候補再選定
  - `forceRebind` を伴う unbind → resolve → bind の再試行

---

## 背景

現在の字幕表示は、主に次の責務へ分散している。

- `subtitleHistory`
  - 右パネルの過去行の保持
- `panelPastBlocks`
  - `blocks.past` ベースの panel history 移行用 runtime state
- `currentSubtitleBlock`
  - panel の現在行と overlay の現在表示の互換参照
- `currentSubtitleView`
  - overlay / panel current が参照する共通 current view
- `lastPrimaryText` / `lastPrimarySignalAt`
  - primary の一時欠落に対する補助
- `lastSecondaryText`
  - secondary の一時保持（ただし current truth には混ぜない）
- overlay
  - 画面下部の字幕表示
- `renderSecondarySubtitle()`
  - secondary 側 DOM の個別描画
- panel renderer
  - resolver が返す block 群と派生フラグの描画
- panel current resolver
  - same-window captions を含む panel 用現在行の解決
- merged subtitle health
  - runtime / cue / sequence の health 集約
- secondary track resolver
  - secondary track の選定・再解決

この状態では、同じ字幕情報が複数経路で別々に補完・描画・判定されるため、同期ズレや重複が起きやすい。  
そのため、Issue #32 では current / history / panel / overlay を別々の正解台帳で持たず、共通の字幕ブロック列モデルへ寄せる。

また、large seek 後の secondary 不復帰は、単なる UI 表示の問題ではなく、

- current block / current view のズレ
- textTrack mode / activeCues のズレ
- merged health と runtime recovery のズレ
- resolver が選ぶ secondaryTrack と実際に bound されている track のズレ

が複合した現象として扱う必要がある。

---

## 現在確認できている問題

### 1. 履歴が二重で積まれる

履歴追加が少なくとも次の 2 箇所で発生していた。

- `setCurrentSubtitleBlock()` 内
- `cue-controller.js:onPrimaryCueChange()` 内の `appendSubtitleHistory(...)`

このため、1 回の primary cuechange に対して history append が二重に走りうる。  
これが、右パネル履歴で同じメイン/サブのペアが重複しやすい主因だった。

現在は、直接 `appendSubtitleHistory(...)` を `cue-controller.js` 側から外し、history 追加責務を 1 箇所へ寄せている。

---

### 2. overlay がイベント単位で更新されていた

overlay は字幕 block 単位ではなく cuechange イベント単位で更新されていた。

- primary cuechange では `updateOverlay(pText, sText)`
- secondary cuechange では `updateOverlay()`（引数なし）

さらに `overlay-controller.js:updateOverlay()` は `primaryText` が falsy のとき即 clear していた。

このため、一時的な空値や cuechange 順序の揺れで overlay が消えやすかった。  
現在は resolver → view → controller の経路へ寄せ、`OverlayView` ベースの更新へ移行している。

---

### 3. current 表示と panel 表示が別モデルで組み立てられていた

現状は、

- current は `currentSubtitleBlock` と補助状態で解決
- history は append された配列から作る
- future は cue から別途組み立てる

という形になっており、ひとつの字幕ブロック列を共通で見る設計になっていなかった。

現在は、

- current は `subtitle-view-resolver.js`
- panel current / list は `displayBlocks`
- panel history は `panelPastBlocks` と `subtitleHistory` の並走観測

という形へ寄せているが、history の truth source はまだ完全移行前である。

---

### 4. overlay が親 DOM や injected CSS に巻き込まれる

下部字幕要素自体には text が入っていても、

- 親の `#atv-panel-host` が `display: none`
- injected style が `display: none !important`

といった理由で見えなくなるケースがあった。  
panel host と overlay host の分離が必要。

---

### 5. showSidebar 変更による restart が下部字幕の早消えを誘発しうる

showSidebar の変更時に `restartBilingual()` が走る経路があり、UI 開閉だけで字幕 pipeline が再初期化される可能性がある。  
panel 開閉は UI state として扱い、subtitle pipeline restart 条件とは分けるべき。

---

### 6. same-window captions でパネルの現在行が飛ぶ

same-window captions を panel 側で順送り表示しようとすると、同一時間帯に複数字幕がある場面で「最初の字幕だけに再生マークが付き、その後続が飛んで見える」挙動が出る。  
これは same-window の表示グループ化不足だけでなく、`current-fallback` の介入や panel 現在行の描画責務の噛み合わせとも関係していた。

現在は same-window group を UI 上で 1 つの表示ブロックとして扱う方針へ寄せているが、panel list / history 側への全面適用はまだ完了していない。

---

### 7. same-window captions や large seek で overlay がメインだけの block になりうる

overlay が current block 1 件だけを描画していたため、same-window で複数のメイン行が連続する場面や large seek 直後に、サブが欠けた block やメインだけの block が見える時間帯が残った。

現在は same-window group を `OverlayView` で扱い、main/sub とも dedupe 済みの lines 配列で描画する方針へ移行している。

---

### 8. current truth に過去 secondary が混入しうる

以前は `computeCurrentSubtitleBlock()` で `lastSecondaryText` や previous current の secondary を current truth に混ぜる経路があり、large seek 後や same-time で「今の字幕」ではない secondary が current に残りうる状態だった。

現在は、

- `applySecondarySubtitleFallback()` の history fallback を削除
- `computeCurrentSubtitleBlock()` で current secondary に `lastSecondaryText` を混ぜる経路を停止

しており、runtime 現在表示には history 由来の secondary を混ぜない方針へ切り替えている。

---

### 9. secondary cuechange 後の再評価が current / overlay に届かないことがある

large seek 後の sub 不復帰ケースでは、secondary cuechange が起きても overlay / panel current が再計算されず、「secondary が追いついても current view が更新されない」可能性があった。

現在は secondary cuechange 後にも current / blocks / overlay を再評価する最小差分を入れている。

---

### 10. Apple TV+ では `hidden-active` な secondary track がある

実測では、Apple TV+ 上で `hidden` のまま activeCues を持つ subtitles track が存在した。  
そのため、secondary track を一律 `showing` に寄せると、Apple TV+ 側の自然な track 状態を壊す場合がある。

現在は secondary track の mode 強制を緩和し、`disabled` のときだけ `hidden` に持ち上げる方針へ変更している。

---

### 11. large seek 後の sub 不復帰は、health / recovery / resolver の不整合として残っている

large seek 代表ケースでは、

- runtime 上は `secondaryTrackFound = true`
- それでも `secondaryActiveCues = 0`
- `currentSecondaryTextLength = 0`
- content 側 fallback recovery は継続発火
- しかし sub は復帰しない

という状態が観測された。

同時に、同じ区間で merged 側では

- `mergedSecondaryHealthy: true`
- `mergedShouldRecoverSecondary: false`

が返ることがあり、merged health と content fallback recovery の間に判定ズレがある。

このため、Issue #32 の後半では「current 整合と secondary recovery truth の整理」が主題になる。

---

## 設計方針

### 正解台帳を字幕ブロック列に一本化する

Issue #32 では、`resolveCurrentSubtitleBlock(now)` のような current 専用関数へ寄せるより、過去 / 現在 / 未来を含む字幕ブロック列を構築する方がよい。  
そのため、正解台帳は `blocks[] + currentIndex + meta` を持つ字幕ブロック列とする。

block の shape は前述の `SubtitleBlock` を基本とする。  
`primaryText` / `secondaryText` は文字列で保持し、片側欠落時は `null` ではなく空文字 `""` を使う。

---

### primary cue をアンカーにする

字幕ブロック列は primary cue をアンカーにして構築する。

1. primary cue 群を基準に block 骨格を作る
2. 各 block に最も近い secondary cue を対応付ける
3. 対応付けは、開始時刻差だけではなく **再生区間の重なり + 開始/終了の近さ** を優先する
4. `now` に基づいて `past/current/future` を振る
5. secondary 未着や再同期待ちを見て `stable` を付ける
6. `currentIndex` と `meta` を付加する
7. `meta.sequenceHealth` に current 整合の健康状態を付与する

---

### state の意味

- `past`  
  確定データとして扱う
- `current`  
  現在時刻に対する解決結果
- `future`  
  再評価可能な予測寄りデータとして扱う

---

### stable の意味

- `stable: true`  
  UI 正解台帳としてあまり揺らさない
- `stable: false`  
  secondary 後追い・track 再解決・seek などで再評価されうる

seek 直後やトラック再解決後の扱いなどの細かい条件は、現時点では暫定ルールとし、今後のフェーズで調整する。

---

### key の基本方針

block の基本 key は少なくとも次の 3 要素を組み合わせる。

- `startTime`
- `endTime`
- `primaryText`

以下は JSDoc ベースの shape イメージ。

```js
/**
 * block の基本 key は startTime + endTime + primaryText を連結して作る。
 * 現時点では secondaryText を含めない。
 * 衝突が確認された場合のみ、source track index・連番・original cue index などの補助要素を追加する。
 */
function buildBlockKey(block) {
  return `${block.startTime}::${block.endTime}::${block.primaryText}`;
}
```

この key は現時点の **実用キー** として扱う。

---

### runtime 現在表示に history を混ぜない

runtime 現在表示は `current block / current view / current cue` を基準に組み立て、`subtitleHistory` や過去 retain テキストを truth 側へ混ぜない。

- `applySecondarySubtitleFallback()` のような history fallback は current truth から外す
- `lastSecondaryText` は UI retain 用に残る場合があっても、current truth 判定には使わない
- 「画面表示上の一時保持」と「現在字幕データとして採用すること」を分けて扱う

---

### current view の共通入口を置く

overlay current / panel current が別々に current を解決し続けると、same-window や large seek で揺れやすい。  
そのため、current 表示の共通入口として `subtitle-view-resolver.js` を置く。

当面の方針は次の通り。

- `subtitle-view-resolver.js` は current 専用の薄い resolver として始める
- まずは overlay current view を返す窓口として使う
- panel current もそこから返る view shape を正式入力として使う
- panel list / history まで含む共通 block resolver へ育てるかは次フェーズで判断する

---

### panel は `displayBlocks` 中心の描画へ寄せる

panel renderer は `allBlocks` を自前で再解釈するのではなく、resolver が返す `displayBlocks` を描画する責務へ寄せる。

- current snapshot は `allBlocks.find(...)` 直依存ではなく、`currentBlock + displayBlocks + uiView` から組み立てる
- panel の薄い UI 都合だけの secondary 読み取りは `content.js` ではなく `panel-ui.js` に置く
- panel history は最終的に `blocks.past` 側から組み立てるが、その移行は段階的に行う

---

### same-window group は UI 用 1 block として扱う

same-window 複数 cue は、UI 上では 1 つの表示ブロックとして扱う。

- メイン字幕は、同じ内容が重複するなら 1 回だけ表示する
- サブ字幕も、同じ内容が重複するなら 1 回だけ表示する
- 「行数を揃えること」より、「意味として同じ字幕を何度も出さない」ことを優先する
- dedupe は truth 側の block を潰すのではなく、view を作る段階で行う

---

## panel の責務

panel は **字幕ブロック列全体** を表示する。  
ただし、正解台帳上の `state="current"` と panel UX 上の現在行（再生マーク行）は分離して扱う。

### panel resolver の役割

panel 側では、次の責務を resolver / view 層に寄せる。

- block 正規化
- same-window の表示グループ化
- group 内 dedupe
- グループ内 sequential current 解決
- strict current winner 解決
- panel 現在行の window 解決
- panel 用派生フラグ付与
- `displayBlocks` 生成

### panel 用派生フラグ

以下は **JSDoc ベースの shape イメージ**。

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

意味は次の通り。

- `state`  
  正解台帳としての `past/current/future`
- `isWindowCurrent`  
  same-window 全体として現在の表示グループに属しているか
- `isPanelEmphasized`  
  panel 上で現在行相当に強調表示すべきか
- `isSequentialCurrent`  
  グループ内 line-level current として内部的に選ばれた行か

### panel same-window 方針

same-window 複数行 window では、

- strict current は 1 行だけに保つ
- panel 上の強調は表示グループ単位で複数行 true を許容する
- UI 表示では same-window group を 1 つのまとまりとして扱う
- 重複した main/sub 行は group 内で表示しない

最終的に再生マークを付ける行は、現時点では **`isSequentialCurrent` が true の行** を基本とする。  
ただし、この優先順は今後の UX 調整で変更する可能性がある。  
グループ全体の「現在表示」は `isWindowCurrent` によって示す。

---

## overlay の責務

overlay は通常時は **current view** を表示する。  
ただし same-window captions や large seek では、**current block が属する表示グループ** を描画対象にする。

### overlay の基本方針

- 通常時は current block / current view を描画する
- same-window / large seek では 画面下部字幕モデル を描画する
- 正解台帳モデル自体は変えず、特殊条件は overlay の表示ポリシー層 / resolver 層で吸収する

#### same-window モードに入る条件（overlay）

same-window による表示グループを overlay で使う条件は次の通り。

- 現在の `currentIndex` に対して、同じ `startTime + endTime` を持つ block が 2 件以上存在する場合
- または、大きな seek の直後であり、その時間帯に同じ `startTime + endTime` を持つ block が 2 件以上存在する場合

ここでいう「大きな seek」は、暫定的には数秒以上の移動を指す。  
この閾値は今後の実機確認で調整する可能性がある。

この条件を満たすときは、overlay は block 1 件ではなく、表示グループ単位で描画する。

### same-window overlay 方針

same-window では、overlay の表示単位を block 1 件ではなく **表示グループ** とする。

- same-window は **同じ `startTime + endTime` を持つ複数 block**
- groupKey / windowKey は `${startTime}::${endTime}`
- main/sub はその表示グループの中でそろえて扱う
- 複数行がある場合は、main/sub ともに取得順を基本に複数行表示する
- ただし、意味として同じ内容は dedupe する
- 代表 1 行への縮約はしない
- ある時刻のまとまりの中で main または sub のどちらかが欠けている場合は、同じ group 内の他 block にある内容で補ってよい
- ここでいう補完は truth 側の block 自体を書き換えることではなく、overlay resolver が表示用 view を組み立てる段階で行う
- group 内を見ても片側が最終的に無い場合は、ある方だけを表示してよく、その場合でも overlay 全体は clear しない
- large seek 直後など表示内容がまだ不安定な間は、足りない側を空のまま静的維持する
- 足りない側を点滅させたり、overlay 全体をいったん消したりはしない

### 画面下部字幕モデルの shape

以下は **JSDoc ベースの shape イメージ**。

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

意味は次の通り。

- `groupKey`  
  same-window の表示グループを識別するキー
- `mainLines`  
  表示グループに属するメイン側複数行（順序維持・dedupe 後）
- `subLines`  
  表示グループに属するサブ側複数行（順序維持・dedupe 後）
- `isStable`  
  画面下部字幕モデルが安定状態か
- `shouldKeepVisible`  
  clear せず維持すべきか
- `isEmpty`  
  本当に表示対象がないか

### overlay clear 条件

overlay の clear 判定は `isEmpty` 単独では行わない。

- `isEmpty === true` かつ `shouldKeepVisible === false` のときだけ clear する
- `isEmpty === true` でも `shouldKeepVisible === true` の間は、直前の overlay view を維持してよい

これにより、seek 直後や片側欠落時のチラつきを抑える。

### overlay controller の役割

overlay-controller は block ではなく **画面下部字幕モデル** を描画する責務へ寄せる。  
概念上は次の流れになる。

```text
resolveOverlayView(blocks, currentIndex, meta)
  └─ overlay view
       ├─ isEmpty && !shouldKeepVisible
       │    └─ clear
       └─ それ以外
            └─ mainLines / subLines を描画
```

---

## history の位置づけ

将来的には、history は独立 append 構造ではなく、**字幕ブロック列の past 側を panel 表示用に切り出したもの** として扱うのが自然。

現時点では次の整理を取る。

- `subtitleHistory` は移行期間中の補助構造として残してよい
- ただし UI の最終正解台帳とはみなさない
- `panelPastBlocks` を `blocks.past` 由来の runtime state として並走させる
- `panel / overlay / current` が blocks 正解台帳へ寄った後、panel history も `blocks.past` 側へ寄せる
- `subtitleHistory` の read path / write path / helper は、最後に順番に縮小・削除する

### history 追加の契機

history への追加は、**current block が前回と異なる新しい block に遷移したタイミングで 1 回だけ** 行う。

- 同じ block に対する再評価では history を追加しない
- secondary 後追い更新だけでは history を追加しない
- same-window 内の表示解決だけでは history を追加しない
- 追加判定は `currentSubtitleBlock` ではなく、**字幕ブロック列上の block key の変化** を基準に行う

---

## secondary recovery の設計メモ

large seek 後の代表ケースでは、

- `secondaryTrackFound = true`
- `secondaryActiveCues = 0`
- `currentSecondaryTextLength = 0`
- content 側 fallback recovery は継続発火
- それでも sub が復帰しない

という状態が観測されている。

このため、secondary recovery は次の 4 層を切り分けて設計する。

### 1. runtime 観測

`content.js` 側で、少なくとも次を継続観測する。

- `hasFreshCurrentPrimary`
- `currentPrimaryTextLength`
- `currentSecondaryTextLength`
- `secondaryTrackFound`
- `secondaryActiveCues`
- `secondaryRecoveryMissCount`

### 2. merged health

`cue-controller.js` 側で、

- current cue
- runtime health
- `meta.sequenceHealth`

を集約し、

- `primaryHealthy`
- `secondaryHealthy`
- `shouldRecoverSecondary`
- `shouldForceSecondaryRebind`

を返す。

### 3. resolver 観測

`subtitle-track-resolver.js` 側で、secondary 候補一覧を観測できるようにする。

```js
getSecondarySubtitleTrackCandidates(video, requestedLang);
```

少なくとも次を見られるようにする。

- `index`
- `language`
- `label`
- `kind`
- `mode`
- `cuesLength`
- `activeCuesLength`
- `matchesRequestedLanguage`
- `forcedLike`
- `score`

### 4. recovery 実行

`syncSecondarySubtitleTrack()` において、

- 通常の再同期
- `forceRebind` を伴う再 bind
- 必要時の `unbind → resolve → bind`

を段階的に行えるようにする。

---

## 実装ステップ

### Phase 1: 履歴重複の一本化

- `cue-controller.js` の直接 `appendSubtitleHistory(...)` を止める
- history 追加は `setCurrentSubtitleBlock()` 側に寄せる

---

### Phase 1.5: 観測性改善

- subtitle debug panel に最小限の filter を入れる
- cuechange / current block 更新 / secondary sync context を追いやすくする

---

### Phase 2: overlay のイベント依存を減らす

- secondary cuechange 起点の引数なし `updateOverlay()` をやめる
- `renderSecondarySubtitle()` から current block 更新責務を外す
- `onPrimaryCueChange()` で current block 更新 → overlay 更新の順を揃える

---

### Phase 3: 字幕ブロック列モデルへ寄せる

- `buildSubtitleBlockSequence(now)` を導入する
- `blocks[] + currentIndex + meta` を state の中心に据える
- panel / overlay / history を順次その正解台帳へ寄せる
- panel / overlay の特殊表示は resolver 層へ切り出す

---

## Phase 実施メモ

### Phase 1（2026-07-15）

- `cue-controller.js:onPrimaryCueChange()` からの直接 `appendSubtitleHistory(...)` 呼び出しを削除した
- history 追加責務を `setCurrentSubtitleBlock()` 側へ寄せた
- `current subtitle block` に `startTime` / `endTime` を持たせた
- 履歴重複の主因であった二重 append 経路は解消した

---

### Phase 1.5（2026-07-15）

- debug panel に `source` / `category` / `text` filter UI を追加した
- `filterLogs(logs, filters)` 相当の pure function を拡張した
- `text` filter は message だけでなく payload 文字列にも部分一致するようにした
- `source=content`、`category=subtitle`、`text=cuechange` などで動作確認した

---

### Phase 2（2026-07-15）

- `cue-controller.js:onCueChange(track)` から secondary cuechange 起点の引数なし `updateOverlay()` を削除した
- `renderSecondarySubtitle()` から current block 更新責務を削除した
- `onPrimaryCueChange()` の中で `currentBlock` を 1 回組み立て、
  1. `setCurrentSubtitleBlock(currentBlock, "onPrimaryCueChange")`
  2. `updateOverlay(currentBlock.primaryText, currentBlock.secondaryText)`
     の順に揃えた
- overlay と current block が同じ `currentBlock` オブジェクトを基準に更新される中間状態を作った
- 実機確認では overlay の点滅・短表示がかなり抑えられた

---

### Phase 3-2

- same-window 表示グループに通常 block がいる場合、`current-fallback` を追加しない調整を入れた
- snapshot 用 current と panel 現在行マーカー描画責務を切り離した
- same-window 表示グループ内 sequential current は resolver 側責務とした
- 50:50 → 30:70 の順送り小実験も行ったが、panel 上で 2 行目が現在行として認識されることは保証できなかった

---

### Phase 3-3（2026-07-16）

- `subtitle-block-resolver.js` に `PANEL_CURRENT_WINDOW_GAP_TOLERANCE` を追加した
- `findPanelCurrentWindowKey(...)` を追加した
- `applyPanelCurrentFlags(...)` を追加した
- strict な `state/currentBlocks` は維持しつつ、panel 用に
  - `isWindowCurrent`
  - `isPanelEmphasized`
  - `isSequentialCurrent`
    を付与する構成へ整理した
- same-window 複数行 window では strict current は 1 行だけに保ちつつ、panel 上は複数行強調を許容した
- `panel-renderer.js` は resolver 結果を描画する責務へ寄せた

---

### Phase 3-4（2026-07-17）

- overlay を `blocks[currentIndex]` ベースへ寄せる最小差分を実施した
- `createCueController({...})` で `updateOverlayFromBlock` を受け取るようにした
- `onPrimaryCueChange()` の overlay 更新を `updateOverlayFromBlock(currentBlock)` へ変更した
- `overlay-controller.js` に `updateOverlayFromBlock(block)` を追加した
- `content.js` は bridge / wiring に留めた
- `resetRuntimeState()` に 字幕ブロック列 / snapshot 系 state のクリアを追加した
- 通常再生では overlay の表示が大きく改善した
- 一方で same-window captions や large seek では、overlay が current block 1 件だけを描画する限界が残った

---

### Phase 3-5（2026-07-17）

- overlay は current block 1 件だけでなく、same-window や large seek では表示グループ単位で描画する方針を確定した
- same-window は同じ `startTime + endTime` を持つ複数 block として定義した
- groupKey / windowKey は `${startTime}::${endTime}` とした
- main/sub はその表示グループの中でそろえて扱う方針を確定した
- 複数行がある場合は main/sub ともに取得順のまま複数行表示し、代表 1 行へ縮約しない方針を確定した
- 片側欠落時でも overlay 全体は消さず、足りない側は空のまま静的維持する方針を確定した
- 補完は truth 側 block の書き換えではなく、overlay resolver が view を組み立てる段階で行う方針を確定した
- `OverlayView` の最小 shape を
  - `groupKey`
  - `startTime`
  - `endTime`
  - `mainLines`
  - `subLines`
  - `isStable`
  - `shouldKeepVisible`
  - `isEmpty`
    とする方針を確定した
- clear 条件は `isEmpty && !shouldKeepVisible` を基本とする方針を確定した
- overlay-controller は block ではなく overlay view を描画する責務へ寄せる方針を確定した

---

### Phase 3-6（2026-07-17〜2026-07-18）

- `overlay-block-resolver.js` を追加し、same-window を `${startTime}::${endTime}` で group 化して `OverlayView` を返す最小実装を入れた
- `overlay-controller.js` に `updateOverlayFromView(view)` を追加し、overlay 更新入口を resolver → view → controller に切り替えた
- `cue-controller.js` の overlay 更新入口を resolver ベースへ寄せた
- same-window group の view で、main/sub ともに順序維持 dedupe を実装した
- same-window の複数 cue は UI 上で 1 つの表示ブロックとして扱い、main/sub とも同じ内容を重複表示しない方針にした
- `subtitle-view-resolver.js` を current 表示の共通入口として置く方針を入れた
- `panel-renderer.js` は `displayBlocks` を正式な描画入力として扱う方向へ寄せた
- `panel-ui.js` の secondary 読み取りは UI 側へ戻し、`content.js` から `applySecondarySubtitleFallback()` を削除した
- `computeCurrentSubtitleBlock()` で current secondary に `lastSecondaryText` を混ぜる経路を止めた
- secondary cuechange 後にも current / blocks / overlay を再評価する最小差分を入れた
- `subtitle-blocks.js` の secondary 紐付けを、開始時刻差中心から「再生区間の重なり + 開始/終了の近さ」ベースへ改善した
- secondary track は一律 `showing` にせず、`disabled` のときだけ `hidden` に持ち上げる方針へ変更した
- `subtitle-blocks.js` に `analyzeSequenceHealth()` を追加し、`meta.sequenceHealth` で current 整合崩れを観測できるようにした
- `cue-controller.js` に `lastMergedSubtitleHealth` と `getMergedSubtitleHealth()` を追加し、merged health を外側から参照できるようにした
- `content.js` に `getMergedSubtitleHealthSnapshot()` を追加し、`secondary track sync context` に merged health 派生値を併記できるようにした
- `content.js` 側に fallback secondary recovery と `secondaryRecoveryMissCount` を追加し、large seek 代表ケースで recovery が継続発火していることを確認した
- `subtitle-track-resolver.js` に `getSecondarySubtitleTrackCandidates()` を追加し、secondary resolver 候補一覧を外側から観測できるようにした
- large seek 代表ケースでは、
  - runtime 上 `secondaryTrackFound = true / secondaryActiveCues = 0 / currentSecondaryTextLength = 0` が継続し、
  - content fallback recovery は継続発火する一方、
  - merged 側では `mergedSecondaryHealthy: true / mergedShouldRecoverSecondary: false` が出る区間があり、
  - health / recovery / resolver の truth がまだ揃っていない
    ことを確認した

---

## 次フェーズの主題

Issue #32 の次フェーズでは、次を主題とする。

- same-window / large seek / panel外 block click / 10 秒送り戻しを含む代表ケースを再テストし、未改善点を最終確定する
- `buildMergedSubtitleHealth()` の `secondaryHealthy` が true になる経路を特定し、health 判定と runtime のズレを潰す
- `content.js` の fallback recovery と `mergedSubtitleHealth` の役割分担を整理し、どちらを recovery truth にするか決める
- resolver 候補と bound secondaryTrack のズレを観測し、track 実体側の問題がないか確認する
- panel / overlay 共通 view を本格的に固め、`subtitleHistory` 読み取り経路を縮小する

---

## 補助設計メモ

### overlay host は panel host と分離する

下部字幕は panel host の表示状態に巻き込まれない構造にする。

---

### style 注入は対象レイヤーを分ける

panel 用 style と overlay 用 style を混同しない。  
`display: none !important` のような強い CSS は適用対象を厳密に限定する。

---

### showSidebar 変更は restart 条件から外せるか検討する

panel 開閉は UI state の変更として扱い、subtitle pipeline restart とは切り分ける方がよい。

---

### debug の観測面は使い分ける

- cuechange / signal / track 状態 / recovery trigger / resolver 候補の時系列確認  
  設定ページ側 debug log
- panel の表示ブロック / same-window 表示グループ / パネル現在行の観測  
  字幕パネル側の debug 表示
- overlay のメインだけ block / サブ欠落 / large seek 後の戻り方確認  
  両方を併用

---

## 関連ファイル

- `content.js`
  - state 保持
  - `setCurrentSubtitleBlock()`
  - orchestration / wiring
  - subtitle runtime state reset
  - sync interval recovery
- `cue-controller.js`
  - primary / secondary cuechange の本流
  - current / history / overlay / panel の更新 fan-out
  - 字幕ブロック列への移行接続点
  - merged subtitle health 集約
- `overlay-controller.js`
  - overlay host と表示更新
  - `updateOverlayFromBlock`
  - `updateOverlayFromView`
- `overlay-block-resolver.js`
  - overlay 用 same-window 表示グループ解決
  - groupKey 生成
  - `mainLines[] / subLines[]` 生成
  - dedupe
  - `isStable / shouldKeepVisible / isEmpty` 解決
- `subtitle-view-resolver.js`
  - current 表示の共通入口
- `panel-renderer.js`
  - panel の描画
  - `displayBlocks` ベース描画
- `subtitle-block-resolver.js`
  - panel 用 block 正規化
  - same-window 表示グループ化
  - current 解決
  - panel 用派生フラグ付与
- `subtitle-blocks.js`
  - subtitle block sequence 構築
  - secondary matching
  - `meta.sequenceHealth`
- `subtitle-track-resolver.js`
  - secondary track 候補解決
  - `getSecondarySubtitleTrackCandidates()`
- `debug-logger.js`
  - debug log 整形・保存・表示側 filter
- `debug-panel.js`
  - debug panel の mount / update / filter wiring
- `panel-ui.js`
  - debug panel を含む panel shell の HTML
  - panel UI 側 secondary 読み取り

---

## 今回の文書で主対象にしないこと

今回は次を主対象にはしない。

- debug log filter の詳細仕様拡張
- debug panel / options の大規模 UI 仕様整理
- 設定保存構造の全面変更
- `content.js` 全体の大規模再分割
- VTT normalizer の詳細仕様変更
- panel / overlay 排他表示仕様そのものの変更
- 70/30 レイアウト崩れの UI 調整本体
