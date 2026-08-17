# Bugfix 将来作業計画 2026-08-17（改訂版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-17（改訂版）  
**このシートの役割:** 将来作業の計画（残っている計画だけにする）

---

## 計画の全体像

マスタープランの依存ツリーに従い、完了した F-1 / F-2 / F-3 / F-6 を除いた  
残件と将来作業だけをここで管理する。  
2026-08-17 時点では、F-4 は UI 復旧まで進んだが async response エラーが残っているため残件化し、  
次の主作業は F-5 とする。

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
[F-5=Bugfix-E] ネイティブ字幕復元 ← 🟡 次着手
      ↓
[F-8] DevConsole 大量ログ削減 ← このシートで計画
      ↓
[Bugfix-B / C] ← このシートで計画
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
- UI 復旧は達成済みであり、F-5 を止めるブロッカーではない
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

## Bugfix-E（F-5）：OFF 時のネイティブ字幕復元

**着手条件:** なし（次着手）

### 背景と目的

拡張機能を OFF にしたとき、Apple TV+ 本来の字幕機能を使える状態に戻す。  
今回の修正で ON 復帰時の UI build 停止は解消したため、次は OFF 側の native 字幕復元を詰める。  
拡張が secondary 用に触った `track.mode` や選択状態の副作用を native 側へ残さないことが目的。

### 現在の前提

- ON 復帰時に `#atv-toggle-btn` と overlay 字幕が出ない問題は解消済み
- F-4 は残件だが、主症状は解消しブロッカーではない
- native 字幕復元の主責務は `cue-controller.restoreNativeSubtitles()` 周辺に寄せて整理する方針

### 実装方針

**主対象ファイル:** `cue-controller.js`

**関連確認ファイル:**
- `content.js`
- `settings-runtime.js`
- `subtitle-track-resolver.js`

### まず確認すること

1. `restoreNativeSubtitles()` が現在どの track / mode を復元対象にしているか
2. `primaryTrackOriginalMode` 等、元状態の保存と復元が本当に対になっているか
3. secondary 用に触った track が native 字幕復元後も残留していないか
4. OFF 遷移時の呼び出し順が `destroyUiHosts()` より前後どちらであるべきか
5. Apple TV+ native menu 状態と `TextTrack.mode` 復元の責務分担が一致しているか

### 実装の考え方

- 拡張が自前で「native 字幕の最終状態」を決め打ちしない
- できるだけ「拡張が変更した分だけ元に戻す」方向で統一する
- OFF 時の UI 破棄と native 字幕復元を責務分離する
- restart / SPA 遷移後でも同じ復元ルールで成立するようにする

### 検証手順

1. 拡張 ON の状態で primary / secondary 字幕が表示されていることを確認
2. ネイティブトグルで拡張を OFF にする
3. Apple TV+ の字幕設定から任意の字幕 track を選択し、字幕が表示されることを確認
4. ON → OFF → ON を繰り返し、native / extension の責務が混線しないことを確認
5. 別エピソード / 別作品へ遷移後も同様に確認する

### 完了条件

- [ ] OFF 後に Apple TV+ のネイティブ字幕が正常に表示される
- [ ] 字幕の二重表示や競合が発生しない
- [ ] ON → OFF → ON を繰り返しても native / extension の責務が混線しない

---

## F-8：DevConsole の大量ログ出力削減

**着手条件:** F-5 完了後

### 背景と目的

DevConsole の詳細表示時に大量ログが連続出力されており、  
デバッグの妨げになっている。常設ログを削減することを最優先とする。

### 現在見えている問題

- `secondary-sync force-rebind skipped` が常設ログとして繰り返し出る
- `DEBUG_SECONDARY_SUBS = true` 配下のつもりだったログが、実質常設化している可能性がある
- `syncInterval` 系の毎サイクル出力が、通常利用時のノイズになっている

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
F-5 / F-8 で主要挙動が安定した後に、初期化順の整理へ進む。

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

## Bugfix-C：recovery module の修正

**着手条件:** Bugfix-B 完了後

### 背景と目的

Bugfix-B で初期化順を修正した後も recovery module 自体に問題が残る場合の対応。  
recovery module の存在意義を再評価し、不要なら削除、必要なら正しい責務へ整理する。

### 修正方針

**対象ファイル:** recovery module 関連ファイル（要特定）

- recovery module が何をしているかをコードベースで確認する
- Bugfix-B 後に不要になった処理があれば削除する
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
| ① | F-5 / E | `cue-controller.restoreNativeSubtitles()` を中心に native 字幕復元を安定化する | なし | 🟡 次着手 |
| ② | F-4 残件 | message channel closed 系エラーの race を切り分ける | F-5 と並行可 | 🟠 持ち越し |
| ③ | F-8 | DevConsole の常設ログを整理する | F-5 後 | 🔴 未着手 |
| ④ | Bugfix-B | module 初期化順の修正 | F-8 後 | 🔴 未着手 |
| ⑤ | Bugfix-C | recovery module の責務整理 | Bugfix-B 後 | 🔴 未着手 |

---

## 補足メモ

- このシートには完了済み作業の詳細は残さず、残件と将来タスクだけを置く
- F-7 は 2026-08-17 の `state.video` / `state.dialogEl` 反映修正で主症状が解消したため、将来作業から外す
- F-4 は「未着手」ではなく、UI 復旧まで進んだ上で async response エラーだけが残っている状態
- 次スレッドではまず F-5 の実装前整理を行い、その後必要なら F-4 残件の再切り分けへ戻る
