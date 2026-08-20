# Bugfix 将来作業計画 2026-08-17（改訂版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-17（改訂版）  
**このシートの役割:** 将来作業の計画（残っている計画だけにする）  
**最終更新:** 2026-08-21

---

## 計画の全体像

マスタープランの依存ツリーに従い、完了した F-1 / F-2 / F-3 / F-6 を除いた  
残件と将来作業だけをここで管理する。  
2026-08-17 時点では、F-4 は UI 復旧まで進んだが async response エラーが残っているため残件化し、  
F-5 は完了済み。リーク対策（Step 1〜5）は `cue-controller.js` を中心に進行中。

```text
[F-1] panelOpen 誤連動の切り離し ← ✅ 完了
      ↓
[F-2] restart 後のネイティブトグル生成漏れ修正 ← ✅ 完了
      ↓
[F-3] 言語設定変更のリアルタイム反映 ← ✅ 完了
      ↓
[F-6] デバッグパネル OFF 時不可 ← ✅ 完了
      ↓
[F-4] SETTINGS_CHANGED 非同期応答 / 再送 race 改善 ← 🟠 残件持ち越し
      ↓
[F-5=Bugfix-E] ネイティブ字幕復元 ← ✅ 完了
      ↓
[リーク対策] secondary listener / rebind / cleanup 整理 ← 🔵 進行中（Step 5 まで確認済み）
      ↓
[F-5] を secondary ベースの hidden-lock モデルへ統一する設計の確定 ← 🔴 未着手
      ↓     
[F-8] DevConsole 大量ログ削減 ← 🔴 未着手
      ↓
[Bugfix-B / C] ← 🔴 未着手
```

---

## F-4 残件：メッセージチャネルクローズエラー整理

**位置づけ:** 次の主作業ではなく、並行で持ち越す残件

### 背景

2026-08-17 の修正で、`background.js` と `settings-runtime.js` に手を入れ、  
ON 復帰時に `#atv-toggle-btn` と overlay 字幕が出ない主症状は解消した。  
一方で、次のエラーはまだ初回に残ることがある。

```text
Uncaught (in promise) Error:
A listener indicated an asynchronous response by returning true,
but the message channel closed before a response was received
```

### ここまでの修正内容

**対象ファイル:** `background.js`、`settings-runtime.js`

- `settings-runtime.js`
  - `waitForPlaybackReady()` 成功後に `state.video` を反映
  - `playbackRef.dialog` があれば `state.dialogEl` を反映
  - その後に ON 側 restart へ進む構成へ変更
- `background.js`
  - `sendSettingsChangedWithRecovery()` に recoverable error 判定を追加
  - `Receiving end does not exist`
  - `message channel closed before a response was received`
  - `A listener indicated an asynchronous response by returning true`  
    を recoverable 扱いへ整理
  - `ensureContentScriptReady()` を追加し、content script 生存確認と再注入を実施
  - recoverable な失敗時は再送を試す構成へ変更

### 現時点の見立て

- 単純な `sendResponse` 漏れだけではなく、content script 再注入・SPA 遷移・tab activation・message channel の寿命競合が残っている可能性が高い
- UI 復旧は達成済みであり、リーク対策作業を止めるブロッカーではない
- 再調査時は、background 側送信を
  - 「応答必須の request-response」
  - 「失敗してもよい fire-and-forget」  
  のどちらにするか先に固定してから切り分ける

### 将来の再調査ポイント

1. `APPLY_SETTINGS_TO_APPLE_TV` / `SETTINGS_CHANGED` のどちらで応答必須かを明確化する
2. `onRuntimeMessage` で `return true` している経路を再点検する
3. background 側送信の再送条件とタイミングを整理する
4. content script 再注入直後の送信 race をログで切り分ける

### 残件の完了条件

- [ ] 初回付近でも message channel closed 系エラーが出ない
- [ ] 再送・再注入が不要な通常経路で安定する
- [ ] 送信設計が request-response / fire-and-forget のどちらかに統一される

---

## Bugfix-E（F-5）：OFF 時のネイティブ字幕復元 ✅ 完了

**着手条件:** なし（完了済み）

### 概要

拡張機能を OFF にしたとき、Apple TV+ 本来の字幕機能を使える状態に戻す修正。  
`cue-controller.restoreNativeSubtitles()` 周辺に主責務を集約し、OFF 時の UI 破棄と  
native 字幕復元を責務分離した。

### 完了条件（確認済み）

- [x] OFF 後に Apple TV+ のネイティブ字幕が正常に表示される
- [x] 字幕の二重表示や競合が発生しない
- [x] ON → OFF → ON を繰り返しても native / extension の責務が混線しない

---

## リーク対策：secondary listener / rebind / cleanup 整理

**位置づけ:** 進行中（Step 5 まで確認済み・未適用）  
**主作業ブランチ:** `issue-32-content-core-split`

### 概要

`cue-controller.js` を中心に、secondary listener の積み増し・不要な rebind・cleanup 経路の  
分散を解消するための段階的整理。`modules/cue-track-binder.js` への cleanup 集約と  
`shouldRebindBecauseUnreadable` の除去を主軸とする。

### 未使用退避名（削除確定まで保留）

- `_resolveSecondarySubtitleTrack`
- `_pickMostReadableTrack`
- `_resolveSecondaryTrackModePolicy`（現行使用中であることを 2026-08-21 に確認）

### 実装ステップ

| Step | 目的 | 主対象ファイル | 状態 |
|---|---|---|---|
| 1 | secondary の選択フェーズを分離する | `modules/subtitle-sync-controller.js`, `cue-controller.js` | ✅ 完了 |
| 2 | ユニークな値を主軸にする | `modules/subtitle-sync-controller.js`, `cue-controller.js` | ✅ 完了 |
| 3 | secondary 監視フェーズを分離する | `modules/cue-track-binder.js` | ✅ 完了 |
| 4 | cleanup を一元化する | `modules/cue-track-binder.js`, `cue-controller.js` | ✅ 完了 |
| 5 | unreadable 即 rebind をやめる | `cue-controller.js` | 🔵 確認完了・未適用 |
| 6 | recovery を継続失敗中心へ寄せる | `modules/subtitle-recovery-manager.js`, `modules/secondary-track-recovery.js` | 🔴 未着手 |
| 7 | `cue-controller.js` を薄くする | `cue-controller.js` | 🔴 未着手 |
| 8 | `content.js` を配線専用に寄せる | `content.js` | 🔴 未着手 |
| 9 | dead code / debug を整理する | `cue-controller.js`, `modules/subtitle-sync-controller.js`, `modules/cue-track-binder.js` | 🔴 未着手 |
| 10 | lifecycle を確認する | `cue-controller.js`, `modules/playback-session-cleanup.js`, `content.js` | 🔴 未着手 |

### Step 5 確認内容（2026-08-21 時点）

**修正対象ファイル:** `cue-controller.js`（主）

現状コードに残っている除去候補の塊：

1. `syncSecondaryTrackOrchestration(...)` 内の `shouldRebindBecauseUnreadable` 計算・debug ログ・`shouldBind` への加算・`rationale: "sameTrackUnreadable"` 分岐
2. `_resolveSecondaryTrackModePolicy(...)` の unreadable 判定と `readability-promote` 返却分岐
3. `bindSecondarySubtitleTrack(...)` 内の `maybePromoteTrackReadability()` と `sameTrackUnreadable` 依存処理

**修正方針：**

- `unreadableSnapshot` 自体は health 情報として保持してよい。bind 条件には使わない
- `sameTrackUnreadable` という bind 理由を落とし、bind 理由を `selected-track-changed` / `force-rebind` 中心へ寄せる
- `_resolveSecondaryTrackModePolicy(...)` の `readability-promote` 分岐は Step 5 で見直し対象
- `maybePromoteTrackReadability()` は `sameTrackUnreadable` 前提の補助処理のため、削除または無効化候補

**Step 5 完了条件:**

- [ ] 同一 track の一時 unreadable だけでは rebind されない
- [ ] `shouldRebindBecauseUnreadable` が bind 判定から除去される
- [ ] `maybePromoteTrackReadability()` の `sameTrackUnreadable` 依存が解消される

### Step 6 確認済み予備情報

- `modules/subtitle-recovery-manager.js`：`evaluateSecondaryRecovery(...)` の委譲経路あり
- `modules/secondary-track-recovery.js`：`forceRebindReason` / `shouldForceRebind` を含む recovery 判定の本体
- 一時的な空状態でも `forceRebind` を返す条件が残っているため、Step 6 で絞り込む

---

## F-8：DevConsole の大量ログ出力削減

**着手条件:** リーク対策 Step 完了後

### 背景と目的

DevConsole の詳細表示時に大量ログが連続出力されており、  
デバッグの妨げになっている。常設ログを削減することを最優先とする。

### 現在見えている問題

- `secondary-sync force-rebind skipped` が常設ログとして繰り返し出る
- `DEBUG_SECONDARY_SUBS = true` 配下のつもりだったログが、実質常設化している可能性がある
- `syncInterval` 系の毎サイクル出力が、通常利用時のノイズになっている
- リーク対策 Step 9 と整合性を保ちながら整理する

### 実装方針

**対象ファイル:**
- `cue-controller.js`
- `settings-runtime.js`
- 必要に応じて関連 sync 系モジュール

- 常設ログをデバッグフラグ配下へ移動する
- 毎サイクル出力は原則やめ、必要なら state change ベースのログへ置き換える
- 「通常時に残すログ」と「切り分け時だけ出すログ」を分ける

### 検証手順

1. `tv-log.log` もしくは DevConsole 出力から、定常ノイズになっているログを列挙する
2. 常設ログを debug flag 配下へ移動する
3. 修正後、通常利用時にログが大幅に減ることを確認する

### 完了条件

- [ ] `secondary-sync force-rebind skipped` が常設出力されなくなる
- [ ] 毎サイクル系ログが通常利用時に流れなくなる
- [ ] DevConsole の通常使用時にノイズが著しく減少する

---

## Bugfix-B：module 初期化順の修正

**着手条件:** F-8 完了後

### 背景と目的

Console に `recovery_module_unavailable` のログが出ており、  
依存先モジュールの初期化前に何かが呼ばれている可能性がある。  
F-8 で主要挙動が安定した後に、初期化順の整理へ進む。

### 修正方針

**対象ファイル:** `content.js`（モジュール初期化の呼び出し順）

- 各モジュールの `init()` 呼び出し順序を依存関係に従って並び替える
- 依存先が未初期化のときは、致命エラーではなく警告で扱うべき箇所を整理する
- `settings-runtime` の apply が、依存モジュール初期化後に走ることを確認する

### 初期化順の目安

```text
1. debug-logger
2. state / storage
3. vtt-normalizer
4. subtitle-fetcher / resolver
5. panel / overlay（UI 系）
6. cue-controller
7. settings-runtime（最後に apply）
```

### 検証手順

1. Console に `recovery_module_unavailable` のログが出ないことを確認
2. 各モジュールの init 順序をログまたはブレークポイントで確認
3. 初期化順変更後も ON/OFF・字幕表示・panel/overlay が壊れないことを確認

### 完了条件

- [ ] `recovery_module_unavailable` ログが Console に出ない
- [ ] 全モジュールが依存順に初期化される
- [ ] 初期化順変更後も主要機能が維持される

---

## Bugfix-C：recovery module の責務整理

**着手条件:** Bugfix-B 完了後

### 背景と目的

Bugfix-B で初期化順を修正した後も recovery module 自体に問題が残る場合の対応。  
recovery module の存在意義を再評価し、不要なら削除、必要なら正しい責務へ整理する。  
なお、リーク対策 Step 6 での `evaluateSecondaryRecovery()` 条件見直しと連動する。

### 修正方針

**対象ファイル:** recovery module 関連ファイル（要特定）

- recovery module が何をしているかをコードベースで確認する
- リーク対策 Step 6 後に不要になった処理があれば削除する
- 必要なフォールバック処理は残し、正しいタイミングで呼ばれるよう修正する

### 検証手順

1. recovery module の呼び出し箇所と役割を洗い出す
2. 想定通りのフォールバックとして機能しているか確認する
3. 不要な再初期化や副作用がないことを確認する

### 完了条件

- [ ] recovery module が正しく動作する、または不要と判断して削除される
- [ ] `recovery_module_unavailable` 関連ログが完全に解消される

---

## 将来作業の優先順位テーブル

| 順序 | Bugfix | やること | 着手条件 | 状態 |
|---|---|---|---|---|
| ① | リーク対策 Step 5 | `shouldRebindBecauseUnreadable` / `sameTrackUnreadable` 除去（`cue-controller.js`） | なし | 🔵 確認完了・未適用 |
| ② | リーク対策 Step 6 | `evaluateSecondaryRecovery()` 条件を継続失敗中心へ絞る | Step 5 後 | 🔴 未着手 |
| ③ | リーク対策 Step 7〜10 | `cue-controller.js` 薄化・配線整理・lifecycle 確認 | Step 6 後 | 🔴 未着手 |
| ④ | F-4 残件 | message channel closed 系エラーの race を切り分ける | リーク対策と並行可 | 🟠 持ち越し |
| ⑤ | F-5 | secondary ベースの hidden-lock モデルへ統一する設計の確定 | リーク対策 Step 完了後 | 🔴 未着手 |
| ⑥ | F-8 | DevConsole の常設ログを整理する（リーク対策 Step 9 と連動） | リーク対策 Step 完了後 | 🔴 未着手 |
| ⑦ | Bugfix-B | module 初期化順の修正 | F-8 後 | 🔴 未着手 |
| ⑧ | Bugfix-C | recovery module の責務整理（リーク対策 Step 6 と連動） | Bugfix-B 後 | 🔴 未着手 |

---

## 補足メモ

- このシートには完了済み作業の詳細は残さず、残件と将来タスクだけを置く
- F-7 は 2026-08-17 の `state.video` / `state.dialogEl` 反映修正で主症状が解消したため、将来作業から外す
- F-4 は「未着手」ではなく、UI 復旧まで進んだ上で async response エラーだけが残っている状態
- F-5（Bugfix-E）は 2026-08-21 時点で完了済み、trakmode の hidden-lock モデルへの統一設計は未着手
- リーク対策 Step 1〜4 は完了。Step 5 は `cue-controller.js` の修正内容を確認済みで適用前の段階
- `_resolveSecondaryTrackModePolicy` は現行使用中のため、退避名リストに保持したまま Step 5 で扱う
