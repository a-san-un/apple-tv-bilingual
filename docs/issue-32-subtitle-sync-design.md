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
- 右パネルと下部字幕は表示位置が違うだけで、**同じ字幕 block モデル** を参照すべき

---

## 確認できた問題

## 1. 履歴が二重で積まれる

現状では、履歴追加が少なくとも次の 2 箇所で発生している。

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

overlay は現在、字幕 block 単位ではなく cuechange イベント単位で更新されている。

- primary cuechange では `updateOverlay(pText, sText)`
- secondary cuechange では `updateOverlay()`（引数なし）

さらに `overlay-controller.js:updateOverlay()` は `primaryText` が falsy のとき即 clear する。

### この問題の影響

- 一時的に `pText` が空になっただけで overlay が消える
- secondary cuechange の順序や遅れで overlay が消えうる
- panel は残っているのに overlay だけ短表示になる

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

## Phase 1: 履歴重複の一本化

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

---

## Phase 2: overlay のイベント依存を減らす

### やること

- secondary cuechange からの引数なし `updateOverlay()` をやめる
- `updateOverlay(pText, sText)` のような生イベント依存を弱める
- overlay 更新を block 解決後の current block 基準へ寄せる

### 目的

- overlay を cuechange イベントではなく current block に従わせる
- 下部字幕の点滅・短表示を抑える
- panel と overlay の内容差を減らす

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

---

## 今回の文書で主対象にしないこと

今回は次を主対象にはしない。

- debug log filter の詳細設計
- debug panel / options の UI 仕様
- 設定保存構造の全面変更
- `content.js` 全体の大規模再分割
- subtitle track resolver / VTT normalizer の仕様変更
- panel / overlay 排他表示仕様そのものの変更

### 補足

debug log の観測性改善は実務上重要だが、Issue #32 設計文書の主役ではない。  
必要なら別タスクや別メモとして扱い、ここでは subtitle block モデルの設計を優先する。

---

## 関連ファイル

主に関係するファイルは次の通り。

- `content.js`
  - state 保持
  - `setCurrentSubtitleBlock()`
  - `renderSecondarySubtitle()`
  - panel / overlay 補助経路
- `cue-controller.js`
  - primary / secondary cuechange の本流
  - current / history / overlay / panel の更新 fan-out
- `overlay-controller.js`
  - overlay host と表示更新
- `panel-renderer.js`
  - panel の current / past / future 描画
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

修正の順番としては、まず履歴重複を止め、その後 overlay のイベント依存を減らし、最終的に block sequence モデルへ寄せるのが最も安全で実務的である。
