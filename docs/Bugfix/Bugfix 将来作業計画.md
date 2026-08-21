# Bugfix 将来作業計画 2026-08-21（整理版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-21（要約版）  
**このシートの役割:** 現在の実装シートで扱わない残件・後続フェーズ・将来の改善候補を管理する。完了済みの詳細、今回の実装手順、実機ログは持たない。  
**最終更新:** 2026-08-21

***

## 運用ルール

- この文書には、**未着手・持ち越し・後続フェーズ**だけを残す
- 今まさに実装する作業は `Bugfix 実装シート.md` に移す
- Step の全体進捗は `Bugfix マスタープラン.md` を正本とする
- 詳細な設計は専用設計資料を正本とする
- 完了した項目はこの文書から削除し、必要なら Git 履歴または archive で参照する
- 新しい作業テーマが主作業になった時点で、この文書から `Bugfix 実装シート.md` へ移す

***

## 将来作業の全体像

```text
現在の主作業:
  [Step 7] secondary 条件統合の実装
      ↓
後続フェーズ:
  [Step 8] content.js を配線専用に寄せる
      ↓
  [Step 9] dead code / debug を整理する
      ↓
  [Step 10] lifecycle / cleanup を全経路で検証する
      ↓
並行残件:
  [F-4] message channel closed 系エラーの整理
  [M-1] 長時間再生時の Renderer メモリ増加の再計測・原因切り分け
  [F-8] decision 導入後のログ体系整理
      ↓
後続改善候補:
  [Bugfix-B / C] 未整理の既存不具合・UI/字幕同期課題を再評価する
```

***

## 優先順位

| 優先度 | 作業 | 着手条件 | 目的 |
|---|---|---|---|
| P0 | Step 8 | Step 7 完了 | `content.js` を配線専用に寄せ、判断ロジックの流入を防ぐ |
| P0 | Step 9 | Step 7 完了 | decision 導入後の dead code / debug / obsolete rationale を整理する |
| P0 | Step 10 | Step 7〜9 完了 | lifecycle ごとの secondary listener cleanup を全経路で確認する |
| P1 | F-4 | Step 7 の実機検証を阻害しない時点 | async response / message channel close の送信設計を整理する |
| P1 | M-1 | Step 10 の検証基盤ができた時点 | 長時間再生時の Renderer メモリ増加を定量的に再計測する |
| P1 | F-8 | Step 7〜9 完了 | decision / binder / recovery 単位のログ体系へ整理する |
| P2 | Bugfix-B / C | 上記の安定化完了後 | 未整理の既存不具合を再評価し、必要なものだけを新規実装シートへ切り出す |

***

## Step 8: content.js を配線専用に寄せる

**位置づけ:** Step 7 完了後の最優先後続作業

### 目的

`content.js` を controller、binder、sync controller、recovery manager の生成と接続に限定する。  
secondary selection、recovery 判断、cleanup 判断、track mode 判断を `content.js` に持ち込まない。

### 対象ファイル

- `content.js`
- 必要に応じて factory / dependency injection を受ける周辺モジュール

### 着手条件

- Step 7 で `buildSecondarySyncDecision()` と action 実行の責務境界が安定している
- `cue-controller.js` が secondary 条件の正本でなくなっている

### 完了条件

- [ ] `content.js` が依存性生成・注入・起動・停止配線だけを担う
- [ ] secondary selection / recovery / cleanup 条件が `content.js` に存在しない
- [ ] controller / binder / recovery manager の生成順と破棄順が追跡できる
- [ ] 新規ロジック追加時に `content.js` へ条件分岐を追加しなくて済む

***

## Step 9: dead code / debug 整理

**位置づけ:** Step 7〜8 で不要になった条件・ログを削る整理フェーズ

### 目的

secondary decision 導入前の補助分岐、obsolete rationale、不要な debug 出力を削除または役割別に移動する。

### 対象ファイル

- `cue-controller.js`
- `modules/subtitle-sync-controller.js`
- `modules/cue-track-binder.js`
- `modules/secondary-track-recovery.js`
- 必要に応じて `modules/subtitle-recovery-manager.js`

### 整理候補

- `if (false)` 系の一時観測コード
- `sameTrackUnreadable` 前提の補助ログや rationale
- controller 側に残る旧 `shouldRebind` 系のログ
- decision 導入後に重複する selection / binder / recovery ログ
- 通常再生時に意味を持たない probe ログ
- 役割が不明確なログカテゴリ

### 完了条件

- [ ] 不要分岐と一時コードが削除されている
- [ ] ログが `decision` / `binder` / `recovery` / `lifecycle` の責務単位で読める
- [ ] 通常再生時にログが過剰出力されない
- [ ] 問題発生時に bind・keep・clear・cleanup の理由を追跡できる

***

## Step 10: lifecycle / cleanup 全経路確認

**位置づけ:** secondary listener と cleanup の安定性を確定する検証フェーズ

### 目的

secondary monitor の開始・停止・cleanup・mode restore が、すべての終了経路で 1 回だけ実行されることを確認する。

### 対象ファイル

- `cue-controller.js`
- `modules/cue-track-binder.js`
- `modules/playback-session-cleanup.js`
- `modules/playback-startup-coordinator.js`
- `content.js`

### 確認対象の終了経路

- panel close
- playback close
- extension OFF
- extension ON 復帰
- short seek
- hard seek
- SPA 遷移
- destroy
- restart
- 別エピソード遷移
- 別作品遷移

### 完了条件

- [ ] listener attach / cleanup の所有者が binder に一本化されている
- [ ] cleanup 実体が同一 session に対して多重実行されない
- [ ] `cleanup skipped` と実 cleanup がログで区別できる
- [ ] old session の watch / retry / timer が新 session へ持ち越されない
- [ ] OFF / restart / close 後に native subtitle mode が正しく復元される
- [ ] 長時間再生と複数回遷移後も listener 数が増加し続けない

***

## F-4: message channel close の整理

**位置づけ:** UI 復旧済みの持ち越し残件。Step 7〜10 を止めるブロッカーではない。

### 現在の状態

- `background.js` には recoverable error 判定と再送処理がある
- `waitForPlaybackReady()` の結果を反映してから restart する流れは導入済み
- 初回付近で次のエラーが残る場合がある

```text
A listener indicated an asynchronous response by returning true,
but the message channel closed before a response was received
```

### 再調査の方針

1. `APPLY_SETTINGS_TO_APPLE_TV` / `SETTINGS_CHANGED` ごとに、応答必須か fire-and-forget かを決める
2. `onRuntimeMessage` で `return true` している全経路を確認する
3. `sendResponse` が必ず呼ばれる経路と、応答不要な経路を分ける
4. content script 再注入、SPA 遷移、tab activation と送信タイミングの race をログで確認する
5. 再送・再注入の条件と上限を明確化する

### 対象ファイル候補

- `background.js`
- `settings-runtime.js`
- `content.js`
- message listener を持つ関連モジュール

### 完了条件

- [ ] 初回付近でも message channel closed 系エラーが出ない
- [ ] 通常経路で不要な再送・再注入が走らない
- [ ] request-response と fire-and-forget の送信設計が明確に分かれている
- [ ] page 遷移・再注入時にも未処理 Promise が残らない

***

## M-1: Renderer メモリ増加の再計測

**位置づけ:** cleanup 安定化後に定量評価する継続課題

### 背景

Chrome Renderer プロセスで 6GB 級のメモリ消費を観測している。  
secondary listener の cleanup、多重 bind、old session の watch / retry が原因候補だが、Step 6.5 までの修正後に再計測して判断する必要がある。

### 着手条件

- Step 10 で lifecycle cleanup の経路確認が完了している
- debug ログを必要最小限に整理できている
- 再現手順と観測時間を固定できている

### 計測方針

1. 起動直後、30 分、60 分、90 分などの測定時点を固定する
2. 通常再生、short seek 反復、hard seek 反復、SPA 遷移反復を別シナリオにする
3. Renderer memory、EventListener、V8EventListener、RegisteredEventListener の推移を記録する
4. session cleanup、secondary bind、secondary cleanup の回数を同じテストログで照合する
5. 増加が継続する場合は listener、observer、timer、DOM node を分けて heap snapshot へ進む

### 完了条件

- [ ] テストシナリオごとのメモリ推移が記録されている
- [ ] listener / observer / timer / DOM のどれが増加源かを分類できている
- [ ] 修正前後の差分を比較できる
- [ ] 必要なら原因別の新しい実装シートを作成できる

***

## F-8: ログ体系の再整理

**位置づけ:** Step 7〜9 完了後に行う観測品質改善

### 目的

secondary の action 決定、bind / cleanup、recovery、lifecycle を役割別に追跡可能にし、通常再生時のログ量を抑える。

### ログカテゴリ案

| カテゴリ | 出す内容 |
|---|---|
| `decision` | selection / readability / monitor / recovery 入力、action type、action reason |
| `binder` | bind、keep、replace、cleanup、mode apply / restore |
| `recovery` | missing 継続時間、debounce、missCount、force rebind 判定 |
| `lifecycle` | startup、session switch、hard seek、SPA 遷移、destroy、restart |
| `debug` | 一時観測専用。通常時は無効または抑制する |

### 完了条件

- [ ] action type と reason が追跡できる
- [ ] cleanup skip と実 cleanup を区別できる
- [ ] 通常再生で probe ログが連続出力されない
- [ ] 1 セッションの lifecycle を時系列で追える
- [ ] 一時調査ログを恒久ログへ混在させない

***

## Bugfix-B / C 再評価

**位置づけ:** secondary lifecycle の安定化後に再評価する未整理課題

### 再評価方針

- 現在の動作に再現する問題だけを対象にする
- 現行 architecture に照らして原因を再分類する
- 修正対象が独立している場合のみ、新しい `Bugfix 実装シート` を作る
- 再現しない過去ログ・既に解消した仮説は持ち込まない

### 着手条件

- Step 10 の lifecycle 検証が完了している
- M-1 の一次再計測が完了している
- 既存の F-4 / F-8 と重複しないことを確認している

***

## 参照資料

- `docs/Bugfix/Bugfix マスタープラン.md`
- `docs/Bugfix/Bugfix 実装シート.md`
- `docs/Bugfix/Secondary 条件統合メモ.md`
- `docs/Bugfix/Secondary 統合後の責務再定義一覧.md`
- `docs/Bugfix/コードベース現状スナップショット.md`

情報源
