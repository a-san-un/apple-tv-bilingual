# Apple TV+ Bilingual Subtitles v2.5-dev 設計まとめ

この文書は、Apple TV+ Bilingual Subtitles v2.5-dev の現状コードで確認できたこと、合意済み仕様、今後の整理方針をまとめた設計メモです。

---

## 1. 現状コードで確認できたこと

### 1.1 現在の構成

- Chrome 拡張 Manifest V3
- `background.js`: 外部 API 通信用 Service Worker
- `content.js`: Apple TV+ 再生画面へ UI を注入するメインロジック
- `popup.html` / `popup.js`: 簡易設定 UI
- `options.html` / `options.css` / `options.js`: 別タブの詳細設定画面 [page:1]
- `manifest.json` の現バージョンは `2.5.2` [page:1]

### 1.2 字幕 UI の現状

- 動画コンテナは 70% 幅を基準に扱い、右側 30% を字幕パネル領域として使う方針
- 右パネルは「履歴 + 現在 + 未来」の一覧型
- 各字幕ブロックは primary / secondary の 2 行表示
- 左下オーバーレイにも現在字幕の 2 行表示
- パネルは `✕` で閉じ、閉じた時だけ右上の再表示ボタンで開く構成

### 1.3 単語ポップアップの現状

- 辞書系 UI と AI 系 UI を段階的に整理中
- 辞書連携は Jisho / Tatoeba / dictionaryapi.dev などを含む構成
- AI 補助表示は今後の拡張対象
- 字幕本体の 2 行表示と、学習補助ポップアップは役割を分けて扱う

### 1.4 言語設定の現状

- `primaryLang` / `secondaryLang` などの一般設定は `chrome.storage.sync` に保存する設計 [cite:3]
- API キーと debug logs は `chrome.storage.local` に保存する設計 [cite:3]
- 既定値は `primaryLang = "en"`、`secondaryLang = ""` [cite:3]
- `secondaryLang` が空の場合はブラウザ言語 fallback を前提に扱う [cite:3]
- popup / options の言語候補は、動画ごとの `textTracks` 生データではなく、固定言語一覧ベースへ整理する方針 [cite:4][cite:2]

---

## 2. 言語設定の設計方針

### 2.1 基本方針

- 設定導線は popup だけに閉じず、`options.html` を別タブで開く構成を主軸にする [page:1]
- popup は簡易設定、options は詳細設定という責務分離に寄せる
- `primaryLang` は必須設定
- `secondaryLang` は空値を許容し、未設定時はブラウザ言語を使う [cite:3]
- UI では `textTracks` の生データを直接表示しない [cite:4]

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
- 空値なら、content 側でブラウザ言語 fallback を適用する想定 [cite:3]
- UI 上では `secondaryLang` に「ブラウザ言語を使う」を明示する

### 2.4 今回の整理対象

- popup / options の言語候補を固定一覧ベースへ変更する
- forced 字幕は設定 UI の直接候補に出さない
- `secondaryLang` の空値許容を前提に UI を整理する
- `textTracks` の厳密な正規化や resolver 導入は今回の対象外とし、後続タスクへ切り分ける [page:2]

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
- `options.html` / `options.css` / `options.js` で責務分離する [page:1]
- ON/OFF はトグルスイッチ中心で整理する
- `primaryLang` は必須
- `secondaryLang` は空値時にブラウザ言語を使う [cite:3]
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
  "version": "2.5.2",
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  }
}
```

- `open_in_tab: true` で設定画面を別タブで開く [page:1]
- popup や UI 上の `⚙️` からは `chrome.runtime.openOptionsPage()` を使う [cite:2]

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

---

## 7. 今後の優先順位

1. #6: popup / options の字幕言語一覧を固定一覧ベースへ整理する [page:2]
2. #7: `secondaryLang` 空値許容とブラウザ言語 fallback 前提の UI 整理を進める [page:2]
3. #3: 右パネルと動画操作レイヤーの重なりを調整する [page:2]
4. #9: `content.js` の current 表示強化を後続タスクとして進める [page:2]
5. #10: 単語ポップアップ UI 改修と AI タブ拡張を後続タスクとして進める [web:2]

---

## 8. 文書整理方針

- `docs/v2.5-dev-roadmap.md` は実装順・issue 追跡用
- `docs/atv-v25-design.md` は設計意図と画面方針の整理用
- README は利用者向けの概要と導入手順を中心に保つ
