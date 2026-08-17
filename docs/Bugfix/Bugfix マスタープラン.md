# Bugfix マスタープラン 2026-08-17（改訂版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-17 ／ **ブランチ:** `issue-32-content-core-split`  
**入口資料：** 新しいスレッドでもこの資料1枚を読めばプロジェクトの文脈と、現在の優先事項がわかります。

***

## 関連資料インデックス

| # | 資料名 | 役割 | 更新頻度 |
|---|---|---|---|
| 資料① | Bugfix マスタープラン | 全体俯瞰・目標・依存関係・優先順位・次スレッドの入口 | 節目ごとに更新 |
| 資料② | コードベース現状スナップショット | ファイル・関数・DOM ID の正本一覧 | 変更のたびに更新 |
| 資料③ | Bugfix 実装シート | 今の症状・今やる修正箇所・検証手順・実機ログ | 完了で archive |
| 資料④ | Bugfix 将来作業計画 | 将来作業の計画 | 残っている計画だけにする |
| 資料⑤ | Bugfix-ABCD-plan | 辞書 | 参考資料 |
| 資料⑥ | Bugfix-仕様確定書 | 確定仕様の正本 | 仕様変更時のみ更新 |

***

## 最終目標

動画再生中に拡張機能をリアルタイムで ON/OFF できるようにする。

- **OFF 時：** 拡張 UI をすべて破棄し、Apple TV+ 本来の字幕機能が使える状態に戻す
- **ON 時：** 字幕パネル＋オーバーレイで 2 言語字幕を表示する
- **OFF 時に残すのは** 「ネイティブトグル・ポップアップ・設定ページ・設定保存」のみ

***

## 状態変数の正本定義（厳守）

| 変数名 | 保存先 | 役割 | 備考 |
|---|---|---|---|
| `extensionEnabled` | `chrome.storage.sync` | 拡張全体の ON/OFF | ネイティブトグルが書き換える |
| `panelOpen` | `chrome.storage.local` | 現在の字幕パネル開閉状態 | `extensionEnabled=ON` のときのみ意味を持つ |
| `panelDefaultOpen` | `chrome.storage.sync` | 通常起動時の `panelOpen` 初期値 | ランタイムの現在状態ではない |

***

## DOM ID 正本（厳守）

| 正式名称 | DOM ID | 役割 |
|---|---|---|
| ネイティブトグル | `atvb-native-toggle` | 拡張全体の ON/OFF のみ。OFF 時も残す。 |
| 字幕パネル開閉ボタン | `atv-toggle-btn` | 右側字幕パネルの開閉のみ。設定保存に関与しない。 |
| 字幕パネル本体 host | `atv-panel-host` | 右側字幕パネル host。表示/非表示と矩形計測の正本。 |
| 字幕パネル本体 root | `atv-panel-root` | 右側字幕パネル本体。 |
| オーバーレイ host | `atv-overlay-host` | 学習補助オーバーレイ host。位置・幅・矩形計測の正本。 |
| オーバーレイ inner root | `data-atvb-overlay-root` | overlay 内部コンテナ。文字要素の親。 |

***

## 現状精査

### 本日修正分（2026-08-17）

以下のファイルに修正を反映済み。

- `content.js`
- `cue-controller.js`
- `modules/playback-context-controller.js`
- `modules/playback-controls-layout-controller.js`
- `modules/subtitle-sync-controller.js`
- `options.html`
- `options.js`
- `panel-renderer.js`
- `panel-ui.js`
- `secondary-subtitle-dom.js`
- `settings-runtime.js`
- `subtitle-track-resolver.js`
- `sync-interval-orchestrator.js`

### ✅ 完了済み・動作確認済み

- `vtt-normalizer.js`、`debug-logger.js` など多数のモジュールが `content_scripts` に正しく列挙されている
- `state.booted` フラグは `content.js` 内に存在する
- `manifest.json` の `content_scripts` エントリ自体は1つ（二重 inject の直接原因ではないことを確認）
- **字幕パネル表示・primary / secondary 同期は正常動作**（2026-08-14 実機確認済み）
- **二重表示・ちらつきなし**（Bugfix-D2 / `settings-runtime.js` 変更の部分効果）
- **日本語字幕表示は復帰済み**（2026-08-16）
  - `hidden && cuesLength === 0` の track を `ensureSubtitleTracksUsable()` 対象から除外する実験は、日本語 track の初期 cue 読み込みも止めた
  - 当該除外は取り消し済みであり、同じ条件のフィルタは再導入しない
- **ON 復帰時に字幕パネル開閉ボタンとオーバーレイ字幕が再表示される状態まで復旧済み**（2026-08-17）
- **`waitForPlaybackReady()` の結果を `state.video` / `state.dialogEl` に反映してから restart する流れへ修正済み**
- **F-4 の修正で message 送信失敗の recoverable 判定と再送処理を追加済み**
- **ただし `A listener indicated an asynchronous response...` はまだ初回に残ることがあり、F-4 は完了ではなく持ち越し**
- **設定ページのデバッグログで全ログ表示が可能になり、content の `settings` / `ui` / `subtitle` ログを常時確認できる**
- **F-5 調査用に `restoreNativeSubtitles before/after` の snapshot を取得できる状態になった**
- **`tv-log.txt` で `SETTINGS_CHANGED disable-branch`、`ネイティブトグル OFF apply start`、`restore call before/after`、`text track snapshot before/after` が同時に確認できる状態まで観測導線を整備済み**
- **最新コミット `fix: F-5 調査向けに字幕 restore とログ観測を整理する (Issue #32)` を push 済み**

#### F-1: 字幕パネル開閉でオーバーレイ位置が追従しない（2026-08-16 完了）

- **症状:** 字幕パネル開閉時に、オーバーレイ字幕が再生画面の可視領域へ追従せず、表示位置がズレていた。
- **原因:** `panel-ui.js` の `applyPanelVisibility(show)` が overlay host の width を直接触るだけで、`overlay-controller.js` 側の再配置を呼んでいなかった。加えて、`overlay-controller.js` 内の `syncOverlayPositionToPlayer()` は panel 状態を知らない引数なし再同期経路を持っていたため、開閉後や再描画後に閉状態基準へ戻る余地があった。
- **修正内容:**
  - `content.js` から `createOverlayController({...})` へ `getPanelOpen: () => state.panelOpen` を注入
  - `panel-ui.js` の `applyPanelVisibility(show)` で overlay host の width 直接変更をやめ、`requestAnimationFrame()` 内で `deps.overlayController?.syncOverlayPositionToPlayer?.({ panelOpen: show, reason: "panel-visibility-change" })` を呼ぶ構成へ変更
  - `overlay-controller.js` の `syncOverlayPositionToPlayer(options = {})` で、位置・幅は `visibleWidth = rect.width - panelWidth` を使って算出し、`options.panelOpen` 未指定時は `getPanelOpen()` を fallback 参照するよう変更
  - フォントサイズ計算は `applyOverlayTypography(rect)` とし、可視領域幅ではなく player 全体矩形を使うことで、パネル開時の字幕縮小を防止
- **確認結果:**
  - パネル開時: `videoWidth=1396`、`panelWidth=418.796875`、`overlayCenterX=488.59375` で、左側可視領域中央と一致
  - パネル閉時: `videoWidth=1396`、`panelWidth=0`、`overlayCenterX=698` で、動画中央と一致
  - フォントサイズは開閉前後とも `primaryFontSize=28.192px`、`secondaryFontSize=23.787px` で維持される
- **判定:** 完了。位置追従・幅追従・文字サイズ維持を実機確認済み。

#### F-2: restart 後にネイティブトグルが表示されない（2026-08-16 完了）

- **症状:** 別エピソードや別作品へ移動すると、`#atvb-native-toggle` が DOM に追加されない。
- **再現条件:** 字幕パネルを開閉するとトグルが表示されるため、初期化フローの途中で処理が止まっていると推定した。
- **原因:** Apple TV+ の Svelte がエピソード遷移時にタブ DOM を再マウントすることで `#atvb-native-toggle` が消える。従来の `watchForPlayerTabs` は初回注入後に `obs.disconnect()` していたため、再マウント後の消失に気づけなかった。
- **修正内容:** `watchForPlayerTabs` の Observer を disconnect しないよう変更し、「タブが存在するがトグルが消えている」状態を検知したら即再注入するループに切り替えた。あわせて `destroyUiHosts` に `closest("li")` が null のときの fallback 除去を追加した。
- **確認結果:** 別エピソードや別作品への遷移後も、字幕パネルを開閉しなくても `#atvb-native-toggle` が表示されることを確認した。
- **判定:** 完了。

#### F-3: 言語設定変更時、secondary track が不安定になる（2026-08-17 完了）

- **症状:**
  - secondary を `ja` → `ko` に変更すると、韓国語 secondary が表示されない
  - `ja` / `en` 以外の言語を選ぶと、secondary が空表示になることがある
  - 日本語は現在表示できている
- **確定した反映経路:**
  1. `popup.js` が `primaryLang` / `secondaryLang` を検証し、`chrome.storage.sync` へ保存する
  2. popup が `APPLY_SETTINGS_TO_APPLE_TV` を `reason: "popup_save"` と設定値付きで送信する
  3. `settings-runtime.js` の `onRuntimeMessage` が受信し、`state.contentExtensionEnabled` / `state.panelOpen` / `state.lastAppliedSettingsSignature` を更新する
  4. `applyRuntimeSettingsToUi()` が `syncSecondarySubtitleTrackBinding()` と `syncNativeSubtitleMenuSelection()` を再実行する
  5. `subtitle-track-resolver.js` が `primaryLang` / `secondaryLang` に応じた候補を返し、`cue-controller.js` が secondary track を bind し直す
- **修正内容:**
  - `modules/language-definitions.js` を新設し、popup / options / resolver の言語候補参照を共通定義へ一本化した
  - `content.js` / `cue-controller.js` / `subtitle-track-resolver.js` で secondary subtitle の選定・復帰・native menu 同期の責務を整理した
  - `modules/settings-schema.js` と `manifest.json` を新構成に合わせて更新した
  - `options.html` / `options.css` / `options.js` / `popup.html` / `popup.js` で設定 UI と選択 UI の関連実装を調整した
- **禁止事項（継続）:**
  - `hidden && cuesLength === 0` の track を `ensureSubtitleTracksUsable()` 対象から除外しない
  - 日本語 cue 読み込みを止める条件分岐を再導入しない
- **確認結果:** `ja → ko`、`ko → ja`、`ja → en` を popup 保存で実機確認し、secondary の表示が追従することを確認した。
- **判定:** 完了。

#### F-4: restart 後の message channel close エラー（2026-08-17 一部改善・持ち越し）

- **症状:** `A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received` が初回 restart 系メッセージで出ることがある。
- **原因整理:** Apple TV+ SPA 遷移や content script 再注入のタイミングで、background → content の送信先が一時的に存在しない瞬間がある。
- **修正済み:**
  - `background.js` で recoverable error 判定を追加
  - `settings-runtime.js` / restart 経路で再送処理を追加
  - `waitForPlaybackReady()` の結果を `state.video` / `state.dialogEl` に反映してから restart する流れへ修正
- **現状:** UI 側の復旧は達成しているが、初回の async response エラーは完全には消えていない。
- **優先度:** F-5 の主調査を優先し、F-4 は持ち越し。
- **判定:** 未完了。

#### F-5: OFF 後にネイティブ字幕が復元されない（2026-08-17 調査導線整備済み・次の主対象）

- **症状:** 拡張を OFF にした後、Apple TV+ 本来のネイティブ字幕へ戻らないことがある。
- **今回までの修正内容:**
  - `cue-controller.js` の `restoreNativeSubtitles()` を見直し、primary / secondary track の cleanup、元 mode の復元、CSS suppress 解除、bound track 参照のクリアを一連で扱うよう整理した
  - `restoreNativeSubtitles before` / `after` の `text track snapshot` を取得できるようにした
  - `options.html` / `options.js` に全ログ表示を追加し、content の `settings` / `ui` / `subtitle` ログを設定ページから常時確認できるようにした
  - `content.js` / `subtitle-track-resolver.js` / `secondary-subtitle-dom.js` などの noisy ログを抑制し、F-5 調査で必要なログだけを追いやすくした
- **実機ログで確認できたこと:**
  - `tv-log.txt` 上で `SETTINGS_CHANGED disable-branch`、`ネイティブトグル OFF apply start`、`restore call before`、`text track snapshot (restoreNativeSubtitles before)`、`text track snapshot (restoreNativeSubtitles after)`、`restore call after`、`apply done` が同時に確認できる
  - つまり、F-5 調査に必要な before/after 観測導線は成立した
- **現時点の主要観測結果:**
  - `spa_navigation` 直後の snapshot では `textTrackCount=0`、`showingTrackCount=0`、`hiddenTrackCount=0`、`disabledTrackCount=0`
  - primary / secondary の track 情報も空であり、「restore が失敗している」というより「restore 実行時点で参照できる text track がまだ存在しない」可能性が高い
- **現在の仮説:**
  - 主因は `restoreNativeSubtitles()` 自体の mode 復元漏れではなく、Apple TV+ 側 text track 公開前のタイミングで OFF 適用が走っていること
  - 次に切るべき論点は、`cue-track-binder` / `text-track-debug` / track 準備完了タイミングのどこで観測・復元を行うか
- **次アクション:**
  1. 再生が安定し text track が可視になっている瞬間に ON → OFF を実施し、`textTrackCount >= 1` の snapshot が取れるか確認する
  2. その状態でも 0 件のままなら、track 準備完了待ちの導入位置を `cue-track-binder` / `text-track-debug` / `settings-runtime` のどこに置くかを切り分ける
  3. 必要に応じて「restore 実行の再試行」よりも「text track 利用可能化待ち」の方針を優先する
- **判定:** 未完了。調査導線整備は完了し、次の主対象。

#### F-6: トグル OFF 時にデバッグパネルが見られない（2026-08-17 完了）

- **症状:** OFF 状態では content 側 UI が壊れているとデバッグログの観測自体が難しく、設定ページ側のデバッグログも安定して見られなかった。
- **原因:** `options.js` で `bindDebugLogRealtimeWatch()` 未定義問題があり、設定ページ側のログ表示導線が壊れていた。
- **修正内容:** `options.js` 側のデバッグログ初期化・リアルタイム監視を修正し、設定ページからログを確認できる状態へ戻した。さらに今回、全ログ表示トグルを追加して content ログを追いやすくした。
- **判定:** 完了。

#### F-8: DevConsole に大量ログが連続出力される（2026-08-17 一次整理済み・残課題）

- **症状:** `secondary-sync force-rebind skipped`、resolver snapshot、subtitle view snapshot などが常設ログとして連続出力され、必要な F-5 ログを埋もれさせる。
- **今回の整理内容:**
  - `content.js` で EJDict load、secondary sync context、resolver snapshot、subtitle view snapshot など複数の詳細ログを `if (false)` で抑制した
  - `cue-controller.js` でも secondary sync の詳細ログや track handoff の補助 snapshot の一部を抑制した
  - `subtitle-track-resolver.js`、`secondary-subtitle-dom.js`、`panel-ui.js` など関連ファイルでも観測ノイズを減らす方向へ調整した
- **現状:** F-5 観測に必要なログは見やすくなったが、F-8 自体は「ログレベル設計の整理」までは未完了。
- **次アクション:**
  - 残すべき常設ログと、一時観測専用ログを分類する
  - `DEBUG_*` フラグやカテゴリ整理で suppress 方法を統一する
- **判定:** 一次整理済み。将来の本格整理は残る。

***

## 直近の優先順位

1. **F-5: OFF 後にネイティブ字幕が復元されない**
   - 調査導線は整ったため、次は text track 準備タイミングを詰める
2. **F-4: restart 後の message channel close エラー**
   - F-5 本体を優先しつつ、再送失敗の残件を後続で詰める
3. **F-8: DevConsole の大量ログ整理**
   - 今回の一次 suppress を恒久整理へ昇格するか判断する

***

## 次スレッドの入口メモ

- 最新 push 済みコミットは  
  `fix: F-5 調査向けに字幕 restore とログ観測を整理する (Issue #32)`
- 設定ページのデバッグログは「全ログ表示」で content の `settings` / `ui` / `subtitle` を確認できる
- `tv-log.txt` では `restoreNativeSubtitles before/after` の snapshot 取得に成功している
- 現在の主仮説は「OFF 適用時点で text track がまだ 0 件」であり、restore 実装単体ではなく track 公開タイミング側の問題を優先して切る
- 次の実機確認は「再生安定後に ON → OFF を 1 回行い、`textTrackCount >= 1` の snapshot が取れるか」を見る
