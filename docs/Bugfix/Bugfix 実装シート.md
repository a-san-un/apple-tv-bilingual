# Bugfix 実装シート 2026-08-17（改訂版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-17（改訂版）  
**このシートの役割:** 今の症状・今やる修正箇所・検証手順・実機ログの要点を 1 枚に集約する（完了で archive）

---

## 現在の症状（2026-08-17 実機テスト確認ベース）

| # | 症状 | 観察事実 | 関連 ID | 状態 |
|---|---|---|---|---|
| 1 | restart 後にネイティブトグルが DOM に出ない | 別エピソード・別作品移動時。パネル開閉で復帰していたが、修正済み | F-2 | ✅ 完了 |
| 2 | 言語設定変更時、secondary track が不安定になる | `ja → ko` で ko track は bind されるが表示されない問題は、言語定義共通化と resolver / binder 整理で解消 | F-3 | ✅ 完了 |
| 3 | メッセージチャネルクローズエラー（初回のみ） | `A listener indicated an asynchronous response...` はまだ残るが、UI 復旧は達成済み。`extensionEnabled=ON` 引き継ぎ時の `#atv-toggle-btn` 未表示も F-4 に吸収して解消 | F-4 | 🟠 持ち越し |
| 4 | ネイティブ字幕が OFF 後に復元されない | `restoreNativeSubtitles before/after` の観測導線は整備済み。現時点では `spa_navigation` 直後に `textTrackCount=0` を観測しており、次は track 準備タイミングの切り分けが主対象 | F-5 | 🟠 調査継続 |
| 5 | トグル OFF 時にデバッグパネルが見られない | `options.js` の `bindDebugLogRealtimeWatch()` 未定義問題を修正済み。さらに全ログ表示を追加して content ログ観測を強化 | F-6 | ✅ 完了 |
| 6 | DevConsole に大量ログが連続出力される | `secondary-sync force-rebind skipped` 等の noisy ログを一次 suppress 済み。恒久的なログレベル整理は未完了 | F-8 | 🟠 一次整理済み |

### ✅ 動作確認済み（2026-08-17）

- primary / secondary 字幕の同期表示は正常
- 二重表示・ちらつきなし
- 字幕パネルが開いているときの ON→OFF→ON 復帰は正常
- 別エピソード・別作品遷移後も `#atvb-native-toggle` が表示される（F-2 完了）
- **字幕パネル開閉時の overlay 位置追従は正常**（F-1 完了）
- **パネル開閉時も overlay 字幕サイズは維持される**（F-1 完了）
- **日本語字幕は現在表示できている**
  - `ensureSubtitleTracksUsable()` で `hidden && cuesLength === 0` の track を除外する実験は取り消し済み
  - この除外は日本語字幕まで消したため、再導入しない
- **言語設定変更時の secondary track 安定化（F-3 完了）**
  - `modules/language-definitions.js` を新設し、言語候補参照を共通定義へ一本化
  - `ja → ko`、`ko → ja`、`ja → en` を popup 保存で実機確認済み
- **デバッグパネルが ON/OFF 状態から独立して常時アクセス可能になった（F-6 完了）**
- **設定ページで全ログ表示を使い、content の `settings` / `ui` / `subtitle` ログを確認できる**
- **`restoreNativeSubtitles before/after` の snapshot を `tv-log.txt` で取得できる**
- **ON 復帰時に `#atv-toggle-btn` と overlay 字幕が再表示される**
- **`waitForPlaybackReady()` の結果を `state.video` / `state.dialogEl` に反映してから restart する流れで、UI build 停止は解消した**
- **F-4 の修正で `background.js` 側に recoverable error 判定と再送処理を追加済み**
- **ただし async response エラーはまだ完全には解消していないため、F-4 は完了ではなく残件扱い**
- **`extensionEnabled=ON` 引き継ぎ時の `#atv-toggle-btn` 未表示は、F-4 の `state.video` / `state.dialogEl` 反映修正に吸収して解消した**
- **最新コミット `fix: F-5 調査向けに字幕 restore とログ観測を整理する (Issue #32)` を push 済み**

---

## 修正対象ファイル一覧

- `background.js`（F-4）
- `settings-runtime.js`（F-4 / F-5 / F-8）
- `cue-controller.js`（F-3 / F-5 / F-8）
- `content.js`（F-3 / F-5 / F-8）
- `subtitle-track-resolver.js`（F-3 / F-5 / F-8）
- `secondary-subtitle-dom.js`（F-5 / F-8）
- `modules/playback-context-controller.js`（F-5 / F-8）
- `modules/playback-controls-layout-controller.js`（F-8）
- `modules/subtitle-sync-controller.js`（F-5 / F-8）
- `sync-interval-orchestrator.js`（F-5 / F-8）
- `panel-renderer.js`（F-8）
- `panel-ui.js`（F-8）
- `options.html` / `options.js`（F-5 / F-6）

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

**判定:** 完了。

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

### ✅ F-3（完了）: 言語設定変更時の secondary track 不安定化

**対象ファイル:**
- `modules/language-definitions.js`
- `subtitle-track-resolver.js`
- `modules/subtitle-sync-controller.js`
- `content.js`

**症状:**
- popup で言語設定を変更すると、secondary track が bind されても表示されないことがある
- `ja → ko`、`ko → ja`、`ja → en` で挙動が安定しない

**原因:**
- 言語候補定義が複数箇所に散っており、resolver と binder の参照条件が揺れていた
- 設定変更時の再 bind / 再同期責務が分散していた

**修正内容:**
- `modules/language-definitions.js` を新設し、言語候補参照を共通定義へ一本化
- `subtitle-track-resolver.js` と `modules/subtitle-sync-controller.js` の責務を整理
- popup 保存後の再 bind / 再同期フローを見直した

**確認結果:**
- `ja → ko`
- `ko → ja`
- `ja → en`
  の各ケースで secondary 字幕が安定表示することを実機確認した

**判定:** 完了。

---

### 🟠 F-4（持ち越し）: `message channel closed` / `asynchronous response` 系エラー

**対象ファイル:**
- `background.js`
- `settings-runtime.js`

**症状:**
```text
Uncaught (in promise) Error: A listener indicated an asynchronous response
by returning true, but the message channel closed before a response was received
```

**対応内容:**
- `background.js`
  - recoverable error 判定を追加
  - メッセージ再送処理を追加
- `settings-runtime.js`
  - `waitForPlaybackReady()` 後に `state.video` / `state.dialogEl` を反映してから restart するよう修正

**改善した点:**
- ON 復帰時の `#atv-toggle-btn` 未表示は解消
- overlay 字幕が build されない症状も解消
- UI 側の復旧は達成済み

**残件:**
- 初回の async response エラー自体はまだ完全には消えていない
- ただし F-5 の主調査を優先するため、現時点では持ち越し

**判定:** 部分改善・未完了。

---

### 🟠 F-5（主対象）: 拡張 OFF 後のネイティブ字幕復元

**対象ファイル:**
- `cue-controller.js`
- `settings-runtime.js`
- `content.js`
- `subtitle-track-resolver.js`
- `modules/playback-context-controller.js`
- `modules/subtitle-sync-controller.js`
- `secondary-subtitle-dom.js`
- `sync-interval-orchestrator.js`
- `options.html`
- `options.js`

**症状:**
- 拡張を OFF にした後、Apple TV+ native 字幕が使える状態へ正しく戻らないことがある

**現時点の観測:**
- `restoreNativeSubtitles before/after` の snapshot を取得できるようにした
- 設定ページの全ログ表示で、content の `settings` / `ui` / `subtitle` ログを追える
- `tv-log.txt` で以下を確認済み
  - `SETTINGS_CHANGED disable-branch`
  - `restore call before/after`
  - `text track snapshot before/after`
- `spa_navigation` 直後には `textTrackCount=0` の瞬間がある

**現時点の主仮説:**
- restore 実装そのものより、**text track 未準備タイミングで restore が走って空振りしている可能性が高い**
- native 字幕は DOM 復元対象ではなく、`<video>.textTracks` / `activeCues` 側で考えるべき
- 実機上で画面表示字幕は `mode === "showing"` かつ `activeCueCount > 0` の track から取得できた
- よって復元対象は **拡張が変更した `TextTrack.mode` と `atvb-cue-suppress`** とみなすのが自然

**F-5 調査補足: Apple TV+ native 字幕構造（2026-08-17 夜）**
- Apple TV+ native 字幕は通常 DOM / `amp-overlay` の open Shadow DOM からは取得できず、字幕 DOM を直接復元する方式は取れない
- native 字幕の実体は `<video>` の `textTracks` / `activeCues` 側で観測できる
- 実機上で画面に出ている字幕は、`mode === "showing"` かつ `activeCueCount > 0` の track から特定できた
- このため F-5 の復元対象は native 字幕 DOM ではなく、**拡張が変更した `TextTrack.mode` と `atvb-cue-suppress`（`video::cue` 抑制）**である
- 一方で `spa_navigation` 直後には `textTrackCount=0` も観測済みのため、現時点の主因候補は restore 対象の誤認より **track 未準備タイミング** の可能性が高い
- 詳細ログ・再利用コマンドは `docs/Bugfix/F-5 調査メモ.md` を参照

**次に確認する論点:**
- `restoreNativeSubtitles()` が現在どの track / mode を復元対象にしているか
- `primaryTrackOriginalMode` など、元状態保存と復元が対になっているか
- secondary 用に触った track / mode の影響が native 側へ残っていないか
- OFF 分岐での呼び出し順が `destroyUiHosts()` より前後どちらであるべきか
- native menu 状態と `TextTrack.mode` 復元の責務を混同していないか
- `textTrackCount=0` のタイミングをどの責務で待つべきか

**判定:** 調査継続。次スレッドの最優先対象。

---

### ✅ F-6（完了）: デバッグパネル OFF 時に設定ページへ入れない

**対象ファイル:**
- `options.html`
- `options.js`

**症状:**
- デバッグパネル OFF 時に設定ページへ遷移できない
- `bindDebugLogRealtimeWatch()` 未定義で設定ページの一部機能が壊れていた

**修正内容:**
- `options.js` の未定義参照を修正
- デバッグ UI 非表示時でも設定ページへ入れるよう導線を見直し
- 全ログ表示を追加し、content の `settings` / `ui` / `subtitle` ログ観測を強化

**確認結果:**
- デバッグパネル OFF 状態でも設定ページに入れる
- 全ログ表示で content ログを確認できる

**判定:** 完了。

---

### 🟠 F-8（一次整理済み）: DevConsole の大量ログ削減

**対象ファイル:**
- `cue-controller.js`
- `content.js`
- `subtitle-track-resolver.js`
- `secondary-subtitle-dom.js`
- `modules/playback-context-controller.js`
- `modules/playback-controls-layout-controller.js`
- `modules/subtitle-sync-controller.js`
- `sync-interval-orchestrator.js`
- `panel-renderer.js`
- `panel-ui.js`

**症状:**
- `secondary-sync force-rebind skipped` などの常設ログが多く、必要なログが埋もれる

**対応内容:**
- noisy ログの一部 suppress を実施済み

**残件:**
- 恒久的なログレベル設計は未完了
- F-5 完了後に再着手する

**判定:** 一次整理済み・未完了。

---

## 今このシートで次に見る場所

1. F-5 セクション
2. `cue-controller.js` の `restoreNativeSubtitles()`
3. `settings-runtime.js` / `content.js` の OFF 分岐
4. `docs/Bugfix/F-5 調査メモ.md`
