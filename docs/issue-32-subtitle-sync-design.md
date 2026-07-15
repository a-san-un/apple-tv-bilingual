# Issue #32 Subtitle Sync Design

## 目的

Issue #32 では、Apple TV+ 再生画面における字幕同期まわりの設計を整理し、右パネルと下部 overlay の表示を安定させる。  
主な目的は次の 3 点。

- 履歴の重複をなくし、「1 セリフ基本 1 行」に近づける
- 下部 overlay の点滅・短表示を止める
- panel / overlay / history を、同じ subtitle block モデルで扱えるようにする

この文書は、Issue #32 の設計メモと修正方針のまとめであり、実装差分そのものではなく、「何をなぜ変えるか」を明確にするための設計文書とする。

---

## 前提と基本方針

### 基本方針

- `content.js` の責務は小さく安全に分ける
- alias / bridge / 重複依存を増やさない
- current / panel / overlay / history が別々に current を持たないようにする
- 表示責務は分けても、字幕データの基準は揃える
- 修正は小さな phase に分けて進める

### 目指す状態

- current subtitle の真実源を `state.currentSubtitleBlock` 単体に閉じず、**past/current/future を含む subtitle block 配列**へ寄せる
- overlay は current block を表示する
- panel は同じ block 配列を表示する
- history はその block 配列の past 側から自然に導けるようにする
- 字幕は「次の字幕 block が来るまで残る」方向を優先する

---

## 現状認識

### 現在の責務分散

現在の字幕表示は、主に次の責務へ分散している。

- `subtitleHistory`
  - 右パネルの past 行の保持
- `currentSubtitleBlock`
  - right panel current 行の基準
- `lastPrimaryText` / `lastPrimarySignalAt`
  - primary の一時欠落に対する grace 補助
- `lastSecondaryText`
  - secondary の一時欠落に対する補助
- overlay
  - 画面下部の字幕表示
- `renderSecondarySubtitle()`
  - secondary 側 DOM の個別描画
- panel renderer
  - current / past / future を別ロジックで組み立て

この状態では、同じ字幕情報が複数の経路で別々に補完・描画されるため、同期ズレや重複が起きやすい。

### これまでに分かったこと

- current subtitle の真実源は、個別の render snapshot ではなく state 側へ寄せる方向がよい
- panel / overlay / history が別々の補完ロジックを持つと、責務の境界が曖昧になる
- 右パネルと下部字幕は表示位置が違うだけで、**同じ subtitle block モデル** を参照すべき
- render 関数が current block の更新責務を持つと、描画タイミングの揺れで state が揺さぶられやすい
- そのため、current block の更新責務は render 関数ではなく cuechange 本流へ寄せる方がよい

---

## 確認できた問題

## 1. 履歴が二重で積まれる

現状では、履歴追加が少なくとも次の 2 箇所で発生していた。

- `setCurrentSubtitleBlock()` 内
- `cue-controller.js:onPrimaryCueChange()` 内の `appendSubtitleHistory(...)`

このため、1 回の primary cuechange に対して history append が二重に走りうる。  
これが、右パネル履歴で同じ英日ペアが重複しやすい主因。

### この問題の影響

- 1 セリフ 1 行になりにくい
- current と past の境界が見えにくい
- ログや UI から原因を追いにくい

---

## 2. overlay がイベント単位で更新されている

overlay は現在、字幕 block 単位ではなく cuechange イベント単位で更新されていた。

- primary cuechange では `updateOverlay(pText, sText)`
- secondary cuechange では `updateOverlay()`（引数なし）

さらに `overlay-controller.js:updateOverlay()` は `primaryText` が falsy のとき即 clear する。

### この問題の影響

- 一時的に `pText` が空になっただけで overlay が消える
- secondary cuechange の順序や遅れで overlay が消えうる
- panel は残っているのに overlay だけ短表示になる

### Phase 2 で見えてきたこと

- secondary cuechange からの引数なし `updateOverlay()` は、overlay 点滅の直接要因の 1 つだった
- `onPrimaryCueChange()` で **currentBlock を組み立ててから** `setCurrentSubtitleBlock(...)` → `updateOverlay(...)` の順に揃えるだけでも、overlay の体感改善が大きい
- ただし現時点では、overlay はまだ `setCurrentSubtitleBlock()` の結果を observer 的に読んでいるわけではなく、**同じ `currentBlock` オブジェクトを shared input として使う段階** に留まっている

---

## 3. current 表示と panel 表示が別モデルで組み立てられている

現状は、

- current は `currentSubtitleBlock` と補助状態で解決
- history は append された配列から作る
- future は cue から別途組み立てる

という形になっており、**ひとつの block 配列を共通で見る設計になっていない**。

### この問題の影響

- panel current と overlay current がずれやすい
- secondary の後追い差し替えが複数箇所で起こる
- seek / track 再解決 / 一時欠落時に整合が崩れやすい

---

## 4. 下部字幕は親 DOM や injected CSS に巻き込まれて消えることがあった

F12 調査により、下部字幕要素自体には text が入っていても、

- 親の `#atv-panel-host` が `display: none`
- injected style が `display: none !important`

といった理由で、要素が見えなくなるケースが確認できた。

### ここから分かったこと

- 下部字幕の host は panel host と分離した方がよい
- panel 閉状態に overlay が巻き込まれてはいけない
- style の適用対象を panel 用と overlay 用で分離する必要がある

---

## 5. showSidebar 変更による restart が下部字幕の早消えを誘発しうる

showSidebar の変更時に `restartBilingual()` が走る経路があり、UI 開閉だけで字幕 pipeline が再初期化される可能性がある。

### ここから分かったこと

- panel 開閉は UI state として扱う方が自然
- subtitle pipeline 再起動条件と UI 表示条件は分けるべき
- current subtitle block まで不要に捨てない方がよい

---

## 設計の中心

## current 専用関数ではなく block 配列モデルへ寄せる

Issue #32 では、`resolveCurrentSubtitleBlock(now)` のような current 専用関数へ寄せるより、**past / current / future を含む subtitle block 配列を構築する関数**へ寄せる方がよい。

### 基本アイデア

- primary cue をアンカーに block 配列を生成する
- 各 block に対して secondary cue を時間近傍で対応付ける
- block 配列には `state: "past" | "current" | "future"` を付与する
- block ごとに `stable: true | false` を持たせる
- overlay は current block を表示する
- panel は同じ block 配列全体を表示する

これにより、current 表示と panel 表示を **同じ block モデル** で統一できる。

---

## subtitle block の内部モデル

### block 形状

```js
{
  startTime,
  endTime,
  primaryText,
  secondaryText,
  state: "past" | "current" | "future",
  stable: true | false
}
```

### 各フィールドの意味

- `startTime`
  - block の開始基準時刻
- `endTime`
  - block の終了基準時刻
- `primaryText`
  - primary cue から得たテキスト
- `secondaryText`
  - secondary cue を時間近傍で対応付けて得たテキスト
- `state`
  - 現在時刻に対して、その block が past/current/future のどれか
- `stable`
  - この block が現時点で確定寄りか、再評価されうるか

### state の意味

- `past`
  - 確定データとして扱う
- `current`
  - 現在時刻に対する解決結果
- `future`
  - 再評価可能な予測寄りデータとして扱う

### stable の意味

- `stable: true`
  - primary / secondary の対応づけがほぼ固まり、再構成の可能性が低い
- `stable: false`
  - secondary cue 後追い・track 再解決・seek などで再評価の余地がある

---

## block 配列構築の考え方

## 基本構造

```text
buildSubtitleBlockSequence(now)
  ↓
[
  { startTime, endTime, primaryText, secondaryText, state: "past", stable: true },
  { startTime, endTime, primaryText, secondaryText, state: "current", stable: true | false },
  { startTime, endTime, primaryText, secondaryText, state: "future", stable: false },
]
```

### 処理イメージ

1. primary cue 群を基準に block の骨格を作る
2. 各 block に最も近い secondary cue を時間近傍で対応付ける
3. 現在時刻 `now` に基づいて `past/current/future` を振る
4. secondary 未着・track 再解決待ちなどを見て `stable` を振る

### primary cue をアンカーにする理由

- Apple TV+ 上では primary 側の時間軸が比較的扱いやすい
- secondary は後追い・欠落・遅延の影響を受けやすい
- current / history / panel / overlay の基準を 1 本化しやすい

---

## panel と overlay の描画責務

## overlay

overlay は **current block だけ** を表示する。

```text
buildSubtitleBlockSequence(now)
  └─ currentBlock を抽出
       └─ overlay へ描画
```

### 意味

- 下部字幕は現在の block だけ見ればよい
- current block が変わるまで表示を維持しやすい
- 「次の字幕が来るまで残す」仕様に寄せやすい

### Phase 2 時点での中間方針

Phase 2 では、いきなり `buildSubtitleBlockSequence(now)` へ全面移行するのではなく、

- current block の更新責務を cuechange 本流へ寄せる
- overlay 更新も、その current block 更新結果に従う方向へ寄せる
- `content.js` に新しい判断ロジックを増やさず、`cue-controller.js` / `overlay-controller.js` 側へ責務を寄せる

という中間段階を取る。

この中間段階では、`onPrimaryCueChange()` が **1 回の `currentBlock` オブジェクト** を組み立て、

1. `setCurrentSubtitleBlock(currentBlock, "onPrimaryCueChange")`
2. `updateOverlay(currentBlock.primaryText, currentBlock.secondaryText)`

の順で使う構成に寄せる。  
これにより、overlay と current block が同じ入力を参照する状態を作り、後続の block sequence モデルへ移行しやすくする。

## panel

panel は **block 配列全体** を表示する。

```text
buildSubtitleBlockSequence(now)
  └─ selectVisiblePanelBlocks(...)
       └─ panel へ描画
```

### 意味

- panel は current を特別扱いしつつ、past / future を同じ系列として表示できる
- 現在のような current 補完や secondary 後追い差し替えを減らせる
- history append のような補助構造に過度に依存しなくてよくなる

---

## panel 表示ウィンドウの考え方

### 実務的な初期値

最初は次のくらいでよい。

- 内部 block 配列
  - `past 20 / current 1 / future 30`
- panel 表示
  - `past 8〜12 / current 1 / future 8〜12`

### この構成の利点

- panel として十分見やすい
- seek 後や track 再解決時に再構築しやすい
- past/current/future の連続性を保ちやすい
- panel 側だけ都合よく current を組み直す必要が減る

### 運用上の扱い

これらの件数は固定仕様ではなく、初期実装時の推奨値とする。  
実装後に、seek、長尺コンテンツ、スクロール感、描画負荷を見て調整する。

---

## history の位置づけ

将来的には、history は独立 append 構造というより、**block 配列の past 側を panel 表示用に切り出したもの** として扱うのが自然。

### 現時点での整理

- 短期的には既存 `subtitleHistory` を使ってもよい
- ただし責務は縮小し、block モデルへ寄せていく
- 「1 セリフ基本 1 行」を崩すような二重 append は避ける

### past/current/future の意味づけ

- past は確定データ
- current は現在時刻に対する解決結果
- future は再評価可能な予測寄りデータ

この考え方に合わせれば、history と current を別世界のものとして持たずに済む。

---

## 修正の順番

## Phase 1: 履歴重複の一本化（完了）

### やること

- `cue-controller.js` の直接 `appendSubtitleHistory(...)` を止める
- history 追加は `setCurrentSubtitleBlock()` 側に寄せる

### 目的

- 履歴重複の主因を除去する
- 1 セリフ基本 1 行へ近づける
- 後続の block モデル化で観測しやすい土台を作る

### この phase を最初にやる理由

- 原因がほぼ特定済み
- 差分が小さい
- panel / history のノイズが大きく減る

### 実施メモ（2026-07-15）

- Phase 1 は実施済み。
- `cue-controller.js:onPrimaryCueChange()` からの直接 `appendSubtitleHistory(...)` 呼び出しを削除し、history 追加責務を `setCurrentSubtitleBlock()` 側へ寄せた。
- あわせて `current subtitle block` に `startTime` / `endTime` を持たせ、履歴側でも block 時間情報を扱える土台を作った。
- これにより、履歴重複の主因であった二重 append 経路は解消した。

### 継続課題

- strict な意味での `primary cuechange 1 回 = history append 1 回` の確認は、観測性改善も含めて継続課題とする。
- 同一文言でも time range が異なる block が複数行として現れる件は、Phase 1 のスコープ外とし、後続の block / history 表示仕様で扱う。
- `contentKey` 切替時の subtitle runtime state reset は別タスクとして扱い、Phase 1 には含めない。

---

## Phase 1.5: debug filter による観測性改善（完了）

### やること

- subtitle debug panel に `source=content` filter を追加する
- subtitle debug panel に `category=subtitle` filter を追加する
- subtitle debug panel に `text` 部分一致 filter を追加する
- 表示側の絞り込みを `filterLogs(logs, filters)` の pure function に寄せる

### 目的

- Phase 2 / Phase 3 の調査時に、primary / secondary cuechange、current block 更新、overlay clear / update の前後関係を追いやすくする
- 保存構造や検索言語を広げず、**表示側の最小限の filter** で観測性を上げる
- subtitle sync 本体に入る前に、再現確認と比較確認をしやすくする

### 実施メモ（2026-07-15）

- Phase 1.5 は実施済み。
- debug panel に `source` / `category` / `text` の filter UI を追加した。
- `debug-logger.js` 側で `filterLogs(logs, filters)` 相当の pure function を拡張し、`source` / `category` / `contentKey` / `text` による絞り込みを共通化した。
- `text` filter は message だけでなく payload 文字列にも部分一致するようにした。
- `source=content`、`category=subtitle`、`text=cuechange`、`text=current subtitle block updated` などの条件で動作確認した。

### この phase をここで入れる理由

- Phase 2 / Phase 3 は subtitle sync 本体の挙動比較が主になるため、先に観測性の最小セットを整えておく価値が高い
- 既存ログ保存構造を変えず、小差分で調査効率だけを上げられる
- 設計の主役ではないため、本体ロジックから独立した補助 phase として切り出すのが扱いやすい

### この phase の範囲外

- 保存構造の変更
- 複雑な検索言語
- 大規模な debug UI 改修
- subtitle sync 本体ロジック（overlay 修正 / block sequence 導入）の変更

### 調査時の使い方メモ

Phase 2 / Phase 3 の挙動確認では、たとえば次のような filter の組み合わせを想定する。

- `source=content` + `text=cuechange`
  - cuechange 系の前後関係を見る
- `source=content` + `text=current subtitle block updated`
  - current block 更新の頻度・時刻・signal 有無を見る
- `source=content` + `text=secondary track sync context`
  - primary / secondary active cues と track 状態の文脈を追う
- `source=content` + `category=subtitle`
  - subtitle カテゴリに寄せたログのみをざっと確認する

### 継続課題

- subtitle 系の主ログの一部は `category=ui` に属しているため、必要であれば後続フェーズで `subtitle` / `ui` の分類見直しを検討する
- debug filter は観測補助であり、Issue #32 の中心設計ではないため、仕様を広げすぎず最小運用を維持する
- 右パネル上の debug log は overlay と表示レイヤが干渉するため、**Phase 2 / Phase 3 の主観測面は設定ページ側へ寄せる** 方針とする
- 右パネル側の debug log は補助ビューとして扱い、filter / log list のロジックとビューは設定ページ側と共通化できるようにしていく

---

## Phase 2: overlay のイベント依存を減らす

### やること

- secondary cuechange からの引数なし `updateOverlay()` をやめる
- `renderSecondarySubtitle()` から current block 更新責務を外す
- `updateOverlay(pText, sText)` のような生イベント依存を弱める
- overlay 更新を block 解決後の current block 基準へ寄せる

### 目的

- overlay を cuechange イベントではなく current block に従わせる
- 下部字幕の点滅・短表示を抑える
- panel と overlay の内容差を減らす
- `content.js` にロジックを増やさず、`cue-controller.js` / `overlay-controller.js` 側へ責務を寄せる

### 実施メモ（2026-07-15）

- Phase 2 第1ラウンドでは、`cue-controller.js:onCueChange(track)` から secondary cuechange 起点の引数なし `updateOverlay()` を削除した。
- あわせて `content.js:renderSecondarySubtitle()` から `setCurrentSubtitleBlock(computeCurrentSubtitleBlock("renderSecondarySubtitle"), "renderSecondarySubtitle")` を削除し、render 関数が current block の更新責務を持たない形に整理した。
- debug filter で確認した範囲では、`current subtitle block updated` の `reason` は `onPrimaryCueChange` のみとなり、`renderSecondarySubtitle` 起点の current block 更新は観測されなかった。
- Phase 2 第2ラウンドでは、`cue-controller.js:onPrimaryCueChange()` の中で `currentBlock` を 1 回組み立て、
  1. `setCurrentSubtitleBlock(currentBlock, "onPrimaryCueChange")`
  2. `updateOverlay(currentBlock.primaryText, currentBlock.secondaryText)`
     の順に揃えた。
- これにより、overlay と current block が **同じ `currentBlock` オブジェクト** を基準に更新される中間状態を作った。
- 実機確認では、画面下部 overlay の字幕が体感上大きく改善し、点滅・短表示がかなり抑えられた。

### この phase の設計判断

- `renderSecondarySubtitle()` から current block 更新責務を外すことは、「render 関数が state の真実源を持たない」という意味で正しい方向とする。
- current block 基準 overlay への入口は、`content.js` ではなく `cue-controller.js` 側に寄せる。
- 同一 block の `current subtitle block updated` が近接して複数回出る事象は認識するが、Phase 2 では strict に 1 回へ潰し切ることを主目的にしない。
- その揺れが overlay 点滅や panel/current 不整合の直接原因になる場合のみ、小さな guard を検討する。
- それ以外の細かい再評価は、Phase 3 の block sequence / `stable` 導入で本格的に扱う。

### 補足

- Phase 2 の調査では、Phase 1.5 で追加した debug filter を使い、`cuechange` / `current subtitle block updated` / `secondary track sync context` の前後関係を見ながら修正前後を比較する。
- ただし再生画面右パネルの debug log は overlay と排他的に扱われやすいため、**詳細なログ観測は設定ページ側の debug log をメインにする** 前提で運用する。

---

## Phase 3: block sequence モデルへ寄せる

### やること

- `buildSubtitleBlockSequence(now)` のような関数へ寄せる
- primary cue をアンカーに block 配列を構築する
- secondary cue を時間近傍で割り当てる
- `state` と `stable` を block に付与する
- panel / overlay が同じ block 配列から描画されるようにする

### 目的

- panel / overlay / history の共通基盤を作る
- current 専用補完ロジックを減らす
- seek / track 再解決 / secondary 後追い差し替えに強くする

### 補足

- Phase 3 でも、Phase 1.5 の debug filter を使って current block 更新の頻度、block start/end の遷移、signal の有無を確認しながら進める
- Phase 2 で cue-controller 側へ寄せた current block / overlay 更新入口は、Phase 3 で block sequence モデルに移行するときの接続点として再利用する

---

## 補助的な設計メモ

## 1. overlay host は panel host と分離する

下部字幕は panel host の表示状態に巻き込まれない構造にする。

### 理由

- panel が `display: none` でも overlay は表示できるべき
- panel の排他表示と overlay の字幕内容を分離したい
- injected CSS の副作用を小さくしたい

## 2. style 注入は対象レイヤーを明確にする

panel 用 style と overlay 用 style を混同しない。  
`display: none !important` のような強い CSS は適用対象を厳密に限定する。

## 3. showSidebar 変更は restart 条件から外せるかを検討する

panel 開閉は UI state の変更として扱い、subtitle pipeline 全体の restart とは切り分ける方がよい。

## 4. debug log は設定ページを主観測面にする

再生画面右パネルの debug log は、その場で軽く状況を見る補助ビューとする。  
Phase 2 / Phase 3 の詳細観測は、overlay と表示レイヤが干渉しない **設定ページ側の debug log** を主観測面として扱う。

### 補足

- filter ロジックと log list ビューは共通化し、右パネル側・設定ページ側は薄いラッパーで扱うのが望ましい
- ただしこれは subtitle sync 本体とは別寄りの観測性改善テーマであり、Issue #32 本体の主対象にはしない

---

## 今回の文書で主対象にしないこと

今回は次を主対象にはしない。

- debug log filter の詳細仕様拡張
- debug panel / options の大規模 UI 仕様整理
- 設定保存構造の全面変更
- `content.js` 全体の大規模再分割
- subtitle track resolver / VTT normalizer の仕様変更
- panel / overlay 排他表示仕様そのものの変更

### 補足

debug log の観測性改善は実務上重要であり、Phase 1.5 として最小限は扱う。  
ただしこの文書の主役はあくまで subtitle block モデルと panel / overlay / history の同期設計であり、debug filter 自体を中心テーマにはしない。

---

## 関連ファイル

主に関係するファイルは次の通り。

- `content.js`
  - state 保持
  - `setCurrentSubtitleBlock()`
  - panel / overlay 補助経路
- `cue-controller.js`
  - primary / secondary cuechange の本流
  - current / history / overlay / panel の更新 fan-out
  - current block 基準 overlay への入口
- `overlay-controller.js`
  - overlay host と表示更新
- `panel-renderer.js`
  - panel の current / past / future 描画
- `debug-logger.js`
  - debug log 整形・保存・表示側 filter
- debug log の共通 view / filter モジュール（将来）
  - 右パネル・設定ページの共通化候補
- `debug-panel.js`
  - debug panel の mount / update / filter wiring
- `panel-ui.js`
  - debug panel を含む panel shell の HTML
- panel / overlay host 生成まわりの helper 群
- style 注入 helper 群

---

## まとめ

Issue #32 の本質は、**イベント単位で UI を更新している設計** により、

- current
- history
- overlay
- panel
- secondary render

が別々の補完ロジックを持ってしまい、重複・短表示・差し替え・不整合が起きていることにある。

そのため、設計の中心は次のように置く。

- current 専用関数ではなく、**past/current/future を含む subtitle block 配列** を先に構築する
- overlay は current block を表示する
- panel は同じ block 配列全体を表示する
- past は確定データ、current は現在時刻に対する解決結果、future は再評価可能な予測寄りデータとして扱う
- `stable` を持たせることで、確定度と再解決余地を区別する

修正の順番としては、まず履歴重複を止め、その後に観測性の最小セットを整え、  
overlay のイベント依存を減らし、最終的に block sequence モデルへ寄せるのが最も安全で実務的である。

Phase 2 時点では、全面的な block sequence 導入の前に、

- secondary cuechange 起点の overlay 更新を止める
- render 関数から current block 更新責務を外す
- cue-controller 側で current block 更新 → overlay 更新の順を揃える

という小さな段階を踏むことで、overlay の体感改善と将来の設計移行の両方を両立させる。
