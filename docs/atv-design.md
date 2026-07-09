# Apple TV+ Bilingual Subtitles phase-3 設計まとめ

この文書は、Apple TV+ Bilingual Subtitles phase-3（v2.6.3）の現状コードで確認できたこと、合意済み仕様、今後の整理方針をまとめた設計メモです。

---

## 1. 現状コードで確認できたこと

### 1.1 現在の構成

- Chrome 拡張 Manifest V3
- `background.js`: 外部 API 通信用 Service Worker
- `content.js`: Apple TV+ 再生画面へ UI を注入するメインロジック
- `popup.html` / `popup.js`: 簡易設定 UI
- `options.html` / `options.css` / `options.js`: 別タブの詳細設定画面
- `manifest.json` の現バージョンは `2.6.3`

### 1.2 字幕 UI の現状

- 動画コンテナは 70% 幅を基準に扱い、右側 30% を字幕パネル領域として使う方針
- 右パネルは「履歴 + 現在 + 未来」の一覧型
- 各字幕ブロックは primary / secondary の 2 行表示
- 左下オーバーレイは、右字幕パネルを閉じたときの補助表示として現在字幕 2 行を表示
- パネルは `✕` で閉じ、閉じた時だけ右上の再表示ボタンで開く構成
- #17 完了後の current 表示は、「独立 current ブロック強調」ではなく **字幕一覧内の current 行 + 左側固定幅マーク欄** を基本モデルとする

### 1.3 単語ポップアップの現状

- 辞書系 UI と AI 系 UI を段階的に整理中
- 辞書連携は Jisho / Tatoeba / `dictionaryapi.dev` などを含む構成
- AI 補助表示は今後の拡張対象
- 字幕本体の 2 行表示と、学習補助ポップアップは役割を分けて扱う
- subtitle popup の UI shell は整理を進めつつあるが、辞書入力文字列の正規化仕様（例: `You're` → `Youre`）は別課題として扱う
- content.js で扱う popup は subtitle popup（字幕上の辞書 popup）であり、拡張機能の extension popup（`popup.html` / `popup.js`）とは別責務として扱う

### 1.4 言語設定の現状

- `primaryLang` / `secondaryLang` などの一般設定は `chrome.storage.sync` に保存する設計
- API キーと debug logs は `chrome.storage.local` に保存する設計
- 既定値は `primaryLang = "en"`、`secondaryLang = ""`
- `secondaryLang` が空の場合はブラウザ言語 fallback を前提に扱う
- popup / options の言語候補は、動画ごとの `textTracks` 生データではなく、**固定言語一覧** ベースへ整理済み
- 設定保存後は、**アクティブな Apple TV+ 再生タブへ即時通知**する実装になっている

---

## 2. 言語設定の設計方針

### 2.1 基本方針

- 設定導線は popup だけに閉じず、`options.html` を別タブで開く構成を主軸にする
- popup は簡易設定、options は詳細設定という責務分離に寄せる
- `primaryLang` は必須設定
- `secondaryLang` は空値を許容し、未設定時はブラウザ言語を使う
- UI では `textTracks` の生データを直接表示しない

### 2.2 `primaryLang` の意味

`primaryLang` は「学習したい主字幕言語」を表します。

想定フロー:

- popup または options でユーザーが設定
- 例: `primaryLang = "en"`、`secondaryLang = ""`
- `chrome.storage.sync` に保存
- `content.js` がそれを読み込み、再生中の字幕処理に反映する

### 2.3 `secondaryLang` の意味

`secondaryLang` は「補助表示に使う言語」を表します。

- 値が設定されていれば、その言語を優先する
- 空値なら、content 側でブラウザ言語 fallback を適用する
- UI 上では `secondaryLang` に「ブラウザ言語を使う」を明示する

### 2.4 今回の整理対象

- popup / options の言語候補を固定一覧ベースへ変更する（Issue #6 完了済み）
- forced 字幕は設定 UI の直接候補に出さない
- `secondaryLang` の空値許容を前提に UI を整理する（Issue #7 と関連）
- `textTracks` の厳密な正規化や resolver 導入は、段階的に進める

### 2.5 `content.js` 側の責務境界

popup / options の役割は「設定値を保存すること」であり、再生中の字幕トラック解決ロジックは `content.js` 側の責務とする。

#### `content.js` で扱う責務

1. 設定値の読込
2. `textTracks` の正規化
3. primary / secondary 用トラックの resolver
4. current / history / future の描画
5. 動画レイヤー上への UI 注入と再配置

#### 設定 UI との境界

- popup / options は固定言語一覧のみを表示する
- UI では `textTracks` の生データや `forced` 付き候補を直接見せない
- `secondaryLang` が空値の場合のブラウザ言語 fallback は `content.js` 側で適用する
- どの track を最終的に採用するかは `content.js` 側の resolver で決定する

### 2.6 `textTracks` 処理と WebVTT 正規化

Apple TV+ の `textTracks` には、同一言語でも通常字幕・captions・forced など複数種が混在する可能性がある。  
そのため、設定 UI では単純な言語選択だけを扱い、実際のトラック選択とテキスト正規化は `content.js` 側で段階的に解決する。

#### 解決方針

- UI 層では「1 言語 = 1 候補」として扱う
- `content.js` 側で `textTracks` を正規化する
- resolver は、同一言語候補に対して優先順位ベースで最終採用 track を決定する
- 優先順位は「通常字幕 → captions → forced」を基本とする
- forced 字幕は UI の直接候補には出さないが、通常候補が存在しない場合の内部 fallback 候補としては保持する
- WebVTT の cue テキストから `<c.styledotitalic>` のようなタグ断片は除去する
- 正規化後の観測は、F12 Console の補助ログではなく、右字幕パネル下部の Debug セクションに表示される
  - `tracks resolved`
  - `Selected tracks detail`
  - `primaryTrackFound`
  - `secondaryTrackFound`
    を主導線として確認する

### 2.7 `primaryLang` 非英語時の切り分け結果（#18）

Issue #18 では、`primaryLang` を英語以外（de / ja / zh / ko / fr / es）に設定した場合に主字幕が表示されない問題を、Phase 3 の範囲で切り分けた。

#### Phase 3 で確認できたこと

- resolver レイヤーでは、`primaryLang = de / ja / zh / ko / fr / es` でも `primaryTrackFound: true` になることを確認した
- `subtitle-track-resolver.js` では、underscore 区切りの正規化と主要 3 文字コードの 2 文字コード寄せを追加した
  - `deu -> de`
  - `jpn -> ja`
  - `zho` / `chi -> zh`
  - `kor -> ko`
  - `fra` / `fre -> fr`
  - `spa -> es`
- `content.js` 側では、`primaryActiveCues` / `hasFreshPrimarySnapshot` / `lastPrimarySnapshotAt` を使った live 優先 + snapshot 鮮度付きの primary signal 判定へ整理した
- Debug ログ上では、`primaryCueTextLength > 0` / `snapshotPrimaryTextLength > 0` が観測でき、primary cue / text / snapshot までは live で取得できている

#### Phase 3 で残ったこと

- 右字幕パネルの primary 行には、依然として未表示のケースが残る
- つまり、resolver / `content.js` の signal レイヤーではなく、binder / sidebar / `renderPanel` 側の UI 層に残課題がある
- この残課題は、Phase D の Issue #19 で扱う

### 2.8 設定ライフサイクルの理想図（#14 前提）

#### 主トリガー

- 設定適用の主トリガーは **設定変更時** と **動画ページ初期化時** の 2 つとする
- ページ離脱時は「必要最小限のクリーンアップ」に留め、設定反映の主トリガーにはしない

#### fallback 方針

- `secondaryLang = ""` の場合は、content 側でブラウザ言語 fallback を適用する
- fallback 適用後の値で resolver を実行し、最終採用 track を決定する
- 観測時は、保存値（`requestedSecondaryLang`）・解決値（`resolvedSecondaryLanguage`）・実使用値（`effectiveSecondaryLanguage`）を分けて追える前提とする

#### 責務境界

- popup / options: 設定値の入力・保存（`chrome.storage.sync`）
- background: 必要な通知・外部連携の橋渡し
- content: 設定読込、fallback 適用、resolver 実行、再生中 UI への反映
- どの track を採用するかの最終判断は content 側で行う

#### 動画ページ間移動時の方針

- 動画ページ間移動時は、直近の反映済み設定を保持したまま次の初期化へ引き継ぐ
- 離脱イベントで「設定を戻す」前提ではなく、次の初期化で必要差分のみ再適用する

#### 擬似フロー

設定変更時フロー:

```text
popup/options で設定保存
  -> storage.sync 更新
  -> （必要なら）background 経由で content へ通知
  -> content が設定を再読込
  -> secondaryLang が空ならブラウザ言語 fallback
  -> resolver 実行
  -> UI へ再適用
```

動画ページ初期化時フロー:

```text
content 初期化
  -> storage.sync から設定読込
  -> secondaryLang が空ならブラウザ言語 fallback
  -> resolver 実行
  -> UI 初期描画
```

ページ離脱時フロー（非主経路）:

```text
ページ離脱検知
  -> listener / timer / observer を必要最小限で解放
  -> 設定値そのものは storage 側を変更しない
  -> 次回の初期化時フローで再適用
```

---

## 3. レイアウト確定事項

### 3.1 右字幕パネル

- 履歴一覧を残す
- 各字幕ブロックは 2 行表示
  - 1 行目: primary
  - 2 行目: secondary
- 右字幕パネルは、上から
  1. 固定ヘッダー（`字幕履歴` / `⚙️` / `閉じる✕`）
  2. 固定 debug ログセクション
  3. 字幕一覧のスクロール領域（history / current / future）
     の 3 層構造を維持する
- current の表現は、**字幕本文の強調ではなく左側の固定幅マーク欄**を基本とする
- 字幕行は `[mark][subtitle text]` の 2 カラム構造とし、マークが出ても字幕本文の列位置はずれないようにする
- current のときだけ左側マーク欄に `▶` などの再生マークを表示する
- past / current / future の字幕本文は、**色・背景・文字サイズをすべて同一**とする
- current の背景塗り、強い黄色強調、全体グレーアウトは行わない
- current / history / future のテキストは、ユーザーが選択・コピー可能な DOM のまま維持する
- debug ログセクションはヘッダー直下に固定されたままとし、折りたたみ時は 1 行、展開時は数行のログ本文を表示できる状態を維持する
- 履歴ブロックをクリックしてシークできる現機能は維持する
- #17 は実装済み。settings / debug の新導線は追加せず、既存 UI と `window.ATVB.settingsBridge` / `window.ATVB.debugPanel` / `window.ATVB.logger` を再利用する

#### 字幕スクロール領域の挙動

- 通常時は字幕リストを動かさない
- 再生位置の変化に応じて、**再生マークだけ** current 行へ移動する
- current が字幕パネル下部のしきい値（下から 1〜2 件前）まで来た時だけ、字幕リストを上へスクロールする
- スクロール量は最小限とし、毎 cue ごとの細かいスムーススクロールは行わない
- current を常に中央付近へ寄せる方式は採用しない
- 動きの主役は「字幕の強調」ではなく「マーク移動 + 必要時のみ最小スクロール」とする

```text
┌────────────────────────────────────────────┐
│ 字幕履歴                         [⚙️][閉じる✕] │
├────────────────────────────────────────────┤
│ デバッグログ（開発者向け）              ▶︎ │
├────────────────────────────────────────────┤
│ [    ]  12:03                             │
│        I mean, it sounds weird.           │
│        つまり、変に聞こえるけど。          │
│                                            │
│ [ ▶ ]  12:05                             │
│        but it's still like making a baby. │
│        でもそれはまだ赤ちゃんを育てるようなもの。│
│                                            │
│ [    ]  12:07                             │
│        You have to keep feeding it.       │
│        ずっと面倒を見ないといけない。       │
└────────────────────────────────────────────┘
```

### 3.2 Phase D の実装結果（#19）

Issue #19 では、Phase 3 の #18 で残った **binder / sidebar / `renderPanel` 側の非対称** を扱い、Phase D として解消した。

#### 実装で確定したこと

- primary track は `showing` で運用し、non-en primary（zh / ko / fr / de / es）でも cue 可用性を確保する
- `video::cue` 非表示（`overlay.css`）を維持し、ネイティブ字幕の二重表示を防ぐ
- `primary = state.primaryTrack` / `secondary = state.secondaryTrack` の責務分離を維持する
- `findCueAt` の `track.cues` 参照を保護し、mode 遷移時の cue 探索を堅牢化する
- panel shell は `panel.css` 外だしと `buildPanelShellHTML` / `buildPanelDebugShellHTML` 分離で整理済み
- resolver の言語一致仕様 / `secondaryLang` fallback / #17 の current 行モデル（左マーク欄 + threshold-scroll）は変更しない

#### Phase D で確認済みの認識

- primary track / cue / text / snapshot は Debug ログ上で live に存在している
- それにもかかわらず、右パネルでは primary 行が空のままになるケースがある
- secondary 側だけが current を持ち続ける構造が残っている

#### Phase D で見直す対象

- binder / sidebar / `renderPanel` の責務整理
- primary / secondary cue を current / history / future に反映する順序
- primary cue が live で存在する場合に、必ず primary 行へ描画する条件
- `lastPanelRenderSnapshot` や history / future の保持ロジックの一貫性

#### Phase D で変えないもの

- #17 で確定した current 行 + 左マーク欄 + threshold-scroll の表示モデル
- resolver の言語一致仕様
- `secondaryLang` fallback の仕様
- `content.js` 全面分割のロードマップ

### 3.3 Phase E の設計メモ

Phase E では、Phase D までで整理した UI 表示仕様を崩さずに、`content.js` の責務境界を明示しながら最終整理を進める。

#### Phase E の基本方針

- 最初の一手は、**コード整備を含めた「挙動を変えない責務整理」**とする
- UI shell と binder / cue logic を同じ差分で同時に大きく触らない
- panel / debug / overlay / subtitle popup は UI shell として扱う
- track binding / cue handling / history / current row 連携は binder / cue logic として扱う
- `ResizeObserver` / `MutationObserver` / timer / retry / bootstrap はさらに後段で整理する
- 最終的に `content.js` は bootstrap 的な薄い入口に寄せる

#### Phase E で維持すること

- #17 の current 行 + 左マーク欄 + threshold-scroll モデル
- #19 で確定した primary / secondary 表示責務
- resolver の言語一致仕様
- `secondaryLang` fallback
- panel / overlay / subtitle popup の見た目と close 挙動
- デバッグログ観測導線

#### Phase E で先に進めること

- panel / debug / overlay / popup の template / shell / event wiring の責務整理
- `createRightPanel()` / `createOverlay()` / `createPopupHost()` のような create 系エントリ関数の薄化
- `buildPanelShellHTML()` / `buildPanelDebugShellHTML()` と同じ考え方で、長い template を builder 関数へ寄せる
- UI shell / binder-cue / observer-bootstrap の境界をコメントと関数配置で見える化する
- render は shell を新規作成せず、既存 shell へ subtitle history / current state を適用する責務に留める

#### Phase E で後ろに回すこと

- `renderPanel()` の hover / click / scroll ロジックの本格分割
- `onCueChange()` を含む binder / cue logic の整理本体
- layout / observer / bootstrap の最終分離
- popup の辞書入力文字列の正規化仕様（例: アポストロフィの扱い）
- AI タブや辞書 UI の機能拡張本体

### 3.4 設定画面

- `options.html` を別タブで開く
- `options.html` / `options.css` / `options.js` で責務分離する
- ON / OFF はトグルスイッチ中心で整理する
- `primaryLang` は必須
- `secondaryLang` は空値時にブラウザ言語を使う
- popup は簡易設定、options は詳細設定として役割を分ける

```text
┌─────────────────────────────────────────────┐
│ Apple TV+ Bilingual Subtitles        [保存] │
│ 字幕表示や学習補助の設定を行います           │
├─────────────────────────────────────────────┤
│ 基本設定                                    │
│ 勉強している言語   [ 英語 ▼ ]               │
│ 自分の言語         [ ブラウザ言語を使う ▼ ] │
│                                             │
│ 字幕表示                                    │
│ [ON/OFF] 右側の字幕パネルを表示する         │
│ [ON/OFF] 字幕パネルを固定表示する           │
│                                             │
│ 音声                                        │
│ [ON/OFF] 単語クリック時に音声再生           │
│                                             │
│ AIツールチップ                              │
│ [ON/OFF] AI自動翻訳ツールチップ             │
└─────────────────────────────────────────────┘
```

### 3.5 単語ポップアップ

- ヘッダーに単語、音声、設定、閉じるを配置する
- 辞書情報、補助説明、例文を段階的に表示する
- AI は字幕本体の置き換えではなく、学習補助として扱う
- options から AI 関連設定へ導線を持たせる余地を残す
- popup の UI shell 整理と、辞書 / AI タブ拡張本体は分けて進める
- 単語文字列の正規化仕様は、辞書 / AI 機能の入力仕様として別途明示する

---

## 4. options ファイル構成と manifest

### 4.1 推奨ファイル構成

```text
options.html   ← 設定画面のマークアップ
options.css    ← 設定画面の見た目
options.js     ← 設定の読込・保存・状態確認
```

### 4.2 `manifest.json` 側の設定

```json
{
  "version": "2.6.3",
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  }
}
```

- `open_in_tab: true` で設定画面を別タブで開く
- popup や UI 上の `⚙️` からは `chrome.runtime.openOptionsPage()` を使う

---

## 5. AI 補助機能の位置づけ

- AI 表示はあくまで学習補助機能
- 字幕パネル本体の 2 行字幕は AI で置き換えない
- AI 訳は意訳を含むため、公式字幕との差分を補助的に見る用途として扱う
- 設定画面でも、AI は補助であり本字幕置換ではないことを明示する

---

## 6. 再生操作レイヤーと DOM 調整

- 動画本体は 70% 幅、右 30% を字幕パネル専用領域として扱う方針
- Apple TV+ の再生操作 UI が右パネルに重ならないよう、CSS 上書きと DOM 配置を調整する
- 実 DOM / class 名への依存は必要最小限にし、壊れにくい調整を優先する

### 6.1 Issue #3 で反映した確定仕様

- 再生開始直後 / 設定反映直後でも、再生バー・シーク UI・ボタン群が右字幕パネルに隠れないこと
- `.video-player__footer` と `.unified-controls` は同じ基準で補正し、右側重なりを回避すること
- shift 値を保持して再補正時の右戻り（snap-back）を防ぐこと
- `amp-volume-control-unified` は中央寄せせず、字幕パネルに重なる分だけ左へ移動すること
- 常駐監視に依存せず、起動時 / 再起動時の軽量な補正バーストで安定化すること

### 6.2 playback controls 調整の現状と限界

- 調整の目的は、右字幕パネル（`#atv-panel-host` 配下）を表示した状態でも、Apple TV+ 側の playback controls が操作可能な範囲へ収まるようにすること
- 特に `.unified-controls` を可視領域中心へ寄せ、header / footer / progress / volume / skip が字幕パネル裏へ隠れないことを優先した
- 実装上は `content.js` の `adjustPlaybackControlsForPanel` 周辺を段階的に調整し、header / footer の safe area ベース sizing、footer 子要素の shrink 補正、skip overlay の位置補正を加えた
- footer 子要素には `.video-player__metadata` / `.video-player__progress` / `.video-player__tabs` / `.video-player__auto-subs-note` へ `min-width: 0`, `max-width: 100%`, `overflow: hidden`, `flex-shrink: 1` を付与する補正を入れている
- `auto-subs-note` は small resolution で safe area を大きく壊しやすいため、狭い横幅では `display: none` の suppress を許容している

#### 実測で分かったこと

- 大きめのデスクトップ解像度では、`.unified-controls` の center offset は safe area に対してほぼ 0 まで改善し、header / footer / progress も概ね操作可能範囲へ収まる
- 一方で small resolution では、safe area 幅に対して Apple TV+ 側の intrinsic 幅が大きく、`header` / `footer` / `progress` / `controls` の `rightOverflow` が非常に大きくなるケースが残る
- このレンジでは、単なる `width` / `max-width` の制御だけでなく、Apple TV+ 側の flex / grid レイアウト再計算と拡張側の `transform` / inline style 管理が複雑に干渉する
- そのため、最小差分パッチだけでは small resolution 全域で安定した controls layout を保証できないことが確認された

#### 現状の方針

- 一般的なデスクトップ解像度では、right panel ON の状態でも playback controls の操作性は実用範囲内とみなす
- small resolution は既知の制約として扱い、現行版では「layout が崩れる可能性がある」ことを明記する
- 再度この issue を扱う場合は、最小差分パッチの延長ではなく、small resolution 専用のレイアウト分岐や CSS 設計を前提に再検討する

#### 開発者向けメモ

- `adjustPlaybackControlsForPanel` の現在の挙動は、大きめ解像度では問題ない範囲なので、このレンジを壊さないことを優先する
- small resolution を再調整する場合は、Apple TV+ 側 DOM と flex / grid 制約を整理し直してから着手した方がよい
- 調査時は `safeAreaLeft/right/width` と、`header` / `footer` / `progress` / `unified` の rect ログを必ずセットで残すこと

#### TODO: small resolution 再検討時

- small resolution 専用の layout branch を切るか判断する
- footer 子要素の shrink 条件を CSS レベルで再設計する
- `auto-subs-note` の抑制を恒久仕様にするか再評価する

---

## 7. 今後の優先順位

1. #17: `content.js` 側で current ブロックの表示モデルを、**左側マーク欄 + 下端しきい値スクロール方式**へ整理する（完了）
2. #19: Phase D として binder / sidebar 側の primary / secondary 描画非対称を解消する（完了）
3. Phase E: `content.js` の UI shell / binder-cue / layout-observer-bootstrap を順に最終整理する
4. #10: 単語ポップアップ UI 改修と AI タブ拡張、`dictionaryapi.dev` ハンドラ実装

### #17 の対象 / 非対象（完了メモ）

- 対象
  - 右字幕パネル内の current 表示モデル整理
  - 左側固定幅マーク欄の導入
  - 字幕本文を変化させずに current を判別できる構造への整理
  - 通常時はリスト固定、下端しきい値到達時のみ最小スクロールする方式への整理
  - 固定ヘッダー / 固定 debug ログセクション / 字幕スクロール領域の 3 層構造を維持したまま、current を見失いにくくすること
- 非対象
  - current セクション内へのタイトル・エピソード・`primaryLang` / `secondaryLang` / selected track label の追加表示
  - binder / sidebar / observer / bootstrap 分離
  - `settings-bridge.js` / `debug-panel.js` API 変更
  - resolver / fallback 仕様変更
- 重複回避方針
  - 既存 helper / bridge / logger / debugPanel を再利用する
  - current / history / future のテキストは選択・コピー可能な DOM のまま維持する
  - 新規 timer / observer / listener は追加しない
  - 可能な限り `renderPanel()` 周辺に処理を寄せ、重複分岐を増やさない

### #18 の対象 / 非対象（完了メモ）

- 対象
  - `primaryLang` を英語以外にしたときの主字幕未表示問題を、resolver / primary track recovery / binder / sidebar のどこで signal が欠落しているか切り分けること
  - `subtitle-track-resolver.js` の言語正規化と、`content.js` の primary signal 判定の補強
  - Debug パネル導線で `primaryTrackFound` / `secondaryTrackFound` / selected track detail を追えるようにすること
- 完了したこと
  - resolver / `content.js` の signal レイヤーまでで primary cue が live に存在することを確認
  - `primaryTrackFound: true` / `primaryCueTextLength > 0` / `snapshotPrimaryTextLength > 0` を観測
  - 残課題が binder / sidebar / `renderPanel` 側の UI 層にあることを切り分け
- 非対象
  - #17 の current 行モデルの変更
  - Phase D / E 相当の広い責務分離
  - layout / observer / bootstrap の整理
- 結果
  - #18 は Phase 3 の切り分け issue として close
  - 残課題は #19 へ移管

### 完了済み（本バッチまで）

- #3: 字幕パネル表示時の動画操作レイヤー重なり解消
- #4: ATV DEBUG の右字幕パネル下部折り畳みセクション統合
- #5: options のデバッグログセクション折り畳み既定化
- #6: popup / options の言語一覧固定化
- #8: Debug ログカテゴリ整理と共通ログ基盤の整合
- #14: 設定ライフサイクル再整理（設定変更時 / 動画初期化時を主トリガー化、離脱時は cleanup 中心）
- #16: Phase C（settings-bridge / debug-panel）の責務分離
- #17: current 行 + 左マーク欄 + threshold-scroll モデルへの移行
- #18: primaryLang 非英語時の主字幕未表示問題の Phase 3 切り分け完了
- #19: binder / sidebar 側の primary cue 非対称解消
- #20: panel / overlay UI shell の責務整理（進行中）

---

## 8. 今回やらないこと

- popup / options / content 間での ES Modules 共有化
- AI タブ拡張や単語ポップアップ刷新の全面対応
- debug 基盤の全面整理
- Phase D / E 相当の広い責務分離を、Phase 3 の issue の中で先回りして進めること
- popup の辞書入力文字列正規化仕様を、Phase E の構造改善と同じ差分で処理すること

`SUPPORTED_LANGS` の共有モジュール化は有効だが、短期的には二重管理のままとし、resolver 整理時またはその後の段階でまとめて検討する。

---

## 9. 文書整理方針

- `docs/dev-roadmap.md` は実装順・issue 追跡用
- `docs/atv-design.md` は設計意図と画面方針の整理用
- `docs/ai-session-templates.md` は AI セッション運用テンプレ整理用
- `docs/contentjs-split-roadmap.md` は `content.js` 分割方針の整理用
- README は利用者向けの概要と導入手順を中心に保つ
