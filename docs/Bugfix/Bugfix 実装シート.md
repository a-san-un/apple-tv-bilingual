# Bugfix 実装シート 2026-08-16（改訂版）

**ブランチ:** `issue-32-content-core-split`
**対応マスタープラン:** Bugfix マスタープラン 2026-08-14（改訂版）
**このシートの役割:** 今の症状・今やる修正箇所・検証手順（完了で archive）

---

## 現在の症状（2026-08-16 実機テスト確認済み）

| # | 症状 | 観察事実 | 関連 ID | 状態 |
|---|---|---|---|---|
| 1 | restart 後にネイティブトグルが DOM に出ない | 別エピソード・別作品移動時。パネル開閉で復帰 | F-2 | ✅ 完了 |
| 2 | 言語設定変更がリアルタイムに反映されない | ja→ko 変更後もメインのみ。ja/en 以外は非表示 | F-3 | 🔴 未着手 |
| 3 | メッセージチャネルクローズエラー（初回のみ） | `onRuntimeMessage @ settings-runtime.js:690` | F-4 | 🔴 未着手 |
| 4 | ネイティブ字幕が OFF 後に復元されない | Bugfix-E 未実装 | F-5 | ⏸ F-3 後 |
| 5 | トグル OFF 時にデバッグパネルが見られない | F12 コンソール依存 | F-6 | 保留 |

### ✅ 動作確認済み（2026-08-16 テストで確認）

- primary / secondary 字幕の同期表示は正常
- 二重表示・ちらつきなし
- 字幕パネルが開いているときの ON→OFF→ON 復帰は正常
- 別エピソード・別作品遷移後も `#atvb-native-toggle` が表示される（F-2 完了）
- **字幕パネル開閉時の overlay 位置追従は正常**（F-1 完了）
- **パネル開閉時も overlay 字幕サイズは維持される**（F-1 完了）

---

## 修正対象ファイル一覧

- `content.js`
- `panel-ui.js`
- `overlay-controller.js`
- `settings-runtime.js`

---

### ✅ F-2（完了）: restart 後のネイティブトグル生成漏れ

**ファイル:** `content.js`（`watchForPlayerTabs`）

**原因:** Apple TV+ の Svelte がエピソード遷移時にタブ DOM を再マウントすることで
`#atvb-native-toggle` が消える。従来の `watchForPlayerTabs` は初回注入後に
`obs.disconnect()` していたため、再マウント後の消失に気づけなかった。

**修正内容:** Observer を disconnect しないよう変更し、「タブが存在するがトグルが消えている」
状態を検知したら即再注入するループに切り替えた。
あわせて `destroyUiHosts` に `closest("li")` が null のときの fallback 除去を追加した。

**確認結果:** 別エピソードや別作品への遷移後も、字幕パネルを開閉しなくても
`#atvb-native-toggle` が表示されることを確認した。

---

### ✅ F-1（完了）: 字幕パネル開閉で表示位置が追従しない

**対象ファイル:**
- `content.js`
- `panel-ui.js`
- `overlay-controller.js`

**症状の再現パターン:**
- 字幕パネルを開くと、overlay が動画中央のままで右パネルぶんを考慮しない
- 字幕パネルを閉じると、overlay が動画中央へ戻る保証が弱い
- 位置調整後に文字サイズまで小さくなった

**原因:**
- `panel-ui.js` の `applyPanelVisibility(show)` が overlay host の width 直接変更だけを行い、`overlay-controller.js` 側の正本再配置を呼んでいなかった
- `overlay-controller.js` の `syncOverlayPositionToPlayer()` が引数なし再同期経路では `panelOpen` を知らず、再描画や resize 後に閉状態基準へ戻る余地があった
- `applyOverlayTypography({ ...rect, width: visibleWidth })` により、位置補正用の可視領域幅が字幕サイズ計算にも流入していた

**修正内容:**
- `content.js`
  - `createOverlayController({...})` に `getPanelOpen: () => state.panelOpen` を注入
- `panel-ui.js`
  - `applyPanelVisibility(show)` で overlay host の width 直接変更を削除
  - `requestAnimationFrame()` 内で `deps.overlayController?.syncOverlayPositionToPlayer?.({ panelOpen: show, reason: "panel-visibility-change" })` を呼ぶよう変更
- `overlay-controller.js`
  - `syncOverlayPositionToPlayer(options = {})` 化
  - `panelOpen` は `options.panelOpen` を優先し、未指定時は `getPanelOpen()` fallback を参照
  - 位置と幅は `visibleWidth = rect.width - panelWidth` を使って計算
  - フォントサイズ計算は `applyOverlayTypography(rect)` に戻し、player 全体矩形ベースへ統一

**実機確認ログ:**
- パネル開状態
  - `panelDisplay='block'`
  - `panelWidth=418.796875`
  - `videoWidth=1396`
  - `overlayCenterX=488.59375`
  - 左側可視領域中央と一致
- パネル閉状態
  - `panelDisplay='none'`
  - `panelWidth=0`
  - `videoWidth=1396`
  - `overlayCenterX=698`
  - 動画中央と一致
- フォントサイズ
  - `primaryFontSize='28.192px'`
  - `secondaryFontSize='23.787px'`
  - パネル開閉で変化しない

**判定:** 完了。位置追従・中央復帰・文字サイズ維持を実機確認済み。

---

### F-3（最優先）: 言語設定変更のリアルタイム反映

**ファイル:** `settings-runtime.js`（`applySettingsAsync` 関数）

**症状:**
- secondary を `ja` → `ko` に変更してもメイン字幕しか出ない
- `ja` / `en` 以外の言語を選択すると secondary が非表示になる

**原因仮説:**
`applySettingsAsync` が言語変更を `chrome.storage` に保存するだけで、
実行中の `cueController` に対してトラック再バインドを呼んでいない。

**確認すること:**
- `cueController` が `settings-runtime.js` のスコープから参照可能か
- `bindPrimarySubtitleTrack` / `bindSecondarySubtitleTrack` の再実行経路があるか
- 参照不可なら `restartBilingual()` 経由での再初期化フォールバックが必要か

---

### F-4: onRuntimeMessage の sendResponse 漏れ

**ファイル:** `settings-runtime.js`（`onRuntimeMessage` 関数、690行付近）

**エラー:**
```text
Uncaught (in promise) Error: A listener indicated an asynchronous response
by returning true, but the message channel closed before a response was received
```

**原因:**
`onRuntimeMessage` が `return true` を返して非同期応答を宣言しているが、
`applySettingsAsync` が失敗・例外終了したケースで `sendResponse` が漏れる可能性がある。

**確認すること:**
- `APPLY_SETTINGS` 系メッセージで成功時・失敗時とも `sendResponse` が呼ばれるか
- `return true` が必要な分岐と不要な分岐が整理されているか

---

### F-5（後回し）: ネイティブ字幕 track 復元（Bugfix-E）

**ファイル:** `settings-runtime.js`（`extensionEnabled === false` ブランチ）

**仕様:** `cue-controller.js` の `restoreNativeSubtitles()` を使う（仕様確定書 §2 参照）。

**状態:** F-3 / F-4 後に着手。

---

## 次の実装順

1. `settings-runtime.js` の `applySettingsAsync` を読み、言語変更時の再バインド経路を確認する
2. `onRuntimeMessage` の `sendResponse` 成功 / 失敗経路を確認する
3. F-3 修正
4. F-4 修正
5. F-5（ネイティブ字幕復元）へ進む