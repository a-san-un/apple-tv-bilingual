# Apple TV+ Bilingual Subtitles

Apple TV+ の動画再生画面に、**バイリンガル字幕パネル**と学習補助 UI を追加する Chrome 拡張機能です。

## 機能

- **右パネル**
  - 字幕の履歴・現在行・未来行を一覧表示
  - primary / secondary の 2 行字幕を見やすく表示
  - 字幕ブロックをクリックしてその時点へシーク可能

- **補助オーバーレイ（パネル非表示時）**
  - 右字幕パネルを閉じたときのみ、動画上で primary / secondary 字幕を同時表示

- **単語ポップアップ**
  - 字幕テキストをクリックすると辞書ポップアップを表示
  - Jisho / Tatoeba / dictionaryapi.dev などを使った学習補助を提供
  - AI 補助表示は将来拡張を見据えて段階的に整理中

- **言語設定**
  - 拡張機能 popup から Primary / Secondary 言語を簡易的に変更可能
  - options ページから詳細設定を変更可能
  - `primaryLang` は必須設定
  - `secondaryLang` は空値保存を許容し、未設定時はブラウザ言語を補助表示に使う想定

- **設定画面**
  - `options.html` を別タブで開く構成
  - 字幕表示、音声、AI 補助、デバッグ関連をまとめて管理

## インストール

1. このリポジトリをクローン、または ZIP でダウンロードします
2. `chrome://extensions` を開きます
3. 「デベロッパーモード」を ON にします
4. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選択します

## 使い方

1. [tv.apple.com](https://tv.apple.com) で動画を再生します
2. 右側の字幕パネルが表示されます
3. 字幕の単語や行をクリックして、辞書表示やシークを使います
4. 拡張機能アイコン（popup）から、primary / secondary 言語を変更します
   - popup で保存した設定は、**現在アクティブな Apple TV+ 再生タブに即座に通知されます**
5. 詳細設定は options ページから変更します

- options から保存した設定も、**アクティブな Apple TV+ 再生タブへ即時反映**されます

## ファイル構成

```text
├── manifest.json      拡張機能の設定
├── background.js      Service Worker（外部 API 通信）
├── content.js         メインロジック（UI 注入・字幕制御）
├── overlay.css        コンテンツスクリプト用の最小 CSS
├── popup.html         言語設定 popup UI
├── popup.js           言語設定 popup のロジック
├── options.html       詳細設定画面
├── options.css        詳細設定画面のスタイル
├── options.js         詳細設定画面のロジック
└── dict/ejdict.json   辞書データ
```

## 技術メモ

### Top Layer 問題

Apple TV+ は動画要素まわりで特殊なレイヤー構造を持つため、通常の `document.body` 直下へ注入した UI が想定どおり前面に出ないことがあります。  
そのため、動画 UI と干渉しにくい位置へ要素を注入し、字幕パネルと操作レイヤーの重なりを避ける設計を採用しています。

### 再生コントロール安定化（Issue #3）

右字幕パネル表示中に、再生バーや操作ボタンが右パネルへ隠れたり、再生直後に左右へチラつく問題を修正しました。  
起動時 / 設定反映時の軽量な補正バーストで位置を安定化し、`footer` / `unified-controls` / `volume` を同一基準で補正します。  
音量 UI は中央寄せではなく、右字幕パネルとの重なり分だけ移動する挙動に調整しています。

### CORS 問題

コンテンツスクリプトから外部辞書 API へ直接 `fetch()` すると、CORS 制約でブロックされることがあります。  
そのため、必要な通信は `background.js` 側の Service Worker 経由で扱います。

### Service Worker 停止問題

Manifest V3 の Service Worker はアイドル時に自動停止します。  
停止中にメッセージが届くケースを考慮し、再送やフォールバックを含めた扱いを段階的に整理しています。

## 現在の整理方針

- popup / options の字幕言語一覧は、動画の `textTracks` に直接依存しない **固定言語一覧** ベースで扱う
- `secondaryLang` の空値を許容し、未設定時はブラウザ言語 fallback を前提にする
- Apple TV+ 側の `textTracks` は content.js 側で正規化し、
  - 設定された `primaryLang` / `secondaryLang` に近いトラックを resolver が選択する
  - forced 字幕は UI の直接候補には出さず、必要に応じて内部 fallback として扱う
- WebVTT の字幕テキストに含まれる `<c.styledotitalic>` などのタグ断片は、正規化処理で除去する  
  （画面表示・実機ログの両方で確認済み）

## 動作確認環境

- Chrome 124+
- Apple TV+ (`tv.apple.com`)

## バージョン

- Current: `2.6.0`
