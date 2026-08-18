# Bugfix 実装シート 2026-08-18（改訂版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-18（改訂版）
**このシートの役割:** 今の症状・今やる修正箇所・検証手順・実機ログの要点を 1 枚に集約する（完了で archive）

---

## 現在の症状（2026-08-18 実機テスト確認ベース）

| # | 症状 | 観察事実 | 関連 ID | 状態 |
|---|---|---|---|---|
| 1 | restart 後にネイティブトグルが DOM に出ない | 別エピソード・別作品移動時。パネル開閉で復帰していたが、修正済み | F-2 | ✅ 完了 |
| 2 | 言語設定変更時、secondary track が不安定になる | `ja → ko` で ko track は bind されるが表示されない問題は、言語定義共通化と resolver / binder 整理で解消 | F-3 | ✅ 完了 |
| 3 | メッセージチャネルクローズエラー（初回のみ） | `A listener indicated an asynchronous response...` はまだ残るが、UI 復旧は達成済み。`extensionEnabled=ON` 引き継ぎ時の `#atv-toggle-btn` 未表示も F-4 に吸収して解消 | F-4 | 🟠 持ち越し |
| 4 | ネイティブ字幕メニューに干渉せず OFF 後復元を成立させたい | `restoreNativeSubtitles before/after` の観測導線は維持済み。現在は `video::cue` 非表示を外しつつ、primary / secondary の listener binding を同一 helper へ寄せる前段を進行中。`track.mode` はまだ未変更 | F-5 | 🟠 実装途中 |
| 5 | トグル OFF 時にデバッグパネルが見られない | `options.js` の `bindDebugLogRealtimeWatch()` 未定義問題を修正済み。さらに全ログ表示を追加して content ログ観測を強化 | F-6 | ✅ 完了 |
| 6 | DevConsole に大量ログが連続出力される | `secondary-sync force-rebind skipped` 等の noisy ログを一次 suppress 済み。`subtitle-view-resolver.js` / `overlay-controller.js` の probe ログも通常時は抑制したが、恒久的なログレベル整理は未完了 | F-8 | 🟠 一次整理済み |
| 7 | 長時間再生で Renderer メモリ使用量が大きく増える | Chrome Renderer プロセスで 6GB 級消費を観測。listener / observer / timer の解除漏れを継続調査中 | M-1 | 🟠 調査継続 |

### ✅ 動作確認済み（2026-08-18）

- primary / secondary 字幕の同期表示は正常
- 二重表示・ちらつきなし
- 字幕パネルが開いているときの ON→OFF→ON 復帰は正常
- 別エピソード・別作品遷移後も `#atvb-native-toggle` が表示される（F-2 完了）
- **字幕パネル開閉時の overlay 位置追従は正常**（F-1 完了）
- **パネル開閉時も overlay 字幕サイズは維持される**（F-1 完了）
- **字幕パネル開閉時の動画本体 70/30 追従も正常**（F-1a 完了）
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
- **`overlay.css` から `video::cue { visibility: hidden; }` を削除済み**
- **`modules/cue-track-binder.js` の `createTrackListenerBinding()` を primary / secondary 両方へ配線済み**
- **`subtitle-view-resolver.js` / `overlay-controller.js` の probe ログは通常時 suppress 済み**

---

## 修正対象ファイル一覧

- `background.js`（F-4）
- `settings-runtime.js`（F-4 / F-5 / F-8）
- `cue-controller.js`（F-3 / F-5 / F-8）
- `content.js`（F-3 / F-5 / F-8）
- `subtitle-track-resolver.js`（F-3 / F-5 / F-8）
- `secondary-subtitle-dom.js`（F-5 / F-8）
- `modules/cue-track-binder.js`（F-5）
- `modules/playback-context-controller.js`（F-5 / F-8）
- `modules/playback-controls-layout-controller.js`（F-8）
- `modules/subtitle-sync-controller.js`（F-5 / F-8）
- `sync-interval-orchestrator.js`（F-5 / F-8）
- `overlay-controller.js`（F-5 / F-8）
- `overlay.css`（F-5）
- `panel-renderer.js`（F-8）
- `panel-ui.js`（F-1a / F-8）
- `options.html` / `options.js`（F-5 / F-6）
- `subtitle-view-resolver.js`（F-5 / F-8）

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

### ✅ F-1a（完了）: 字幕パネル開閉で動画本体が 70/30 に追従しない

**対象ファイル:**
- `panel-ui.js`
- `content.js`
- `modules/playback-controls-layout-controller.js`

**症状:**
- 字幕パネルを開いても `.video-player__video-container` の幅が変化せず、動画本体が右パネルぶん縮まらない
- DevConsole から manual で `layoutController.applyPanelLayout(true)` を呼ぶと 70/30 になるのに、通常のトグル操作では反映されない

**原因:**
- `panel-ui.js` の `togglePanel()` が `applyLayout?.()` を引数なしで呼んでおり、`isVisible` が `undefined` のまま `applyPanelLayout()` に渡っていた

**修正内容:**
- `panel-ui.js` で `applyLayout?.(state.panelOpen)` を呼ぶよう修正

**確認結果:**
- manual `applyPanelLayout(true)` 実行後
  - `.video-player__video-container`
    - inline: `width: 70%`, `maxWidth: 70%`, `flexShrink: 0`
    - computed: `width: 1111.59px`, `maxWidth: 70%`, `flexShrink: 0`
  - `.video-container.is-opaque`
    - inline: `right: 30%`
    - computed: `right: 471.891px`, `position: absolute`
- 通常のパネル開閉でも同等の 70/30 レイアウト追従が成立

**判定:** 完了。

---

### ✅ F-3（完了）: 言語設定変更時の secondary track 不安定

**対象ファイル:**
- `modules/language-definitions.js`
- `content.js`
- `cue-controller.js`
- `subtitle-track-resolver.js`

**症状:**
- popup で secondary 言語を変更すると、候補 track は bind されるが表示されないケースがあった

**修正内容:**
- 言語候補定義を `modules/language-definitions.js` に一本化
- resolver / binder / controller の責務を整理し、candidate 選定から bind 後表示までの流れを安定化

**確認結果:**
- `ja → ko`
- `ko → ja`
- `ja → en`
  を popup 保存で実機確認済み

**判定:** 完了。

---

### 🟠 F-4（持ち越し）: message チャネルクローズエラー

**対象ファイル:**
- `background.js`
- `settings-runtime.js`
- `content.js`

**現状:**
- `A listener indicated an asynchronous response...` はまだ初回に残ることがある
- ただし UI build 停止や ON 復帰失敗は解消済み

**完了済み部分:**
- `background.js` 側に recoverable error 判定と再送処理を追加済み
- `waitForPlaybackReady()` の結果を `state.video` / `state.dialogEl` に反映してから restart する流れへ修正済み

**残件:**
- 初回のみ残るチャネルクローズ警告の根治
- background / content 間メッセージのタイミング差を再点検

---

### 🟠 F-5（実装途中）: ネイティブ字幕メニューに干渉せず OFF 後復元できるようにする

**対象ファイル:**
- `overlay.css`
- `modules/cue-track-binder.js`
- `content.js`
- `cue-controller.js`
- `subtitle-view-resolver.js`
- `overlay-controller.js`

**今回の方針:**
- native 字幕メニューに干渉しない
- 拡張機能側 primary / secondary を同じ処理モデルへ寄せる
- 共通化の基準は secondary 側の hidden-lock モデルをベースにする
- primary 側で使っていた `timeupdate` / `seeked` / `playing` の補助発火は共通 helper に取り込む

**今完了している段階:**
1. `modules/cue-track-binder.js` に `createTrackListenerBinding()` を追加
2. `content.js` で `createCueController` に helper を渡す
3. `cue-controller.js` の primary bind を helper 利用へ置換
4. `cue-controller.js` の secondary bind を helper 利用へ置換

**まだやっていないこと:**
- `track.mode` の統一変更
- secondary ベースの hidden-lock モデルを primary にまで適用する本体ロジック
- native menu 非干渉と OFF restore の両立確認

**同時に行った方針変更:**
- `overlay.css` から `video::cue { visibility: hidden; }` を削除
- `subtitle-view-resolver.js` / `overlay-controller.js` の probe ログは通常時 suppress
- `content.js` で `layoutController` を参照可能にし、DevConsole から manual `applyPanelLayout(true)` を確認しやすくした

**次の着手点:**
1. 共通 helper 化後の primary / secondary bind / cleanup の安定性確認
2. `track.mode` を secondary ベースの hidden-lock モデルへ統一する設計の確定
3. OFF 時 restore と native menu 操作が両立するかの再検証
4. `restoreNativeSubtitles before/after` と実画面の整合確認

---

### ✅ F-6（完了）: トグル OFF 時にデバッグパネルが見られない

**対象ファイル:**
- `options.html`
- `options.js`

**修正内容:**
- `bindDebugLogRealtimeWatch()` 未定義問題を修正
- 全ログ表示を追加し、content の `settings` / `ui` / `subtitle` ログを追えるようにした

**判定:** 完了。

---

### 🟠 F-8（一次整理済み）: DevConsole の大量ログ整理

**対象ファイル:**
- `settings-runtime.js`
- `cue-controller.js`
- `subtitle-view-resolver.js`
- `overlay-controller.js`
- `panel-ui.js`

**現状:**
- `secondary-sync force-rebind skipped` などの noisy ログは一次 suppress 済み
- `subtitle-view-resolver.js` / `overlay-controller.js` の probe ログも通常時抑制済み

**残件:**
- ログカテゴリごとのレベル整理
- debug flag ごとの再有効化導線整理
- 次スレッドで必要最小限だけ戻せるようにする

---

### 🟠 M-1（調査継続）: Renderer メモリ増加

**症状:**
- Chrome Renderer プロセスで 6GB 級のメモリ消費を観測
- 長時間再生や UI 再初期化の繰り返しで listener / observer 系の蓄積が疑われる

**観測済み事項:**
- Heap Snapshot 比較で `EventListener` / `V8EventListener` / `RegisteredEventListener` の増加傾向を確認
- `overlay-controller.js` は stop 系 cleanup が比較的揃っている
- `panel-ui.js` の resize listener など、解除経路の明確化が必要な箇所が残る

**次の着手点:**
1. listener / observer / timer の登録解除対応表を作る
2. 長時間再生時の heap / listener 数を再測定する
3. restart / destroyUiHosts / panel close / navigation ごとの cleanup 完了条件を整理する

---

## 次スレッド開始時の最優先

1. F-5 の `track.mode` 統一方針を確定する
2. helper 化後の primary / secondary bind / cleanup を再検証する
3. native menu 非干渉と OFF restore を両立できるか実機確認する
4. Renderer メモリ 6GB 問題のリーク候補を継続調査する
5. F-4 の async response 初回警告を持ち越しで詰める
