# Bugfix 実装シート 2026-08-17（改訂版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-17（改訂版）  
**このシートの役割:** 今の症状・今やる修正箇所・検証手順・実機ログの要点を 1 枚に集約する（完了で archive）

---

## 現在の症状（2026-08-17 実機テスト確認ベース）

| # | 症状 | 観察事実 | 関連 ID | 状態 |
|---|---|---|---|---|
| 1 | restart 後にネイティブトグルが DOM に出ない | 別エピソード・別作品移動時。パネル開閉で復帰していたが、修正済み | F-2 | ✅ 完了 |
| 2 | 言語設定変更時、secondary track が不安定になる | `ja → ko` で ko track は bind されるが表示されない。言語定義共通化で解消 | F-3 | ✅ 完了 |
| 3 | メッセージチャネルクローズエラー（初回のみ） | `A listener indicated an asynchronous response...` はまだ残るが、UI 復旧は達成済み。`extensionEnabled=ON` 引き継ぎ時の `#atv-toggle-btn` 未表示も F-4 に吸収して解消 | F-4 | 🟠 持ち越し |
| 4 | ネイティブ字幕が OFF 後に復元されない | Bugfix-E 未実装。次の主対象 | F-5 | 🟡 次着手 |
| 5 | トグル OFF 時にデバッグパネルが見られない | `options.js` の `bindDebugLogRealtimeWatch()` 未定義問題を修正済み | F-6 | ✅ 完了 |
| 6 | DevConsole に大量ログが連続出力される | `secondary-sync force-rebind skipped` 等が常設ログとして毎サイクル流れている | F-8 | 🔴 未着手 |

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
- **ON 復帰時に `#atv-toggle-btn` と overlay 字幕が再表示される**
- **`waitForPlaybackReady()` の結果を `state.video` / `state.dialogEl` に反映してから restart する流れで、UI build 停止は解消した**
- **F-4 の修正で `background.js` 側に recoverable error 判定と再送処理を追加済み**
- **ただし async response エラーはまだ完全には解消していないため、F-4 は完了ではなく残件扱い**
- **`extensionEnabled=ON` 引き継ぎ時の `#atv-toggle-btn` 未表示は、F-4 の `state.video` / `state.dialogEl` 反映修正に吸収して解消した**

---

## 修正対象ファイル一覧

- `background.js`（F-4）
- `settings-runtime.js`（F-4）
- `cue-controller.js`（F-5）
- `cue-controller.js` / `settings-runtime.js`（F-8）

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
- `modules/language-definitions.js`（新規追加）
- `modules/settings-schema.js`
- `manifest.json`
- `content.js`
- `cue-controller.js`
- `subtitle-track-resolver.js`
- `options.html` / `options.css` / `options.js`
- `popup.html` / `popup.js`

**症状:**
- secondary を `ja` → `ko` に変更すると、韓国語 secondary が表示されない
- `ja` / `en` 以外の言語を選択すると、secondary が空表示になることがある
- 日本語字幕は復帰済み

**修正内容（2026-08-17）:**
- `modules/language-definitions.js` を新設し、popup / options / resolver の言語候補参照を共通定義へ一本化した
- `content.js` / `cue-controller.js` / `subtitle-track-resolver.js` で secondary subtitle の選定・復帰・native menu 同期の責務を整理した
- `modules/settings-schema.js` と `manifest.json` を新構成に合わせて更新した
- `options.html` / `options.css` / `options.js` / `popup.html` / `popup.js` で設定 UI と選択 UI の関連実装を調整した

**禁止事項（継続）:**
- `hidden && cuesLength === 0` の track を `ensureSubtitleTracksUsable()` 対象から一律除外しない
- この除外は日本語 subtitle track の初期 cue 読み込みも止め、日本語字幕を消したため取り消し済み

**判定:** 完了。`ja → ko`、`ko → ja`、`ja → en` を popup 保存だけで実機確認済み。

---

### ✅ F-6（完了）: トグル OFF 時にデバッグパネルが見られない

**ファイル:** `options.js`

**症状:** トグル OFF 時はデバッグパネルが表示できず、ログ確認が不能だった。

**原因:** `options.js` の `bindDebugLogRealtimeWatch()` 関数が未定義で、ログ画面初期化が途中で止まっていた。

**修正内容:** リアルタイム監視初期化を整理し、OFF 状態でもデバッグログ画面に到達できるようにした。

**確認結果:** 拡張 OFF 状態からでもデバッグパネルを開いてログ確認できる。

**判定:** 完了。

---

### 🟠 F-4（持ち越し）: メッセージチャネルクローズエラー

**対象ファイル:**
- `background.js`
- `settings-runtime.js`

**症状:**
- 初回付近で次のエラーが出ることがある
- `Uncaught (in promise) Error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received`
- `extensionEnabled=ON` 引き継ぎ時に `#atv-toggle-btn` と overlay 字幕が表示されない副症状があったが、F-4 に吸収して解消済み

**今回の整理で分かったこと:**
- `startBilingual trace` までは出るのに UI build ログが出ないケースがあった
- その時点では `waitForPlaybackReady()` 後も `state.video` が未反映で、`startBilingual()` が早期 return していた
- これにより、字幕パネル開閉ボタンと overlay 字幕が出ない副症状が発生していた
- `secondary element ensure skipped: panel host missing` は主因ではなく、panel host 未生成時に secondary 描画が先行した結果ログだった

**今回の修正内容:**
- `settings-runtime.js`
  - `safeSendResponse` による 1 回応答の構造を維持
  - `waitForPlaybackReady()` 成功後に `state.video = playbackRef.video` を反映
  - `playbackRef.dialog` があれば `state.dialogEl` に反映
  - その後に ON 側 restart へ進むよう修正
- `background.js`
  - `sendSettingsChangedWithRecovery()` に error 分類処理を追加
  - `Receiving end does not exist`
  - `message channel closed before a response was received`
  - `A listener indicated an asynchronous response by returning true`
  を recoverable error として扱う整理を追加
  - content script 生存確認と再注入を行う `ensureContentScriptReady()` を追加
  - recoverable なケースでは再送を試すよう変更

**修正後の結果:**
- ON 復帰時に `#atv-toggle-btn` と overlay 字幕が表示される状態まで復旧した
- 字幕や UI の主要症状は解消した
- ただし async response エラー自体はまだ完全には消えていない

**現時点の見立て:**
- 単純な `sendResponse` 漏れだけではなく、content script 再注入・SPA 遷移・tab activation・message channel の寿命競合が残っている可能性が高い
- 実害は限定的であり、F-5 を止めるブロッカーではない
- 次に詰めるときは、background 側の送信期待設計を「応答必須」か「fire-and-forget」かで先に固定する

**判定:** 部分改善。持ち越し。

---

### 🟡 F-5（次着手）: ネイティブ字幕が OFF 後に復元されない

**対象ファイル:**
- `cue-controller.js`
- 必要に応じて `content.js`
- 必要に応じて `settings-runtime.js`
- 必要に応じて `subtitle-track-resolver.js`

**症状:**
- 拡張を OFF にしたあと、Apple TV+ ネイティブ字幕が期待通り復元されないことがある
- secondary subtitle 用に触った track / mode の影響が native 側へ残っている可能性がある

**今回の着手前提:**
- ON 復帰時の `#atv-toggle-btn` / overlay 字幕未表示は解消済み
- F-4 は残件だが、主症状は解消しブロッカーではない
- 次は Bugfix-E として native 字幕復元責務を整理してよい

**確認したい点:**
- `restoreNativeSubtitles()` が、どの track をどの mode に戻すべきか
- OFF 時に native menu 状態・track.mode・resolver state のどこまで戻すべきか
- 別エピソード遷移後や restart 後でも同じ復元ルールで成立するか

**最初の調査ポイント:**
- `cue-controller.restoreNativeSubtitles()` の現在実装
- OFF 分岐から `restoreNativeSubtitles()` までの呼び出し経路
- secondary track bind / mode 変更の副作用がどこに残るか
- native 字幕復元後に resolver / panel / overlay state と矛盾しないか

**完了条件:**
- 拡張 OFF 後に Apple TV+ ネイティブ字幕が操作可能かつ期待通り表示される
- ON→OFF→ON を繰り返しても native / extension の責務が混線しない

---

### 🔴 F-8（未着手）: DevConsole に大量ログが連続出力される

**対象ファイル:**
- `cue-controller.js`
- `settings-runtime.js`

**症状:** `secondary-sync force-rebind skipped` 等が常設ログとして毎サイクル流れている。

**見立て:** 調査用ログが定常運用でも流れ続けている。F-5 以降でログ粒度を整理する。

**判定:** 未着手。

---

## 現時点の作業順

1. F-5: `cue-controller.restoreNativeSubtitles()` の責務整理と native 字幕復元の安定化
2. F-4: message channel closed の race 条件を別スコープで継続調査
3. F-8: DevConsole の常設ログ整理

---

## 次に見るファイル

- `cue-controller.js`
- `content.js`
- `settings-runtime.js`
- `subtitle-track-resolver.js`

---

## 補足メモ

- `panel host missing` は原因ログではなく、UI 未生成時に secondary 描画が先行した結果ログとして扱う
- `startBilingual trace` の後に `ui build step` が無い場合は、まず `state.video` 未設定や playback ready 前 return を疑う
- F-4 は「未着手」ではなく、UI 復旧まで進んだが async response エラーが残る状態
- `extensionEnabled=ON` 引き継ぎ時の `#atv-toggle-btn` 未表示は、独立した F-7 ではなく F-4 に吸収済み
- F-5 着手時は、native 字幕復元の仕様を `cue-controller.restoreNativeSubtitles()` に寄せて整理する
