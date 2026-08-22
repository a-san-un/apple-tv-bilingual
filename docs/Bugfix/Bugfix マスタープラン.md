# Bugfix マスタープラン 2026-08-22（要約版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-22 ／ **ブランチ:** `issue-32-content-core-split`  
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
| 資料⑦ | Secondary 条件統合メモ | secondary の selection / monitor / recovery 条件を `decision result` へ統合する設計方針 | Step 7 設計変更時 |
| 資料⑧ | Secondary 統合後の責務再定義一覧 | 条件統合後における各モジュールの責務・状態所有者・依存方向の一覧 | Step 7〜10 の進行に合わせて更新 |

***

## 最終目標

動画再生中に拡張機能をリアルタイムで ON/OFF できるようにする。

- **OFF 時：** 拡張 UI をすべて破棄し、Apple TV+ 本来の字幕機能が使える状態に戻す。
- **ON 時：** 字幕パネル＋オーバーレイで 2 言語字幕を表示する。
- **OFF 時に残すのは** 「ネイティブトグル・ポップアップ・設定ページ・設定保存」のみ。

***

## 状態変数の正本定義（現行方針）

| 変数名 | 保存先 | 役割 | 備考 |
|---|---|---|---|
| `extensionEnabled` | `chrome.storage.sync` | 拡張全体の ON/OFF | ネイティブトグルが書き換える。  |
| `panelOpen` | ランタイムメモリ | 現在の字幕パネル開閉状態 | 現在状態として扱う。永続化しない方針へ寄せる。  |
| `panelDefaultOpen` | `chrome.storage.sync` | 通常起動時の `panelOpen` 初期値 | ランタイムの現在状態ではない。  |

**補足**  
過去の資料では `panelOpen` を `chrome.storage.local` 前提で記述していたが、現在の設計方針ではランタイム UI 状態と永続設定を分離し、`panelOpen` は保存しない方向へ寄せている。関連する正本は `ATV bilingual subtitles 設計・修正方針.md` を優先する。

***

## DOM ID 正本（厳守）

| 正式名称 | DOM ID | 役割 |
|---|---|---|
| ネイティブトグル | `atvb-native-toggle` | 拡張全体の ON/OFF のみ。OFF 時も残す。  |
| 字幕パネル開閉ボタン | `atv-toggle-btn` | 右側字幕パネルの開閉のみ。設定保存に関与しない。  |
| 字幕パネル本体 host | `atv-panel-host` | 右側字幕パネル host。表示/非表示と矩形計測の正本。  |
| 字幕パネル本体 root | `atv-panel-root` | 右側字幕パネル本体。  |
| オーバーレイ host | `atv-overlay-host` | 学習補助オーバーレイ host。位置・幅・矩形計測の正本。  |
| オーバーレイ inner root | `data-atvb-overlay-root` | overlay 内部コンテナ。文字要素の親。  |

***

## 現在地の要約

### 主要な完了事項

- 字幕パネル表示、primary / secondary 同期表示、ON→OFF→ON の基本復帰経路は成立している。
- 二重表示・ちらつきは解消済みで、字幕パネル開閉時の overlay 位置追従、文字サイズ維持、70/30 レイアウト追従も完了済みである。
- primary / secondary の listener binding 共通化、secondary monitor の start / replace / stop、cleanup / mode restore の基盤は binder 側へ集約済みである。
- unreadable 即 rebind 抑制、recovery の継続失敗中心化、hard seek / SPA 遷移時の cleanup 多重実行防止までは完了済みである。
- Step 7 の中核実装として、secondary 字幕同期は `decision` ベースの action 判定へ統合済みであり、`buildSecondarySyncDecision()` と `resolveSecondaryWaitOutcome()` を導入したコミット `0c3f20d` が反映済みである。
- `cue-controller.js` 側の secondary sync は `clear` / `keep` / `wait-and-bind` / `bind` の action switch ベースへ移行済みであり、旧 `staleMonitor` / `shouldRebind` のローカル組み立ては整理済みである。

### 継続課題

- `A listener indicated an asynchronous response...` は初回のみ残ることがあり、F-4 は持ち越しである。
- Chrome Renderer のメモリ使用量増大は継続観測中であり、listener / observer / timer 蓄積の有無を引き続き見たい。
- 拡張 ON/OFF トグル操作は、現状のログでは一意に追えない。OFF 側ログはあるが、ON 側は開始ログ中心で、トグル単独復帰の確認にはまだ弱い。
- 大きな seek 直後に `secondary-track-unbind-skipped` が出るケースがあり、unbind すべき track 参照自体が先に失われている可能性がある。

***

## 優先順位

### 最優先

**7-17: トグル ON/OFF ログの相関強化**

- `settings-runtime.js` にトグル操作単位の相関 ID を入れる。
- OFF 側の `apply start / restore before / restore after / apply done` と、ON 側の `restart begin / restart done` を対で追えるようにする。
- 実機でトグル単独復帰を再確認できる観測基盤を先に整える。

### 次点

**7-16: トグル時の完全リセット実装**

- `modules/cue-track-binder.js` / `modules/subtitle-state-reset.js` を中心に、listener・timer・Map参照・track binding を明示的に解放する。
- `window.gc()` のような強制 GC は使わず、参照断ち切りによって回収可能な状態を作る。 

**7-19〜7-20: 大きな seek 後の track 参照消失調査**

- `cue-controller.js` の large seek 直後に `primaryBoundTrack` 空状態や `secondary-track-unbind-skipped` が出る条件を切り分ける。
- `dispose` / `unbind` / `rebind` の順序と、track 参照消失タイミングを精査する。

### その次

**Step 8〜10: 配線整理・ログ整理・lifecycle 確認**

- `content.js` をさらに配線専用に寄せる。
- debug / dead code を役割別に整理する。
- panel close / playback close / destroy / restart の cleanup 経路を確認する。

### 並行観測

- F-4: 初回 async response エラー。
- M-1: 長時間再生時の Renderer メモリ増加。

***

## 実装ステップ進捗

| Step | 状態 | 要約 |
|---|---|---|
| 1 | ✅ 完了 | secondary 選択フェーズを分離した。  |
| 2 | ✅ 完了 | `sameTrackRef` を主軸に identity 判定を統一した。  |
| 3 | ✅ 完了 | secondary monitor の start / replace / stop を binder に集約した。  |
| 4 | ✅ 完了 | secondary cleanup / mode restore の責務を binder 側へ寄せた。  |
| 5 | ✅ 完了 | unreadable 単独で即 rebind しないようにした。  |
| 6 | ✅ 完了 | recovery を継続 missing 中心へ寄せた。  |
| 6.5 | ✅ 完了 | hard seek / SPA 遷移時の cleanup 多重実行防止と復帰基盤補強を行った。  |
| 6.6 | ✅ 完了（設計） | secondary 条件統合の設計と責務境界を確定した。  |
| 7 | ✅ 中核実装完了 | `subtitle-sync-controller.js` に decision 集約を実装し、`cue-controller.js` を action 実行中心へ寄せた。  |
| 7-11 | ✅ 完了 | wait-and-bind が readable 化しない場合の共通復帰経路を追加し、最新 track 状態から再選択・decision 再評価できるようにした。  |
| 7-12 | ✅ 部分確認済み | `ja → ko`、`ko → ja`、再度 `ja → ko` の切替は session2〜4 で復帰確認済み。  |
| 7-13 | 🟡 一部確認 | 拡張 OFF→ON 復帰はネイティブ UI 操作併用で復帰確認済み。トグル単独復帰は未確認。  |
| 7-14 | ⬜ 未完了 | 軽い seek 単独の影響はまだ分離確認できていない。  |
| 7-15 | 🟡 保留 | track 不在時 clear はコード確認済み。実機再現は未確認。  |
| 7-16 | ⬜ 未着手 | トグル押下時の完全リセット処理を実装する。  |
| 7-17 | ⬜ 未着手 | トグル ON/OFF を一意に追えるログ相関を追加する。  |
| 7-18 | ⬜ 未着手 | cleanup 前後の解放件数ログを追加し、完全リセット効果を観測可能にする。  |
| 7-19 | ⬜ 未着手 | 大きな seek 後に track 参照が失われる条件を調査する。  |
| 7-20 | ⬜ 未着手 | seek 後再初期化フローの見直しと unbind-skipped 原因の整理を行う。  |
| 8 | ⬜ 未着手 | `content.js` をさらに配線専用に寄せる。  |
| 9 | ⬜ 未着手 | dead code / debug を整理する。  |
| 10 | ⬜ 未着手 | lifecycle と cleanup 一本化を確認する。  |

***

## 現在の判断

Step 7 の設計→実装の流れは完了し、secondary の selection / readability / monitor / recovery を decision object に寄せる方針はコードへ反映済みである。

現時点の主戦場は「secondary 条件統合そのもの」ではなく、その上に残っている **トグル観測の弱さ**、**トグル時の完全リセット不足**、**大きな seek 直後の一時破綻** の3点である。

***

## 次スレッドの開始手順

1. この「Bugfix マスタープラン」を読む。
2. `Bugfix 実装シート.md` を読み、7-12 以降の実機確認結果と未完了項目を確認する。
3. トグル観測をやる場合は `settings-runtime.js` のログ現状を先に確認する。
4. 完全リセットをやる場合は `modules/playback-session-cleanup.js` / `modules/subtitle-state-reset.js` / `modules/cue-track-binder.js` を確認する。
5. 大きな seek 問題をやる場合は `cue-controller.js` の `secondary-track-unbind-skipped` 周辺を確認する。

***

## 直近コミット

| コミット | 内容 |
|---|---|
| `0c3f20d` | `refactor: secondary字幕同期をdecisionベースのaction判定へ統合する (Issue #32, Phase 7-11)`  |
| `79df106` | `docs: Bugfix 関連ドキュメントの役割と Step 7 計画を整理する`  |
| `3afc931` | `refactor: secondary 条件統合の設計を整理する (Issue #32)`  |
| `ea5d814` | `fix: hard seek / SPA遷移時の cleanup 多重実行を防ぎ、secondary track 復帰の基盤を整理する (Issue #32)`  |

