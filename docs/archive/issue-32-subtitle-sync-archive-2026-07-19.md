https://github.com/a-san-un/apple-tv-bilingual/issues/32
[Phase E (3)] content.js の本体モジュール分割（panel / cue / overlay / observer）

## 概要

Phase E (1) / #20 では panel / overlay 周辺の UI shell 責務整理、
Phase E (2) / #21 では binder / cue ロジックの責務整理まで完了した。

この Issue では、その結果を前提に、
`content.js` の本体を panel / cue / overlay / observer 単位で**実際に別ファイルへ分割する**
ことをスコープとする（= Phase E 後半の「物理分割」フェーズ）。

## この Issue でやること（Phase E (3)）

- `content.js` から panel 描画・更新ロジックを `panel-renderer.js` に移動し、
  `content.js` 側は「current/future/history の配列を用意して呼ぶだけ」に寄せる。
- cue ハンドリング（`onCueChange` など）を `cue-controller.js` に移動し、
  overlay / history / panel への fan-out をここから行う。
- overlay の生成・更新を `overlay-controller.js` に分割し、
  Apple TV+ ネイティブ寄せの見た目調整もここに集約する。
- player DOM 検出 / attach / observer 設定を `runtime-observers.js`（仮）にまとめる。
- `content.js` は、各モジュールの初期化・連携を行う薄いエントリポイントにする。

## スコープの違い（#20 / #21 との差分）

- #20 / #21: **ファイル内の責務整理とコメント整備**が中心（物理分割までは行わない）。
- 本 Issue: #20 / #21 で揃えた責務境界を前提に、**panel / cue / overlay / observer を別ファイルへ実際に分割**する。

## 制約

- 既存の挙動（panel / overlay / subtitle popup / binder / cue / recovery）は変えない。
- DOM の id / class / data 属性を変えない。
- Phase E (1)(2) の完了条件（#20 / #21 の完了コメントに書いた挙動）は保つ。
- 詳細設計は docs を正本とする

### この先の進め方と、このスレッドでやっていること

Phase E では、リファクタの各フェーズをこのスレッドで相談しながら、小さく区切って進めています。

具体的には、次のような単位で AI に手伝ってもらう前提で進めています。

- 「どこから切り出すか相談」
  - どの責務から分離するか
  - どこまでやったら一区切りにするか
  - 今回の変更を単独コミットとして成立させられるか
    を先に固めてから着手する

- 「置換スクリプトを出してほしい」
  - `python3 - <<'PY'` など、そのままコピペで動く置換スクリプトを出してもらう
  - 必要に応じて `manifest.json` 更新、`git grep` 用の確認コマンド、`node --check` 用コマンドも一緒に出してもらう

- 「diff / grep の確認を一緒にしてほしい」
  - `git diff`
  - `git diff --stat`
  - `git grep`
  - `node --check`
  - `git status -sb`
    の結果を貼って、意図通りに責務が移ったか、残骸がないか、登録順や参照が崩れていないかを一緒に確認する

- 「コミットメッセージを整える」
  - 過去のコミット粒度に合わせて、今回の変更だけを説明する件名と箇条書き本文を作る
  - 日本語で、あとから `git log` を見たときに責務移動の内容がすぐ分かる形にそろえる

- 「プッシュ後に Issue 用の進捗メモを書いてほしい」
  - フェーズごとに
    - 最終ファイル構成案
    - 作業一覧
    - 修正ファイル
    - 現在の状態
    - 保留していること
    - 次にやること
      を Markdown でまとめる
  - 進捗メモは、その時点で実際に終わった作業だけに絞ってフルアップデートする

いまの進め方では、1 フェーズごとに

1. 切り出し境界を相談する
2. 置換スクリプトや確認コマンドを作る
3. diff / grep / check を見ながら責務移動を確認する
4. 日本語コミットメッセージでコミットする
5. push 後に Issue 用進捗メモをフルアップデートする

という流れを基本パターンにしています。

cue 系はこのパターンの 1 回目として完了済みで、settings-runtime 系も同じパターンで一区切り完了しました。次も同じ進め方で、`content.js` に残っている restart / recovery / runtime glue を少しずつ圧縮していく想定です。

### Phase E（content core split / runtime glue 整理 / 字幕同期デバッグを含む）進捗の統合版まとめ

この Issue #32 では、`content.js` の「一枚板」構造を、panel / cue / overlay / observer / settings-runtime / popup 周りへ少しずつ分割しながら、Apple TV+ の再生画面で安定した bilingual UI を提供するための core を段階的に整理している。

現時点では、Phase E 前半で進めた bridge / dep 帯の整理に加えて、runtime glue / panel visibility / settings の整理、さらに字幕同期まわりの Phase 1 / Phase 1.5 / Phase 2 までを一通り反映した状態になっている。

---

## 1. Phase E 全体の整理状況

### `content.js` の orchestrator 化

`content.js` は、各責務を自前で抱える一枚板から、`window.ATVB` 上の各 factory を呼び出して接続する薄い orchestrator に寄せる方向で整理を進めている。

現時点で主に分離・接続済みの責務は次の通り：

- `panel-renderer.js`  
  panel list 描画・更新、scroll 調整
- `cue-controller.js`  
  primary / secondary cuechange 制御、secondary track sync、history / panel / overlay への fan-out、current subtitle block の本流更新
- `overlay-controller.js`  
  overlay の生成・更新、見た目調整、表示切替
- `runtime-observers.js`  
  player DOM 検出、layout observer、起動時 video 検出
- `playback-controls-layout.js`  
  Apple TV+ 再生コントロール帯のレイアウト調整
- `settings-runtime.js`  
  settings 読み込み、fallback、restart orchestration、runtime message listener

`content.js` 本体は、上記モジュールを組み合わせて起動フローや restart / recovery / popup orchestration を担う「入口／接着剤」的な役割に寄せている。

### runtime glue / settings / panel visibility

runtime glue まわりでは、restart 前処理を `prepareForRestart()` に集約し、runtime 側からはそれを呼ぶだけの構造へ寄せている。

また、panel visibility については `panelVisible` を単独で持つのではなく、`state.contentSettings.showSidebar` を真実源として扱う方針に整理した。

- `loadPanelVisibility()` は `showSidebar !== false` ベース
- `persistPanelVisibility()` は `chrome.storage.sync.showSidebar` へ反映
- popup / options / playback toggle の変更は `APPLY_SETTINGS_TO_APPLE_TV` 経由で Apple TV+ タブへ伝播

これに合わせて、GENERAL settings から `pinSidebar` を削除し、一般設定は `showSidebar` 中心に簡素化した。  
debug logger には extension context invalidated 対策も追加し、detach 後のノイズを抑えている。

---

## 2. 字幕同期まわりの現在地（Phase 1 / 1.5 / 2）

字幕同期まわりでは、次の症状を主な対象として扱っている：

- 短いセリフが連続する場面で、二つ目以降のセリフが表示されない、または表示時間が極端に短い
- seek 後に英語字幕だけ表示され、日本語字幕が復帰しないことがある
- 右パネル履歴で同じ英日ペアが複数行になりやすい
- panel は残っているのに overlay だけ短表示・点滅することがある

### Phase 1: 履歴重複の一本化（完了）

Phase 1 では、履歴追加経路の二重化を解消した。

- `cue-controller.js:onPrimaryCueChange()` からの直接 `appendSubtitleHistory(...)` 呼び出しを削除
- history 追加責務を `setCurrentSubtitleBlock()` 側に集約
- `current subtitle block` に `startTime` / `endTime` を持たせ、履歴側でも block 時間情報を扱えるようにした

これにより、右パネル履歴の重複主因であった二重 append 経路は解消し、「1 セリフ基本 1 行」に近づける土台ができた。

### Phase 1.5: debug filter による観測性改善（完了）

Phase 2 / Phase 3 の調査をしやすくするために、subtitle debug panel に最小限の filter を追加した。

- `source`
- `category`
- `text` 部分一致

表示側の絞り込みを `filterLogs(logs, filters)` 相当の pure function に寄せ、`source` / `category` / `contentKey` / `text` による絞り込みを共通化。  
`source=content` / `category=subtitle` / `text=cuechange` / `text=current subtitle block updated` などで、cuechange と current block 更新の前後関係を追えるようにした。

この phase は字幕同期ロジック本体ではなく、**Phase 2 / Phase 3 のための観測性改善タスク**として位置づけている。

### Phase 2: overlay のイベント依存を減らす（第1〜第2ラウンド完了）

Phase 2 では、overlay を cuechange 生イベント単位ではなく、current block に従わせる方向への中間整理を進めた。

実施内容の要点：

- `cue-controller.js:onCueChange(track)` から、secondary cuechange 起点の引数なし `updateOverlay()` を削除
- `content.js:renderSecondarySubtitle()` から current block 更新責務を削除（render 関数は state の真実源を持たない）
- `cue-controller.js:onPrimaryCueChange()` の中で `currentBlock` を 1 回組み立て、
  1. `setCurrentSubtitleBlock(currentBlock, "onPrimaryCueChange")`
  2. `updateOverlay(currentBlock.primaryText, currentBlock.secondaryText)`
     の順に揃えた

これにより、overlay と current block が **同じ `currentBlock` オブジェクト** を基準に更新される中間状態を作ることができた。  
実機確認では、画面下部 overlay の字幕が体感上かなり改善し、点滅・短表示が大きく減っている。

Phase 2 の時点では、同一 block の `current subtitle block updated` が近接して複数回出る事象は「即バグ」として潰し切らず、Phase 3 の block sequence / `stable` 導入で扱う前提にしている。

---

## 3. 設計の正本

字幕同期まわりの詳細な設計、Phase 1〜3 の意図、subtitle block モデル、`state` / `stable`、panel / overlay / history の関係などは、次の docs を正本とする：

- `docs/issue-32-subtitle-sync-design.md`

Issue 側ではゴール・進捗・Phase の現在地を共有し、詳細な設計判断や更新は docs 側へ寄せる方針。

---

## 4. 現在の責務分担（更新版）

現時点の主な責務分担は次の通り：

- `cue-controller.js`  
  primary / secondary の cuechange 制御、secondary track sync、overlay / history / panel への fan-out、current subtitle block の本流更新
- `overlay-controller.js`  
  overlay の生成・更新、見た目調整、表示切替
- `playback-controls-layout.js`  
  Apple TV+ 再生コントロール帯のレイアウト調整
- `runtime-observers.js`  
  player DOM 検出、layout observer、起動時 video 検出
- `settings-runtime.js`  
  settings 読み込み、fallback、restart orchestration、runtime message listener
- `panel-renderer.js`  
  panel list 描画・更新、scroll 調整
- `content.js`  
  初期化、各モジュール接続、起動フロー、restart / recovery / popup orchestration、panel visibility 永続化の入口、subtitle probe / debug log などの観測補助

---

## 5. 今どこにいるか

現時点で、Issue #32 の範囲では次のところまで完了している：

- bridge / dep 帯整理
- panel / cue / overlay / observer / settings-runtime / panel-renderer の分離と接続
- `showSidebar` を真実源にした panel visibility 同期、および `pinSidebar` 廃止
- debug logger 防御
- Phase 1: 履歴重複の一本化
- Phase 1.5: debug filter 導入（観測性改善）
- Phase 2: overlay のイベント依存を減らすための中間整理（current block 基準の overlay 更新）

この結果、

- 右パネル履歴の重複主因は除去できた
- overlay は cuechange 生イベントより current block に近い基準で更新されるようになった
- Phase 3 の block sequence モデル（`buildSubtitleBlockSequence(now)`）へ進むための入口が整った

という状態になっている。

---

## 6. 次にやること（Phase 3 以降）

この Issue #32 の残タスクとしては、次を優先する：

- Phase 3: `buildSubtitleBlockSequence(now)` を軸にした block sequence モデル導入
  - primary cue をアンカーに block 配列を構築
  - `state: "past" | "current" | "future"` と `stable` の付与
  - panel / overlay / history を同じ block 配列から描画する構造への移行
- 同一 block の近接再評価を `stable` で扱う設計への移行
- 設定ページ側 debug log を主観測面として、current block 更新頻度・block start/end の遷移・overlay 影響を軽く整理
- `content.js` の入口化と runtime glue 圧縮の継続（Phase E の残り）

debug log filter / view の共通化（右パネル / 設定ページ）は価値のある派生テーマだが、Issue #32 の主対象ではないため、必要なら別 docs / 別 Issue に切り出して扱う。

このコメントでは、Issue #32 の Phase 3（subtitle block sequence / panel current resolver）について、ここまでの整理内容と今後の方針をまとめます。

---

## Phase 3 の位置づけ

- 現状:
  - Phase 1 / 2 で、subtitle history と current ブロック更新の一枚板構造をある程度整理済み。
  - Phase 3 では、「current の真実源」を単一ブロックから block sequence モデルへ寄せるフェーズに入っている。

- Phase 3 の役割:
  - 字幕の真実源を「currentSubtitleBlock 1 本」ではなく「blocks[] + currentIndex + meta」で扱うモデルへ移行する。
  - panel / overlay / history を、この真実源モデルを前提に段階的に差し替える。
  - same-second / same-window 字幕が「最初だけ再生マークが付き、後が飛ぶ」症状を、設計レベルで解消する。

---

## 真実源モデル（blocks / sequence）

Phase 3 の中心は `buildSubtitleBlockSequence(now)` という関数を真実源構築の入口にすることです。

- `buildSubtitleBlockSequence(now)` の返り値方針:
  - `blocks[]` : 字幕ブロック配列
  - `currentIndex` : 現在位置を指すインデックス
  - `meta` : 再構成理由・バージョン・デバッグ用情報など

- block の同一性キー:
  - `startTime + endTime + primaryText` を基本キーとする。
  - `secondaryText` は key には含めない（同一時間帯の二言語字幕などは別扱い）。

- `stable` フラグ:
  - 意味: 「この block を UI 真実源として、今後どれだけ揺らしてよいか」の指標。
  - Phase 3-1 の MVP 方針:
    - 過去側（past）の block のみ保守的に `stable = true` にする。
    - 現在 / 未来側は当面 `stable = false` を許容しつつ、後続フェーズで条件を詰める。

- `currentSubtitleBlock` の扱い:
  - 即削除はせず、Phase 3-1 では `blocks[currentIndex]` の互換コピーとして残す。
  - overlay / history など既存の current 依存箇所は、この互換コピーを通して段階的に blocks 真実源へ寄せる。

---

## panel current resolver 分離

右パネル（字幕パネル）については、current 判定責務を専用モジュールへ切り出しました。

- 新規モジュール:
  - `subtitle-block-resolver.js`
  - 役割:
    - panel に出す字幕ブロックの正規化
    - same-window（同一時間窓）のグループ化
    - グループ内の sequential current 解決
    - 単一 current winner の決定

- 既存モジュール側の方針:
  - `content.js` は orchestration / wiring に寄せ、current 判定ロジックを増やさない。
  - `panel-renderer.js` は描画（render）責務を中心にし、current 判定の主責務は持たせない。
  - panel は「どの字幕を current とみなすか」を resolver に任せる形とする。

---

## same-window group と current-fallback 問題

subtitle panel の debug 表示を主観測源として、32〜40 秒帯の挙動を観測しました。

- 32.330〜34.195 秒の窓:
  - `"Looking for a woman"`
  - `"with a bandaged right arm."`
    の 2 行が同一窓に入り、same-window group 自体は形成されている。

- 36.830〜39.869 秒の窓:
  - `"Please ship two barrels of D+"`
  - `"to Water Filtration."`
    の 2 行も同一窓に入り、同様に group 化されている。

- 窓前半では:
  - group 内 1 件目が `current`
  - 2 件目が `future`
    という形で順送りは動いている。

- 窓終端付近では:
  - 元の block 群が `past` に落ちたあと、
  - 同じ時間窓に `current-fallback` が `current` として追加される場面がある。
  - 結果として、ユーザー視点では「同じ秒にある 2 行目以降が飛ぶ」挙動になる。

この観測から、

- 問題の主因は same-window group 化の失敗ではなく、
- **`current-fallback` の介入と、panel current マーカー描画責務の噛み合わせにある**

という仮結論を採っています。

---

## Phase 3-1 の最小ライン

Phase 3-1 は「真実源側を固めるフェーズ」として、次の 4 点に絞っています。

1. `buildSubtitleBlockSequence(now)` が  
   `blocks[] + currentIndex + meta` を返すことを前提にする。
2. block key を  
   `startTime + endTime + primaryText` の組み合わせに統一する。
3. `stable` は MVP では過去側のみ保守的に `true` とし、現在 / 未来側は後続フェーズで条件を詰める。
4. `currentSubtitleBlock` は当面 `blocks[currentIndex]` の互換コピーとして維持する。

これに合わせて、

- `subtitleBlocks`
- `subtitleCurrentIndex`
- `subtitleBlockMeta`

を state として持つ土台を追加済みです。

---

## 段階移行方針（真実源側 → 表示側）

Phase 3 以降の段階移行は次のように考えています。

- 優先順:
  - **真実源側（blocks / sequence） → 表示側（panel / overlay / history）**

- Phase 3-1:
  - sequence 関数と key / stable の最低限ルールを固める。
  - `subtitleBlocks` / `subtitleCurrentIndex` / `subtitleBlockMeta` の state を揃える。
  - `currentSubtitleBlock` を `blocks[currentIndex]` の互換コピーとして維持する。

- Phase 3-2:
  - panel 用の resolver（`subtitle-block-resolver.js`）を blocks 真実源前提で調整する。
  - same-window group への通常 block がある場合に `current-fallback` を追加しない / 優先順位を下げる / snapshot と marker 描画を分離する等の案から着手する。
  - panel current の飛びを blocks 真実源側のポリシーとして修正する。

- Phase 3-3 以降:
  - overlay を `blocks[currentIndex]` 基準へ移行する。
  - seek / reopen 時は block sequence の再構成（full rebuild）で扱う。
  - panel の past/current/future を `blocks + now + currentIndex` 基準へ寄せる。
  - `subtitleHistory` は UI 真実源から外し、安定後に `currentSubtitleBlock` とともに縮退させる。

---

## 現在のブランチ・コミット状況

- ブランチ:
  - `issue-32-content-core-split`
- 先頭コミット（抜粋）:
  - `462fb43` refactor: panel debug ロジックを改善し、時間範囲を動的に設定
  - `bee621e` refactor: subtitle blocks 真実源の state 土台を追加
  - `dcb846a` chore: mark previous refactor as Phase 3-1 WIP checkpoint

真実源側の state 土台追加と panel current resolver の分離については、このブランチにコミット済み・push 済みです。

---

## 今後の Issue 更新方針

- docs 側（`docs/issue-32-subtitle-sync-design.md`）では、
  - `buildSubtitleBlockSequence(now)` が `blocks[] + currentIndex + meta` を返す設計方針
  - block key / `stable` の基本ルール
  - panel 用 resolver を表示ポリシー層として置く方針
  - `current-fallback` 介入問題の観測結果と修正方針
  - `currentSubtitleBlock` を互換コピーへ縮退させる段階移行
    を追記予定です。

- Issue #32 側では、
  - 本コメントを Phase 3 の「真実源モデルと panel current resolver 分離のまとめ」として扱い、
  - 以降のコメントで Phase 3-2 以降の個別タスクと調整内容を追っていきます。

Phase 3-2 の checkpoint を commit / push しました。  
branch: `issue-32-content-core-split`  
commit: `0bbb1e9`

### 今回まででやったこと

- `subtitle-block-resolver.js` 側で panel current 判定責務を継続整理
- same-window に通常 block が存在する場合は `current-fallback` を追加しないよう調整
- same-window group 内の current を single winner 解決で潰さないよう調整
- 2 行 group の sequential current を 50:50 から 30:70 に寄せる小実験を実施
- `panel-renderer.js` から snapshot 的な `currentSubtitleBlock` 依存を外し、resolver debug を観測できるように変更

### 観測結果

- same-window 2 行 group 自体は正しく形成されている
- `current-fallback` 介入抑制や resolver 内の sequential current ロジックは概ね意図どおり動いている
- ただし panel 上では、2 行目に再生マークが乗る瞬間は実質観測できなかった
- 32〜40 秒帯の debug でも、
  - 1 行目 `current`
  - 2 行目 `future`
  - その後まとめて `past`
    になっており、2 行目 `current` は拾えていない

### ここまでの整理

resolver 単体の調整だけでは、

- same-window group 化
- fallback 抑制
- current winner 調整
- 2 行内順送り比率調整

を行っても、panel UX として「同一 window の複数行が飛ばずに認識されること」は満たし切れない、というところまで確認できた。

原因は真実源モデルそのものというより、  
**短い window 内の line-level current を panel 更新タイミングで拾い切れないこと**にあると見ている。

### 次フェーズ案（Phase 3-3）

次は resolver 単体調整ではなく、**panel current UX フェーズ**として切り出す想定。

方向性:

- 真実源モデル（`blocks[] + currentIndex + meta`）は維持
- panel は派生ビューとして別ポリシーを許容
- same-window 2 行 group では、panel に限り 2 行とも current 風に強調表示する方針を検討

候補 shape:

```js
{
  (key,
    state, // truth: past/current/future
    isWindowCurrent, // この window が current か
    isPanelEmphasized, // panel で current 相当に強調するか
    isSequentialCurrent); // line-level current（内部整合 / debug 用）
}
```

この方針で、次セッションは

- resolver 出力 shape の確認
- `panel-renderer.js` の current マーカー依存箇所の確認
- `isPanelEmphasized` ベースの描画切り替え
  へ進める予定です。

### Phase 3-3（panel current UX / resolver 派生フラグ）の初期実装メモ

Phase 3-2 までの整理を踏まえて、Phase 3-3 では「真実源モデルは strict のまま維持しつつ、panel だけは派生ビューとして window 単位 current を扱えるようにする」初期実装に着手しました。

#### 1. resolver 側の更新

`subtitle-block-resolver.js` に、panel current 専用の派生ロジックを追加しました。

- `PANEL_CURRENT_WINDOW_GAP_TOLERANCE` を導入し、strict current window が存在しない短いギャップでは、直前 window を panel 用 current window として扱えるようにした。
- `findPanelCurrentWindowKey(...)` を追加し、same-window group 群の中から
  - strict current window を優先的に採用しつつ、
  - なければ「直前の past window かつ gap が許容範囲内」の window を panel current window として選べるようにした。
- `applyPanelCurrentFlags(...)` を追加し、各 block に対して
  - `isWindowCurrent`
  - `isPanelEmphasized`
  - `isSequentialCurrent`
    を付与する流れに整理した。
- strict な `state` / `currentBlocks` は従来どおり resolver 側の truth として維持しつつ、panel 用の派生フラグは「表示ポリシー層」の情報として別レイヤーで扱う構成にした。

これにより、same-window 複数行 window では

- truth としては依然「line-level current は 1 行だけ」を維持しつつ、
- panel では window 単位で複数行を current 風に強調

という分離ができるようになりました。

#### 2. panel renderer 側の更新

`panel-renderer.js` では、resolver の派生フラグを前提に描画ロジックを整理しました。

- 旧来の `collectFuturePanelBlocks` / `buildCurrentPanelBlock` など、
  - content.js 時代の「独自 current/future 組み立て」に依存した経路を削除した。
- `buildPanelBlockHtml(...)` で、
  - `state === "current"` だけではなく、
  - resolver 由来の `isWindowCurrent` / `isSequentialCurrent` / `isPanelEmphasized`
    をそれぞれ
    - scroll anchor / debug 用の `id="current-block"`
    - data 属性（`data-window-current` / `data-sequential-current` / `data-panel-emphasized`）
    - 再生マーク表示（panel 上の視覚的 current 強調）
      に反映するように変更した。
- scroll 補正ロジックは `isSequentialCurrent` を anchor として使い続けつつ、panel 上の「どの行に再生マーカーを付けるか」は `isPanelEmphasized` を基準にする構成に寄せた。

結果として、panel renderer は

- current 判定ロジックをこれ以上増やさず、
- resolver が返す truth + 派生フラグを「どう見せるか」に専念する

という役割に寄せることができました。

#### 3. Phase 3 の現在地

Phase 3 全体の中では、いま次のような状態です。

- 真実源モデルとしての `subtitleBlocks` / `subtitleCurrentIndex` / `subtitleBlockMeta` の state 土台は追加済み。
- panel current については、
  - strict 判定（truth）は `state` / `currentBlocks` 側に残しつつ、
  - panel UX 用の派生フラグ（`isWindowCurrent` / `isPanelEmphasized` / `isSequentialCurrent`）を resolver で計算するところまで進んだ。
- `panel-renderer.js` からは旧来の current/future 独自組み立て経路を削除し、
  - 「resolver の出力を描画する側」に整理できた。

今後は、今回の gap tolerance / 派生フラグ構成で実際のコンテンツを観察しながら、

- tolerance の値や window 単位強調のポリシーを微調整する
- overlay / history への sequence モデル適用とあわせて、`currentSubtitleBlock` / `subtitleHistory` の縮退フェーズへ進む

といった順番で、Phase 3 の後半に入っていく予定です。

## Phase 3-3（panel current UX フェーズ）サマリ

Issue #32 の Phase 3-3 では、same-window captions の panel current 問題を  
「truth の current 判定」ではなく「panel UX の派生強調問題」として捉え直し、resolver / renderer の責務分離を進めました。

---

### 1. 問題の再定義

Phase 3-2 までの調整で分かったこと:

- same-window group 化や `current-fallback` 抑制だけでは、
  - same-window 2 行 group の 2 行目に再生マーカーが安定して乗らない
    という UX 要件を満たしきれない。
- 主因は、
  - strict current 判定（truth）
  - panel current マーカー描画責務
  - panel 更新タイミングと line-level current サンプリングの粗さ
    の組み合わせにある。

このため、Phase 3-3 では、

- strict current 判定は resolver の **truth** として維持しつつ、
- panel 側では UX レイヤーで複数行強調を許容する

という「truth と panel UX の責務分離」方針に切り替えました。

---

### 2. resolver 側の変更（`subtitle-block-resolver.js`）

panel 用の派生フラグを次のように導入しました。

- gap tolerance の導入
  - `PANEL_CURRENT_WINDOW_GAP_TOLERANCE` を追加し、
  - strict current window が存在しない短い区間でも、
    - 直前の past window と小さな gap がある場合は
    - その window を panel 上で current 風に扱えるようにした。

- panel current window 解決処理
  - `findPanelCurrentWindowKey(...)` を追加。
  - strict current windowが見つからなければ、「直前の past window + gap 許容」の window を panel current window として採用。

- 派生フラグ付与処理
  - `applyPanelCurrentFlags(...)` を追加。
  - 各 block に次のフラグを付与する流れを実装:
    - `isWindowCurrent` … window 単位で current とみなすか
    - `isPanelEmphasized` … panel 上で current 相当として強調するか
    - `isSequentialCurrent` … line-level current（内部整合 / debug 用）

方針としては、

- strict current（truth）は `state` / `currentIndex` に基づく判定で維持しつつ、
- same-window 複数行 window では window 単位で `isWindowCurrent = true` を許容する、
- panel の再生マーカー表示や強調は `isPanelEmphasized` に寄せる、

という構造にしています。

---

### 3. renderer 側の変更（`panel-renderer.js`）

renderer は「描画専任」に寄せました。

- 旧 panel 組み立て関数の削除
  - `collectFuturePanelBlocks`
  - `buildCurrentPanelBlock`
    を削除し、独自 current/future 組み立てをやめました。

- resolver 出力ベースの描画に整理
  - `buildPanelBlockHtml(...)` 内で、
    - strict current / sequential current を `id="current-block"` や `data-sequential-current` に反映。
    - `isWindowCurrent` / `isSequentialCurrent` / `isPanelEmphasized` を `data-*` 属性として埋め込み。
    - 再生マーカー表示条件に `isPanelEmphasized` を利用し、
      - same-window 2 行 group では 2 行とも current 風に強調できるようにした。
  - scroll 補正で使う anchor は `isSequentialCurrent` ベースに保ちつつ、
    - UX 上の強調は `isPanelEmphasized` をベースにする、という役割分担にしています。

これにより、

- resolver が truth + panel 用派生フラグを決める層、
- renderer がその出力を DOM に落とす層、

として責務を分けられました。

---

### 4. docs / Issue 更新

Phase 3-3 の初期実装内容は、次に反映済みです。

- `docs/issue-32-subtitle-sync-design.md`
  - truth / resolver / panel renderer の関係、
  - `isWindowCurrent` / `isPanelEmphasized` / `isSequentialCurrent` の意味、
  - same-window captions に対する UX 方針（strict current 1 行 + panel 強調複数行）
    を文書側へ統合済み。

- Issue コメント
  - このコメントを含む Phase 3-3 の進捗メモで、
    - panel current UX の再定義、
    - resolver / renderer の変更点、
    - 今後のフェーズ（overlay / history 寄せ）案
      を共有済み。

---

### 5. Phase 3-3 の完了ラインと残タスク

**Phase 3-3 の完了ライン:**

- `subtitle-block-resolver.js` に panel current window 解決 + gap tolerance を導入済み。
- `findPanelCurrentWindowKey(...)` / `applyPanelCurrentFlags(...)` を追加済み。
- `isWindowCurrent` / `isPanelEmphasized` / `isSequentialCurrent` を block に付与する流れを実装済み。
- `panel-renderer.js` から旧 panel 経路を削除し、派生フラグ描画ベースへ整理済み。
- docs / Issue コメントともに Phase 3-3 初期実装内容を反映済み。

**残タスク / 次フェーズ案:**

- gap tolerance の具体値と UX の微調整。
- overlay 側を `blocks[currentIndex]` ベースへ寄せる（Phase 3-4 候補）。
- `subtitleHistory` を `blocks[]` の `past` 表現へ縮退させる前段の設計。
- 最終的に `currentSubtitleBlock` を互換コピーから段階的に削っていく。

### Phase 3-4: overlay blocks 移行フェーズ（2026-07-17）

`docs/issue-32-subtitle-sync-design.md` を Phase 3-4 までの内容でフル更新しました。  
主に overlay を `blocks[currentIndex]` ベースへ寄せる最小差分と、その結果見えてきた論点を整理しています。

#### 今回やったこと（実装側）

- `cue-controller.js`
  - `createCueController({...})` に `updateOverlayFromBlock` を注入できるようにし、
    `onPrimaryCueChange()` で決まった current block を overlay へそのまま渡せる入口を追加。
  - `onPrimaryCueChange()` 内の overlay 更新を  
    `updateOverlay(currentBlock.primaryText, currentBlock.secondaryText)`  
    から  
    `updateOverlayFromBlock(currentBlock)`  
    へ変更。
- `overlay-controller.js`
  - `updateOverlayFromBlock(block)` を追加し、overlay 側の入力を「テキスト 2 本」ではなく
    「block オブジェクト」に寄せる薄い adapter を用意。
  - 現時点では `block.primaryText` / `block.secondaryText` から既存 `updateOverlay()` を呼ぶ実装に留め、
    truth model の形は変えずに、入力インタフェースだけ block ベースへ寄せる。
- `content.js`
  - `createCueController({...})` への `updateOverlayFromBlock` の受け渡しに限定し、
    overlay ロジックそのものは `cue-controller.js` / `overlay-controller.js` に寄せる。
  - `resetRuntimeState()` で `subtitleBlocks` / `subtitleCurrentIndex` / `subtitleBlockMeta` /
    `currentSubtitleBlock` / `lastCurrentSubtitleBlockAt` / `lastPanelRenderSnapshot` など
    subtitle truth / snapshot 系の runtime state をまとめてクリアするように調整。
  - これにより、`restartBilingual()` 相当の再初期化で古い block / current を引きずりにくくした。

この結果、通常再生では：

- overlay は `currentSubtitleBlock` の「複製」ではなく、`onPrimaryCueChange()` で決まった current block を
  直接 shared input として受け取る形になった。
- panel / overlay の current 表示が、いずれも同じ current block から導かれる構成に一歩近づいた。
- 体感として、画面下部 overlay の英日 2 行表示がかなり安定し、以前のような点滅・短表示は目立たなくなった。

#### 観測できたこと（same-window / seek 周り）

Phase 3-4 の実装後に、same-window captions や large seek まわりを観測したところ、次のような挙動が見えてきました。

- same-window captions:
  - panel 側では、同一時間窓に複数の英語行＋共有日本語があるケースでも、
    `subtitle-block-resolver.js` の派生フラグ
    (`isWindowCurrent` / `isPanelEmphasized` / `isSequentialCurrent`) により
    「2 行とも current 風に見える」構成は実現できている。
  - 一方 overlay は current block 1 件だけを表示するため、
    - 英語だけのブロックに見える時間帯がある
    - 同じ場面でも panel 側では日本語が表示されている
      といった体感差が残った。
- large seek 直後:
  - seek 直後から数秒程度、secondary の再同期が追いつくまで
    overlay が英語だけのブロックになる場面が観測された。
  - 同じタイトル・同じ場面でも、再生し直すと英語行のまとまり方が変わるケースがあり、
    Apple TV+ 側の字幕トラック構造や再生タイミング由来の揺れも一定程度ありそう。

ここから分かったことは：

- Phase 3-4 の「current block ベース overlay」への移行自体は正しい方向で、
  通常再生における点滅・短表示はかなり改善した。
- ただし same-window captions / large seek では、
  overlay が **current block 単体** だけを見る構成だと UX 上まだギャップが残る。
- panel と同様に、overlay でも
  - current block が属する同時刻 window / group
  - group 内の英語行の扱い（連結するか、1 行だけ見せるか）
  - group 内の日本語行の扱い（最初の secondaryText を採用するか）
    といった「表示ポリシー層」を truth blocks の上にもう一段用意した方がよさそう。

#### 設計ドキュメント更新

これらを踏まえて、`docs/issue-32-subtitle-sync-design.md` を Phase 3-4 までの内容で更新しました。

主な追加点は：

- Phase 3-4 を **overlay blocks 移行フェーズ** として明示
- `updateOverlayFromBlock(block)` を入口とする中間設計を記載
- same-window / large seek での **英語だけのブロック** を問題として定義
- overlay 側に残っている論点を
  - truth blocks の問題ではなく
  - **overlay 表示ポリシー** の設計テーマ
    として切り分けておくことを明記

今後の overlay 側の検討は、次のような問いを設計 Issue 側で扱う想定です：

- overlay は「current block 1 件」だけでよいのか、same-window window を 1 単位として扱うべきか
- 英語行は window 内の複数行を改行結合するのがよいのか
- 日本語行は window 内でどの行を代表として採用するのか
- large seek 直後の英語だけ block をどの程度まで許容し、どこからを「修正対象」とみなすか
- これらをどこまで `subtitle-block-resolver.js` 側で扱い、どこからを `overlay-controller.js` 側の表示ポリシーとして扱うか

Phase 3-4 としては、

- overlay の入力を `blocks[currentIndex]` ベースへ寄せる
- subtitle runtime state reset まわりを整理し、restart 時の揺れを減らす

ところまでを一区切りとする。  
same-window captions / seek 後の overlay UX については、このフェーズでは抱え込まず、次ラウンドの設計スレで扱う予定。

### Phase 3-5 方針: same-window overlay 表示ポリシーと resolver 形の整理

Phase 3-4 で overlay 入力を `blocks[currentIndex]` ベースへ寄せたうえで、Phase 3-5 では表示ポリシーと resolver 形を決めました。

画面下部 overlay の表示方針と overlay 用 resolver の形を次のように固めました。

1. 表示単位の見直し（same-window を窓単位で扱う）

- overlay はこれまでの「current block 1 件」単位ではなく、
  「same-window の表示まとまり」単位で表示する方針に切り替えます。
- same-window の「同じ時刻のまとまり」は、
  **startTime と endTime が同じ複数の block の集まり**とします。
  panel 側と同様に、windowKey / groupKey は `${startTime}::${endTime}` で表現します。
- この窓に属する複数 block は、1 block ずつ順送り表示せず、
  1 つの表示単位として同時に扱います。

2. main / sub の扱い

- メイン字幕とサブ字幕は、どちらも同じ表示単位（same-window のまとまり）の中で扱います。
  片方だけ block 単位、片方だけ group 単位で扱うことはしません。
- same-window に属する複数行があれば、
  **メインもサブも複数行のまま表示し、代表 1 行への縮約は行いません**。
- 表示する際の行順は、取得された字幕 block の順番をそのまま使います。

3. 片側欠落時・large seek 時の扱い

- ある時刻のまとまりの中で、メインまたはサブのどちらかが欠けている場合は、
  同じ startTime / endTime を持つ他の block にある内容で補ってよいものとします。
- ここでいう補完は truth 側の block 自体を書き換えることではなく、
  overlay resolver が表示用 view を組み立てる段階で行います。
- それでもメイン字幕またはサブ字幕がまだ存在しない場合は、
  **ある方だけを表示してよく、overlay 全体は消しません**。
- large seek 直後などで表示内容がまだ不安定な間は、
  足りない方の字幕は空のまま静的に維持し、
  足りない行を点滅させたり overlay 全体を消したりはしません。
  現実には、メインだけ表示され、サブは空行で静的維持される状態を許容します。

4. overlay 専用 resolver の新設と shape

- truth 側（`subtitleBlocks[] / currentIndex / meta`）は既存のモデルを維持し、
  same-window / large seek まわりの表示ポリシーは overlay 専用 resolver へ寄せます。
- 新たに `overlay-block-resolver.js`（仮）相当を追加し、overlay 用の軽量 resolver / helper として分離します。
- 初期 interface は次のようにします:

  ```js
  resolveOverlayView(blocks, currentIndex, meta) => {
    return {
      groupKey,          // `${startTime}::${endTime}`
      startTime,
      endTime,
      mainLines,         // string[]
      subLines,          // string[]
      isStable,          // boolean
      shouldKeepVisible, // boolean
      isEmpty            // boolean
    };
  }
  ```

  - `groupKey` は panel 側と同様に `${startTime}::${endTime}` を使用します。
  - `mainLines` / `subLines` には、同じ窓に属する block 群から取得順のまま複数行を格納します。
  - `isStable` は現在の表示が安定状態かどうかのフラグです。
  - `shouldKeepVisible` は「一時的な片側欠落でも overlay 全体は消さない」ための表示維持判定で、
    controller ではなく resolver 側が返します。
  - `isEmpty` は、本当に表示対象の字幕が存在しないかどうかを示します。

5. overlay-controller 側の責務

- `overlay-controller.js` には `updateOverlayFromView(view)` を用意し、
  block 単位ではなく上記の overlay view を描画対象とします。
- controller 側の基本ロジックは次の通りとします。

  ```js
  if (view.isEmpty && !view.shouldKeepVisible) {
    clearOverlay();
  } else {
    renderOverlayLines(view.mainLines, view.subLines);
  }
  ```

  - `isEmpty && !shouldKeepVisible` のときだけ overlay 全体を clear し、
    それ以外は `mainLines` / `subLines` をそのまま描画します。
  - 片側だけでも表示対象があれば overlay は維持されます。

- 既存の `updateOverlayFromBlock()` は、移行期間中は互換 adapter として残しつつ、
  新しい `updateOverlayFromView(view)` への段階移行を進めます。

6. Phase 3-5 の最小実装ライン

- `overlay-block-resolver.js`（仮）相当を追加し、`resolveOverlayView(blocks, currentIndex, meta)` を export します。
- same-window group を `${startTime}::${endTime}` で組み、
  group から `mainLines[]` / `subLines[]` を取得順で構成します。
- `isStable / shouldKeepVisible / isEmpty` の最小判定を resolver 層に持たせます。
- `overlay-controller.js` に `updateOverlayFromView(view)` を追加し、
  cue 側の更新入口を `resolver → view → controller` に切り替えます。
- same-window / large seek / reopen / track 再解決の各シナリオで、
  overlay 表示がこの方針通りに動くかを観測確認します。

このコメントでは、Phase 3-5 の overlay 表示ポリシーと resolver 形の決定内容を共有します。  
詳細な自然言語仕様と shape は `docs/issue-32-subtitle-sync-design.md` を正本として更新します。

Phase 3-6 実装: overlay same-window resolver と view 結線 / secondary recovery 観測まわり

今日のセッションでは、Phase A〜I までのうち、overlay / panel / current 行まわりと secondary recovery の観測強化まわりを中心に進めました。

---

## 今回のコミット

- ブランチ: `issue-32-content-core-split`
- コミット: `41575ad chore: secondary recovery 観測と resolver probe を追加する`

### 変更概要

- `content.js`
  - `state.secondaryRecoveryMissCount` を追加
  - `getMergedSubtitleHealthSnapshot()` を追加し、`cue-controller.js` 側の merged health を runtime から参照できるようにした
  - `secondary track sync context` ログに以下の merged 派生値を併記できるようにした
    - `mergedPrimaryHealthy` / `mergedSecondaryHealthy`
    - `mergedShouldRecoverSecondary` / `mergedShouldForceSecondaryRebind`
  - content 側で fallback secondary recovery を試す経路を追加
    - 条件: `hasFreshCurrentPrimary && !secondaryCueText && state.secondaryTrack`
    - `secondaryRecoveryMissCount` と `forceRebind` を用いて継続 miss を監視
  - fallback recovery 中に `secondary resolver probe` を出せるようにし、current / resolved / candidates をまとめてログできる土台を追加

- `cue-controller.js`
  - `lastMergedSubtitleHealth` を保持し、`getMergedSubtitleHealth()` 経由で外側から参照できるようにした
  - merged health の派生値（primary/secondary healthy / shouldRecoverSecondary / shouldForceSecondaryRebind）をログ出力する `merged subtitle health snapshot` を追加
  - これまで `cue-controller` 内で行っていた secondary recovery 実行は、今回のコミットでは「merged 側での判定・観測」に寄せ、実行は sync interval（content 側）に任せる構造に整理

- `subtitle-track-resolver.js`
  - `getSecondarySubtitleTrackCandidates(video, requestedLang)` を追加し、secondary 候補一覧（index / language / label / kind / mode / cuesLength / activeCuesLength / matchesRequestedLanguage / forcedLike / score）をまとめてログできるようにした
  - `resolverApi` に `getSecondarySubtitleTrackCandidates` を追加し、`content.js` 側から recovery probe に利用できるようにした

---

## 今日のゴールの棚卸し

- overlay / panel / current 行が、共通の字幕ブロック列（`blocks[] + currentIndex + meta`）を正解台帳として参照していること。
- runtime 現在表示に対して、`subtitleHistory` 由来の history fallback が使われていないこと。
- same-window / large seek の代表シナリオで、overlay / panel の表示が不自然でないことを確認すること。
- large seek 後の「メインだけ表示・サブ不復帰」代表ケースを、view だけでなく runtime / health / recovery / resolver を含む構造として把握しておくこと。
- 次フェーズで「health / recovery truth をどこに置くか」「panel/overlay 共通 view をどこで最終生成するか」を決められる状態にしておくこと。

今日のセッションでは、上記のうち

- view / panel / overlay の基盤整理（current 行・same-window・displayBlocks）は **ほぼ達成**。
- history fallback 削除と current secondary の過去混入除去は **達成**。
- large seek 代表ケースの「症状」と「health/recovery の不整合」の把握は **達成**。
- ただし「same-window / large seek の実機確認で完全に自然になった」と言えるところまでは **未達成**。
- 「health / recovery truth をどこに置くか」の設計判断も **未達成（次フェーズの主題）**。

---

## フェーズ整理（Phase A〜I-4）

### Phase A〜H（view / track / UI 土台）

- Phase A  
  `overlay-block-resolver.js` による same-window overlay view の最小実装を追加し、Apple TV+ 再生画面にオーバーレイ表示の土台を作った。

- Phase B  
  overlay 更新の入口を `resolver → view → controller` に揃え、panel / overlay の両方が同じ view 経由で更新される構造にした。

- Phase C  
  runtime の「いま表示している字幕」と history を混ぜない方針を反映し、current 用データと履歴用データの責務を分離した。

- Phase D  
  secondary 側の cuechange 後にもブロック再評価が走る経路を追加し、サブ字幕の更新タイミングを primary 側に依存しすぎないようにした。

- Phase E  
  same-window の main/sub group を UI 用 1 block として扱う view shape にし、メイン／サブの重複表示の整理（dedupe）を view 層で行うようにした。

- Phase F  
  secondary cue matching を「再生区間の重なり」ベースへ改善し、Apple TV+ 上でズレや抜けが起きにくいペアリングロジックにした。

- Phase G  
  secondary track の `mode` 強制を緩和し、Apple TV+ 固有の `hidden-active` 状態を壊さないように subtitle track 制御方針を更新した。

- Phase H  
  `subtitle-view-resolver.js` / `displayBlocks` / `panel-ui` の cleanup を行い、panel / overlay の共通 view 化に向けた基盤整理を完了した。

### Phase I-1（view & panel current / past）

- [x] panel current が `subtitle-view-resolver.js` の返り view shape を正式な入力として使うように変更し、panel 側も共通 view を見る構造に寄せた。
- [x] `cue-controller.js` で overlay current 更新時に `subtitleView` を解決し、`state.currentSubtitleView` へ載せる経路を復旧した。
- [x] `panel-ui.js` の `normalizeSubtitleText` 参照切れと、`cue-controller.js` の `state` 参照切れを修正し、共通 view 化途中で発生していた実行時エラーを解消した。
- [x] `blocks.past` 由来の `panelPastBlocks` を runtime state として保持し、既存の `subtitleHistory` と並走で観測できるようにした（history 移行の準備）。

### Phase I-2（sequence health / 揃い崩れ検知）

- [x] `subtitle-blocks.js` に `analyzeSequenceHealth()` を追加し、subtitle block sequence 生成時に「メイン／サブの揃い崩れ」を `meta.sequenceHealth` として保持できるようにした。
- [x] `cue-controller.js` から `meta.sequenceHealth` を読み取り、secondary resync への最小限の接続を入れた（秒間ループとは別の recovery 経路を用意）。

### Phase I-3（health 集約 + content fallback recovery）

- [x] 通常再生 / same-window / panel 内の表示範囲において、overlay と panel current が概ね正常に動作し、block click / 10 秒スキップも大きく崩れていないことを確認した。
- [x] large seek 後の panel current 固着・sub 不復帰を、runtime 上の  
      `secondaryTrackFound = true` かつ `secondaryActiveCues = 0` が継続するケースとして絞り込んだ。
- [x] `current subtitle block updated` 実測ログから、  
      `hasPrimarySignal = true` / `hasSecondarySignal = false` / `secondaryTextLength = 0`  
      が長時間継続することを確認し、「メインだけ進んでサブが置いてけぼりになる」現象を runtime ベースで捉えた。
- [x] 当該ケースで、`subtitle blocks api snapshot` / `cuechange track probe` / `merged subtitle health snapshot` / `cue-controller secondary recovery trigger` がいずれも発火していないことを確認し、「検知までは届いていない／entry が切れている」可能性を把握した。
- [x] `cue-controller.js` に `lastMergedSubtitleHealth` と `getMergedSubtitleHealth()` を追加し、runtime health / current cue / sequenceHealth を統合した結果を、外側（`content.js` など）から参照できるようにした。
- [x] `content.js` に `getMergedSubtitleHealthSnapshot()` を追加し、`secondary track sync context` ログの中に merged health の派生値（primary / secondary 健康状態と recovery 意図）を併記できるようにした。
- [x] 実測ログにより、「main は healthy / sub は unhealthy / recover したい」という判定自体は、代表ケースでは merged health の派生値として成立する区間があることを確認した。
- [x] 上記状態でも `cue-controller secondary recovery trigger` が一度も出ていないケースがあることを確認し、「health 判定レイヤーから recovery 実行レイヤーへの導線が、当該ケースでは繋がっていない」ことを特定した。
- [x] `content.js` 側で `hasFreshCurrentPrimary && !secondaryCueText && state.secondaryTrack` を基準に secondary recovery を直接試す fallback 経路を追加し、`secondaryRecoveryMissCount` と `forceRebind` を用いた継続 miss 監視を導入した。
- [x] 実測ログにより、大シーク後の代表ケースでは `secondary recovery trigger` 自体は継続発火しており、`missCount` が増え続けて `forceRebind: true` に入り続けることを確認した。
- [x] 同じ代表ケースで、`currentSecondaryTextLength = 0` が継続して recovery は走っている一方、`secondary track sync context` 上では `mergedSecondaryHealthy: true` / `mergedShouldRecoverSecondary: false` が観測される区間があり、merged health と content fallback recovery の間に判定のズレがあることを確認した。

### Phase I-4（resolver 観測）

- [x] `subtitle-track-resolver.js` に `getSecondarySubtitleTrackCandidates()` を追加し、`video.textTracks` 上の secondary 候補一覧（index / language / label / kind / mode / cuesLength / activeCuesLength / matchesRequestedLanguage / forcedLike / score）を外側から観測できるようにした。
- [x] `content.js` の `resolverDeps` に `getSecondarySubtitleTrackCandidates` を接続し、secondary recovery 時に current / resolved / candidates を比較観測する `secondary resolver probe` の足場を入れた。
- [x] `secondary resolver probe` が出ない理由を追い、probe の配置位置が `mergedSubtitleHealth?.derived?.secondaryHealthy !== true` 側に寄っていたため、「content fallback recovery は動いているが merged 側では healthy 扱い」の区間では probe が出ないことを整理した。

---

## Phase J（次フェーズの主題＝current 整合 & recovery truth）

次のフェーズでは、以下を主題にしたいです。

- same-window / large seek / panel外 block click / 10 秒送り戻しを含む代表ケースを再テストし、未改善点を最終確定する。
- `buildMergedSubtitleHealth()` の `secondaryHealthy` が true になる経路を特定し、health 判定と runtime のズレを潰す。
- `content.js` の fallback recovery と `mergedSubtitleHealth` の役割分担を整理し、どちらを recovery truth にするか決める（merged 側を正にするか、content runtime を正にするか、hybrid にするか）。
- resolver 候補と bound secondaryTrack のズレを観測し、track 実体側の問題がないか確認する。
- panel / overlay 共通 view を本格的に固め、`subtitleHistory` 読み取り経路を縮小する。

---

## TODO（カテゴリ別・今日時点で残っているもの）

### 1. view / overlay / panel 系 TODO（表示まわり）

- [ ] `overlay / panel` の両方で使う共通 view / common block の責務位置を決める。
- [ ] same-window group を UI 用の 1 block として扱う shape を panel current だけでなく panel list / history 側にも広げる。
- [ ] panel history を `subtitleHistory` ではなく `blocks.past` から組み立てられるか確認する。
- [ ] `renderSecondarySubtitle()` の retain / idle clear が、truth/view と混線していないか再確認する。
- [ ] large seek ではなく「current 整合崩れ」を主語に、panel外 block click / 10 秒スキップ / seek bar でも共通に効く recovery 条件へ整理する。

### 2. health / recovery / resolver 系 TODO

- [ ] `cue-controller.js` の `buildMergedSubtitleHealth()` で、`secondaryHealthy` が true になる経路（`activeCues > 0` / `hasSecondaryText` / `sequence.hasCurrentSecondary`）のどれが代表ケースで効いているかをコード・ログ両面で特定する。
- [ ] `content.js` の fallback recovery と `mergedSubtitleHealth` の役割分担を整理し、どちらを recovery truth にするか設計判断を取る。
- [ ] `secondary resolver probe` を、`mergedSecondaryHealthy` 分岐に依存しない位置へ出し直す。
- [ ] `currentSecondaryTextLength = 0` 継続ケースで、current 実測と merged health のズレが一目で分かるログ shape を決める。
- [ ] `resolveSecondarySubtitleTrack()` の候補選定と、実際に bound されている `state.secondaryTrack` のズレを再観測する。
- [ ] `syncSecondarySubtitleTrack()` の `forceRebind` 実行条件を見直し、bound 済みでも必要時に `unbind → resolve → bind` をやり直せるようにする。

### 3. history / state 整理系 TODO

- [ ] `panelPastBlocks` と `subtitleHistory` の差分をログ上で確認し、panel history の truth source をどちらへ寄せるか判断する。
- [ ] `subtitleHistory` を current / panel history / fallback のどこでまだ使っているかを整理し、縮小順を決める。
- [ ] `setCurrentSubtitleBlock()` の same-time keep 分岐を縮退対象として再評価する。
- [ ] primary / secondary が同一 track を指した場合の除外またはフォールバック方針を決める。
- [ ] 動画面が字幕パネルに隠れる 70/30 レイアウト崩れを別件として切り分ける。

---

## 今日のゴールの達成状況（簡潔版）

- overlay / panel / current 行が共通 view を参照するための基盤は一通り整備済み。
- history fallback と current secondary への過去混入は削除済み。
- same-window group の dedupe(main/sub) と secondary matching 改善、secondary track mode 緩和までは完了。
- large seek 代表ケースでは、
  - runtime 上 `secondaryTrackFound = true / secondaryActiveCues = 0 / currentSecondaryTextLength = 0` が継続し、
  - content fallback recovery は継続発火しているにもかかわらず sub が復帰しない、
  - merged 側では一部区間で `mergedSecondaryHealthy: true / mergedShouldRecoverSecondary: false` が出る、
    という構造をログベースで把握できる状態になった。
- 次フェーズでは、この health / recovery / resolver の truth をどこに置くかを決めることと、representative シナリオでの最終再テストが主題になります。
