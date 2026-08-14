# Bugfix 将来作業計画 2026-08-14

**ブランチ:** `issue-32-content-core-split`
**対応マスタープラン:** Bugfix マスタープラン 2026-08-14（改訂版）
**このシートの役割:** 将来作業の計画（残っている計画だけにする）

---

## 計画の全体像

マスタープランの依存ツリーに従い、F-2 → F-1 → F-3 → F-4 → F-5 → B/C の順番で着手します。
現在の実装シートで扱う F-2〜F-4 が完了した後の作業をここで管理します。

```
[F-2] restart 後のネイティブトグル生成漏れ修正 ← 実装シートで管理
      ↓
[F-1] panelOpen 誤連動の切り離し ← 実装シートで管理
      ↓
[F-3] 言語設定変更のリアルタイム反映 ← 実装シートで管理
      ↓
[F-4] sendResponse 漏れ修正 ← 実装シートで管理
      ↓
[F-5=Bugfix-E] ← このシートで計画
      ↓
[Bugfix-B / C] ← このシートで計画
```

---

## Bugfix-E：OFF 時のネイティブ字幕 track 復元

**着手条件:** F-1 / F-2 完了後

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

## Bugfix-B：module 初期化順の修正

**着手条件:** F-5 完了後

### 背景と目的

Console に `recovery_module_unavailable` のログが出ており、
何らかのモジュールが依存先モジュールの初期化前に呼び出されている。
F-2〜F-5 の修正で初期化フローが安定した後に、初期化順を整理する。

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
| ① | F-5 / E | `cue-controller.restoreNativeSubtitles()` で track を元の mode に戻す | F-1/F-2 完了後 | ⏸ 待機中 |
| ② | B | module 初期化順を依存関係に従って並び替える | F-5 完了後 | ⏸ 待機中 |
| ③ | C | recovery module の要否判断と修正または削除 | B 完了後 | ⏸ 待機中 |

---

## スコープ外（将来作業にも含めない）

- Issue-32 リファクタ（`content.js` 分割）本体 → Bugfix シリーズ完了後に別途計画
  - ただしバグ調査中に邪魔な箇所は随時整理してよい（マスタープラン参照）
- AI tooltip / 単語ポップアップ機能
- `overlay-block-resolver` の挙動変更
- パフォーマンス最適化
