# Apple TV+ Bilingual Subtitles

Chrome拡張機能 — Apple TV+ で英語字幕と日本語字幕を同時表示し、単語をクリックすると辞書ポップアップと例文を表示します。

## 機能

- **バイリンガル字幕オーバーレイ** — 動画左下に英語 + 日本語を重ねて表示
- **字幕履歴パネル** — 画面右30%に過去・現在・未来の字幕を一覧表示、クリックでシーク
- **辞書ポップアップ（3セクション構成）**
  - ヘッダー：単語 + バッジ（よく使われる語 / JLPT レベル）+ 読み仮名
  - 意味セクション：品詞ごとの定義（Jisho API、最大5 senses）
  - 例文セクション：Tatoeba から英語例文を最大5件取得、ホバーで日本語訳をツールチップ表示
- **例文内単語クリックで再検索** — 例文中の単語をクリックするとそのままポップアップが更新される
- **AI翻訳タブ** — Google Translate で文全体を日本語訳
- **言語切り替え** — 拡張機能アイコン → ポップアップから一次・二次言語を変更

## バージョン履歴

| バージョン | 主な変更点 |
|---|---|
| **v2.5** | タブバグ修正、辞書タブ3セクション構成、Tatoeba例文取得（最大5件）、例文ホバーで日本語訳ツールチップ、例文内単語クリック再検索 |
| v2.4 | 字幕パネル・オーバーレイ・辞書ポップアップの初期実装 |

## インストール

1. このリポジトリをクローンまたは ZIP でダウンロード
2. Chrome で `chrome://extensions` を開く
3. 「デベロッパーモード」をオン
4. 「パッケージ化されていない拡張機能を読み込む」→ フォルダを選択

## ファイル構成

```
apple-tv-bilingual/
├── manifest.json    # 拡張機能の設定（v2.5.0）
├── background.js    # Service Worker — 外部 API (Jisho / Translate / Tatoeba) へのリクエストを中継
├── content.js       # メインスクリプト — 字幕取得・UI 構築・ポップアップ制御
├── overlay.css      # コンテンツスクリプト用 CSS
├── popup.html       # 拡張機能アイコンクリック時のポップアップ UI
└── popup.js         # ポップアップの言語切り替えロジック
```

## 使用 API

| API | 用途 |
|---|---|
| [Jisho API](https://jisho.org/api/v1/search/words) | 英語単語の辞書検索 |
| [Google Translate](https://translate.googleapis.com) | 字幕文の日本語翻訳 |
| [Tatoeba API](https://api.tatoeba.org) | 英語例文 + 日本語訳の取得 |

## 権限

| 権限 | 理由 |
|---|---|
| `storage` | 言語設定の保存 |
| `https://tv.apple.com/*` | Apple TV+ ページへの挿入 |
| `https://jisho.org/*` | 辞書 API |
| `https://translate.googleapis.com/*` | 翻訳 API |
| `https://api.tatoeba.org/*` | 例文 API（v2.5 追加） |

## アーキテクチャメモ

- **Top Layer 問題** — Apple TV+ のプレイヤーは `<dialog class="playback-view">` 内で動作し、ブラウザの top layer に昇格する。すべての UI 要素を `<dialog>` 内に直接挿入することで解決。
- **CORS 問題** — `tv.apple.com` からの外部 API フェッチは CORS でブロックされる。すべての外部リクエストを Service Worker (`background.js`) 経由にすることで解決。
- **SW Keepalive 問題** — Manifest V3 の Service Worker は非アクティブ後 ~30 秒で停止する。`sendToBackground()` は SW が停止していた場合に 300ms 待って1回リトライする。
