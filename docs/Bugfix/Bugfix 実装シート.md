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
| 3 | メッセージチャネルクローズエラー（初回のみ） | `onRuntimeMessage @ settings-runtime.js:690` 付近で発生 | F-4 | 🔴 未着手 |
| 4 | ネイティブ字幕が OFF 後に復元されない | Bugfix-E 未実装 | F-5 | ⏸ F-4 後 |
| 5 | トグル OFF 時にデバッグパネルが見られない | `options.js` の `bindDebugLogRealtimeWatch()` 未定義問題を修正済み | F-6 | ✅ 完了 |
| 6 | `extensionEnabled=ON` 引き継ぎ起動時に `#atv-toggle-btn` が表示されない | 初期化フローの復元順序に競合か抜けがある可能性 | F-7 | 🔴 未着手 |
| 7 | DevConsole に大量ログが連続出力される | `secondary-sync force-rebind skipped` 等が常設ログとして毎サイクル流れている | F-8 | 🔴 未着手 |

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

---

## 修正対象ファイル一覧

- `settings-runtime.js`（F-4）
- `cue-controller.js`（F-5）
- `content.js`（F-7）
- `panel-ui.js`（F-7）
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

**原因:** `options.js` の `bindDebugLogRealtimeWatch()` 関数が未定義のまま呼ばれていた。

**修正内容:** `bindDebugLogRealtimeWatch()` の実装を追加し、デバッグパネルの表示制御を ON/OFF 状態から独立させ、常時アクセス可能にした。

**判定:** 完了。

---

### F-4（最優先）: onRuntimeMessage の sendResponse 漏れ

**ファイル:** `settings-runtime.js`（`onRuntimeMessage` 関数、690行付近）

**エラー:**
```text
Uncaught (in promise) Error: A listener indicated an asynchronous response
by returning true, but the message channel closed before a response was received
```

**発生箇所:** `applySettingsAsync @ settings-runtime.js:663` / `onRuntimeMessage @ settings-runtime.js:690`

**原因仮説:**
`onRuntimeMessage` が `return true` を返して非同期応答を宣言しているが、  
`applySettingsAsync` が失敗・例外終了したケースで `sendResponse` が漏れる可能性がある。  
初回のみ発生し、その後は再現しないことから、チャネル生存期間と処理完了タイミングの問題と推定する。

**確認すること:**
- `APPLY_SETTINGS` 系メッセージで成功時・失敗時・例外時の全経路で `sendResponse` が呼ばれるか
- `return true` が必要な分岐と不要な分岐が整理されているか

**次にやること:**
1. `onRuntimeMessage` 内の `APPLY_SETTINGS` 系処理で、全終了経路に `sendResponse` が存在するか確認する
2. `try/catch` の `catch` 節でも `sendResponse` が呼ばれるか確認する
3. `return true` が不要な分岐（同期で完結するもの）を整理する
4. 修正後、popup 保存操作でコンソールにチャネルクローズエラーが出ないことを実機確認する
5. F-4 完了後に F-5 へ進む

---

### F-5（後回し）: ネイティブ字幕 track 復元（Bugfix-E）

**ファイル:** `settings-runtime.js`（`extensionEnabled === false` ブランチ）、`cue-controller.js`

**症状:** OFF 後にネイティブ字幕が表示されない。

**実装方針:** `cue-controller.js` の `restoreNativeSubtitles()` を呼ぶ（仕様確定書 §2 参照）。

**状態:** F-4 完了後に着手。

---

### F-7（未着手）: `extensionEnabled=ON` 引き継ぎ起動時に `#atv-toggle-btn` が表示されない

**対象ファイル:**
- `content.js`
- `panel-ui.js`

**症状:**
- `extensionEnabled = ON` を引き継いで起動したとき、字幕パネル開閉ボタン（`#atv-toggle-btn`）が表示されない

**原因仮説:**
- `content.js` の初期化フローで `extensionEnabled` の状態復元 → `panelOpen` 復元 → UI 構築の順序に競合か抜けがある
- `panelOpen` を復元したとき、`#atv-toggle-btn` の表示処理が走っていない可能性が高い
- `initializeUI()` や `applyPanelVisibility()` が storage 復元の**前**に一度 `extensionEnabled=false` 前提で実行されて `#atv-toggle-btn` を非表示にし、その後 `extensionEnabled=true` を読んでも再表示が呼ばれていない可能性がある

**次にやること:**
1. `content.js` の初期化フローで `extensionEnabled` / `panelOpen` を storage から読み込む順序と、`#atv-toggle-btn` の表示処理が呼ばれるタイミングを確認する
2. `applyPanelVisibility()` / `initializeUI()` が `extensionEnabled` の復元前に実行される経路がないか確認する
3. `extensionEnabled=true` 読み込み後に `#atv-toggle-btn` の表示を確実に再評価するよう修正する
4. 修正後、`extensionEnabled=ON` のまま再読み込みして `#atv-toggle-btn` が表示されることを実機確認する

**着手順:** F-4 / F-5 の後に着手する。

---

### F-8（未着手）: DevConsole の大量ログ出力

**対象ファイル:**
- `cue-controller.js`
- `settings-runtime.js`（および関連する sync 系モジュール）

**症状:**
- DevConsole の詳細表示時に大量ログが連続出力される

**原因:**
- `secondary-sync force-rebind skipped` が 0.25〜0.55 秒ごとに常設ログとして連続出力されている（F-3 調査時に確認済み）
- `DEBUG_SECONDARY_SUBS = true` 配下のログがフラグ ON 時に全量流れる設計になっている
- `syncInterval` 系の定期ログが毎サイクル出力されている

**削減方針:**
- **最優先:** 常設ログを減らす。`secondary-sync force-rebind skipped` など毎サイクル出る常設ログを `DEBUG_SECONDARY_SUBS` 等のデバッグフラグ配下へ移動するだけで大半は解決する
- `syncInterval` 系の定期ログも同様にフラグ配下へ移動する
- デバッグフラグ（`DEBUG_SECONDARY_SUBS` など）配下のログは現行維持、フラグ OFF 時は出力しない

**次にやること:**
1. `tv-log.log` を確認し、常設ログの具体的な削除・移動候補を列挙する
2. 常設ログを `DEBUG_SECONDARY_SUBS` 等のフラグ配下へ移動する
3. `syncInterval` 系の毎サイクル出力をフラグ配下へ移動する
4. 修正後、DevConsole でログが大幅に減っていることを確認する

**着手順:** F-7 の後に着手する。

---

## 次の実装順

1. `settings-runtime.js` の `onRuntimeMessage` で `APPLY_SETTINGS` 系メッセージの全終了経路を確認する
2. `sendResponse` 漏れを修正し、`return true` の分岐を整理する（F-4）
3. F-4 完了後、popup 保存操作でコンソールエラーが出ないことを実機確認する
4. F-5（ネイティブ字幕復元）へ進む
5. `content.js` の初期化フローで `extensionEnabled=ON` 引き継ぎ時の `#atv-toggle-btn` 表示漏れを修正する（F-7）
6. `tv-log.log` を確認し、常設ログの削除・フラグ配下移動を実施する（F-8）
