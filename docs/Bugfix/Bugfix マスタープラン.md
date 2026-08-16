# Bugfix マスタープラン 2026-08-16（改訂版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-16 ／ **ブランチ:** `issue-32-content-core-split`  
**入口資料：** 新しいスレッドでもこの資料1枚を読めばプロジェクトの文脈と、F-3 の現在地がわかります。

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

### 本日修正分（2026-08-16）

以下のファイルに修正を反映済み、または F-3 の調査対象として確認中。各不具合の解消状況は実機確認で判定する。

- `panel-ui.js`
- `overlay-controller.js`
- `settings-runtime.js`
- `content.js`
- `cue-controller.js`
- `subtitle-track-resolver.js`（F-3 の調査対象）

### ✅ 完了済み・動作確認済み

- `vtt-normalizer.js`、`debug-logger.js` など多数のモジュールが `content_scripts` に正しく列挙されている
- `state.booted` フラグは `content.js` 内に存在する
- `manifest.json` の `content_scripts` エントリ自体は1つ（二重 inject の直接原因ではないことを確認）
- **字幕パネル表示・primary / secondary 同期は正常動作**（2026-08-14 実機確認済み）
- **二重表示・ちらつきなし**（Bugfix-D2 / `settings-runtime.js` 変更の部分効果）
- **restart 後の復帰は字幕パネル開時に限り動作する**
- **日本語字幕表示は復帰済み**（2026-08-16）
  - `hidden && cuesLength === 0` の track を `ensureSubtitleTracksUsable()` 対象から除外する実験は、日本語 track の初期 cue 読み込みも止めた
  - 当該除外は取り消し済みであり、同じ条件のフィルタは再導入しない

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

### 🟠 調査中・不具合（2026-08-16）

#### F-3: 言語設定変更時、secondary track が不安定になる

- **症状:**
  - secondary を `ja` → `ko` に変更すると、韓国語 secondary が表示されない
  - `ja` / `en` 以外の言語を選ぶと、secondary が空表示になることがある
  - 日本語は現在表示できている
- **確定した反映経路:**
  1. `popup.js` が `primaryLang` / `secondaryLang` を検証し、`chrome.storage.sync` へ保存する
  2. popup が `APPLY_SETTINGS_TO_APPLE_TV` を `reason: "popup_save"` と設定値付きで送信する
  3. `settings-runtime.js` の `onRuntimeMessage` が受信し、`state.contentSettings` と `requestedSecondaryLang` を更新する
  4. `applySettingsAsync` が実行され、secondary は `cueController.syncSecondarySubtitleTrack(...)` の明示的な同期経路に到達する
- **否定された当初仮説:**
  - 「`applySettingsAsync` が secondary track の再 bind をまったく実行していない」は不正確
  - 実機ログでは `ko` track に対する secondary bind が実行されている
- **実機ログで確認した事実（`ja → ko`）:**
  - 初回 bind は `secondary-sync state-transition` の `phase: "bind-apply"`
  - 対象 track は `selectedTrackLanguage: "ko"`、`selectedTrackKind: "subtitles"`
  - secondary controller は `requestedMode: "hidden"` を適用し、`secondary-sync mode-applied` と `secondary track bind` を出力する
  - bind 時点の `selectedTrackCuesLength` は `0`、`activeCuesLength` も `0`
  - 同一 track が hidden のままなら `sameTrackRef: true` / `sameMode: true` となり、`bind-skip` は正常な no-op
  - その後、約 0.25〜0.55 秒単位で `secondary-sync force-rebind skipped` が連続する
  - 同ログ時、同じ `ko` track は `trackMode: "showing"`、`cuesLength: 0`、`activeCuesLength: 0`、`currentCueTextLength: 0`
  - 次の secondary sync で `sameTrackRef: true` / `sameMode: false` となり、secondary controller が `showing → hidden` に戻して再 bind する
  - 結果として同じ `ko` track で `showing ↔ hidden` の往復が継続する
- **現時点の結論:**
  - secondary controller は `ko` track を `hidden` で bind する処理まで正常に到達している
  - `secondary-sync force-rebind skipped` 分岐は mode を変更しない。zero-cue track を unbind せず、空描画・scene rebuild 後に return する保護分岐である
  - `ko` track を `showing` に変更している主体は、force-rebind skip より前の別経路にある
  - 最有力候補は `ensureSubtitleTracksUsable(..., finalMode: "showing")` を呼ぶ primary 側、または共通 recovery / native subtitle 制御である
  - primary 用の mode 制御が secondary track まで巻き込んでいるかを確認する
- **現在の調査対象:**
  - `cue-controller.js` の `ensureSubtitleTracksUsable()` 全呼び出し元
  - `track.mode = "showing"`、または showing を設定する helper の全経路
  - `bindPrimarySubtitleTrack`、`bindSecondarySubtitleTrack`、`syncSecondarySubtitleTrack` の責務境界
  - `subtitle-track-resolver.js` が `ko` track を選ぶ際の候補選択と mode 操作
  - Apple TV+ 側が track mode を再変更している可能性
- **現行の未コミット実験変更（`cue-controller.js`）:**
  - `sameTrackRef && sameMode && secondaryTrackCleanup` 時の no-op bind を early return
  - `bind-skip` / `secondary-sync bind skipped` ログを `DEBUG_SECONDARY_SUBS` 配下へ移動
  - `forceRebind && selectedTrackHasNoCues` の場合は unbind を避け、空描画・scene rebuild 後に return
  - `secondary-sync force-rebind skipped` は常設ログとして維持
  - 構文チェックと diff の空白チェックは通過済み
- **禁止事項:**
  - `hidden && cuesLength === 0` を理由に `ensureSubtitleTracksUsable()` から track を一律除外しない
  - この除外は日本語 subtitle track の初期 cue 読み込みを妨げ、日本語字幕を非表示にしたため取り消し済み
- **次スレッドの最優先作業:**
  1. `cue-controller.js` の `ensureSubtitleTracksUsable()` の全呼び出し元を列挙する
  2. 各呼び出しについて `requestedLang`、`finalMode`、`reason`、対象 track を確認する
  3. `track.mode` を `showing` に変更するコードと helper を全検索する
  4. primary bind が secondary track を巻き込んでいる場合、primary の選択・mode 操作対象を primary track に限定する
  5. `ja → ko`、`ko → ja`、`ja → en` を popup 保存だけで実機検証する
  6. primary / secondary がそれぞれ意図した track を維持できることを確認する
  7. F-3 完了後に F-4 へ進む

##### F-3 デバッグ手順

Apple TV+ の再生タブで、言語を切り替える前に実行する。

```js
window.DEBUG_SECONDARY_SUBS = true;
```

`ja → ko` の切替直後に実行する。

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

#### F-4: メッセージチャネルクローズエラー（未着手）

- **症状:** `Uncaught (in promise) Error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received`
- **発生箇所:** `applySettingsAsync @ settings-runtime.js:663` / `onRuntimeMessage @ settings-runtime.js:690`
- **原因仮説:** `onRuntimeMessage` が `true` を返して非同期応答を宣言しているが、`sendResponse` を呼ばずに処理が終わるケースがある
- **影響:** 初回のみ発生・その後は再現しない。チャネル生存期間と処理完了タイミングの問題と推定する
- **着手条件:** F-3 で track mode の競合を解消してから着手する
- **確認事項:**
  - `APPLY_SETTINGS` 系メッセージで成功・失敗・例外の全経路が `sendResponse` を呼ぶか
  - `return true` が必要な分岐だけに限定されているか

#### F-5: Bugfix-E（ネイティブ字幕復元）未動作

- **症状:** OFF 後にネイティブ字幕が表示されない
- **実装方針:** `cue-controller.js` の `restoreNativeSubtitles()` を呼ぶ（仕様確定書 §2 参照）
- **状態:** 未着手。F-3 / F-4 完了後に着手する

#### F-6: デバッグパネルが OFF 時に確認不可（運用上の問題）

- **症状:** トグル OFF 時はデバッグパネルが表示できず、ログ確認が不能
- **暫定対策:** F12 コンソールで `window.__atvDebugLogs` を直接確認する
- **状態:** 保留。F-3 の原因特定を優先する

***

## Bugfix 依存ツリー（2026-08-16 更新）

```text
【根本症状】
現在の最優先
  [F-3] secondary track の showing ↔ hidden 往復の変更元を特定し、
        primary / secondary の mode 制御を分離する
        ↓
  [F-3] ja → ko / ko → ja / ja → en のリアルタイム切替を実機確認する
        ↓
  [F-4] onRuntimeMessage の sendResponse 漏れを修正する
        ↓
  [F-5 = Bugfix-E] cue-controller.restoreNativeSubtitles() で
        ネイティブ字幕 track を復元する
```

***

## 優先順位テーブル（2026-08-16 改訂）

| 順序 | ID | やること | 完成の判定 | 状態 |
|---|---|---|---|---|
| ① 今すぐ | F-3 | `ko` track を `showing` にする経路を特定し、primary / secondary の mode 制御を分離する | `ja → ko` 後、secondary が `hidden` を維持し韓国語字幕が表示される | 🟠 調査中 |
| ② 継続 | F-3 | popup 保存だけで言語切替を実機検証する | `ja → ko`、`ko → ja`、`ja → en` が再起動なしで反映される | ⏳ 原因修正後 |
| ③ 次 | F-4 | `onRuntimeMessage` の `sendResponse` 漏れを修正する | コンソールにチャネルクローズエラーが出なくなる | 🔴 未着手 |
| ④ その後 | F-5 | `cue-controller.restoreNativeSubtitles()` でネイティブ字幕 track を復元する | Apple TV+ 字幕が OFF 後に動く | ⏸ F-3/F-4 後 |

***

## 次スレッド開始テンプレート

```text
Apple TV+ Bilingual Subtitles の F-3 を継続してください。

最初に以下を読んでください。
1. docs/Bugfix/Bugfix マスタープラン.md
2. docs/Bugfix/Bugfix 実装シート.md
3. docs/Bugfix/コードベース現状スナップショット.md
4. docs/Bugfix/Bugfix-仕様確定書.md

現在の最優先は F-3 です。
secondary を ja → ko に切り替えると、cue-controller は ko track を hidden で bind するが、
直後に別経路で同一 track が showing に変更される。
ko track は cuesLength: 0 のまま showing ↔ hidden を往復し、secondary 字幕が表示されない。

次に行うこと:
- ensureSubtitleTracksUsable() の全呼び出し元を追う
- showing を設定する mode 操作の全経路を追う
- primary bind が secondary track を巻き込んでいないか検証する
- 修正後は ja → ko / ko → ja / ja → en を popup 保存だけで実機検証する

注意:
- hidden && cuesLength === 0 の track を usable 化対象から除外する実験は、
  日本語字幕も消したため取り消し済み。再導入しない。
- F-3 の未コミット実験変更が cue-controller.js にある。まず git diff を確認する。
- ローカルファイルは読み取り専用として扱い、変更案はチャット上で提示する。
```

***

## スコープ外（このフェーズでは触らない）

- Issue-32 のリファクタ（`content.js` 分割）本体
  - ただし **バグ調査中に「ここが読みにくい」と感じた箇所を先行して整理することは妨げない**
  - 整理はバグ修正の完了を条件としない。調査の障害になる部分は随時整理してよい
- AI tooltip / 単語ポップアップ機能
- `overlay-block-resolver` の挙動変更
- パフォーマンス最適化