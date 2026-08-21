# Bugfix マスタープラン 2026-08-21（要約版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-21 ／ **ブランチ:** `issue-32-content-core-split`  
**入口資料：** 新しいスレッドでもこの資料 1 枚を読めば、プロジェクトの目標・現在地・優先順位・次に着手する作業が分かる状態を保つ。

***

## 関連資料インデックス

| # | 資料名 | 役割 | 更新頻度 |
|---|---|---|---|
| 資料① | Bugfix マスタープラン | 全体俯瞰・目標・依存関係・優先順位・次スレッドの入口 | 節目ごとに更新 |
| 資料② | コードベース現状スナップショット | ファイル・関数・DOM ID の正本一覧 | 変更のたびに更新 |
| 資料③ | Bugfix 実装シート | 今の症状・今やる修正箇所・検証手順・実機ログ | 作業中は更新、完了で archive |
| 資料④ | Bugfix 将来作業計画 | 将来作業の計画 | 残っている計画だけにする |
| 資料⑤ | Bugfix-ABCD-plan | 辞書 | 参考資料 |
| 資料⑥ | Bugfix-仕様確定書 | 確定仕様の正本 | 仕様変更時のみ更新 |
| 資料⑦ | Secondary 条件統合メモ | secondary の selection / monitor / recovery 条件を `decision result` へ統合する設計方針 | Step 7 実装前・設計変更時 |
| 資料⑧ | Secondary 統合後の責務再定義一覧 | 条件統合後における各モジュールの責務・状態所有者・依存方向の一覧 | Step 7〜10 の進行に合わせて更新 |

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
| 字幕パネル本体 host | `atv-panel-host` | 右側字幕パネル host。表示/非表示と矩形計測の正本。 |
| 字幕パネル本体 root | `atv-panel-root` | 右側字幕パネル本体。 |
| オーバーレイ host | `atv-overlay-host` | 学習補助オーバーレイ host。位置・幅・矩形計測の正本。 |
| オーバーレイ inner root | `data-atvb-overlay-root` | overlay 内部コンテナ。文字要素の親。 |

***

## 現在地の要約

### 主要な完了事項

- 字幕パネル表示、primary / secondary 同期表示、ON→OFF→ON 復帰は成立している
- 二重表示・ちらつきは解消済み
- 字幕パネル開閉時の overlay 位置追従、文字サイズ維持、動画本体 70/30 レイアウト追従は完了済み
- 日本語字幕表示は復帰済みで、`hidden && cuesLength === 0` 除外実験は取り消し済み
- 言語設定変更時の secondary track 安定化は完了済み
- primary / secondary の listener binding 共通化は導入済み
- secondary monitor の start / replace / stop、cleanup / mode restore の基盤は binder 側へ集約済み
- unreadable 即 rebind 抑制、recovery の継続失敗中心化、hard seek / SPA 遷移時の cleanup 多重実行防止までは完了済み
- secondary 条件統合の設計と責務境界は文書化済みだが、実装はまだ未着手

### 継続課題

- `A listener indicated an asynchronous response...` は初回のみ残ることがあり、F-4 は持ち越し
- Chrome Renderer のメモリ使用量増大は継続観測中
- secondary の条件判断はまだ複数モジュールに分散しており、Step 7 で統合実装が必要

***

## 優先順位

### 最優先

**Step 7: secondary 条件統合の実装**

- `subtitle-sync-controller.js` に secondary decision の正本を実装する
- `cue-controller.js` から `staleMonitor` / `shouldRebind` / bind rationale のローカル組み立てを外す
- `clear` / `keep` / `wait-and-bind` / `bind` の action ベースへ移行する

### 次点

**Step 8〜10: 配線整理・ログ整理・lifecycle 確認**

- `content.js` を配線専用に寄せる
- debug / dead code を役割別に整理する
- panel close / playback close / destroy / restart の cleanup 経路を確認する

### 並行観測

- F-4: 初回 async response エラー
- M-1: 長時間再生時の Renderer メモリ増加

***

## 実装ステップ進捗

| Step | 状態 | 要約 |
|---|---|---|
| 1 | ✅ 完了 | secondary 選択フェーズを分離した |
| 2 | ✅ 完了 | `sameTrackRef` を主軸に identity 判定を統一した |
| 3 | ✅ 完了 | secondary monitor の start / replace / stop を binder に集約した |
| 4 | ✅ 完了 | secondary cleanup / mode restore の責務を binder 側へ寄せた |
| 5 | ✅ 完了 | unreadable 単独で即 rebind しないようにした |
| 6 | ✅ 完了 | recovery を継続 missing 中心へ寄せた |
| 6.5 | ✅ 完了 | hard seek / SPA 遷移時の cleanup 多重実行防止と復帰基盤補強を行った |
| 6.6 | ✅ 完了（設計） | secondary 条件統合の設計と責務境界を確定した |
| 7 | ⬜ 未着手（次に実装） | 6.6 の設計に沿って decision 集約を実装し、`cue-controller.js` を薄くする |
| 8 | ⬜ 未着手 | `content.js` を配線専用に寄せる |
| 9 | ⬜ 未着手 | dead code / debug を整理する |
| 10 | ⬜ 未着手 | lifecycle と cleanup 一本化を確認する |

***

## Step 7 の入口メモ

次に着手するのは Step 7。  
目的は、secondary の selection / readability / monitor health / recovery 要求を `subtitle-sync-controller.js` の decision builder へ集約し、`cue-controller.js` を action 実行中心の orchestration にすること。

Step 7 で主に触るファイル:

- `modules/subtitle-sync-controller.js`
- `cue-controller.js`
- 必要に応じて `modules/cue-track-binder.js`

Step 7 の設計正本:

- `docs/Bugfix/Secondary 条件統合メモ.md`
- `docs/Bugfix/Secondary 統合後の責務再定義一覧.md`

***

## 次スレッドの開始手順

1. この「Bugfix マスタープラン」を読む
2. `Secondary 条件統合メモ.md` を読む
3. `Secondary 統合後の責務再定義一覧.md` を読む
4. Step 7 の対象を `modules/subtitle-sync-controller.js` と `cue-controller.js` に限定して確認する
5. 実装の詳細、検証観点、ログ観点は `Bugfix 実装シート.md` を参照する

***

## 直近コミット

| コミット | 内容 |
|---|---|
| `3afc931` | `refactor: secondary 条件統合の設計を整理する (Issue #32)` |
| `ea5d814` | `fix: hard seek / SPA遷移時の cleanup 多重実行を防ぎ、secondary track 復帰の基盤を整理する (Issue #32)` |
