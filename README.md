# Apple TV+ Bilingual Subtitles

Apple TV+ の動画再生画面に**バイリンガル字幕パネル**を追加する Chrome 拡張機能です。

## 機能

- **右パネル** — 字幕の履歴・現在行・未来行を一覧表示
- **オーバーレイ** — 動画左下にプライマリ＋セカンダリ字幕を同時表示
- **単語ポップアップ** — 任意の字幕をクリックすると辞書（Jisho）と AI 翻訳（Google Translate）を表示
- **シーク機能** — 字幕ブロックをクリックするとその時点にジャンプ
- **言語切り替え** — 拡張機能ポップアップから Primary / Secondary 言語を変更可能

## インストール

1. このリポジトリをクローンまたは ZIP でダウンロード
2. `chrome://extensions` を開く
3. 「デベロッパーモード」を ON にする
4. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選択

## 使い方

1. [tv.apple.com](https://tv.apple.com) で動画を再生する
2. 右パネルが自動的に表示される
3. 字幕の単語をクリックすると辞書ポップアップが開く
4. パネル内の **✕ 閉じる** でパネルを非表示、右上の 📋 ボタンで再表示
5. 拡張機能アイコンをクリックすると言語設定を変更できる

## ファイル構成

```
├── manifest.json   拡張機能の設定
├── background.js   Service Worker（外部 API の CORS フリーフェッチ）
├── content.js      メインロジック（UI 注入・字幕制御）
├── overlay.css     コンテンツスクリプト用の最小 CSS
├── popup.html      言語設定ポップアップ UI
└── popup.js        言語設定ポップアップのロジック
```

## 技術メモ

### Top Layer 問題
Apple TV+ は `<dialog class="playback-view">` を使用しており、ブラウザの **Top Layer** に昇格します。  
`document.body` に注入した要素は `z-index` に関わらず `<dialog>` より下に描画されるため、  
すべての UI 要素を `<dialog>` の直接の子として注入することで解決しています。

### CORS 問題
コンテンツスクリプトから `tv.apple.com` 経由で `jisho.org` へ `fetch()` すると CORS でブロックされます。  
`background.js`（Service Worker）経由でフェッチすることで回避しています。

## 動作確認環境

- Chrome 124+
- Apple TV+ (tv.apple.com)
