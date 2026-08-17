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

- `modules/language-definitions.js`（新規追加）
- `modules/settings-schema.js`
- `manifest.json`
- `content.js`
- `cue-controller.js`
- `subtitle-track-resolver.js`
- `options.html` / `options.css` / `options.js`
- `popup.html` / `popup.js`
- `background.js`
- `settings-runtime.js`

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
  3. `settings-runtime.js` の `onRuntimeMessage` が受信し、`state.contentSettings` と `requestedSecondaryLang` を更新する
  4. `applySettingsAsync` が実行され、secondary は `cueController.syncSecondarySubtitleTrack(...)` の明示的な同期経路に到達する
- **修正内容（2026-08-17）:**
  - `modules/language-definitions.js` を新設し、popup / options / resolver の言語候補参照を共通定義へ一本化した
  - `content.js` / `cue-controller.js` / `subtitle-track-resolver.js` で secondary subtitle の選定・復帰・native menu 同期の責務を整理した
  - `modules/settings-schema.js` を導入し、設定値の正規化と検証を popup / options / background / content 間で共通化した
- **確認結果:**
  - `ja → ko`
  - `ko → ja`
  - `ja → en`
  の切替を popup 保存だけで再現し、secondary 表示が追従することを確認した
- **判定:** 完了。

#### F-6: デバッグパネルが OFF 時に確認不可（2026-08-17 完了）

- **症状:** トグル OFF 時、デバッグパネル経由でログを確認できなかった。
- **原因:** `options.js` の `bindDebugLogRealtimeWatch()` 未定義により、ログ画面初期化が途中で止まっていた。
- **修正内容:** `options.js` 側のリアルタイム監視初期化を整理し、OFF 状態でもデバッグログに到達できるようにした。
- **確認結果:** 拡張 OFF 状態からでもデバッグパネルを開いてログを確認できる。
- **判定:** 完了。

#### F-4: メッセージチャネルクローズエラー（着手済み・持ち越し）

- **症状:** 初回付近で次のエラーが出ることがある。  
  `Uncaught (in promise) Error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received`
- **従来仮説:** `settings-runtime.js` の `onRuntimeMessage` が `true` を返して非同期応答を宣言しているが、`sendResponse` を呼ばずに終わるケースがある。
- **今回の修正内容:**
  - `settings-runtime.js`
    - `safeSendResponse` を使って `SETTINGS_CHANGED` 応答を 1 回に寄せる構造を維持
    - `waitForPlaybackReady()` の戻り値を `state.video` / `state.dialogEl` に反映してから ON 復帰へ進むよう修正
  - `background.js`
    - `sendSettingsChangedWithRecovery()` に、`Receiving end does not exist` と `message channel closed before a response was received` を recoverable error として分類する処理を追加
    - content script 生存確認と再注入を行う `ensureContentScriptReady()` を追加
    - recoverable な失敗時に再送を試みるよう変更
- **結果:**
  - ON 復帰時に字幕パネル開閉ボタンとオーバーレイ字幕が出ない主症状は解消した
  - ただし async response エラー自体はまだ完全には消えていない
- **現時点の見立て:**
  - `sendResponse` 漏れ単独ではなく、content script の再注入・SPA 遷移・tab activation・message channel の寿命が競合している可能性が高い
  - 実害は限定的で、UI 復旧は達成できているため、残件として持ち越す
- **判定:** 部分改善。ブロッカーではなく残課題。

#### F-5: ネイティブ字幕復元（次着手）

- **症状:** OFF 後に Apple TV+ ネイティブ字幕が期待通り復元されないことがある。
- **主対象:** `cue-controller.restoreNativeSubtitles()`
- **論点:**
  - OFF 移行時に native 字幕の track / mode / menu state をどこまで戻すか
  - secondary 用に触った track の副作用を native 側へ残さないこと
  - restart / tab 遷移後の状態でも一貫して復元できること
- **状態:** 次着手。F-4 は残件化し、F-5 を先に進めてよい。

***

## 依存関係と進め方

```text
[F-1] オーバーレイ位置追従
   └─ 完了

[F-2] restart 後のネイティブトグル再注入
   └─ 完了

[F-3] 言語定義共通化・secondary track 安定化
   └─ 完了

[F-4] SETTINGS_CHANGED 非同期応答まわりの race 改善
   └─ 部分改善・残件持ち越し

[F-5 = Bugfix-E] cue-controller.restoreNativeSubtitles() で
      Apple TV+ ネイティブ字幕へ安全に戻す
   └─ 次着手

[F-6] デバッグパネル常時アクセス化
   └─ 完了
```

***

## 優先順位

| 優先度 | 項目 | 内容 | 完了条件 | 状態 |
|---|---|---|---|---|
| ① 今すぐ | F-5 | `cue-controller.restoreNativeSubtitles()` でネイティブ字幕 track を復元する | Apple TV+ 字幕が OFF 後に動く | 🟡 次着手 |
| ② 並行残件 | F-4 | `SETTINGS_CHANGED` 非同期応答と再送の race を詰める | コンソールにチャネルクローズエラーが出なくなる | 🟠 持ち越し |
| ✅ 完了 | F-1 | オーバーレイ位置追従 | 実機確認済み | ✅ |
| ✅ 完了 | F-2 | ネイティブトグル再注入 | 実機確認済み | ✅ |
| ✅ 完了 | F-3 | 言語定義共通化・secondary track 安定化 | 実機確認済み | ✅ |
| ✅ 完了 | F-6 | デバッグパネル OFF 時不可 | 修正済み | ✅ |

***

## 次スレッド開始用プロンプト

Apple TV+ Bilingual Subtitles の Bugfix-F5 を着手してください。

参照資料:
- docs/Bugfix/Bugfix マスタープラン.md
- docs/Bugfix/Bugfix 実装シート.md
- docs/Bugfix/Bugfix-仕様確定書.md
- docs/Bugfix/Bugfix 将来作業計画.md

現在の状況:
- F-1, F-2, F-3, F-6 は完了済み
- F-4 は `background.js` と `settings-runtime.js` に修正を入れて UI 復旧までは達成したが、
  `A listener indicated an asynchronous response...` は残っており持ち越し
- ON 復帰時に字幕パネル開閉ボタンとオーバーレイ字幕は再表示される
- 次は F-5 として `cue-controller.restoreNativeSubtitles()` を中心に、
  OFF 後の Apple TV+ ネイティブ字幕復元を安定化したい

前提:
- `extensionEnabled` は拡張全体 ON/OFF の正本
- `panelOpen` は字幕パネル開閉状態の正本
- OFF 時に残す UI は `#atvb-native-toggle` のみ
- `#atv-toggle-btn`、`#atv-panel-host`、`#atv-overlay-host` は ON 時にのみ存在すべき

まずは `cue-controller.js` を読み、`restoreNativeSubtitles()` の現状整理、
関連する `content.js` / `settings-runtime.js` / `subtitle-track-resolver.js` の呼び出し経路確認、
その後に最小差分の修正方針を提案してください。

***

## 補足メモ

- `panel host missing` 系ログは、panel host 未生成時に secondary 描画が先行した結果であり、主因とは限らない
- `startBilingual trace` の後に `ui build step` が出ないときは、まず `state.video` 未設定や playback ready 前の早期 return を疑う
- F-4 の残件は background 側送信、content script 再注入、SPA 遷移の race 条件として切り分ける
- 整理はバグ修正の完了を条件としない。調査の障害になる部分は随時整理してよい
