## Bugfix マスタープラン 2026-08-14（改訂版）
**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-16 ／ **ブランチ:** issue-32-content-core-split
**入口資料：** 新しいスレッドでもこの資料1枚を読めばプロジェクトの文脈がわかります。

***

## 関連資料インデックス

| # | 資料名 | 役割 | 更新頻度 |
|---|---|---|---|
| 資料① | Bugfix マスタープラン | 全体俯瞰・目標・依存関係・優先順位 | 節目ごとに更新 |
| 資料② | コードベース現状スナップショット | ファイル・関数・DOM ID の正本一覧 | 変更のたびに更新 |
| 資料③ | Bugfix 実装シート | 今の症状・今やる修正箇所・検証手順 | 完了で archive |
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

以下のファイルに修正を反映済み。各不具合の解消状況は実機確認で判定する。

- `panel-ui.js`
- `overlay-controller.js`
- `settings-runtime.js`
- `content.js`

### ✅ 完了済み・動作確認済み

- `vtt-normalizer.js`、`debug-logger.js` など多数のモジュールが `content_scripts` に正しく列挙されている
- `state.booted` フラグは `content.js` 内に存在する
- manifest.json の `content_scripts` エントリ自体は1つ（二重 inject の直接原因ではないことを確認）
- **字幕パネル表示・primary / secondary 同期は正常動作**（2026-08-14 実機確認済み）
- **二重表示・ちらつきなし**（Bugfix-D2 / settings-runtime.js 変更の部分効果）
- **restart 後の復帰は字幕パネル開時に限り動作する**

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

### 🔴 未完了・不具合（2026-08-16 テスト判明）

#### F-3: 言語設定変更が再起動なしに反映されない（新規）
- **症状:** secondary を ja→ko に変えてもメインしか表示されない。ja/en 以外は表示されなくなる
- **原因仮説:** `applySettingsAsync` が言語変更時に字幕トラック再バインドを行っていない
- **調査対象:** `settings-runtime.js` の `applySettingsAsync` → `bindPrimarySubtitleTrack` / `bindSecondarySubtitleTrack` 呼び出し経路

#### F-4: メッセージチャネルクローズエラー（新規）
- **症状:** `Uncaught (in promise) Error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received`
- **発生箇所:** `applySettingsAsync @ settings-runtime.js:663` / `onRuntimeMessage @ settings-runtime.js:690`
- **原因:** `onRuntimeMessage` が `true` を返して非同期応答を宣言しているが、`sendResponse` を呼ばずに処理が終わるケースがある
- **影響:** 初回のみ発生・その後は再現しない（チャネル生存期間とタイミングの問題）

#### F-5: Bugfix-E（ネイティブ字幕復元）未動作
- **症状:** OFF 後にネイティブ字幕が表示されない
- **実装方針:** `cue-controller.js` の `restoreNativeSubtitles()` を呼ぶ（仕様確定書 §2 参照）
- **状態:** 未着手（F-3/F-4 より後）

#### F-6: デバッグパネルが OFF 時に確認不可（運用上の問題）
- **症状:** トグル OFF 時はデバッグパネルが表示できず、ログ確認が不能
- **暫定対策:** F12 コンソールで直接確認するしかない

***

## Bugfix 依存ツリー（2026-08-16 更新）

```text
【根本症状】
現在の最優先
  [F-3] 言語設定変更時のトラック再バインドを実装する
        ↓
  [F-4] onRuntimeMessage の sendResponse 漏れを修正する
        ↓
  [F-5=Bugfix-E] cue-controller.restoreNativeSubtitles() でネイティブ字幕 track 復元
```

***

## 優先順位テーブル（2026-08-16 改訂）

| 順序 | ID | やること | 完成の判定 | 状態 |
|---|---|---|---|---|
| ① 今すぐ | F-3 | 言語設定変更時にトラック再バインドを実行する | ja→ko 変更後すぐに secondary が切り替わる | 🔴 未着手 |
| ② 次 | F-4 | `onRuntimeMessage` の `sendResponse` 漏れを修正する | コンソールにチャネルクローズエラーが出なくなる | 🔴 未着手 |
| ③ その後 | F-5 | `cue-controller.restoreNativeSubtitles()` でネイティブ字幕 track を復元する | Apple TV+ 字幕が OFF 後に動く | ⏸ F-3/F-4 後 |

***

## スコープ外（このフェーズでは触らない）

- Issue-32 のリファクタ（`content.js` 分割）本体
  - ただし **バグ調査中に「ここが読みにくい」と感じた箇所を先行して整理することは妨げない**
  - 整理はバグ修正の完了を条件としない。調査の障害になる部分は随時整理してよい
- AI tooltip / 単語ポップアップ機能
- `overlay-block-resolver` の挙動変更
- パフォーマンス最適化
