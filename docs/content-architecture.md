# Content Architecture

この文書は、Apple TV+ Bilingual Subtitles の **content 層における設計正本** である。

主に次の 3 つを 1 本に統合して扱う。

- Apple TV+ 再生画面に注入する UI / 表示 / 設定適用の現行仕様
- `content.js` を thin coordinator に近づけるための分割原則と責務境界
- subtitle sync / recovery の truth / controller / resolver / UI / observer 境界

この文書で扱うもの:

- content 層のシステム全体像
- UI shell / binder / cue logic / playback context / observer / layout / bootstrap の責務境界
- `SubtitleBlockSequence` を起点とした字幕表示モデル
- runtime first / merged assists / lane state に基づく secondary recovery 設計
- `content.js` に残すもの、外へ寄せるもの
- 今後の分割でも維持したい接続原則と安全策

この文書で扱わないもの:

- Issue ごとの進捗・完了状態の管理
- セッション単位の実況メモや作業ログ
- AI セッション運用テンプレ
- ラウンドごとの細かい実施記録
- UI の微細な見た目調整だけを目的とした個別チューニング履歴

正本の位置づけ:

- この文書は、content 層の **設計・責務境界・分割原則の正本** とする
- Issue #32 の進捗・現在位置・次ラウンド候補は `docs/issue-32-content-core-split.md` に寄せる
- AI セッション運用ルールは `docs/ai-session-templates.md` に寄せる

---

## 1. システム全体像

### 1.1 現在の構成

この拡張は Chrome 拡張 Manifest V3 を前提とし、主に次の層で構成される。

- `background.js`
  - 外部 API 通信用の Service Worker
- `content.js`
  - Apple TV+ 再生画面へ UI を注入するメインの coordinator
- `popup.html` / `popup.js`
  - 簡易設定 UI
- `options.html` / `options.css` / `options.js`
  - 別タブの詳細設定 UI

content 層では、設定読込、字幕 track 解決、字幕ブロック構築、UI 反映、再初期化、再配置、観測ログ出力までを扱う。

### 1.2 コンポーネントの責務

全体責務は次のように分ける。

- popup / options
  - 設定値を入力・保存する UI
- background
  - 外部 API 呼び出しや通知の橋渡し
- content
  - 設定の読込と fallback 適用
  - text track の正規化
  - primary / secondary 用 track の resolver
  - subtitle truth / current / history / future の構築
  - 動画レイヤー上の UI 注入と再配置
  - runtime 観測と recovery 配線

最終的な track 採用、runtime 事実の収集、各 controller / resolver / renderer の接続は content 層が担当する。

### 1.3 用語整理

この文書では、混同しやすい語を次のように区別する。

- **extension popup**
  - ブラウザ拡張の popup UI（`popup.html` / `popup.js`）
- **subtitle popup**
  - 字幕上の単語クリックで表示する辞書 / AI 補助 popup
- **panel**
  - 右側字幕パネル
- **overlay**
  - 画面下部の字幕補助表示
- **truth**
  - UI 表示の正解台帳となる内部モデル
- **view**
  - truth を UI 向けに整形した表示用構造
- **coordinator**
  - 判定本体を持たず、controller / resolver / renderer / observer を接続する役割

---

## 2. 言語設定と適用責務

### 2.1 基本方針

言語設定は、再生中の track 生データに引きずられず、設定 UI と content 側の責務を分けて扱う。

- popup は簡易設定、options は詳細設定に寄せる
- `primaryLang` は必須設定とする
- `secondaryLang` は空値を許容する
- `secondaryLang = ""` の場合は content 側でブラウザ言語 fallback を適用する
- popup / options の言語候補は、動画依存の `textTracks` 生データではなく固定言語一覧ベースで扱う
- UI では「1 言語 = 1 候補」を見せ、実際の track 解決は content 側で吸収する

### 2.2 設定値の意味

#### `primaryLang`

`primaryLang` は学習対象として優先表示する主字幕言語を表す。

- popup または options で設定する
- `chrome.storage.sync` に保存する
- content 層が読み込み、再生中の字幕処理へ反映する

#### `secondaryLang`

`secondaryLang` は補助表示に使う言語を表す。

- 値が設定されていればその言語を優先する
- 空値なら content 側でブラウザ言語 fallback を適用する
- UI 上では「ブラウザ言語を使う」を明示する

### 2.3 設定適用のライフサイクル

設定適用の主トリガーは次の 2 つである。

- 設定変更時
- 動画ページ初期化時

ページ離脱時は、設定反映の再評価ではなく、必要最小限の cleanup を主目的とする。

### 2.4 textTracks と正規化

text track の扱いは次の原則に従う。

- `content.js` 側で `textTracks` を正規化する
- resolver は優先順位ベースで最終採用 track を決定する
- 基本優先順位は「通常字幕 → captions → forced」
- forced 字幕は UI の直接候補には出さないが、通常候補がない場合の内部 fallback 候補として保持する

設定 UI は固定言語一覧を扱い、track の揺れや作品差は content 側で吸収する。

---

## 3. 設計原則

### 3.1 content.js を thin coordinator に近づける

`content.js` の分割は、単なるファイル分割ではない。  
最終目標は、`content.js` を「状態と判定の本体」ではなく、**薄い wiring / bootstrap / lifecycle 入口**に近づけることである。

この方針により、次を実現したい。

- `content.js` のコード量を段階的に減らす
- UI shell / binder / observer / bootstrap の責務線を明確にする
- 影響範囲を追いやすくし、修正時の事故を減らす
- subtitle sync / recovery の改善を `content.js` への追記で吸収せず、controller / resolver / helper 側へ責務移送して進める
- NLM 併用前提でも、相談範囲と責務境界を docs とコードの両方で明確にする

### 3.2 既存挙動を壊さない

最優先は **既存挙動を変えずに責務を分けること** である。

- 一括分割ではなく、Phase / ラウンド単位で進める
- 構造整理と仕様変更を同じラウンドで混ぜない
- 差分ゼロ移設、薄いラッパー、controller 優先 + local fallback を基本とする
- 旧ロジックを残したまま新ロジックを継ぎ足す形は避ける
- 同じ責務の処理を別経路に複製しない

### 3.3 controller 優先 + local fallback

実ファイル分割では、manifest の `content_scripts` 読み込み順と `window.ATVB` 名前空間を前提に、段階接続を行う。

- controller を先に導入する
- `content.js` 側では `controller?.method()` の形で参照する
- 直ちに全面置換せず、当面は local fallback を残す
- 安定確認後に fallback を撤去し、`content.js` の重複実装を削る

この方式により、動作維持と責務移送を両立させる。

### 3.4 content.js に何を足すかの判断基準

`content.js` に新しい処理を足す前に、必ず次を確認する。

- これは本当に wiring か
- controller 側に置けないか
- resolver 側で扱うべきではないか
- UI shell / renderer 側で受けるべきではないか

特に subtitle sync / recovery の改善では、runtime missing / missCount / force-rebind / terminated などの判定本体を `content.js` に増やさないことを原則とする。

### 3.5 UI 調整と構造整理は分ける

UI 見た目調整では、視覚要素と構造要素を混ぜない。

- 見た目調整の対象
  - 位置
  - 幅
  - 背景
  - 角丸
  - padding
  - line-height
  - text shadow
  - font-size
- 原則として同時に変更しないもの
  - resolver
  - cue
  - binder
  - observer
  - bootstrap
  - truth 判定

---

## 4. アーキテクチャの層構造

content 層は、概ね次のレイヤーで捉える。

1. **settings / bridge**
   - 設定読込、message bridge、storage 連携
2. **resolver / helper**
   - track 解決、truth → view 変換、補助 health 集約
3. **controller**
   - cue 本流、state machine、runtime recovery 判定
4. **UI shell / renderer**
   - host / shadow / shell の生成と既存 shell への反映
5. **observer / layout / bootstrap**
   - 再接続、再評価、再配置、起動順制御
6. **content.js**
   - 上記各層の組み立て、接続、起動、観測ログの入口

この構成において、`content.js` は各層の本体を持つ場所ではなく、**最上位 coordinator** として振る舞うのが理想である。

---

## 5. UI の基本設計

### 5.1 全体レイアウト

Apple TV+ 再生画面では、次の UI 構成を基本とする。

- 動画コンテナは 70% 幅を基準に扱う
- 右側 30% を字幕パネル領域として使う
- 右パネルは「履歴 + 現在 + 未来」の一覧型
- 各字幕ブロックは primary / secondary の 2 行表示
- 左下 overlay は、右字幕パネルを閉じたときの補助表示として current 字幕 2 行を表示する
- パネルは `✕` で閉じ、閉じた時だけ右上の再表示ボタンで開く構成を基本とする

### 5.2 右字幕パネル

右字幕パネルは、履歴・現在・未来を同じ列構造で扱う。

- 各字幕ブロックは 2 行表示
  - 1 行目: primary
  - 2 行目: secondary
- 上から次の 3 層構造を維持する
  1. 固定ヘッダー（`字幕履歴` / `⚙️` / `閉じる✕`）
  2. 固定 debug ログセクション
  3. 字幕一覧のスクロール領域（history / current / future）

### 5.3 current 行モデル

current 表示は、独立 current ブロックを大きく強調する方式ではなく、**字幕一覧内の current 行 + 左側固定幅マーク欄** を基本モデルとする。

- 字幕行は `[mark][subtitle text]` の 2 カラム構造
- current 時だけ左側マーク欄に `▶` などの再生マークを表示する
- past / current / future の字幕本文は、色・背景・文字サイズを原則統一する
- current 判定は truth / view 側で決め、UI 側はそれを描画するだけに留める

### 5.4 スクロール挙動

panel スクロールは次の方針に従う。

- 通常時は字幕リストを動かさない
- 再生位置の変化に応じて、再生マークだけ current 行へ移動する
- current が字幕パネル下部のしきい値まで来た時だけ、字幕リストを最小限スクロールする
- 毎 cue ごとの細かいスムーススクロールは行わない
- user scroll と auto-follow は分離して扱う
- 手動スクロール直後や一時停止中は auto-follow を抑制する
- auto-follow の再開条件は、再生再開・一定時間経過・明示的 current jump のいずれかに限定する

### 5.5 overlay

overlay は panel の縮小版ではなく、独立した UI shell / view として扱う。

- 右字幕パネルを閉じたときの補助字幕表示
- primary / secondary の 2 行表示を維持する
- panel と同じ truth は参照するが、同じ表示条件では扱わない
- overlay 上の単語クリックは event delegation ベースで扱う
- overlay の表示責務と panel の表示責務は分離する

#### 5.5.1 overlay shell と host の境界

overlay は shell 側と host 側で責務を分ける。

- shell 側
  - 背景
  - padding
  - border-radius
  - line-height
  - text style
  - text shadow
  - font-size の受け口
- host 側
  - fixed 配置
  - width
  - 中央寄せ
  - z-index
  - pointer-events
  - bottom の動的更新

#### 5.5.2 overlay の見た目方針

- bottom は固定値だけで決めず、playback progress / footer の位置を基準に動的に調整する
- host は中央寄せを前提にし、左寄せ固定の見え方を避ける
- 背景は半透明の黒帯を基本とし、映像を潰しすぎない濃度に調整する
- line-height と上下 padding は詰めすぎず広げすぎない
- text shadow は読みやすさの補助として使うが、過度な装飾にはしない
- font-size は固定値ではなく、video 高さに応じて動的に調整する
- 高解像度で字幕が小さく見えやすい場合は、一定以上の高さで追加ブーストを許容する
- 目標は Apple TV+ ネイティブ字幕との完全一致ではなく、2 行表示を保ったまま違和感の少ない近似を作ることにある

### 5.6 subtitle popup

subtitle popup は字幕本体とは別責務の学習補助 UI として扱う。

- ヘッダーに単語、音声、設定、閉じるを配置する余地を持つ
- 辞書情報、補助説明、例文、AI 補助タブを段階的に表示する
- 字幕本体の 2 行表示と学習補助 popup は役割を分ける
- popup の shell 整理と辞書 / AI タブ拡張本体は別フェーズで進める

---

## 6. truth モデルと表示モデル

subtitle UI の正解台帳は **`SubtitleBlockSequence`** に一本化する。  
責務は次の 3 段構成とする。

1. **truth**: `SubtitleBlockSequence`
2. **current view**: `UiSubtitleView`
3. **list / history view**: `PanelBlock[]`

### 6.1 SubtitleBlockSequence

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

### 6.2 UiSubtitleView

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

### 6.3 PanelBlock[]

`PanelBlock[]` は panel list / history 用の表示列である。

- `SubtitleBlockSequence` から正規化して作る
- panel current と truth current は分離して扱う
- same-window captions に対して UX 上の current 表示を持てるようにする

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

### 6.4 truth 境界

truth 境界は次のように固定する。

- strict current の truth は `SubtitleBlockSequence.blocks[currentIndex]`
- overlay / panel current は `UiSubtitleView` を通して組み立てる
- panel list / history は `PanelBlock[]` を描画入力とする
- `subtitleHistory` は current truth や fallback truth に使わない
- runtime 現在表示に history を混ぜない

### 6.5 playback context 境界

playback page context / content key / history context は、subtitle truth と分離して扱う。

- playback page の DOM / track readiness 判定
- content key 解決
- contentKey ごとの history bucket 切替

これらは subtitle sync の truth source ではなく、**再生対象の切替文脈**である。  
そのため `playbackContext.js` は `SubtitleBlockSequence` や recovery 判定と混ぜず、history 文脈切替の補助に留める。

---

## 7. runtime / recovery 設計

secondary recovery の truth は **runtime first / merged assists** とする。

### 7.1 基本方針

- recovery trigger の最終判定は runtime 側のハード条件で行う
- `MergedSubtitleHealth.derived.*` は recover / forceRebind / probe の補助判断に使う
- merged health を唯一の recovery truth にはしない
- observer は recovery 本体を持たず、再評価トリガだけを持つ
- recovery 本線は **sync interval → controller 判定 → truth rebuild → UI redraw** の順で進める
- controller は runtime missing の入口判定と lane state の継続時間管理を主担当とする
- `content.js` は recovery 本体を持たず、large seek 時刻や sync interval 起動などの薄い wiring に留める

### 7.2 runtime ハード条件

secondary recovery 候補は、runtime missing を lane state へ入れる条件として定義する。  
少なくとも次を満たす場合に、secondary を recover 対象の missing とみなす。

- `hasFreshCurrentPrimary === true`
- `currentSecondaryTextLength === 0`
- `secondaryTrackFound === true`
- `secondaryActiveCues === 0`

実装上は、この条件を `secondaryRuntimeMissing` 相当の判定として扱い、secondary lane の `isMissing` に反映する。

ここで重要なのは、secondary missing を **runtime 上「primary は進んでいるのに secondary だけ空である」状態**として定義し、history や UI 表示状態には依存させないことである。

### 7.3 MergedSubtitleHealth

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

`derived.*` は runtime ハード条件の代替ではなく、runtime missing 成立後に、その missing が recovery 対象として妥当かを補助的に絞り込む層とする。

概ね次の考え方で組み立てる。

- `primaryHealthy`
  - primary track / primary cues / primary text / current primary block のいずれかで primary 側の生存を確認する
- `secondaryHealthy`
  - secondary track / secondary cues / secondary text / current secondary block のいずれかで secondary 側の生存を確認する
- `shouldRecoverSecondary`
  - `primaryHealthy && !secondaryHealthy && sequence.currentPairMissingSecondary`
- `shouldForceSecondaryRebind`
  - `shouldRecoverSecondary && sequence.consecutiveCurrentMissingSecondary`

### 7.4 lane state

recovery の実行状態は lane state で持つ。

- `primary` / `secondary` の lane state を同型で持つ
- 現時点の実行対象は secondary lane のみ
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

secondary lane の評価は概ね次の順で進める。

1. runtime ハード条件から `isMissing` を決める
2. `isMissing === false` なら `idle`
3. `terminated === true` なら retry せず `terminated`
4. `missingDurationMs >= recoveryWindow` になるまで待機する
5. 閾値超過後、`derived.*` を補助条件として見て `recover` または `force-rebind` を決める
6. `missCount` が上限を超えたら `terminated` に移行する

### 7.5 large seek 方針

large seek 時は、secondary recovery を **miss limit 付きの runtime retry** として扱う。

- near seek では追加 recovery を前提にしない
- large seek では、primary 復帰後に secondary missing が継続するケースを対象にする
- recovery は一定 window 内で retry する
- missCount が一定回数を超えた場合、その seek window / blockRange では secondary recovery を打ち切る
- 打ち切り後は `terminated` として primary-only 表示へ切り替える
- `terminated` は次 block または新しい seek で reset されうる

### 7.6 現行採用パラメータ

現行運用値は次のとおり。

- recovery window: 1000ms
- force-rebind 開始: 2 回目
- miss limit: 8 回

意図は次のとおり。

- recovery window 1000ms
  - primary 復帰直後の短い揺れを即時 miss として叩かず、secondary cue の自然な遅れを待つ
- force-rebind 開始 2 回目
  - 1 回目は軽量 recovery に留め、連続 miss に入ったときだけ強い再接続へ進む
- miss limit 8 回
  - 無限 retry を避けつつ、戻るケースには複数回の再挑戦を許す

### 7.7 Runtime First 方針

secondary recovery の基本方針は **Runtime First** とする。

- missing の入口判定は runtime 事実で決める
- waiting window までは merged assists を尊重し、軽い待機を許す
- waiting window 超過後は `derived.shouldRecoverSecondary === true` のみに固定せず、runtime missing が続いているなら recovery を進める
- その後の `recover` / `force-rebind` / `terminated` は lane state と missCount に従って進める

この方針により、large seek 後に runtime missing が継続しているのに、derived の揺れだけで recovery が遅延・停止することを避ける。

### 7.8 large seek 直後の truth 保護

large seek 直後は、secondary sync 後に **近傍 truth rebuild** と **short-lived hold** を許す。

- `content.js` 側は large seek を検知し、`lastLargeSeekAt` を記録する
- `cue-controller.js` 側は `lastLargeSeekAt` を参照し、短い seek window の間だけ nearby hold を利用できる
- hold は truth source ではなく、large seek 直後の UI 空白を避けるための一時 view である
- hold / guard は latest-only とし、新しい nearby rebuild が来たら古い保護は上書きする
- hold は次の `onPrimaryCueChange()` で 1 回だけ使い、その後は通常の truth 解決に戻す

### 7.9 通常再生時の hold 制御

hold / rebuild 系の保護は large seek 向けの補助手段であり、通常再生時の常用ロジックにはしない。

- 通常再生では `nearbyRebuildHold` / `preserveNearbyRebuildHold` の効きを最小限にする
- 一時停止中や通常 cue 進行中に hold が overlay の短表示やちらつき原因にならないようにする
- large seek 用の強い保護と、通常再生用の軽い安定化は分けて扱う

### 7.10 Known Issue 境界

拡張側で担保する範囲は次のとおり。

- runtime missing の検知
- lane state による waiting window / missCount / terminated 管理
- `recover` / `force-rebind` の決定
- secondary track の再同期・再バインド試行
- terminated 後の primary-only 静的処理

一方、次は現時点では Apple TV+ 側挙動に依存する Known Issue として扱う。

- `force-rebind` による再同期が実行され、track re-bound も確認できるのに、JA track の active cues が復帰しないケース
- 作品 / 区間依存で secondary が最後まで `secondaryActiveCues: 0` のままになるケース

これらは、recovery 判定が出ていない・sync が走っていない、という問題とは切り分けて扱う。

---

## 8. UI 表示方針と truth の接点

### 8.1 overlay view

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

### 8.2 panel / history view

panel は `PanelBlock[]` を描画入力とする。

- 過去 / 現在 / 未来を同じ列で表示する
- same-window group に対して `isWindowCurrent` / `isPanelEmphasized` / `isSequentialCurrent` を付与する
- panel current と truth current は分離して扱う
- large seek 直後の hold は panel list の truth を書き換えず、current 表示の短期補助としてのみ使う

history は最終的に `blocks.past` 由来へ縮退させる。

- `subtitleHistory` は移行期間の補助構造とする
- history の追加契機は「block key が変わったとき」の 1 回だけとする
- same-window 再評価や secondary 後追いでは追加しない

### 8.3 primary-only / keep-visible / clear ルール

secondary recovery が terminated に入った seek window では、UI は primary-only 区間として扱う。

- primary 側 truth がある限り、overlay / panel current を静的に維持する
- secondary missing を理由に current 全体を空へ落とさない
- secondary 復帰後は通常の current block / view 解決へ戻す

---

## 9. 責務境界

### 9.1 UI shell

対象:

- panel
- debug
- overlay
- subtitle popup
- notice / panel slot 周辺の shell 生成導線

責務:

- host 作成と shadow root 準備
- shell HTML / style の適用
- event wiring
- 既存 shell への state 反映
- 空 shell を不用意に再生成しないための生成条件管理

方針:

- `create*()` 系は host / shadow / shell / wiring に集中させる
- 長い template は `build*ShellHTML()` / `build*StyleText()` 系へ寄せる
- render 系は shell の新規生成ではなく、既存 shell への反映責務に留める
- 未設定状態でも panel / secondary host / notice の関係が破綻しないよう、生成条件を UI shell 側で追えるようにする

#### 9.1.1 overlay shell

overlay は UI shell の一部だが、panel と同じ表示条件・同じ見た目責務で扱わない。

- overlay 本体の HTML / CSS は `buildOverlayShellHTML()` 側に持たせる
- shell 側は背景・padding・border-radius・line-height・text-shadow・font-size の受け口を持つ
- host 側は fixed 配置・width・中央寄せ・z-index を持ち、bottom を playback progress / footer 基準で動的に更新する
- font-size は host に CSS 変数として設定し、video 高さ基準で更新する
- primary / secondary の 2 行表示と単語クリック可能な DOM 構造は維持する

#### 9.1.2 secondary subtitle DOM 管理

secondary subtitle の DOM 管理は、UI shell / render 側の中でも独立した 1 グループとして扱う。

対象:

- `getSecondarySubtitleElements`
- `getSecondaryRenderLogPayload`
- `ensureSecondarySubtitleElement`
- `renderSecondarySubtitle`

責務:

- 既存 host / layer / text node の探索
- data 属性 / class 両対応のセレクタ吸収
- secondary host / hidden layer / slot の確保
- idle clear を含む secondary 表示の反映

方針:

- `ensureSecondarySubtitleElement()` を中核にして、探索・正規化・host 確保・描画を 1 セクションとして保つ
- `ensureSecondarySubtitleElement()` は必要になった時に host / shell を確保する lazy initialization の入口として扱う
- `renderSecondarySubtitle()` は truth 決定や recovery 判定を持たず、受け取った入力を描画する責務に留める
- secondary subtitle DOM は Apple TV+ の right panel / slot 構造への依存を吸収する infrastructure 層として扱う
- 古いセレクタや data 属性差分の吸収は `getSecondarySubtitleElements()` を入口に集約する
- 将来 `secondaryDom.js` 相当に切り出す場合も、このグループを分割単位として扱う

### 9.2 binder / cue logic

対象:

- track binding
- cue handling
- history 管理
- current row 連携
- snapshot 管理
- primary / secondary の live cue 同期
- subtitle sync / health / recovery の controller 連携

責務:

- primary / secondary cuechange の本流管理と UI 反映前の整形
- track / cue / current block の同期と history 追加契機の制御
- subtitle sync / recovery 実行の入り口制御と controller 呼び出しの配線
- `content.js` から見た controller 呼び出し点の最小化

方針:

- cue の解釈・同期・health 集約は `cue-controller.js` を主担当に寄せる
- subtitle sync / recovery の改善は `content.js` に新しい分岐や状態を増やして吸収しない
- `content.js` は controller 呼び出し、戻り値受け取り、必要最小限の wiring に留める
- current / history / recovery の truth 判定は可能な限り resolver / controller 側へ寄せる
- 同じ recovery 条件を `content.js` と controller 側の両方で持たない

#### 9.2.1 sync interval orchestration

sync interval 系は runtime recovery をつなぐ orchestrator 層として 1 グループで扱う。

対象:

- `buildSecondarySyncLogPayload`
- `buildSyncIntervalSubtitleSnapshot`
- `syncIntervalRefreshPlaybackContext`
- `syncIntervalDetectLargeSeek`
- `syncIntervalRunSecondaryRecoveryPass`
- `ensureSecondaryTrackSyncInterval`

責務:

- runtime snapshot の採取
- playback context の再取得
- large seek の検知
- secondary recovery pass の起動
- primary recovery / initial cue recovery への橋渡し

方針:

- `ensureSecondaryTrackSyncInterval()` は orchestrator として処理順だけを担当する
- recovery 材料の採取は `buildSyncIntervalSubtitleSnapshot()` に集約する
- `buildSyncIntervalSubtitleSnapshot()` が作る snapshot は、recovery 判定層へ渡す入力境界として扱う
- secondary recovery 本体は `syncIntervalRunSecondaryRecoveryPass()` にまとめる
- `syncIntervalRunSecondaryRecoveryPass()` は単なる helper 群ではなく、sync interval 内の secondary recovery を束ねる sub-orchestrator として扱う
- 判定そのものは `cue-controller.js` / recovery helper 側へ寄せ、`content.js` には復帰フローの配線だけを残す

### 9.3 playback context

`playbackContext` は、binder / cue logic と observer / bootstrap の中間にある「再生対象文脈」の層として扱う。

対象:

- playback page context
- content key 解決
- subtitle history context の切替
- currentSrc / title / aria 系属性からの stable key 生成

責務:

- video / dialog / playback view / textTrack 状態の収集
- content key の安定解決
- contentKey ごとの subtitle history bucket 切替
- `content.js` に対して playback context 系 helper を controller として提供すること

方針:

- `playbackContext.js` は `window.ATVB.createPlaybackContextController` を公開する classic content script 方式で維持する
- `content.js` からは `playbackContextController?.xxx()` で参照し、当面は local fallback を残す
- local fallback は安定確認後に撤去し、`content.js` 側の重複実装を削る
- `appendSubtitleHistory` のような「履歴追加と UI 連携」に近い責務はこの単位に混ぜない

### 9.4 observer / layout / bootstrap

対象:

- `ResizeObserver`
- `MutationObserver`
- timer / retry
- 動画切替と再初期化
- `attachTracks`
- playback controls layout 調整
- bootstrap / cleanup
- unconfigured flow

責務:

- 監視開始 / 停止と DOM 再接続への追従
- host 再配置と layout 更新
- bootstrap 順序の維持と cleanup の整合
- UI shell / controller / settings の起動配線と再初期化

方針:

- observer は「何を監視し、何を再評価するか」を明示した薄い配線層へ寄せる
- layout 更新は UI shell の見た目責務と混ぜず、位置・サイズ・再配置に限定する
- bootstrap は「必要な初期化を順に呼ぶだけ」の形に近づける
- retry / timer は controller のロジックと混ぜず、起動・再接続の補助に留める
- unconfigured flow は例外経路ではなく、通常の初期状態として破綻しない構造を保つ

##### 9.4.1 reinitialize / retry / result bridge

再初期化系は observer / bootstrap 側に残しつつ、1 セクションとして明示的に整理する。

対象:

- reinitialize entry helpers
- track resolve retry helpers
- reinitialize result / settings bridge helpers
- `reinitialize-coordinator.js`

責務:

- 現在の playback context を取り直して再初期化入口へ渡す
- `video_changed` 後に track 解決が遅れるケースの retry 管理
- settings snapshot の state 反映
- 再初期化結果の評価と、retry 継続 / 停止の後処理橋渡し

方針:

- `reinitializeSubtitlePipeline` は「重い本体」、周辺 helper は「入口 / retry / 結果反映」に分けて読む
- `syncIntervalRefreshPlaybackContext()` は sync interval orchestration 側の入口として残し、reinitialize 専用の entry helper とは分けて扱う
- 再初期化の判定や retry 条件を複数箇所で重複保持しない
- 今後の分割候補として、entry / retry / result bridge の境界が保てる粒度で整理する

#### 9.4.2 playback controls layout

playback controls layout は observer / layout / bootstrap の中でも独立した 1 セクションとして扱う。

対象:

- playback controls の位置・幅・再配置
- layout target 解決
- `applyManaged*` / `clearManaged*` 系
- panel 開閉時の controls 再配置
- overlay / panel との相対位置維持

責務:

- panel 開閉や video サイズ変化に応じた controls の layout 計算と DOM 反映
- UI shell の見た目とは分けて、位置・幅・translate の適用と解除を管理する
- layout target の取得と managed style / transform の適用範囲を制御する

方針:

- layout 計算式は変えず、仕様変更なしで物理移送する
- `playback-controls-layout.js` を playback controls layout 実装の正本として扱う
- `content.js` には薄い bridge のみを残し、新しい判定や state を足さない
- bridge が太らないようにし、layout 判定本体や managed style 実装は module 側へ寄せる

#### 9.4.3 runtime observers

runtime-observers.js は、Apple TV+ 再生画面における DOM の構造変化やリサイズを監視し、再接続・再評価・再配置のトリガーを統括する。

対象:

- 各種 Observer ライフサイクル (`startPlaybackControlLayoutObservers`, `stopPlaybackControlLayoutObservers`)
- DOM 再接続 bridge (`refreshPlaybackControlResizeObserverTargets`)
- レイアウト変更検知 (`playbackControlsMutationObserver`, `playbackControlsResizeHandler`)
- 再初期化 / リカバリ論理入口 (`handleVideoChanged`, `handleContentKeyChanged`)

責務:

- `MutationObserver` や `ResizeObserver` インスタンスの生成・保持・破棄管理
- 監視対象要素（footer, panel 等）の自己解決、および要素が再生成された際の自動再バインド
- 膨大な DOM 変化から「レイアウト再評価が必要なケース」のみを抽出するフィルタリング
- `video.src` や content key の変更を論理的な事実として検知し、上位の coordinator へ通知する機能

方針:

- 実装詳細の隠蔽: Observer インスタンスや具体的なフィルタ条件（どの属性変化を無視するか等）はモジュール内のプライベートな状態として保持し、`content.js` に意識させない
- 抽象イベント通知: 生の `MutationRecord` をそのまま coordinator へ渡さず、`onLayoutLikelyChanged` のような意味のある抽象化された通知として発行することで、bridge を太らせない
- 戦略的配線の維持: ライフサイクルの起動（boot 時）や、通知を受けた後の「どの controller を呼ぶか」といった高レベルな意思決定（strategic routing）のみを `content.js` に残す
- モジュール間連携: 監視対象の解決には `playback-controls-layout.js` の `getTargets()` 等を利用し、要素探索のロジックが複数モジュールに分散するのを防ぐ

### 9.5 content.js の物理構造

`content.js` は最終的に thin coordinator として、論理セクションごとの見出しを保ちながら物理配置を整理する。

目的:

- 実ファイル分割前でも、責務の混在を防ぎながら `content.js` を読める状態に保つ
- docs 上で定義した責務境界を、`content.js` 内のコメント見出しと配置ルールへ落とし込む
- 次ラウンドでの物理移送を、論理的リスクの少ない cut & paste に近づける

構成方針:

- UI shell / render 系は 1 セクションに寄せ、secondary subtitle DOM 管理をその内部グループとして保つ
- sync interval orchestration は binder / cue logic 配下の独立セクションとして保ち、定期実行の順序制御だけを `content.js` に残す
- playback context 系 helper は再生対象文脈の bridge としてまとまりを維持し、truth / history / UI 表示本体とは混ぜない
- reinitialize / retry / result bridge、playback controls layout、runtime observers、bootstrap / cleanup は observer / layout / bootstrap 配下の見出しで区画整理する
- 実装詳細を増やさず、`content.js` には module 間の初期化・イベント配送・多重実行防止ガードのような上位配線を残す

運用ルール:

- Apple TV+ 固有のセレクタ文字列、重い DOM 掘削、複雑な timer / retry 条件、recovery 判定本体は `content.js` に常設しない
- 未分割期間でも、対象関数は必ず定義済みセクション配下へ寄せ、責務の飛び地を増やさない
- 新しい処理を追加する場合も、まず既存セクションのどこに属するかを決め、属せない場合は設計正本側を先に更新する

---

## 10. content.js に残すもの / 外へ寄せるもの

### 10.1 content.js に残すもの

`content.js` に残すのは主に次の責務である。

- Apple TV+ 再生画面への attach / detach
- lifecycle 管理
- bootstrap / cleanup の入口
- observer / timer の起動と停止
- settings / storage / message bridge の配線
- controller / resolver / renderer の呼び出し配線
- large seek 検知のような再生イベントから得られる薄い事実の記録
- `window.ATVB` controller 群の組み立てと受け渡し
- coordinator としての上位入口の維持
- 観測ログの入口

### 10.2 content.js から外へ寄せるもの

最終的に `content.js` から減らしていく対象は次である。

- subtitle sync / recovery の本体判定
- health 集約
- current truth の決定
- history truth の決定
- same-window の詳細な表示解決
- panel / overlay の描画入力の組み立て
- track 候補解決の詳細
- fallback truth の常設ロジック
- content key / history context の詳細実装
- 大きな DOM グループの個別生成・正規化ロジック
- runtime missing / force-rebind / miss limit / terminated などの recovery 条件そのもの

### 10.3 例外の扱い

完全移送がまだ難しい期間は `content.js` に薄い bridge を残してよい。

- bridge は「呼び出すだけ」「時刻や event を渡すだけ」に留める
- state を増やす場合は controller 側へ移るまでの一時的な最小範囲に限る
- local fallback を残す場合も恒久化せず、撤去条件を docs または作業ログで明示する
- NLM 提案差分も、bridge を太らせる形なら採らず、controller 側へ寄せられないかを先に見直す

---

## 11. 接続原則

各層の接続原則は次のとおりとする。

- `content.js`
  - runtime fact / trigger を controller へ渡す
  - controller / resolver / renderer / observer / layout を組み立てる
- controller
  - 判定と state machine を持つ
- resolver / helper
  - truth から view / panel / health を作る
- UI
  - view を描画する
- observer / layout
  - trigger と配置だけを扱う

この原則により、`content.js` が判定本体や truth 本体を持たずに済む構造を維持する。

---

## 12. 実装ルール

### 12.1 ラウンド単位で進める

- 1 つの実装ラウンドでは、主題となる責務塊を 1 つに固定する
- 構造整理と仕様変更が両方必要な場合は、可能な限りラウンドを分ける
- 差分の大きさではなく、責務のまとまりと説明可能性を優先する
- 実ファイル分割に進む場合も、まずは `content.js` 内で section boundary を整えてから移す

### 12.2 確認順

実装前後の確認は、次の順で行う。

1. 既存コードの責務位置を確認する
2. この責務をどこへ移すかを決める
3. 対象ラウンドの範囲で差し替える
4. テストで戻り道を残す

実ファイル分割時は、少なくとも次を確認する。

- 構文確認
- manifest 読み込み順確認
- controller 接続確認
- 実ブラウザ観測

### 12.3 削除ルール

- 新経路が安定するまで、旧経路の即時全面削除はしない
- ただし、旧経路と新経路が二重で走る状態は長く残さない
- 読まれていない state / helper / fallback は、確認できしだい次ラウンドで消す
- local fallback は「次に消す前提の暫定」として扱う

### 12.4 docs 同期ルール

- この文書は設計正本であり、進捗ログではない
- 実分割や責務移送が入った場合は、この文書へ「分割単位・接続方式・fallback 方針・導入範囲」を反映する
- ラウンド名、現在位置、到達点、次候補は `docs/issue-32-content-core-split.md` に寄せる
- AI セッション運用の書式や進捗メモテンプレは `docs/ai-session-templates.md` に寄せる

---

## 13. 主要モジュール一覧

- `content.js`
- `playbackContext.js`
- `reinitialize-coordinator.js`
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

### 13.1 各モジュールの位置づけ

- `cue-controller.js`
  - subtitle sync / health / recovery の主担当
- `subtitle-blocks.js`
  - `SubtitleBlockSequence` 構築
- `subtitle-view-resolver.js`
  - `UiSubtitleView` 生成
- `overlay-block-resolver.js`
  - same-window group から `OverlayView` を生成
- `subtitle-block-resolver.js`
  - sequence から `PanelBlock[]` を生成
- `subtitle-track-resolver.js`
  - secondary track 候補解決と観測
- `playbackContext.js`
  - playback page context / content key / history context
- `reinitialize-coordinator.js`
  - subtitle pipeline の再初期化フロー、track resolve retry、settings / result bridge の coordinator
- `playback-controls-layout.js`
  - controls の位置・幅・translate 管理
- `runtime-observers.js`
  - 再接続・再評価・再配置 trigger
- `panel-renderer.js` / `panel-ui.js`
  - panel shell と表示反映
- `overlay-controller.js`
  - overlay 表示制御

---

## 14. 非目標

この文書では次を扱わない。

- UI の細かい見た目調整だけを目的とした微細チューニング履歴
- Phase / Issue の進捗管理
- セッション単位の調査ログや実況メモ
- runtime パラメータの試行履歴の細かい時系列
- grep / filter 文字列のような一時的 debug 手順
- aggressive workaround の個別実装案
- 行数削減ラウンドの逐次進捗ログ

これらは別の docs または issue log で扱う。

---

## 15. 設計上の到達点

現時点で、この architecture として次の方針が揃っている。

- subtitle truth を `SubtitleBlockSequence` に寄せる
- current view / panel list view を truth から分離する
- secondary recovery を runtime first / merged assists で扱う
- lane state で waiting window / missCount / terminated を管理する
- large seek 直後の nearby rebuild / short-lived hold を truth 保護として位置づける
- primary-only fallback を「失敗時の静かな表示モード」として扱う
- `content.js` を subtitle sync / recovery の本体から外し、controller / resolver / UI / observer の境界を分ける
- `playbackContext.js` を subtitle truth とは別の「再生対象文脈」として扱う
- playback controls layout を subtitle sync 本体と切り分ける
- Apple TV+ 側で active cues が復帰しないケースを Known Issue として切り分ける

この文書の役割は、今後の調整を「どの値を少し変えるか」ではなく、**どの層が何を担うべきか** の観点でぶれずに進めることである。
