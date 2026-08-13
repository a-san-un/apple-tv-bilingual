
## Bugfix マスタープラン 2026-08-13（改訂版）
**作成日:** 2026-08-13 ／ **ブランチ:** issue-32-content-core-split
**入口資料：** 新しいスレッドでもこの資料1枚を読めばプロジェクトの文脈がわかります。

***

## 関連資料インデックス

| # | 資料名 | 役割 | 更新頻度 |
|---|---|---|---|
| 資料① | Bugfix マスタープラン | 全体俯瞰・目標・依存関係・優先順位 | 節目ごとに更新 |
| 資料② | コードベース現状スナップショット | ファイル・関数・DOM ID の正本一覧 | 変更のたびに更新 |
| 資料③ | Bugfix 実装シート | 今の症状・今やる修正箇所・検証手順 | 完了で archive |
| 資料④ | Bugfix 将来作業計画 | 将来作業の計画 | 残っている計画だけにする |
| 資料⑤ | Bugfix-ABCD-plan | 辞書 | 参考資料 |
***

## 最終目標

動画再生中に拡張機能をリアルタイムで ON/OFF できるようにする。

- **OFF 時：** 拡張 UI をすべて破棄し、Apple TV+ 本来の字幕機能が使える状態に戻す
- **ON 時：** 字幕パネル＋オーバーレイで 2 言語字幕を表示する
- **OFF 時に残すのは** 「ネイティブトグル・ポップアップ・設定ページ・設定保存」のみ

***

## 状態変数の正本定義（厳守）

| 変数名 | 保存先 | 役割 | 備考 |
|---|---|---|---|
| `extensionEnabled` | `chrome.storage.sync` | 拡張全体の ON/OFF | ネイティブトグルが書き換える |
| `panelOpen` | `chrome.storage.local` | 現在の字幕パネル開閉状態 | `extensionEnabled=ON` のときのみ意味を持つ |
| `panelDefaultOpen` | `chrome.storage.sync` | 通常起動時の `panelOpen` 初期値 | ランタイムの現在状態ではない |

***

## DOM ID 正本（厳守）

| 正式名称 | DOM ID | 役割 |
|---|---|---|
| ネイティブトグル | `atvb-native-toggle` | 拡張全体の ON/OFF のみ。OFF 時も残す。 |
| 字幕パネル開閉ボタン | `atv-toggle-btn` | 右側字幕パネルの開閉のみ。設定保存に関与しない。 |
| 字幕パネル本体 | `atv-panel-root` | 右側字幕パネル。OFF 時は destroy。 |
| オーバーレイ | `atv-overlay-root` | 学習補助オーバーレイ。OFF 時は destroy。 |

***

## 現状精査（2026-08-13 時点）

前回セッションのログ・コード確認から判明した事実：

### ✅ 完了済み

- `vtt-normalizer.js`、`debug-logger.js` など多数のモジュールが `content_scripts` に正しく列挙されている
- `state.booted` フラグは `content.js` 内に存在する（ただし early-return ガードは未実装）
- `manifest.json` の `content_scripts` エントリ自体は1つで、二重 inject の直接原因ではないことを確認

### 🔴 未完了（着手中）— Bugfix-D

- `content.js` 先頭に **`window.__atvbContentInjected` ガードが存在しない**
  - `content message listener registered` が同一 ms に2回出力されており、リスナー二重登録が発生中
  - SPA ナビゲーション時の reinject で二重起動が再現することを確認
- `restartBilingual` の二重呼び出しが解消されていない（panel/overlay/toggle が DOM に出ない根本原因）

### ⏸ 未着手 — Bugfix-A

- OFF 時の `apply start → apply done` が 3ms で完了しており、実質 **`destroyUiHosts()` が呼ばれていない**ことを確認
- `settings-runtime.js` の OFF ブランチに `destroyUiHosts()` の呼び出しが欠落している

### ⏸ 未着手 — Bugfix-E / B / C

- Bugfix-D・A が完了するまで着手しない

***

## Bugfix 依存ツリー

```
【根本症状】
  UI が再生ページで初期化されない
  （panel / overlay / toggle がすべて null）
        ↓
  [Bugfix-D] init/destroy 経路の二重所有を修正　← 最優先・基盤
        ↓ UI が DOM に出るようになったら
  [Bugfix-A] OFF 時の全 UI destroy を完成させる
        ↓ destroy が確実にできたら
  [Bugfix-E] OFF 時にネイティブ字幕 track を復元する
        ↓ 副作用を確認しながら
  [Bugfix-B/C] module 初期化順・recovery module（後回し可）
```

***

## 優先順位テーブル（2026-08-13 改訂）

| 順序 | Bugfix | やること | 完成の判定 | 状態 |
|---|---|---|---|---|
| ① 今すぐ | D-1 | `content.js` 先頭に `window.__atvbContentInjected` ガード追加 | `startup completed` が 1 回のみ、リスナー登録も 1 回のみ | 🔴 **着手中・未適用** |
| ② 今すぐ | D-2 | `restartBilingual` 二重呼び出し解消 | panel / overlay / toggle が DOM に出る | 🔴 **着手中** |
| ③ 次 | A | `settings-runtime.js` OFF ブランチに `destroyUiHosts()` 追加 | OFF で全要素 null・native toggle だけ残る | ⏸ D 完了後 |
| ④ その次 | E | OFF → `subtitle track.mode` を `showing` に戻す | Apple TV+ 字幕が OFF 後に動く | ⏸ A 完了後 |
| ⑤ 後回し | B/C | module 初期化順・recovery module 修正 | `recovery_module_unavailable` ログが消える | ⏸ A/E 後 |

***

## 次の具体的アクション（D-1）

`content.js` の IIFE 冒頭に以下を追加するだけで二重起動を防止できます：

```js
(function () {
  ("use strict");

  // ★ Bugfix-D-1: 二重 inject ガード
  if (window.__atvbContentInjected) {
    console.warn('[ATVB] content.js already injected, skipping.');
    return;
  }
  window.__atvbContentInjected = true;

  // --- 既存コードここから ---
  const DEFAULT_SETTINGS = { ... };
```

適用後、`content message listener registered` が **1 回だけ** になることをログで確認してから D-2 に進んでください。

***

## スコープ外（このフェーズでは触らない）

- Issue-32 のリファクタ（`content.js` 分割）本体
- AI tooltip / 単語ポップアップ機能
- `overlay-block-resolver` の挙動変更
- パフォーマンス最適化

情報源
