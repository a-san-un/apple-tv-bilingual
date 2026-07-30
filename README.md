# Apple TV+ Bilingual Subtitles

Apple TV+ の動画再生画面に、**バイリンガル字幕パネル**と学習補助 UI を追加する Chrome 拡張機能です。

右側の字幕パネル、動画上の補助オーバーレイ、単語ポップアップ、言語設定 UI を通じて、Apple TV+ を使った字幕学習をしやすくすることを目指しています。

## 機能

### 右パネル

- 字幕の履歴・現在行・未来行を一覧表示
- primary / secondary の 2 行字幕を見やすく表示
- 字幕ブロックをクリックして、その時点へシーク可能

### 補助オーバーレイ

- 右字幕パネルを閉じたときに、動画上へ primary / secondary 字幕を補助表示
- 字幕の current view / hold view をもとに、seek や再同期中でも表示を安定させる方向で整理中

### 単語ポップアップ

- 字幕テキストをクリックすると辞書ポップアップを表示
- Jisho / Tatoeba / dictionaryapi.dev などを使った学習補助を提供
- AI 補助表示は将来拡張を見据えて段階的に整理中

### 言語設定

- 拡張機能 popup から Primary / Secondary 言語を簡易的に変更可能
- popup では primary / secondary の両方を選択したときだけ設定を適用できます
- options ページから詳細設定を変更可能
- 保存した設定は、現在アクティブな Apple TV+ 再生タブへ即時反映されます

### 設定画面

- `options.html` を別タブで開く構成
- 字幕表示、音声、AI 補助、デバッグ関連をまとめて管理

## インストール

1. このリポジトリをクローン、または ZIP でダウンロードします
2. `chrome://extensions` を開きます
3. 「デベロッパーモード」を ON にします
4. 「パッケージ化されていない拡張機能を読み込む」で、このフォルダを選択します

## 使い方

1. 拡張機能アイコン（popup）を開き、primary / secondary 言語を選択して適用します
2. [tv.apple.com](https://tv.apple.com) で動画を再生します
3. 右側の字幕パネルを開きます
4. 字幕の単語や行をクリックして、辞書表示やシークを使います
5. 詳細設定は options ページから変更します

### 設定反映について

- popup から保存した設定は、現在アクティブな Apple TV+ 再生タブに即座に通知されます
- options から保存した設定も、アクティブな Apple TV+ 再生タブへ即時反映されます
- 設定反映の主トリガーは「設定変更時（popup / options）」と「動画初期化時」です
- ページ離脱時は設定再適用の主経路ではなく、cleanup 中心で扱います

## ファイル構成

主要ファイルのみ抜粋:

```text
├── manifest.json
├── background.js
├── content.js
├── cue-controller.js
├── sync-interval-orchestrator.js
├── subtitle-track-resolver.js
├── subtitle-blocks.js
├── subtitle-block-resolver.js
├── subtitle-view-resolver.js
├── overlay-block-resolver.js
├── overlay-controller.js
├── panel-ui.js
├── panel-renderer.js
├── playback-controls-layout.js
├── runtime-observers.js
├── playbackContext.js
├── reinitialize-coordinator.js
├── settings-runtime.js
├── settings-bridge.js
├── vtt-normalizer.js
├── debug-logger.js
├── debug-panel.js
├── popup.html
├── popup.js
├── options.html
├── options.css
├── options.js
├── panel.css
├── overlay.css
├── dict/
└── docs/
```

- `manifest.json`: 拡張機能の設定
- `background.js`: Service Worker（外部 API 通信）
- `content.js`: 再生画面での初期化と全体 coordination
- `cue-controller.js`: 字幕トラック bind、cuechange、block sequence 更新
- `sync-interval-orchestrator.js`: secondary subtitle の recovery / sync interval 制御
- `subtitle-track-resolver.js`: `textTracks` から primary / secondary 候補を解決
- `subtitle-blocks.js`: 字幕ブロックの基礎データ構造
- `subtitle-block-resolver.js`: cue から panel 用 block を解決
- `subtitle-view-resolver.js`: 現在表示用 subtitle view を解決
- `overlay-block-resolver.js`: overlay 用 block を解決
- `overlay-controller.js`: 補助オーバーレイの表示更新と keep / clear 制御
- `panel-ui.js`: 右字幕パネル UI の状態管理
- `panel-renderer.js`: パネル描画
- `playback-controls-layout.js`: Apple TV+ 再生コントロールのレイアウト補正
- `runtime-observers.js`: DOM / playback 状態の監視
- `playbackContext.js`: 再生コンテキスト管理
- `reinitialize-coordinator.js`: 再初期化フローの調停
- `settings-runtime.js`: content 側での設定反映ランタイム
- `settings-bridge.js`: popup / options / content 間の設定連携
- `vtt-normalizer.js`: WebVTT テキストの正規化
- `debug-logger.js`: デバッグログ出力
- `debug-panel.js`: デバッグ UI
- `popup.html` / `popup.js`: 言語設定 popup UI
- `options.html` / `options.js`: 詳細設定画面
- `panel.css` / `overlay.css`: パネルと補助オーバーレイのスタイル
- `dict/`: 辞書データ
- `docs/`: 設計メモ、運用ドキュメント

## 技術メモ

### Top Layer / 再生画面レイヤー

Apple TV+ は動画要素まわりで特殊なレイヤー構造を持つため、通常の `document.body` 直下へ注入した UI が想定どおり前面に出ないことがあります。  
そのため、動画 UI と干渉しにくい位置へ要素を注入し、字幕パネルと操作レイヤーの重なりを避ける設計を採用しています。

### 再生コントロール安定化

右字幕パネル表示中に、再生バーや操作ボタンが右パネルへ隠れたり、再生直後に左右へチラつく問題を抑えるため、起動時 / 設定反映時に軽量な補正を行っています。  
`footer` / `unified-controls` / `volume` などを同一基準で補正し、右字幕パネルとの重なりを減らす方針です。

### playback controls レイアウト制約

右字幕パネル表示時でも、Apple TV+ 側の header / footer / unified-controls / progress / volume / skip を操作可能範囲へ収めるよう、段階的な補正を行っています。  
大きめのデスクトップ解像度では概ね実用範囲ですが、小さい横幅では Apple TV+ 側の intrinsic なレイアウト制約が強く、small resolution は既知制約として残っています。

### CORS / Service Worker

コンテンツスクリプトから外部辞書 API へ直接 `fetch()` すると CORS 制約で失敗することがあるため、必要な通信は `background.js` 側の Service Worker 経由で扱います。  
Manifest V3 の Service Worker はアイドル時に停止するため、再送やフォールバックを含めた扱いを段階的に整理しています。

## 現在の整理方針

- popup / options の字幕言語一覧は、動画の `textTracks` に直接依存しない固定言語一覧ベースで扱う
- Apple TV+ 側の `textTracks` は content.js 側で正規化し、設定された言語に近いトラックを選択する
- forced 字幕は UI の直接候補には出さず、必要に応じて内部 fallback として扱う
- 保存値・解決値・実使用値を分けて観測し、字幕言語の不整合を追いやすくする
- `content.js` に責務を集めすぎず、段階的にモジュール分割を進める
- WebVTT の字幕テキストに含まれるタグ断片（例: `<c.styledotitalic>`）は正規化処理で除去する

## 動作確認環境

- Chrome 124+
- Apple TV+ (`tv.apple.com`)

## バージョン

- Current: `2.6.3`

## 開発向けドキュメント

- AI セッション運用ルールとテンプレートは `docs/ai-session-templates.md` を参照してください