# Bugfix 実装シート 2026-08-16（改訂版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-14（改訂版）  
**このシートの役割:** 今の症状・今やる修正箇所・検証手順・実機ログの要点を 1 枚に集約する（完了で archive）

---

## 現在の症状（2026-08-16 実機テスト確認ベース）

| # | 症状 | 観察事実 | 関連 ID | 状態 |
|---|---|---|---|---|
| 1 | restart 後にネイティブトグルが DOM に出ない | 別エピソード・別作品移動時。パネル開閉で復帰していたが、現在は修正済み | F-2 | ✅ 完了 |
| 2 | 言語設定変更時、secondary track が不安定になる | `ja → ko` で ko track は bind されるが、`showing ↔ hidden` を往復して表示されない | F-3 | 🟠 調査中 |
| 3 | メッセージチャネルクローズエラー（初回のみ） | `onRuntimeMessage @ settings-runtime.js:690` 付近で発生 | F-4 | 🔴 未着手 |
| 4 | ネイティブ字幕が OFF 後に復元されない | Bugfix-E 未実装 | F-5 | ⏸ F-3/F-4 後 |
| 5 | トグル OFF 時にデバッグパネルが見られない | F12 コンソール依存 | F-6 | 保留 |

### ✅ 動作確認済み（2026-08-16）

- primary / secondary 字幕の同期表示は正常
- 二重表示・ちらつきなし
- 字幕パネルが開いているときの ON→OFF→ON 復帰は正常
- 別エピソード・別作品遷移後も `#atvb-native-toggle` が表示される（F-2 完了）
- **字幕パネル開閉時の overlay 位置追従は正常**（F-1 完了）
- **パネル開閉時も overlay 字幕サイズは維持される**（F-1 完了）
- **日本語字幕は現在表示できている**
  - `ensureSubtitleTracksUsable()` で `hidden && cuesLength === 0` の track を除外する実験は取り消し済み
  - この除外は日本語字幕まで消したため、再導入しない

---

## 修正対象ファイル一覧

- `content.js`
- `panel-ui.js`
- `overlay-controller.js`
- `settings-runtime.js`
- `cue-controller.js`
- `subtitle-track-resolver.js`（必要に応じて確認）

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

**判定:** 完了。 [cite:62]

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

**判定:** 完了。位置追従・中央復帰・文字サイズ維持を実機確認済み。 [cite:62]

---

### F-3（最優先）: 言語設定変更時の secondary track 不安定化

**対象ファイル:**
- `popup.js`
- `settings-runtime.js`
- `cue-controller.js`
- `subtitle-track-resolver.js`（必要に応じて）

**症状:**
- secondary を `ja` → `ko` に変更すると、韓国語 secondary が表示されない
- `ja` / `en` 以外の言語を選択すると、secondary が空表示になることがある
- 日本語字幕は現在復帰済み

**確定した設定反映経路:**
1. `popup.js` が `primaryLang` / `secondaryLang` を検証して `chrome.storage.sync` へ保存する
2. popup が `APPLY_SETTINGS_TO_APPLE_TV` を `reason: "popup_save"` と設定値付きで送信する
3. `settings-runtime.js` の `onRuntimeMessage` が受信し、`state.contentSettings` と `requestedSecondaryLang` を更新する
4. `applySettingsAsync` が実行され、secondary 側は `cueController.syncSecondarySubtitleTrack(...)` の明示的同期経路に到達する

**ここまでで否定された仮説:**
- 「`applySettingsAsync` が言語変更時に secondary track の再 bind を呼んでいない」は不十分
- 実機ログ上、`ko` track に対する bind 自体は発生している

**実機ログで確認した事実（`ja → ko`）:**
- 初回 bind は `secondary-sync state-transition` の `phase: "bind-apply"`
- 対象は `selectedTrackLanguage: "ko"`、`selectedTrackKind: "subtitles"`
- `requestedMode: "hidden"` が適用され、`secondary-sync mode-applied` と `secondary track bind` が出る
- bind 時点で `selectedTrackCuesLength: 0`、`activeCuesLength: 0`
- hidden のまま維持されている周期では `sameTrackRef: true` / `sameMode: true` となり `bind-skip` になる
- しかし、その後に `secondary-sync force-rebind skipped` が連続する
- このログ時点では、同じ `ko` track が `trackMode: "showing"`、`cuesLength: 0`、`activeCuesLength: 0`、`currentCueTextLength: 0` になっている
- 次の同期で `sameTrackRef: true` / `sameMode: false` と判定され、secondary controller が `showing → hidden` に戻して再 bind する
- 結果として、同じ `ko` track 上で `showing ↔ hidden` の往復が続く

**現時点の結論:**
- secondary controller 自体は `ko` track を `hidden` で bind するところまで正常に動作している
- `secondary-sync force-rebind skipped` 分岐は mode を変更していない
- `ko` track を `showing` にしている別経路がある
- 最有力候補は `ensureSubtitleTracksUsable(..., finalMode: "showing")` を使う primary 側、または共通 recovery / native subtitle 制御
- primary 側の mode 制御が secondary track を巻き込んでいる可能性が高い

**現在の調査対象:**
- `cue-controller.js` の `ensureSubtitleTracksUsable()` 全呼び出し元
- `track.mode = "showing"`、または showing を設定する helper の全経路
- `bindPrimarySubtitleTrack` / `bindSecondarySubtitleTrack` / `syncSecondarySubtitleTrack` の責務境界
- `subtitle-track-resolver.js` の選択対象 track と mode 変更の関係
- Apple TV+ 側が track mode を再変更している可能性

**現行の未コミット実験変更（`cue-controller.js`）:**
- `sameTrackRef && sameMode && secondaryTrackCleanup` の no-op bind を early return
- `bind-skip` / `secondary-sync bind skipped` ログを `DEBUG_SECONDARY_SUBS` 配下へ移動
- `forceRebind && selectedTrackHasNoCues` の場合は unbind を避け、空描画・scene rebuild 後に return
- `secondary-sync force-rebind skipped` は常設ログとして維持
- 構文チェックと diff の空白チェックは通過済み

**やってはいけないこと:**
- `hidden && cuesLength === 0` の track を `ensureSubtitleTracksUsable()` 対象から一律除外しない
- この実験は日本語 subtitle track の初期 cue 読み込みも止め、日本語字幕を消したため取り消し済み

**次にやること:**
1. `cue-controller.js` の `ensureSubtitleTracksUsable()` の全呼び出し元を列挙する
2. 各呼び出しについて `requestedLang`、`finalMode`、`reason`、対象 track を確認する
3. `track.mode` を `showing` に変更するコードと helper を全検索する
4. primary bind が secondary track を巻き込んでいる場合、primary の track 選択・mode 操作対象を primary track に限定する
5. 修正後、`ja → ko`、`ko → ja`、`ja → en` を popup 保存だけで実機検証する
6. F-3 が安定してから F-4 に進む

#### F-3 観測用ログ

Apple TV+ の再生タブで先に実行する。

```js
window.DEBUG_SECONDARY_SUBS = true;
```

`ja → ko` の切替後に実行する。

```js
JSON.stringify(
  (window.__atvDebugLogs || []).filter((entry) => {
    const message = String(entry?.message || "");
    const all = JSON.stringify(entry);

    return (
      /secondary-sync force-rebind skipped|secondary-sync state-transition|secondary-sync mode-applied|secondary track bind|secondary-sync rebind-required|primary-bind|APPLY_SETTINGS_TO_APPLE_TV|SETTINGS_CHANGED/i.test(
        message
      ) &&
      /ko|한국어/i.test(all)
    );
  }),
  null,
  2
)
```

---

### F-4: onRuntimeMessage の sendResponse 漏れ

**ファイル:** `settings-runtime.js`（`onRuntimeMessage` 関数、690行付近）

**エラー:**
```text
Uncaught (in promise) Error: A listener indicated an asynchronous response
by returning true, but the message channel closed before a response was received
```

**原因仮説:**
`onRuntimeMessage` が `return true` を返して非同期応答を宣言しているが、  
`applySettingsAsync` が失敗・例外終了したケースで `sendResponse` が漏れる可能性がある。

**確認すること:**
- `APPLY_SETTINGS` 系メッセージで成功時・失敗時とも `sendResponse` が呼ばれるか
- `return true` が必要な分岐と不要な分岐が整理されているか

**着手順:** F-3 の mode 競合解消後に着手する。

---

### F-5（後回し）: ネイティブ字幕 track 復元（Bugfix-E）

**ファイル:** `settings-runtime.js`（`extensionEnabled === false` ブランチ）

**仕様:** `cue-controller.js` の `restoreNativeSubtitles()` を使う（仕様確定書 §2 参照）。

**状態:** F-3 / F-4 後に着手。

---

### F-6（保留）: トグル OFF 時にデバッグパネルが見られない

**症状:** トグル OFF 時はデバッグパネルが表示できず、ログ確認が不能。  
**暫定対策:** F12 コンソールで `window.__atvDebugLogs` を直接確認する。  
**状態:** 保留。F-3 優先。

---

## 次の実装順

1. `cue-controller.js` の `ensureSubtitleTracksUsable()` の全呼び出し元を確認する
2. `track.mode = "showing"` を行うコードと helper の全経路を確認する
3. primary bind が secondary track を巻き込んでいないか切り分ける
4. F-3 を修正し、`ja → ko`、`ko → ja`、`ja → en` を popup 保存だけで実機確認する
5. `settings-runtime.js` の `onRuntimeMessage` で `sendResponse` 成功 / 失敗経路を確認する
6. F-4 を修正する
7. F-5（ネイティブ字幕復元）へ進む
