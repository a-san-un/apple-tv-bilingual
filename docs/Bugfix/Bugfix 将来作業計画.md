# Bugfix 将来作業計画 2026-08-17

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-17（改訂版）  
**このシートの役割:** 将来作業の計画（残っている計画だけにする）

---

## 計画の全体像

マスタープランの依存ツリーに従い、完了した F-1 / F-2 / F-3 / F-6 の後続として  
F-4 → F-5 → F-7 → F-8 → B / C の順番で着手します。  
現在の実装シートで扱う F-4 が完了した後の作業をここで管理します。

```
[F-1] panelOpen 誤連動の切り離し ← ✅ 完了
      ↓
[F-2] restart 後のネイティブトグル生成漏れ修正 ← ✅ 完了
      ↓
[F-3] 言語設定変更のリアルタイム反映 ← ✅ 完了
      ↓
[F-6] デバッグパネル OFF 時不可 ← ✅ 完了
      ↓
[F-4] sendResponse 漏れ修正 ← 実装シートで管理（最優先）
      ↓
[F-5=Bugfix-E] ネイティブ字幕復元 ← このシートで計画
      ↓
[F-7] extensionEnabled=ON 引き継ぎ時の #atv-toggle-btn 不表示 ← このシートで計画
      ↓
[F-8] DevConsole 大量ログ削減 ← このシートで計画
      ↓
[Bugfix-B / C] ← このシートで計画
```

---

## Bugfix-E（F-5）：OFF 時のネイティブ字幕 track 復元

**着手条件:** F-4 完了後

### 背景と目的

拡張機能を OFF にしたとき、Apple TV+ 本来の字幕機能を使える状態に戻す。  
拡張が `subtitle track.mode` を変更した分だけ元に戻す方針（仕様確定書 §2 参照）。

### 実装方針（仕様確定書 §2 に準拠）

**対象ファイル:** `settings-runtime.js`（`extensionEnabled === false` ブランチ）

`cue-controller.js` の `restoreNativeSubtitles()` を呼ぶ。  
この関数は `primaryTrackOriginalMode`（bind 前に保存した元の mode）に track.mode を戻す。  
拡張が track.mode の値を自分で決定しないことが重要。

```js
// settings-runtime.js の OFF ブランチ
if (!extensionEnabled) {
  cueController?.restoreNativeSubtitles?.();  // ★ Bugfix-E: 元の mode に戻す
  destroyUiHosts();
  applyDone();
  return;
}
```

**注意点:**
- `restoreNativeSubtitles` は `cue-controller.js` に公開済みのため新規実装は不要
- `atvb-cue-suppress` スタイル要素の除去も `restoreNativeSubtitles` 内で行われていることを確認する
- Apple TV+ が独自に track を管理しているため、`mode` を直接書き換えず元の値に戻すことを徹底する

### 検証手順

1. 拡張 ON の状態で再生し、拡張の字幕パネル・オーバーレイが動いていることを確認
2. ネイティブトグルで拡張を OFF にする
3. Apple TV+ の字幕設定から任意の字幕 track を選択し、字幕が表示されることを確認
4. SPA ナビゲーション後も同様に動作することを確認

### 完了条件

- [ ] OFF 後に Apple TV+ のネイティブ字幕が正常に表示される
- [ ] 字幕の二重表示や競合が発生しない

---

## F-7：`extensionEnabled=ON` 引き継ぎ起動時に `#atv-toggle-btn` が表示されない

**着手条件:** F-5 完了後

### 背景と目的

拡張機能を `extensionEnabled=ON` の状態で再読み込みした際、  
字幕パネル開閉ボタン（`#atv-toggle-btn`）が表示されない問題。  
初期化フローの復元順序に競合または抜けがあると推定される。

### 原因仮説

- `initializeUI()` や `applyPanelVisibility()` が storage 復元の**前**に一度  
  `extensionEnabled=false` 前提で実行されて `#atv-toggle-btn` を非表示にしている
- その後 `extensionEnabled=true` を読んでも再表示処理が呼ばれていない

### 実装方針

**対象ファイル:** `content.js`、`panel-ui.js`

1. `content.js` の初期化フローで `extensionEnabled` / `panelOpen` を storage から読み込む順序と、`#atv-toggle-btn` の表示処理が呼ばれるタイミングを確認する
2. `applyPanelVisibility()` / `initializeUI()` が `extensionEnabled` の復元前に実行される経路がないか確認する
3. `extensionEnabled=true` 読み込み後に `#atv-toggle-btn` の表示を確実に再評価するよう修正する

### 検証手順

1. `extensionEnabled=ON` のまま拡張を再読み込みする
2. `#atv-toggle-btn` が表示されることを確認する
3. `extensionEnabled=OFF` → `ON` の切り替えでも正常に表示されることを確認する

### 完了条件

- [ ] `extensionEnabled=ON` 引き継ぎ起動時に `#atv-toggle-btn` が表示される
- [ ] `extensionEnabled=OFF` → `ON` の切り替えでも表示が正常になる

---

## F-8：DevConsole の大量ログ出力削減

**着手条件:** F-7 完了後

### 背景と目的

DevConsole の詳細表示時に大量ログが連続出力されており、  
デバッグの妨げになっている。常設ログを削減することを最優先とする。

### 原因

- `secondary-sync force-rebind skipped` が 0.25〜0.55 秒ごとに常設ログとして連続出力されている（F-3 調査時に確認済み）
- `DEBUG_SECONDARY_SUBS = true` 配下のログがフラグ ON 時に全量流れる設計になっている
- `syncInterval` 系の定期ログが毎サイクル出力されている

### 実装方針

**対象ファイル:** `cue-controller.js`、`settings-runtime.js`（および関連 sync 系モジュール）

- **最優先:** 常設ログを `DEBUG_SECONDARY_SUBS` 等のデバッグフラグ配下へ移動する
- `syncInterval` 系の毎サイクル出力を同様にフラグ配下へ移動する
- デバッグフラグ配下のログはフラグ ON 時のみ出力、OFF 時は出力しない

### 検証手順

1. `tv-log.log` を確認し、常設ログの具体的な削除・移動候補を列挙する
2. 常設ログを `DEBUG_SECONDARY_SUBS` 等のフラグ配下へ移動する
3. 修正後、DevConsole でログが大幅に減っていることを確認する

### 完了条件

- [ ] `secondary-sync force-rebind skipped` が常設出力されなくなる
- [ ] `syncInterval` 系の毎サイクル出力がフラグ配下に収まる
- [ ] DevConsole の通常使用時にログが著しく減少している

---

## Bugfix-B：module 初期化順の修正

**着手条件:** F-8 完了後

### 背景と目的

Console に `recovery_module_unavailable` のログが出ており、  
何らかのモジュールが依存先モジュールの初期化前に呼び出されている。  
F-4〜F-8 の修正で初期化フローが安定した後に、初期化順を整理する。

### 修正方針

**対象ファイル:** `content.js`（モジュール初期化の呼び出し順）

- 各モジュールの `init()` 呼び出し順序を依存関係に従って並び替える
- 依存先が未初期化の場合にエラーではなく警告ログを出すよう各モジュールを修正する

**初期化順の目安（依存関係が少ないものを先に）:**

```
1. debug-logger
2. state / storage
3. vtt-normalizer
4. subtitle-fetcher
5. panel / overlay（UI 系）
6. settings-runtime（最後に apply）
```

### 検証手順

1. Console に `recovery_module_unavailable` のログが出ないことを確認
2. 各モジュールの init が正しい順序で呼ばれていることをログで確認

### 完了条件

- [ ] `recovery_module_unavailable` ログが Console に出ない
- [ ] 全モジュールが正常に初期化されることをログで確認

---

## Bugfix-C：recovery module の修正

**着手条件:** Bugfix-B 完了後

### 背景と目的

Bugfix-B で初期化順を修正した後も recovery module 自体に問題が残る場合の対応。  
recovery module の存在意義（フォールバック処理）を再評価し、  
不要であれば削除、必要であれば正しく実装する。

### 修正方針

**対象ファイル:** recovery module 関連ファイル（要特定）

- recovery module が何をしているかをコードベースで確認する
- Bugfix-B 後に不要になった処理があれば削除する
- 必要なフォールバック処理は残し、正しいタイミングで呼ばれるよう修正する

### 検証手順

1. recovery module の処理が意図した通りに動作することを確認
2. 副作用（不要な再初期化など）が発生しないことを確認

### 完了条件

- [ ] recovery module が正しく動作する（または不要と判断して削除）
- [ ] `recovery_module_unavailable` 関連のログが完全に解消される

---

## 将来作業の優先順位テーブル

| 順序 | Bugfix | やること | 着手条件 | 状態 |
|---|---|---|---|---|
| ① | F-5 / E | `cue-controller.restoreNativeSubtitles()` で track を元の mode に戻す | F-4 完了後 | ⏸ 待機中 |
| ② | F-7 | `extensionEnabled=ON` 引き継ぎ時の `#atv-toggle-btn` 不表示を修正 | F-5 完了後 | ⏸ 待機中 |
| ③ | F-8 | DevConsole 大量ログを常設ログ削減・フラグ配下移動で解消 | F-7 完了後 | ⏸ 待機中 |
| ④ | B | module 初期化順を依存関係に従って並び替える | F-8 完了後 | ⏸ 待機中 |
| ⑤ | C | recovery module の要否判断と修正または削除 | B 完了後 | ⏸ 待機中 |

---

## スコープ外（将来作業にも含めない）

- Issue-32 リファクタ（`content.js` 分割）本体 → Bugfix シリーズ完了後に別途計画
  - ただしバグ調査中に邪魔な箇所は随時整理してよい（マスタープラン参照）
- AI tooltip / 単語ポップアップ機能
- `overlay-block-resolver` の挙動変更
- パフォーマンス最適化
