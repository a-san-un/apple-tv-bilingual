# Apple TV+ Bilingual Subtitles phase-2 設計まとめ

この文書は、Apple TV+ Bilingual Subtitles phase-2（v2.6.3）の現状コードで確認できたこと、合意済み仕様、今後の整理方針をまとめた設計メモです。

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

### 1.3 単語ポップアップの現状

- 辞書系 UI と AI 系 UI を段階的に整理中
- 辞書連携は Jisho / Tatoeba / dictionaryapi.dev などを含む構成
- AI 補助表示は今後の拡張対象
- 字幕本体の 2 行表示と、学習補助ポップアップは役割を分けて扱う

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

popup / options の役割は「設定値を保存すること」であり、再生中の字幕トラック解決ロジックは content.js 側の責務とする。

#### content.js で扱う責務

1. 設定値の読込
2. `textTracks` の正規化
3. primary / secondary 用トラックの resolver
4. current / history / future の描画
5. 動画レイヤー上への UI 注入と再配置

#### 設定 UI との境界

- popup / options は固定言語一覧のみを表示する
- UI では `textTracks` の生データや `forced` 付き候補を直接見せない
- `secondaryLang` が空値の場合のブラウザ言語 fallback は content.js 側で適用する
- どの track を最終的に採用するかは content.js 側の resolver で決定する

### 2.6 `textTracks` 処理と WebVTT 正規化

Apple TV+ の `textTracks` には、同一言語でも通常字幕・captions・forced など複数種が混在する可能性がある。  
そのため、設定 UI では単純な言語選択だけを扱い、実際のトラック選択とテキスト正規化は content.js 側で段階的に解決する。

#### 解決方針

- UI 層では「1 言語 = 1 候補」として扱う
- content.js 側で `textTracks` を正規化する
- resolver は、同一言語候補に対して優先順位ベースで最終採用 track を決定する
- 優先順位は「通常字幕 → captions → forced」を基本とする
- forced 字幕は UI の直接候補には出さないが、通常候補が存在しない場合の内部 fallback 候補としては保持する
- WebVTT の cue テキストから `<c.styledotitalic>` のようなタグ断片は除去し、
  - 画面表示上も
  - F12 Console での `__atvbDumpTracks()` の `hasTag: false` でも
    正規化済みであることを確認済み

### 2.7 設定ライフサイクルの理想図（#14 前提）

#### 主トリガー

- 設定適用の主トリガーは **設定変更時** と **動画ページ初期化時** の 2 つとする。
- ページ離脱時は「必要最小限のクリーンアップ」に留め、設定反映の主トリガーにはしない。

#### fallback 方針

- `secondaryLang = ""` の場合は、content 側でブラウザ言語 fallback を適用する。
- fallback 適用後の値で resolver を実行し、最終採用 track を決定する。
- 観測時は、保存値（`requestedSecondaryLang`）・解決値（`resolvedSecondaryLanguage`）・実使用値（`effectiveSecondaryLanguage`）を分けて追える前提とする。

#### 責務境界

- popup / options: 設定値の入力・保存（`chrome.storage.sync`）
- background: 必要な通知・外部連携の橋渡し
- content: 設定読込、fallback 適用、resolver 実行、再生中 UI への反映
- どの track を採用するかの最終判断は content 側で行う。

#### 動画ページ間移動時の方針

- 動画ページ間移動時は、直近の反映済み設定を保持したまま次の初期化へ引き継ぐ。
- 離脱イベントで「設定を戻す」前提ではなく、次の初期化で必要差分のみ再適用する。

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
- 各ブロックは 2 行表示
  - 1 行目: primary
  - 2 行目: secondary
- current 行は視覚的に強調する
- 履歴ブロックをクリックしてシークできる現機能は維持する

```text
┌────────────────────────────────────┐
│ 字幕履歴                    [⚙️][✕] │
├────────────────────────────────────┤
│ 12:03                              │
│ I mean, it sounds weird.           │
│ つまり、変に聞こえるけど。          │
│                                    │
│ ▶ 再生中 [⏵]                       │
│ but it's still like making a baby. │
│ でもそれはまだ赤ちゃんを育てるようなもの。│
│                                    │
│ 12:07                              │
│ You have to keep feeding it.       │
│ ずっと面倒を見ないといけない。       │
└────────────────────────────────────┘
```

### 3.2 設定画面

- `options.html` を別タブで開く
- `options.html` / `options.css` / `options.js` で責務分離する
- ON/OFF はトグルスイッチ中心で整理する
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

### 3.3 単語ポップアップ

- ヘッダーに単語、音声、設定、閉じるを配置
- 辞書情報、補助説明、例文を段階的に表示する
- AI は字幕本体の置き換えではなく、学習補助として扱う
- options から AI 関連設定へ導線を持たせる余地を残す

---

## 4. options ファイル構成と manifest

### 4.1 推奨ファイル構成

```text
options.html   ← 設定画面のマークアップ
options.css    ← 設定画面の見た目
options.js     ← 設定の読込・保存・状態確認
```

### 4.2 manifest.json 側の設定

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

- 再生開始直後 / 設定反映直後でも、再生バー・シーク UI・ボタン群が右字幕パネルに隠れないこと。
- `.video-player__footer` と `.unified-controls` は同じ基準で補正し、右側重なりを回避すること。
- shift 値を保持して再補正時の右戻り（snap-back）を防ぐこと。
- `amp-volume-control-unified` は中央寄せせず、字幕パネルに重なる分だけ左へ移動すること。
- 常駐監視に依存せず、起動時 / 再起動時の軽量な補正バーストで安定化すること。

### 6.2 playback controls 調整の現状と限界

- 調整の目的は、右字幕パネル（`#atv-panel-host` 配下）を表示した状態でも、Apple TV+ 側の playback controls が操作可能な範囲へ収まるようにすること。
- 特に `.unified-controls` を可視領域中心へ寄せ、header / footer / progress / volume / skip が字幕パネル裏へ隠れないことを優先した。
- 実装上は `content.js` の `adjustPlaybackControlsForPanel` 周辺を段階的に調整し、header / footer の safe area ベース sizing、footer 子要素の shrink 補正、skip overlay の位置補正を加えた。
- footer 子要素には `.video-player__metadata` / `.video-player__progress` / `.video-player__tabs` / `.video-player__auto-subs-note` へ `min-width: 0`, `max-width: 100%`, `overflow: hidden`, `flex-shrink: 1` を付与する補正を入れている。
- `auto-subs-note` は small resolution で safe area を大きく壊しやすいため、狭い横幅では `display: none` の suppress を許容している。

#### 実測で分かったこと

- 大きめのデスクトップ解像度では、`.unified-controls` の center offset は safe area に対してほぼ 0 まで改善し、header / footer / progress も概ね操作可能範囲へ収まる。
- 一方で small resolution では、safe area 幅に対して Apple TV+ 側の intrinsic 幅が大きく、`header` / `footer` / `progress` / `controls` の `rightOverflow` が非常に大きくなるケースが残る。
- このレンジでは、単なる width/max-width の制御だけでなく、Apple TV+ 側の flex / grid レイアウト再計算と拡張側の transform / inline style 管理が複雑に干渉する。
- そのため、最小差分パッチだけでは small resolution 全域で安定した controls layout を保証できないことが確認された。

#### 現状の方針

- 一般的なデスクトップ解像度では、right panel ON の状態でも playback controls の操作性は実用範囲内とみなす。
- small resolution は既知の制約として扱い、現行版では「layout が崩れる可能性がある」ことを明記する。
- 再度この issue を扱う場合は、最小差分パッチの延長ではなく、small resolution 専用のレイアウト分岐や CSS 設計を前提に再検討する。

#### 開発者向けメモ

- `adjustPlaybackControlsForPanel` の現在の挙動は、大きめ解像度では問題ない範囲なので、このレンジを壊さないことを優先する。
- small resolution を再調整する場合は、Apple TV+ 側 DOM と flex / grid 制約を整理し直してから着手した方がよい。
- 調査時は `safeAreaLeft/right/width` と、`header` / `footer` / `progress` / `unified` の rect ログを必ずセットで残すこと。

#### TODO: small resolution 再検討時

- small resolution 専用の layout branch を切るか判断する。
- footer 子要素の shrink 条件を CSS レベルで再設計する。
- `auto-subs-note` の抑制を恒久仕様にするか再評価する。

---

## 7. 今後の優先順位

1. #9: `content.js` 側で current 表示強化（タイトル・トラック情報の常時表示）
2. Phase D: binder / sidebar の責務分離
3. Phase E: layout / observer / bootstrap の最終整理
4. #10: 単語ポップアップ UI 改修と AI タブ拡張、dictionaryapi.dev ハンドラ実装

### 完了済み（本バッチまで）

- #3: 字幕パネル表示時の動画操作レイヤー重なり解消
- #4: ATV DEBUG の右字幕パネル下部折り畳みセクション統合
- #5: options のデバッグログセクション折り畳み既定化
- #6: popup / options の言語一覧固定化
- #14: 設定ライフサイクル再整理（設定変更時 / 動画初期化時を主トリガー化、離脱時は cleanup 中心）
- #8: Debug ログカテゴリ整理と共通ログ基盤の整合（Clear 挙動含む）
- #16: Phase C（settings-bridge / debug-panel）の責務分離

---

## 8. 今回やらないこと

- popup / options / content 間での ES Modules 共有化
- AI タブ拡張や単語ポップアップ刷新の全面対応
- debug 基盤の全面整理

`SUPPORTED_LANGS` の共有モジュール化は有効だが、短期的には二重管理のままとし、resolver 整理時またはその後の段階でまとめて検討する。

---

## 9. 文書整理方針

- `docs/dev-roadmap.md` は実装順・issue 追跡用
- `docs/atv-design.md` は設計意図と画面方針の整理用
- README は利用者向けの概要と導入手順を中心に保つ
