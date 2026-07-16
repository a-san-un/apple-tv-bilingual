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
- `content.js` は orchestration / wiring に寄せ、判定ロジックを増やしすぎない
- panel current 判定のような表示ポリシーは、必要なら専用 resolver へ切り出す

### 目指す状態

- current subtitle の真実源を `state.currentSubtitleBlock` 単体に閉じず、**past/current/future を含む subtitle block 配列**へ寄せる
- overlay は current block を表示する
- panel は同じ block 配列を表示する
- history はその block 配列の past 側から自然に導けるようにする
- 字幕は「次の字幕 block が来るまで残る」方向を優先する
- 将来的な真実源は **`blocks[] + currentIndex + meta`** を返す subtitle block sequence モデルとする

---

## 現状認識

### 現在の責務分散

現在の字幕表示は、主に次の責務へ分散している。

- `subtitleHistory`
  - 右パネルの past 行の保持
- `currentSubtitleBlock`
  - right panel current 行と overlay current の基準
- `lastPrimaryText` / `lastPrimarySignalAt`
  - primary の一時欠落に対する grace 補助
- `lastSecondaryText`
  - secondary の一時欠落に対する補助
- overlay
  - 画面下部の字幕表示
- `renderSecondarySubtitle()`
  - secondary 側 DOM の個別描画
- panel renderer
  - resolver が返す block 群と派生フラグの描画
- panel current resolver
  - same-window captions を含む panel 用 current の最終解決

この状態では、同じ字幕情報が複数の経路で別々に補完・描画されるため、同期ズレや重複が起きやすい。

### これまでに分かったこと

- current subtitle の真実源は、個別の render snapshot ではなく state 側へ寄せる方向がよい
- panel / overlay / history が別々の補完ロジックを持つと、責務の境界が曖昧になる
- 右パネルと下部字幕は表示位置が違うだけで、**同じ subtitle block モデル** を参照すべき
- render 関数が current block の更新責務を持つと、描画タイミングの揺れで state が揺さぶられやすい
- そのため、current block の更新責務は render 関数ではなく cuechange 本流へ寄せる方がよい
- panel current のような表示都合の winner 決定は、真実源そのものではなく表示ポリシー層で扱う方が安全
- 同一秒・同一時間窓の字幕飛びは、単純な group 化不足ではなく、`current-fallback` の介入と panel current 描画責務の噛み合わせとして現れている可能性が高い
- Phase 3-2 の観測により、resolver 単体の調整だけでは「same-window 2 行の両方が panel 上で認識される」UX を保証し切れないことが分かった
- そのため、真実源モデルを維持したまま、panel だけは派生ビューとして独自の強調ポリシーを持てるようにする方向が有力になった
- さらに Phase 3-3 の初期実装により、truth としての `state/currentBlocks` は strict 判定のまま維持しつつ、panel では window 単位 current と line-level current を分離した派生フラグで扱う方向が有効であることが確認できた

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

## 6. same-window captions で panel current が飛ぶ

same-window captions を panel 側で順送り表示しようとすると、同一時間窓に複数字幕がある場面で「最初の字幕だけに再生マーカーが付き、その後続が飛んで見える」挙動が出る。

### ここまでの観測

- same-window group 自体は形成されている
- 同一時間窓に 2 行以上の字幕が存在する場面では、窓前半で group 内 1 件目が `current`、後続が `future` になる
- 窓終端付近では、元 block 群が `past` に落ちた後、同じ時間窓に `current-fallback` が `current` として追加されることがあった
- Phase 3-2 では、same-window に通常 block が存在する場合は `current-fallback` を追加しない調整を入れた
- same-window 2 行 group に対して 50:50 → 30:70 の sequential current 小実験も行った
- それでも、panel 上では 2 行目に再生マーカーが乗る瞬間は安定して保証できなかった

### この問題の影響

- ユーザー視点では、同一秒の 2 行目以降が飛んだように見える
- same-window 順送りができていないように見える
- panel current と snapshot/current 補完が競合しやすい

### ここから分かったこと

- 問題の主因は same-window group 化不足そのものではない
- むしろ **`current-fallback` の介入と、panel current マーカー描画責務の噛み合わせ** が主因候補である
- さらに Phase 3-2 の観測から、**panel 更新タイミングと line-level current のサンプリング粗さ** も無視できない
- このため、same-window group 化の成否、panel current winner の決定責務、panel の見せ方は分けて考える必要がある

---

## 設計の中心

## current 専用関数ではなく block 配列モデルへ寄せる

Issue #32 では、`resolveCurrentSubtitleBlock(now)` のような current 専用関数へ寄せるより、**past / current / future を含む subtitle block 配列を構築する関数**へ寄せる方がよい。

### 基本アイデア

- primary cue をアンカーに block 配列を生成する
- 各 block に対して secondary cue を時間近傍で対応付ける
- block 配列には `state: "past" | "current" | "future"` を付与する
- block ごとに `stable: true | false` を持たせる
- `currentIndex` で現在位置を明示する
- `meta` で再構成理由やデバッグ補助情報を持つ
- overlay は current block を表示する
- panel は同じ block 配列全体を表示する

これにより、current 表示と panel 表示を **同じ block モデル** で統一できる。

---

## subtitle block の内部モデル

### block 形状

```js
{
  key,
  startTime,
  endTime,
  primaryText,
  secondaryText,
  state: "past" | "current" | "future",
  stable: true | false
}
```

### sequence result 形状

```js
{
  blocks: [
    {
      key,
      startTime,
      endTime,
      primaryText,
      secondaryText,
      state: "past" | "current" | "future",
      stable: true | false
    }
  ],
  currentIndex,
  meta: {
    rebuildReason,
    blockCount
  }
}
```

### 各フィールドの意味

- `key`
  - block の基本識別子
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
- `currentIndex`
  - `blocks[]` 内の current 位置
- `meta`
  - sequence 再構成の理由やデバッグ補助情報

### key の基本方針

block の基本キーは、少なくとも次の 3 要素を組み合わせる。

- `startTime`
- `endTime`
- `primaryText`

初期方針では、`secondaryText` は key に含めない。

### state の意味

- `past`
  - 確定データとして扱う
- `current`
  - 現在時刻に対する解決結果
- `future`
  - 再評価可能な予測寄りデータとして扱う

### stable の意味

- `stable: true`
  - この block を UI 真実源として今後あまり揺らさない
- `stable: false`
  - secondary cue 後追い・track 再解決・seek などで再評価の余地がある

ここでの `stable` は、単なる「確定した / していない」の二値というより、**UI に対してどこまで再更新を許容するか** の指標として扱う。

---

## block 配列構築の考え方

## 基本構造

```text
buildSubtitleBlockSequence(now)
  ↓
{
  blocks: [
    { key, startTime, endTime, primaryText, secondaryText, state: "past", stable: true },
    { key, startTime, endTime, primaryText, secondaryText, state: "current", stable: true | false },
    { key, startTime, endTime, primaryText, secondaryText, state: "future", stable: false }
  ],
  currentIndex,
  meta
}
```

### 処理イメージ

1. primary cue 群を基準に block の骨格を作る
2. 各 block に最も近い secondary cue を時間近傍で対応付ける
3. 現在時刻 `now` に基づいて `past/current/future` を振る
4. secondary 未着・track 再解決待ちなどを見て `stable` を振る
5. `currentIndex` と `meta` を付加する

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
  └─ currentIndex から currentBlock を取得
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
  └─ subtitle-block-resolver.js
       ├─ panel 用 block 正規化
       ├─ same-window group 化
       ├─ group 内 sequential current 解決
       ├─ strict current winner 解決
       ├─ panel current window 解決
       ├─ panel 用派生フラグ付与
       └─ renderer へ渡して描画
```

### 意味

- panel は current を特別扱いしつつ、past / future を同じ系列として表示できる
- 現在のような current 補完や secondary 後追い差し替えを減らせる
- history append のような補助構造に過度に依存しなくてよくなる
- same-window captions の current winner 決定を、描画コード本体から分離できる
- panel 用の UX ポリシーを、真実源 block モデルと切り分けて調整できる

### panel resolver を置く理由

same-window captions の group 化や current winner 決定は、真実源 block そのものというより、**panel 表示ポリシー** に近い。  
そのため、`panel-renderer.js` に判定ロジックを積み増すのではなく、`subtitle-block-resolver.js` のような専用 resolver に寄せる方が責務分離しやすい。

### Phase 3-3 の方向性

Phase 3-2 までの観測を踏まえると、panel では line-level current を strict に 1 行だけ見せるより、**same-window 2 行 group を window 単位で current と認識できる見せ方** の方が UX に合う可能性が高い。

そのため Phase 3-3 では、真実源 block の `state` は維持したまま、panel 用に次のような派生フラグを持たせる方向を取る。

```js
{
  (key,
    startTime,
    endTime,
    primaryText,
    secondaryText,
    state,
    stable,
    isWindowCurrent,
    isPanelEmphasized,
    isSequentialCurrent);
}
```

意味は次の通り。

- `state`
  - 真実源としての `past/current/future`
- `isWindowCurrent`
  - same-window group 全体として current な window に属しているか
- `isPanelEmphasized`
  - panel 上で current 相当に強調表示すべきか
- `isSequentialCurrent`
  - group 内 line-level current として内部的に選ばれた行か

初期案としては、same-window 2 行 group の window が current のとき、

- `isWindowCurrent = true`
- 2 行とも `isPanelEmphasized = true`
- `isSequentialCurrent` は内部整合や debug のために 1 行だけ true

とする。  
これにより、真実源モデルを壊さずに、panel だけは「2 行とも current 風に見せる」派生ビューとして扱える。

### 実施メモ（2026-07-16）

- Phase 3-3 の初期実装を行った
- `subtitle-block-resolver.js` に `PANEL_CURRENT_WINDOW_GAP_TOLERANCE` を追加し、strict current window が存在しない短い gap では、直前 window を panel 上の current window として扱えるようにした
- `findPanelCurrentWindowKey(...)` を追加し、strict current が無い場面でも panel 用 current window を決められるようにした
- `applyPanelCurrentFlags(...)` を追加し、truth としての `state/currentBlocks` は strict 判定のまま維持しつつ、panel 用の派生フラグとして `isWindowCurrent` / `isPanelEmphasized` / `isSequentialCurrent` を block へ付与する形に整理した
- same-window 複数行 window では strict current は 1 行だけに保ちつつ、panel 上では window 単位で複数行を current 風に強調できる構成になった
- `resolvePanelBlocksForRender(...)` は、block 正規化 → same-window group 化 → group 内 sequential current 解決 → strict current winner 解決 → panel 用派生フラグ付与、という順で truth / 派生情報をまとめる構成へ整理した
- `panel-renderer.js` 側では、旧来の current/future 個別組み立て関数を削除し、resolver が返す block 配列と派生フラグをそのまま描画へ反映する方向へ寄せた
- renderer は `state === "current"` のみで panel current を決めるのではなく、`isWindowCurrent` / `isPanelEmphasized` / `isSequentialCurrent` を使い分ける構成に変更した
- `isSequentialCurrent` は scroll anchor や debug の基準、panel 上の再生マーカー表示は `isPanelEmphasized` を基準にする

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
- Phase 3-1 では history の全面置換までは進めず、まず真実源側を固める
- `subtitleHistory` を UI 真実源から本格的に外すのは、panel / overlay が blocks 真実源に寄った後とする

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
- Phase 2 時点では詳細観測を設定ページ側 debug log に寄せる方針を採っていたが、Phase 3 では **字幕パネル debug 表示が same-window group / current-fallback 観測の主観測源として有効** であることが分かった
- 今後は、
  - cuechange / signal / track 状態などの時系列ログは設定ページ側 debug log
  - panel current / same-window group / visible blocks の観測は字幕パネル debug 表示
    という使い分けを取る

---

## Phase 2: overlay のイベント依存を減らす（実施済み・継続観察）

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
- overlay 点滅や current 更新頻度の時系列観測は設定ページ側 debug log が依然有効である。
- 一方、panel current の飛びや same-window group の見え方は、字幕パネル debug 表示の方が直接的に観測しやすい。

---

## Phase 3: block sequence モデルへ寄せる

### やること

- `buildSubtitleBlockSequence(now)` のような関数へ寄せる
- primary cue をアンカーに block 配列を構築する
- secondary cue を時間近傍で割り当てる
- `state` と `stable` を block に付与する
- `currentIndex` と `meta` を sequence result に付与する
- panel / overlay が同じ block 配列から描画されるようにする
- panel current 判定を必要に応じて専用 resolver へ切り出す
- `currentSubtitleBlock` を `blocks[currentIndex]` の互換コピーへ縮退させる

### 目的

- panel / overlay / history の共通基盤を作る
- current 専用補完ロジックを減らす
- seek / track 再解決 / secondary 後追い差し替えに強くする
- same-window captions を block モデルと表示ポリシーに分けて扱えるようにする

### 補足

- Phase 3 でも、Phase 1.5 の debug filter を使って current block 更新の頻度、block start/end の遷移、signal の有無を確認しながら進める
- Phase 2 で cue-controller 側へ寄せた current block / overlay 更新入口は、Phase 3 で block sequence モデルに移行するときの接続点として再利用する
- same-window captions や current-fallback の観測では、字幕パネル debug 表示を主観測源として使う

### Phase 3 の入口イメージ

Phase 2 時点の `onPrimaryCueChange()` では、まず 1 件の `currentBlock` を組み立て、その同じ入力を

1. `setCurrentSubtitleBlock(currentBlock, "onPrimaryCueChange")`
2. `updateOverlay(currentBlock.primaryText, currentBlock.secondaryText)`

の順で使う中間段階を取っている。これは最終形ではないが、Phase 3 で **1 件の currentBlock を block 配列上の current 要素へ吸収する** ための接続点として有用である。

```text
Phase 2 の中間形

onPrimaryCueChange()
  └─ currentBlock を 1 回組み立てる
       ├─ setCurrentSubtitleBlock(currentBlock, "onPrimaryCueChange")
       └─ updateOverlay(currentBlock.primaryText, currentBlock.secondaryText)
```

Phase 3 では、この `currentBlock` を特別な単独オブジェクトとして持ち続けるのではなく、**past / current / future を含む `blocks[]` の current 要素**として扱う方向へ寄せる。

```text
Phase 3 で目指す形

cuechange / track resolve / seek
  └─ buildSubtitleBlockSequence(now)
       └─ {
            blocks[],
            currentIndex,
            meta
          }

sequence result
  ├─ panel: resolver で可視範囲と panel 用派生情報を解決して描画
  └─ overlay: blocks[currentIndex] を描画
```

この見方に立つと、

- `currentSubtitleBlock` は `blocks[]` の current 要素へ寄せられる
- `subtitleHistory` は `blocks[]` の `past` 側の暫定表現として縮小できる
- future 行は primary cue 群をアンカーにした `future` block 群として扱える

という整理になる。

### currentBlock から block へのマッピング方針

Phase 2 で使っている `currentBlock` は、概ね次のような block へ写像できる。

```js
{
  startTime,
  endTime,
  primaryText,
  secondaryText,
  hasPrimarySignal,
  hasSecondarySignal,
  sourceReason,
  updatedAt,
}
```

```js
{
  key,
  startTime,
  endTime,
  primaryText,
  secondaryText,
  state: "past" | "current" | "future",
  stable: true | false,
}
```

ここで `hasPrimarySignal` / `hasSecondarySignal` / `sourceReason` / `updatedAt` のような補助情報は、block の恒久的な公開モデルというより、**stable 判定や debug log の補助情報**として内部的に扱う想定とする。Phase 3 の主モデルでは、panel / overlay / history が共有する最小限の block 形状を優先する。

### state の決め方

`buildSubtitleBlockSequence(now)` では、各 block の `state` を現在時刻 `now` に対して次のように振る。

- `endTime < now` の block は `state = "past"`
- `startTime <= now <= endTime` の block は `state = "current"`
- `startTime > now` の block は `state = "future"`

このルールにより、panel と overlay は同じ `blocks[]` を参照しながら、

- overlay は `blocks[currentIndex]` を表示する
- panel は `past/current/future` を連続した系列として表示する

という役割分担に寄せられる。

### stable の初期方針

`stable` は「その block を UI 真実源として今後どれだけ揺らしてよいか」を表す。Phase 3-1 の MVP では、次のような扱いを基本方針とする。

- `state="past"` の block は基本 `stable=true`
- `state="current"` の block は当面 `stable=false` を基本とし、後続で昇格条件を詰める
- `state="future"` の block は基本 `stable=false`

つまり、MVP では **past 側のみ保守的に true 化** し、current / future の細かい安定化は後続フェーズで扱う。

### 同一 block の重複更新をどう扱うか

Phase 2 の観測では、同一 `blockStartTime` / `blockEndTime` を持つ `current subtitle block updated` が近接して複数回出る箇所があった。Phase 3 では、これを単に「即バグ」とみなして strict に 1 回へ潰し切るのではなく、**block の確定度 (`stable`) を使って吸収する** 方針を取る。

初期方針としては、同一 block の識別キーを少なくとも次で見る。

- `startTime`
- `endTime`
- `primaryText`

このキーが同一の block に対して後続更新が来た場合、

- 既存 block が `stable=false` なら更新を許容する
- 既存 block が `stable=true` なら後続更新は原則無視する（または debug log のみ残す）

という扱いを基本にする。

```text
新しい block candidate
  └─ 同一 key の既存 block を探す
       ├─ ない
       │    └─ 新規追加
       └─ ある
            ├─ stable=false
            │    └─ 更新を許容
            └─ stable=true
                 └─ 原則無視（UI には波及させない）
```

この方針により、secondary の後追い・track 再解決・seek 前後の一時的な揺れは `stable=false` の範囲で再評価を許容しつつ、いったん確定した block が panel / overlay 上で何度も揺れ直すことを抑えやすくなる。

### currentSubtitleBlock の縮退方針

Phase 3-1 では `currentSubtitleBlock` を即削除しない。  
まずは **`blocks[currentIndex]` の互換コピー** として残す。

この方針を取る理由は次の通り。

- overlay / history / 既存 current 参照箇所を一度に壊さず移行しやすい
- 真実源は blocks 側へ寄せつつ、既存呼び出し面は最小差分で維持できる
- 将来的には current 専用 state を縮退できる

### Phase 3-1 の最小実装ライン

Phase 3-1 は、まず真実源側を固めるフェーズとする。最小ラインは次の 4 点。

1. `buildSubtitleBlockSequence(now)` の返り値 shape を `blocks[] + currentIndex + meta` に固定する
2. block 生成時に `key = startTime + endTime + primaryText` を付与する
3. `stable` は MVP では past 側のみ保守的に true 化する
4. `currentSubtitleBlock` は `blocks[currentIndex]` の互換コピーとして維持する

また state には少なくとも次を持つ。

- `subtitleBlocks`
- `subtitleCurrentIndex`
- `subtitleBlockMeta`

### Phase 3-2 の整理

Phase 3-2 では、panel current の飛びに対して `subtitle-block-resolver.js` を調整した。整理できた点は次の通り。

- same-window group に通常 block がいる場合、`current-fallback` を追加しない
- snapshot 用 current と panel current マーカー描画責務を切り離し、panel resolver は `blocks[]` 側を真実源として扱う
- same-window group 内の sequential current は resolver 側の責務とする
- same-window 2 行 group に対して 50:50 → 30:70 の順送り小実験を行ったが、
  **panel 上で 2 行目が current として認識されることは保証できなかった**
- このため、resolver 単体調整だけでは panel UX 要件を満たし切れない

### Phase 3-3 の設計論点

Phase 3-3 では、**panel current UX フェーズ** として次を扱う。

- panel に限り、same-window 2 行 group を「2 行とも current 風に強調表示する」ことを許容するか
- resolver から renderer へ渡す派生フラグ shape をどう定義するか
- `state="current"` と panel 用の `isPanelEmphasized` をどう切り分けるか
- 必要なら、same-window group 中だけ panel 更新補助を入れるかどうか

この論点は、真実源 block モデルそのものというより、**panel 表示ポリシー** の再設計として扱う。

### Phase 3-3 の実施メモ（2026-07-16）

- Phase 3-3 は「検討のみ」ではなく、panel current UX の初期実装まで着手した
- `subtitle-block-resolver.js` は strict な `state/currentBlocks` の解決を維持しつつ、panel 用に `isWindowCurrent` / `isPanelEmphasized` / `isSequentialCurrent` を派生計算する責務を持つ構成へ前進した
- strict current window が存在しない短い gap では、直前 window を panel current window として扱う補助を導入した
- same-window 複数行 window では、strict current は 1 行だけに保ちつつ、panel 上の強調は window 単位で複数行 true を許容する方向で実装した
- `panel-renderer.js` は panel current の判定責務を増やすのではなく、resolver が返す派生フラグを描画へ反映する責務へ寄せた
- 旧来の current/future 個別組み立て関数は削除し、panel renderer は resolver 結果を描画する方向へ整理した
- これにより、truth の strict 判定と panel UX 用の強調表示を切り分ける土台ができた
- 一方で、gap tolerance の閾値や same-window 強調の最終 UX は、引き続き観察と微調整の対象とする

### Phase 3 に入る時点での整理

したがって、Phase 3 の入口では次を前提にしてよい。

- Phase 2 の `currentBlock` は、block sequence モデルへ移行するための暫定的な current 要素である
- 最終的には `current / history / panel / overlay` を別経路で持たず、`blocks[]` を共通基盤にする
- 同一 block の近接再評価は一定範囲で許容するが、`stable=true` 化した block は原則再更新しない
- overlay は `blocks[currentIndex]` を表示し、panel は同じ `blocks[]` の可視範囲を描画する
- same-window captions の current winner 決定は、必要に応じて resolver による表示ポリシーとして扱う
- panel では、真実源 `state` と UI 強調状態を分離する余地を持つ

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

## 4. debug log / debug view の観測面を使い分ける

再生画面右パネルの debug log / debug 表示は、その場で軽く状況を見る補助ビューとする。  
ただし Phase 3 では、same-window captions と current-fallback の観測に関して、**字幕パネル debug 表示が主観測面として有効** であることが分かった。

### 補足

- 時系列ログの確認:
  - 設定ページ側 debug log を主に使う
- panel visible blocks / current winner / same-window group の確認:
  - 字幕パネル debug 表示を主に使う
- filter ロジックと log list ビューは共通化し、右パネル側・設定ページ側は薄いラッパーで扱うのが望ましい
- ただしこれは subtitle sync 本体とは別寄りの観測性改善テーマであり、Issue #32 本体の主対象にはしない
- debug log の共通 view / filter 化（右パネル / 設定ページ / popup などの共通化）は、必要なら別 docs / 別 Issue として切り出して扱う

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
  - orchestration / wiring
- `cue-controller.js`
  - primary / secondary cuechange の本流
  - current / history / overlay / panel の更新 fan-out
  - current block 基準 overlay への入口
  - sequence 真実源への移行接続点
- `overlay-controller.js`
  - overlay host と表示更新
- `panel-renderer.js`
  - panel の描画
  - resolver が返す block 群と派生フラグの描画
- `subtitle-block-resolver.js`
  - panel 用 block 正規化
  - same-window group 化
  - group 内 sequential current 解決
  - strict current winner 解決
  - panel current window 解決
  - panel 用派生フラグ付与
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
- 真実源は `blocks[]` 単体ではなく、**`blocks[] + currentIndex + meta`** を返す sequence result として扱う
- overlay は current block を表示する
- panel は同じ block 配列全体を表示する
- past は確定データ、current は現在時刻に対する解決結果、future は再評価可能な予測寄りデータとして扱う
- `stable` を持たせることで、確定度と再解決余地ではなく、**UI に対してどこまで揺らしてよいか** を区別する
- `currentSubtitleBlock` は当面 `blocks[currentIndex]` の互換コピーとして残し、段階的に縮退させる
- panel current 判定は、必要に応じて resolver を介した表示ポリシーとして扱う
- Phase 3-3 では、panel に限って same-window 2 行 group を **window 単位で current と認識できる強調表示** へ寄せる

修正の順番としては、まず履歴重複を止め、その後に観測性の最小セットを整え、  
overlay のイベント依存を減らし、最終的に block sequence モデルへ寄せるのが最も安全で実務的である。

Phase 2 時点では、全面的な block sequence 導入の前に、

- secondary cuechange 起点の overlay 更新を止める
- render 関数から current block 更新責務を外す
- cue-controller 側で current block 更新 → overlay 更新の順を揃える

という小さな段階を踏むことで、overlay の体感改善と将来の設計移行の両方を両立させる。

そして Phase 3 では、

- `buildSubtitleBlockSequence(now)` を真実源構築関数として定義し
- `blocks[] + currentIndex + meta` を state の中心に据え
- panel / overlay / history を真実源側 → 表示側の順に寄せていく

ことで、same-window captions、secondary 後追い差し替え、seek / track 再解決、一時欠落時の揺れに対して、より一貫した設計を作っていく。
