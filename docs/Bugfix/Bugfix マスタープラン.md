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
- **確認結果:** 別エピソードや別作品への遷移後も、字幕パネルを開閉しなくても `#atvb-native-toggle` が再生成されることを確認。
- **判定:** 完了。

#### F-3: 言語設定変更で secondary track が不安定になる（2026-08-16 完了）

- **症状:** 言語設定の切り替え後、secondary 字幕が消えたり誤った track を参照したりする。
- **原因:** secondary track の再選定タイミングと resolver の戻り値利用が不安定で、primary / secondary の責務境界も曖昧だった。
- **修正内容:** `subtitle-track-resolver.js` と `modules/subtitle-sync-controller.js` 周辺の責務を見直し、設定変更時の再 bind と同期更新を整理した。
- **確認結果:** 言語設定変更後も secondary 字幕が安定して表示されることを確認。
- **判定:** 完了。

#### F-4: `message channel closed` / `asynchronous response` 系エラー（2026-08-17 部分改善・持ち越し）

- **症状:** 初回付近で以下のエラーが残ることがある。
  ```text
  Uncaught (in promise) Error: A listener indicated an asynchronous response
  by returning true, but the message channel closed before a response was received
  ```
- **対応状況:**
  - `background.js` に recoverable error 判定と再送処理を追加済み
  - `settings-runtime.js` で `waitForPlaybackReady()` 後に `state.video` / `state.dialogEl` を反映する修正を実施済み
  - ON 復帰時の `#atv-toggle-btn` / overlay 字幕未表示は F-4 に吸収して解消済み
- **現状:** UI 側の復旧は達成しているが、初回の async response エラーは完全には消えていない。
- **優先度:** F-5 の主調査を優先し、F-4 は持ち越し。
- **判定:** 未完了。

#### F-5: OFF 後にネイティブ字幕が復元されない（2026-08-17 調査導線整備済み・次の主対象）

- **症状:** 拡張を OFF にした後、Apple TV+ 本来のネイティブ字幕へ戻らないことがある。
- **今回までの修正内容:**
  - `cue-controller.js` に `restoreNativeSubtitles before/after` の snapshot ログを追加
  - `options.html` / `options.js` で「全ログ表示」を追加し、content の `settings` / `ui` / `subtitle` ログを確認できるようにした
  - `tv-log.txt` で `SETTINGS_CHANGED disable-branch`、`restore call before/after`、`text track snapshot before/after` を確認済み
- **現時点の主仮説:**
  - restore 実装そのものが完全に壊れているというより、**`spa_navigation` 直後など `textTrackCount=0` の未準備タイミングで restore が走って空振りしている可能性が高い**
  - Apple TV+ native 字幕は DOM 直接復元対象ではなく、`<video>.textTracks` / `activeCues` 側で把握すべき
  - 画面表示字幕は `mode === "showing"` かつ `activeCueCount > 0` の track から特定できるため、復元対象は **拡張が変更した `TextTrack.mode` と `atvb-cue-suppress`** とみなすのが妥当
- **次の調査ポイント:**
  - `restoreNativeSubtitles()` が現在どの track / mode を復元対象にしているか
  - `primaryTrackOriginalMode` など元状態保存と復元が対になっているか
  - secondary 用に触った track / mode の影響が native 側へ残っていないか
  - OFF 分岐での呼び出し順が `destroyUiHosts()` より前後どちらであるべきか
  - native menu 状態と `TextTrack.mode` 復元の責務分担が一致しているか
  - `textTrackCount=0` タイミングをどう扱うか
- **関連メモ:** 詳細な構造観測と再利用コマンドは `docs/Bugfix/F-5 調査メモ.md` を参照
- **判定:** 未完了。次スレッドの最優先対象。

#### F-6: デバッグパネル OFF 時に設定ページへ入れない（2026-08-16 完了）

- **症状:** デバッグパネル OFF 時に設定ページへ遷移できない。
- **原因:** 設定導線がデバッグ UI に依存していた。
- **修正内容:** `options.html` / `options.js` の導線を見直し、デバッグパネル非表示時でも設定ページへ入れるようにした。
- **確認結果:** デバッグパネル OFF 状態でも設定ページへ遷移可能。
- **判定:** 完了。

#### F-8: DevConsole の大量ログ削減（2026-08-17 一次整理済み）

- **症状:** `secondary-sync force-rebind skipped` などの常設ログが多く、必要なログの視認性を下げていた。
- **対応状況:** noisy ログの一部 suppress は実施済み。
- **現状:** 一次整理までは完了したが、恒久的なログレベル設計は未完了。
- **優先度:** F-5 の後。
- **判定:** 部分完了。

***

## 次スレッドで最初にやること

1. `docs/Bugfix/Bugfix 実装シート.md` と `docs/Bugfix/Bugfix-仕様確定書.md` を読み、F-5 の前提を合わせる
2. `cue-controller.js` の `restoreNativeSubtitles()` を中心に、保存した元 mode と復元処理の対を確認する
3. `textTrackCount=0` のタイミングを考慮し、restore をどの責務で待つべきか整理する
4. 必要なら `settings-runtime.js` / `content.js` の OFF 分岐順序も合わせて見直す
5. F-5 の修正後に、Apple TV+ 再生中の ON/OFF 実機確認を行う

***

## 補足メモ

- `hidden && cuesLength === 0` のような強いフィルタは、日本語 primary の初期 cue 読み込みまで止める副作用があったため、F-5 調査でも安易に再導入しない
- Apple TV+ の SPA / Svelte 再マウント、Top Layer、再生コントロール再生成が不安定さの根本要因になっている
- 今回の優先は **F-5 完了**。F-4 / F-8 はその後でよい
