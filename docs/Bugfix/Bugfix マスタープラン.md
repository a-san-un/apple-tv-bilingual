# Bugfix マスタープラン 2026-08-18（改訂版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-18 ／ **ブランチ:** `issue-32-content-core-split`
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

### 本日修正分（2026-08-18）

以下のファイルに修正を反映中。

- `content.js`
- `cue-controller.js`
- `modules/cue-track-binder.js`
- `overlay-controller.js`
- `overlay.css`
- `panel-ui.js`
- `subtitle-view-resolver.js`

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
- **字幕パネル開閉時の overlay 位置追従・文字サイズ維持は完了済み**
- **字幕パネル開閉時の動画本体レイアウト追従も修正済み**
  - `panel-ui.js` の `togglePanel()` から `applyLayout(state.panelOpen)` を渡すよう修正し、通常操作でも `.video-player__video-container` が `70%`、`.video-container.is-opaque` が `right: 30%` になることを確認した
  - DevConsole からの manual `layoutController.applyPanelLayout(true)` と同等の 70/30 状態へ通常操作でも到達できる
- **`subtitle-view-resolver.js` / `overlay-controller.js` の probe ログは通常時 suppress 済み**
- **`overlay.css` から `video::cue { visibility: hidden; }` を削除済み**
  - native 字幕メニューに干渉しない方向へ方針を切り替えた
- **F-5 の前段として primary / secondary の track listener binding 共通化を着手済み**
  - `modules/cue-track-binder.js` に `createTrackListenerBinding()` を追加
  - `content.js` から `createCueController` へ helper を注入
  - `cue-controller.js` の primary / secondary bind を helper 利用へ置換
  - 現時点では `track.mode` はまだ変更していない

### ⚠ 継続観測中の横断課題

- **Chrome Renderer プロセスで 6GB 級メモリ消費を観測**
  - F-5 本線とは別に、listener / observer / timer の登録解除漏れ調査を並行実施中
  - 一時点では `EventListener` / `V8EventListener` / `RegisteredEventListener` が増加しており、長時間再生と UI 再初期化の繰り返しで蓄積している可能性がある
  - 特に `panel-ui.js` の resize listener など、無名関数登録と解除経路の整合性を次スレッドでも確認する

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

#### F-1a: 字幕パネル開閉で動画本体が 70/30 に追従しない（2026-08-18 完了）

- **症状:** 字幕パネルを開いても `.video-player__video-container` の幅が変化せず、動画本体が右パネルぶん縮まらない。
- **原因:** `panel-ui.js` の `togglePanel()` が `applyLayout?.()` を引数なしで呼んでおり、`playback-controls-layout-controller.js` の `applyPanelLayout(isVisible, options)` に `undefined` が渡っていた。
- **修正内容:** `panel-ui.js` で `applyLayout?.(state.panelOpen)` を呼ぶよう修正。
- **確認結果:**
  - manual `layoutController.applyPanelLayout(true)` 実行後に `.video-player__video-container` の inline / computed が `width: 70%`, `maxWidth: 70%`, `flexShrink: 0` となることを確認
  - 同時に `.video-container.is-opaque` 側も `right: 30%` / computed `471.891px` となることを確認
  - 通常のパネル開閉でも同等のレイアウト追従が起きるようになった
- **判定:** 完了。

#### F-2: restart 後にネイティブトグルが表示されない（2026-08-16 完了）

- **症状:** 別エピソードや別作品へ移動すると、`#atvb-native-toggle` が DOM に追加されない。
- **再現条件:** 字幕パネルを開閉するとトグルが表示されるため、初期化フローの途中で処理が止まっていると推定した。
- **原因:** Apple TV+ の Svelte がエピソード遷移時にタブ DOM を再マウントすることで `#atvb-native-toggle` が消える。従来の `watchForPlayerTabs` は初回注入後に `obs.disconnect()` していたため、再マウント後の消失に気づけなかった。
- **修正内容:** `watchForPlayerTabs` の Observer を disconnect しないよう変更し、「タブが存在するがトグルが消えている」状態を検知したら即再注入するループに切り替えた。あわせて `destroyUiHosts` に `closest("li")` が null のときの fallback 除去を追加した。
- **確認結果:** 別エピソードや別作品への遷移後も、字幕パネルを開閉しなくても `#atvb-native-toggle` が表示されることを確認した。
- **判定:** 完了。

#### F-3: 言語設定変更時の secondary track が不安定（2026-08-17 完了）

- **症状:** popup で secondary 言語を変更すると、候補 track は見つかるが実表示されないケースがあった。
- **修正内容:** `modules/language-definitions.js` の導入、resolver / binder / controller の責務整理により、secondary 候補選定と bind 後表示を安定化した。
- **確認結果:** `ja → ko`、`ko → ja`、`ja → en` を popup 保存で実機確認済み。
- **判定:** 完了。

#### F-4: message チャネルクローズエラー（持ち越し）

- **現状:** `A listener indicated an asynchronous response...` はまだ初回に残ることがある。
- **完了済み部分:** `background.js` 側で recoverable error 判定と再送処理を追加し、UI 復旧自体は達成済み。
- **残件:** 初回のみ残るチャネルクローズ警告の根治。

#### F-5: ネイティブ字幕メニューに干渉せず OFF 後復元できるようにする（進行中）

- **現状の方針:**
  - native 字幕メニューに干渉しない
  - 拡張側 primary / secondary を同じ処理モデルへ寄せる
  - ただし共通化のベースは secondary 側の hidden-lock モデルを採用する
  - primary 側で使っていた `timeupdate` / `seeked` / `playing` の補助発火は共通 helper に取り込む
- **今完了している段階:**
  - `modules/cue-track-binder.js` に `createTrackListenerBinding()` を追加済み
  - `content.js` で `createCueController` に helper を渡す配線済み
  - `cue-controller.js` の primary bind を helper 利用へ置換済み
  - `cue-controller.js` の secondary bind を helper 利用へ置換済み
  - `track.mode` の変更はまだ行っていない
- **同時に行った方針変更:**
  - `overlay.css` の `video::cue { visibility: hidden; }` を削除し、native 字幕レンダリングを CSS で強制抑止しない構成へ戻した
- **次スレッドの着手点:**
  1. 共通 helper 化後の primary / secondary bind / cleanup の安定性確認
  2. `track.mode` を secondary ベースの hidden-lock モデルへ統一する設計の確定
  3. OFF 時 restore と native menu 操作が両立するかの再検証
  4. `restoreNativeSubtitles before/after` と実画面の整合確認

#### F-6: トグル OFF 時にデバッグパネルが見られない（2026-08-17 完了）

- **修正内容:** `options.js` の `bindDebugLogRealtimeWatch()` 未定義問題を修正し、さらに全ログ表示を追加。
- **結果:** content の `settings` / `ui` / `subtitle` ログを ON/OFF 状態と独立して追えるようになった。
- **判定:** 完了。

#### F-8: DevConsole の大量ログ整理（一次整理済み）

- **現状:** `secondary-sync force-rebind skipped` などの noisy ログは一次 suppress 済み。
- **今回追加:** `subtitle-view-resolver.js` / `overlay-controller.js` の probe ログも通常時は抑制。
- **残件:** 恒久的なログレベル整理と、必要時だけ個別フラグで再有効化できる設計への整理。

***

## 次スレッド開始時の優先順位

1. **F-5 継続**
   - `createTrackListenerBinding()` 共通化後の挙動確認
   - primary / secondary の `track.mode` 統一方針を確定
   - native 字幕メニュー非干渉を守ったまま OFF 復元を成立させる
2. **メモリ調査継続**
   - listener / observer / timer のリーク候補の再点検
   - 長時間再生時の heap / listener 増加再観測
3. **F-4 持ち越し**
   - 初回のみ残る async response 警告の根治

***

## 次スレッドに必ず持ち込む要点

- F-5 は **未完了**。今は `track.mode` を触る前段の listener binding 共通化まで進んだ段階。
- `overlay.css` の `video::cue` 非表示は **削除済み**。native 字幕メニュー非干渉が現在の設計方針。
- `panel-ui.js` の `applyLayout(state.panelOpen)` 修正により、動画本体の 70/30 追従は **完了済み**。
- `subtitle-view-resolver.js` / `overlay-controller.js` の probe ログは通常時 **抑制済み**。
- Renderer 6GB 問題は **別線の重要課題**。F-5 と並行して継続監視する。
