# Apple TV+ Bilingual Subtitles 設計まとめ

この文書は、Apple TV+ Bilingual Subtitles の **現行仕様・責務境界・UI 方針** を整理した設計書である。

この文書で扱うもの:

- 現状コードで確定している UI / 表示 / 設定の仕様
- 今後も維持したい責務境界
- `content.js` 内の各レイヤーをどう捉えるか
- unconfigured flow を含む表示条件の考え方

この文書で扱わないもの:

- issue の進捗・完了状態の正本管理
- `content.js` 分割の段階順や実装バッチの詳細
- AI セッション運用テンプレ

正本の位置づけ:

- 実装順や issue の進捗管理は `docs/dev-roadmap.md` を正本とする
- `content.js` 分割の段階方針や安全策は `docs/contentjs-split-roadmap.md` に寄せる
- AI セッションの依頼テンプレは `docs/ai-session-templates.md` に寄せる
- この文書は、現行仕様・責務境界・UI 方針の正本とする

---

## 1. システム全体像

### 1.1 現在の構成

- Chrome 拡張 Manifest V3
- `background.js`: 外部 API 通信用 Service Worker
- `content.js`: Apple TV+ 再生画面へ UI を注入するメインロジック
- `popup.html` / `popup.js`: 簡易設定 UI
- `options.html` / `options.css` / `options.js`: 別タブの詳細設定画面
- 現行バージョン表記は phase-3 系列の設計を前提とする

### 1.2 コンポーネントの責務

- popup / options は「設定値を入力・保存する UI」
- background は通知や外部連携の橋渡し
- content は設定読込、fallback 適用、字幕 track 解決、再生中 UI への反映を担当する
- 実際にどの字幕 track を採用するかの最終判断は `content.js` 側で行う

### 1.3 用語整理

- `popup` は文脈によって 2 種類ある
  - **extension popup**: ブラウザ拡張の popup UI（`popup.html` / `popup.js`）
  - **subtitle popup**: 字幕上で単語クリック時に出る辞書 / AI 補助 popup
- この文書で単に `popup` と書く場合、混乱しやすい箇所では **subtitle popup** / **extension popup** を明示する

---

## 2. 言語設定と適用責務

### 2.1 基本方針

- popup は簡易設定、options は詳細設定という役割分担に寄せる
- `primaryLang` は必須設定
- `secondaryLang` は空値を許容する
- `secondaryLang = ""` の場合は、content 側でブラウザ言語 fallback を適用する
- 設定 UI では `textTracks` の生データを直接表示しない
- popup / options の言語候補は、動画依存の `textTracks` ではなく固定言語一覧ベースで扱う

### 2.2 設定値の意味

#### `primaryLang`

`primaryLang` は「学習したい主字幕言語」を表す。

- popup または options で設定する
- `chrome.storage.sync` に保存する
- `content.js` が読み込んで再生中の字幕処理へ反映する

#### `secondaryLang`

`secondaryLang` は「補助表示に使う言語」を表す。

- 値が設定されていれば、その言語を優先する
- 空値なら、content 側でブラウザ言語 fallback を適用する
- UI 上では「ブラウザ言語を使う」を明示する

### 2.3 設定ライフサイクル

#### 主トリガー

- 設定適用の主トリガーは **設定変更時** と **動画ページ初期化時**
- ページ離脱時は、設定反映ではなく必要最小限の cleanup を主目的とする

### 2.4 `content.js` 側の責務

`content.js` で扱うこと:

1. 設定値の読込
2. `textTracks` の正規化
3. primary / secondary 用 track の resolver
4. current / history / future の描画
5. 動画レイヤー上への UI 注入と再配置

### 2.5 `textTracks` と WebVTT 正規化

- UI 層では「1 言語 = 1 候補」として扱う
- `content.js` 側で `textTracks` を正規化する
- resolver は優先順位ベースで最終採用 track を決定する
- 基本優先順位は「通常字幕 → captions → forced」
- forced 字幕は UI の直接候補には出さないが、通常候補がない場合の内部 fallback 候補として保持する

---

## 3. 字幕 UI の基本設計

### 3.1 全体レイアウト

- 動画コンテナは 70% 幅を基準に扱い、右側 30% を字幕パネル領域として使う方針
- 右パネルは「履歴 + 現在 + 未来」の一覧型
- 各字幕ブロックは primary / secondary の 2 行表示
- 左下 overlay は、右字幕パネルを閉じたときの補助表示として現在字幕 2 行を表示する
- パネルは `✕` で閉じ、閉じた時だけ右上の再表示ボタンで開く構成を基本とする

### 3.2 右字幕パネル

- 履歴一覧を残す
- 各字幕ブロックは 2 行表示
  - 1 行目: primary
  - 2 行目: secondary
- 右字幕パネルは、上から次の 3 層構造を維持する
  1. 固定ヘッダー（`字幕履歴` / `⚙️` / `閉じる✕`）
  2. 固定 debug ログセクション
  3. 字幕一覧のスクロール領域（history / current / future）

### 3.3 current 行モデル

- current 表示は、**独立 current ブロック強調** ではなく **字幕一覧内の current 行 + 左側固定幅マーク欄** を基本モデルとする
- 字幕行は `[mark][subtitle text]` の 2 カラム構造とし、マークが出ても字幕本文の列位置はずれないようにする
- current の時だけ左側マーク欄に `▶` などの再生マークを表示する
- past / current / future の字幕本文は、色・背景・文字サイズをすべて同一とする

### 3.4 スクロール挙動

- 通常時は字幕リストを動かさない
- 再生位置の変化に応じて、**再生マークだけ** current 行へ移動する
- current が字幕パネル下部のしきい値まで来た時だけ、字幕リストを上へスクロールする
- スクロール量は最小限とし、毎 cue ごとの細かいスムーススクロールは行わない

### 3.5 overlay

- 左下 overlay は、右字幕パネルを閉じたときの補助字幕表示として扱う
- overlay の表示責務と panel の表示責務は分けて考える
- overlay は subtitle shell の一部として扱うが、panel と同じ表示条件にはしない
- overlay 上の単語クリック処理は event delegation ベースで扱う
- overlay は primary / secondary の 2 行表示を維持する
- overlay の host / shadow / shell / wiring の責務境界は維持する
- Issue #23 では、overlay の表示 / 非表示条件や binder / resolver / observer の仕様は変更しない
- Issue #23 では、`buildOverlayShellHTML()` と `createOverlay()` を中心に shell HTML / inline style を調整し、Apple TV+ のネイティブ字幕に近い見た目へ寄せる

### 3.5.1 overlay の見た目指針

- bottom 位置は、現状よりやや低くし、Apple TV+ ネイティブ字幕に近い下寄せを優先する
- 幅は固定 `70%` / `left: 0` のような左寄せではなく、中央寄せ前提で扱う
- 背景は半透明の黒帯を基本とし、適度な border-radius を持たせる
- primary / secondary の 2 行表示は維持しつつ、行間・上下 padding・行ごとの余白が極端に窮屈または広すぎる状態を避ける
- 必要に応じて text shadow / outline を使って読みやすさを確保するが、過度な装飾は避ける
- z-index / pointer-events の設計は維持し、再生バーや他 UI コンポーネントの操作を阻害しない
- 目標は Apple TV+ ネイティブ字幕との完全一致ではなく、拡張機能としての 2 行表示を保ったまま **違和感の少ない近似** を作ることとする

### 3.6 subtitle popup

- subtitle popup は字幕上の語彙学習用 UI として扱う
- ヘッダーに単語、音声、設定、閉じるを配置する余地を持たせる
- 辞書情報、補助説明、例文、AI 補助タブを段階的に表示する
- 字幕本体の 2 行表示と、学習補助 popup は役割を分ける
- popup の UI shell 整理と、辞書 / AI タブ拡張本体は別フェーズで進める

---

## 4. スコープ管理の考え方

- UI 見た目調整タスクでは、見た目の調整と挙動変更を同じバッチで混ぜない
- overlay の見た目調整では、まず位置・幅・背景・padding・line-height・text shadow などの視覚要素を対象にする
- resolver / cue / binder / observer / bootstrap の仕様変更は、別 issue または別フェーズで扱う
- subtitle popup と overlay は別責務として扱い、同じ「字幕 UI」でも変更対象を混ぜない
