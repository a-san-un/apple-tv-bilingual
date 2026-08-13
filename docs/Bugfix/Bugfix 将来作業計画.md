# Bugfix 将来作業計画 2026-08-13

**ブランチ:** `issue-32-content-core-split`
**対応マスタープラン:** Bugfix マスタープラン 2026-08-13（改訂版）
**このシートの役割:** 将来作業の計画（残っている計画だけにする）

---

## 計画の全体像

マスタープランの依存ツリーに従い、D → A → E → B/C の順番で着手します。
現在の実装シートで扱う D / A が完了した後の作業をここで管理します。

```
[Bugfix-D] 完了 ✅（実装シートで管理）
      ↓
[Bugfix-A] 完了 ✅（実装シートで管理）
      ↓
[Bugfix-E] ← このシートで計画
      ↓
[Bugfix-B / C] ← このシートで計画
```

---

## Bugfix-E：OFF 時のネイティブ字幕 track 復元

**着手条件:** Bugfix-A 完了後

### 背景と目的

拡張機能を OFF にしたとき、Apple TV+ 本来の字幕機能を使える状態に戻す必要がある。
現状、OFF 操作後に Apple TV+ のネイティブ字幕が動かなくなるケースが報告されており、
その原因は拡張が `subtitle track.mode` を `disabled` にしたまま復元していないためと推定される。

### 修正方針

**対象ファイル:** `settings-runtime.js`（または字幕 track を操作しているモジュール）

```js
// OFF 時の処理に追加するイメージ
function restoreNativeSubtitleTrack() {
  const video = document.querySelector('video');
  if (!video) return;

  const tracks = Array.from(video.textTracks);
  tracks.forEach(track => {
    if (track.mode === 'disabled') {
      track.mode = 'showing'; // ★ Bugfix-E: ネイティブ字幕を復元
    }
  });
}
```

**注意点:**
- 復元する track が正しいもの（ユーザーが選択していた言語）かを確認すること
- Apple TV+ が独自に track を管理している場合、`mode` を直接書き換えると競合する可能性がある
- 副作用（字幕の二重表示など）がないか再生中に確認すること

### 検証手順

1. 拡張 ON の状態で再生し、ネイティブ字幕ではなく拡張の字幕パネルが動いていることを確認
2. ネイティブトグルで拡張を OFF にする
3. Apple TV+ の字幕設定から任意の字幕 track を選択し、字幕が表示されることを確認
4. SPA ナビゲーション後も同様に動作することを確認

### 完了条件

- [ ] OFF 後に Apple TV+ のネイティブ字幕が正常に表示される
- [ ] 字幕の二重表示や競合が発生しない

---

## Bugfix-B：module 初期化順の修正

**着手条件:** Bugfix-A / E 完了後

### 背景と目的

Console に `recovery_module_unavailable` のログが出ており、
何らかのモジュールが依存先モジュールの初期化前に呼び出されている。
D / A の修正で初期化フローが安定した後に、初期化順を整理する。

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
| ① | E | OFF → `subtitle track.mode` を `showing` に戻す | A 完了後 | ⏸ 待機中 |
| ② | B | module 初期化順を依存関係に従って並び替える | A/E 完了後 | ⏸ 待機中 |
| ③ | C | recovery module の要否判断と修正または削除 | B 完了後 | ⏸ 待機中 |

---

## スコープ外（将来作業にも含めない）

- Issue-32 リファクタ（`content.js` 分割）本体 → Bugfix シリーズ完了後に別途計画
- AI tooltip / 単語ポップアップ機能
- `overlay-block-resolver` の挙動変更
- パフォーマンス最適化
