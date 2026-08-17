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
- `hidden && cuesLength === 0` の track を `ensureSubtitleTracksUsable()` 対象から除外しない
- 日本語 cue 読み込みを止める条件分岐を再導入しない

**確認結果:** `ja → ko`、`ko → ja`、`ja → en` を popup 保存で実機確認し、secondary の表示が追従することを確認した。

**判定:** 完了。

---

### 🟠 F-4（持ち越し）: restart 後の message channel close エラー

**対象ファイル:**
- `background.js`
- `settings-runtime.js`

**症状:**
- `A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received` が初回 restart 系メッセージで出ることがある

**修正済み内容:**
- `background.js` で recoverable error 判定を追加
- `settings-runtime.js` / restart 経路で再送処理を追加
- `waitForPlaybackReady()` の結果を `state.video` / `state.dialogEl` に反映してから restart する流れへ修正

**現状評価:**
- UI 側の復旧は達成済み
- `extensionEnabled=ON` 引き継ぎ時の `#atv-toggle-btn` 未表示は解消した
- ただし async response エラー自体はまだ完全には消えていない

**次にやること:**
1. 初回送信で content 不在になる条件を再確認する
2. reinject 直後の再送タイミングを追加で見直す
3. F-5 本体が落ち着いた後に、message channel エラーの完了条件を明文化して詰める

**判定:** 未完了。持ち越し。

---

### 🟠 F-5（調査継続）: OFF 後にネイティブ字幕が復元されない

**対象ファイル:**
- `cue-controller.js`
- `content.js`
- `settings-runtime.js`
- `subtitle-track-resolver.js`
- `secondary-subtitle-dom.js`
- `modules/playback-context-controller.js`
- `modules/subtitle-sync-controller.js`
- `sync-interval-orchestrator.js`
- `options.html`
- `options.js`

**症状:**
- 拡張を OFF にした後、Apple TV+ 本来のネイティブ字幕へ戻らないことがある

**今回の修正内容（観測導線整備）:**
- `cue-controller.js`
  - `restoreNativeSubtitles()` を見直し、primary / secondary track の cleanup、元 mode の復元、CSS suppress 解除、bound track 参照クリアを一連で扱うよう整理した
  - `restoreNativeSubtitles before` / `restoreNativeSubtitles after` の snapshot を取得できるようにした
- `options.html` / `options.js`
  - デバッグログに全ログ表示を追加し、content の `settings` / `ui` / `subtitle` を設定ページから常時確認できるようにした
- `content.js` / `subtitle-track-resolver.js` / `secondary-subtitle-dom.js` / 関連ファイル
  - noisy な詳細ログを suppress し、F-5 調査で必要なログが埋もれにくい状態へ整理した

**今回の実機ログで確認できたこと:**
- `tv-log.txt` 上で以下を同時に確認できる
  - `SETTINGS_CHANGED disable-branch`
  - `ネイティブトグル OFF apply start`
  - `ネイティブトグル OFF restore call before`
  - `text track snapshot`（`reason: "restoreNativeSubtitles before"`）
  - `text track snapshot`（`reason: "restoreNativeSubtitles after"`）
  - `ネイティブトグル OFF restore call after`
  - `ネイティブトグル OFF apply done`

**主要観測結果:**
- `spa_navigation` 直後の snapshot では
  - `textTrackCount=0`
  - `showingTrackCount=0`
  - `hiddenTrackCount=0`
  - `disabledTrackCount=0`
- primary / secondary の track 情報も空
- したがって、現段階では「restore 実装の mode 復元漏れ」よりも、「restore 実行時点で参照可能な text track がまだ存在しない」可能性が高い

**現時点の仮説:**
- 主因は `restoreNativeSubtitles()` の後処理不備ではなく、Apple TV+ 側 text track 公開前のタイミングで OFF 適用が走っていること
- 次に切るべき論点は、`cue-track-binder` / `text-track-debug` / track 準備完了タイミングのどこで観測・復元を行うか

**次にやること:**
1. 再生が安定し text track が可視になっている瞬間に ON → OFF を実施し、`textTrackCount >= 1` の snapshot が取れるか確認する
2. それでも 0 件のままなら、track 準備完了待ちの導入位置を `cue-track-binder` / `text-track-debug` / `settings-runtime` のどこに置くか切り分ける
3. 必要に応じて「restore 実行の再試行」よりも「text track 利用可能化待ち」の方針を優先する

**判定:** 未完了。観測導線整備は完了し、次の主対象。

---

### ✅ F-6（完了）: トグル OFF 時にデバッグパネルが見られない

**対象ファイル:**
- `options.js`
- `options.html`

**症状:**
- OFF 状態では content 側 UI が壊れているとデバッグログの観測自体が難しく、設定ページ側のデバッグログも安定して見られなかった

**原因:**
- `options.js` で `bindDebugLogRealtimeWatch()` 未定義問題があり、設定ページ側のログ表示導線が壊れていた

**修正内容:**
- `options.js` 側のデバッグログ初期化・リアルタイム監視を修正し、設定ページからログを確認できる状態へ戻した
- 今回さらに `options.html` / `options.js` で全ログ表示トグルを追加し、content の `settings` / `ui` / `subtitle` ログを追いやすくした

**確認結果:**
- OFF 状態でも設定ページからログ確認が可能
- 全ログ表示で F-5 調査に必要な content ログを確認できる

**判定:** 完了。

---

### 🟠 F-8（一次整理済み）: DevConsole に大量ログが連続出力される

**対象ファイル:**
- `content.js`
- `cue-controller.js`
- `subtitle-track-resolver.js`
- `secondary-subtitle-dom.js`
- `settings-runtime.js`
- `modules/playback-context-controller.js`
- `modules/playback-controls-layout-controller.js`
- `modules/subtitle-sync-controller.js`
- `sync-interval-orchestrator.js`
- `panel-renderer.js`
- `panel-ui.js`

**症状:**
- `secondary-sync force-rebind skipped`、resolver snapshot、subtitle view snapshot などが常設ログとして連続出力され、必要な F-5 ログを埋もれさせる

**今回の整理内容:**
- `content.js` で EJDict load、secondary sync context、resolver snapshot、subtitle view snapshot など複数の詳細ログを `if (false)` で抑制した
- `cue-controller.js` でも secondary sync の詳細ログや track handoff の補助 snapshot の一部を抑制した
- `subtitle-track-resolver.js`、`secondary-subtitle-dom.js`、`panel-ui.js`、`settings-runtime.js`、`sync-interval-orchestrator.js` など関連ファイルでも観測ノイズを減らす方向へ整理した

**現状:**
- F-5 観測に必要なログは見やすくなった
- ただし F-8 自体は「ログレベル設計の整理」までは未完了

**次にやること:**
1. 残すべき常設ログと、一時観測専用ログを分類する
2. `DEBUG_*` フラグ、カテゴリ、保存先の使い分けを整理する
3. suppress の書き方をファイルごとにバラつかせず、共通ルールへ寄せる

**判定:** 一次整理済み。恒久整理は残課題。

---

## 直近の検証手順

1. Apple TV+ の再生画面を開き、再生を安定させる
2. 設定ページのデバッグログを開き、「全ログ表示」を ON にする
3. 再生中に ON → OFF を 1 回実行する
4. `tv-log.txt` または設定ページ上で以下を確認する
   - `SETTINGS_CHANGED disable-branch`
   - `ネイティブトグル OFF apply start`
   - `restore call before / after`
   - `text track snapshot before / after`
5. snapshot の `textTrackCount` が 1 以上か、0 のままかを判定する
6. 0 のままなら「restore 不備」ではなく「track 未準備タイミング」を優先仮説として次の修正へ進む

---

## 次の着手順

1. **F-5**
   - text track 準備タイミングの切り分け
   - 必要なら track 利用可能化待ちを導入
2. **F-4**
   - 初回 async response エラーの残件整理
3. **F-8**
   - 一次 suppress を共通ルール化し、恒久的なログレベル設計へ寄せる
