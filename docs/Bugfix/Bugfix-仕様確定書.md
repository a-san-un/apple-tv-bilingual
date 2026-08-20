# Bugfix 仕様確定書

**作成日:** 2026-08-14  
**最終更新:** 2026-08-21  
**ブランチ:** `issue-32-content-core-split`  
**位置づけ:** このセッションで固まった仕様の正本。マスタープランと合わせて参照すること。

---

## 1. レイアウト図との対応（図-B / C / D）

| 状態 | ネイティブ字幕 | 拡張 overlay 字幕 | ネイティブ UI アイコン群 |
|---|---|---|---|
| **図-B** トグル OFF | ✅ 字幕メニューで出せる状態にする | ❌ 非表示 | ✅ 全表示（確認済） |
| **図-C** トグル ON ＋ パネル閉 | ❌ 意図的に非表示（overlay 優先） | ✅ 表示中。動画全体の中央下へ配置 | ✅ 全表示（確認済） |
| **図-D** トグル ON ＋ パネル開 | ❌ 意図的に非表示（overlay 優先） | ✅ 表示中。右パネル幅を除いた左側可視領域中央へ寄せる | ✅ 全表示（確認済） |

**レイアウト図の場所:** `docs/Bugfix/Layout/appletv-layout1.drawio`

---

## 2. ネイティブ字幕の制御仕様（Bugfix-E / F-5 確定・完了）

### 方針：「拡張機能とネイティブ UI の完全切り離し」

拡張機能はネイティブ字幕の制御に**最小限だけ介入**し、OFF 時は**触った分だけ元に戻す**。  
Apple TV+ 側の字幕メニュー操作には干渉しない。  
ネイティブ字幕復元の主責務は `cue-controller.restoreNativeSubtitles()` に寄せる。  
**F-5 はこの仕様に基づき 2026-08-21 時点で完了済み。**

### トグル OFF 時（拡張 → ネイティブへの引き渡し）

- `cue-controller.js` の `restoreNativeSubtitles()` を呼ぶ
- この関数は `primaryTrackOriginalMode`（拡張が bind する前に保存した元の mode）に `track.mode` を戻す
- `atvb-cue-suppress` スタイル要素（`video::cue { visibility: hidden !important; }`）も除去する
- 拡張機能は `track.mode` の値を自分で決定しない。Apple TV+ が設定していた状態に戻すだけとする
- OFF 時は UI 破棄と native 字幕復元を責務分離し、native 側状態の復元を先に行う

```js
// settings-runtime.js の OFF ブランチ
if (!extensionEnabled) {
  cueController?.restoreNativeSubtitles?.();  // ネイティブ字幕を復元
  destroyUiHosts();                           // 拡張 UI を破棄
  applyDone();
  return;
}
```

### トグル ON 時（ネイティブ → 拡張が引き取る）

- `bindPrimarySubtitleTrack()` 内で `primaryTrackOriginalMode = track.mode` を保存してから `hidden` にする
- overlay が字幕描画を担う
- ネイティブ字幕は表示しない（`atvb-cue-suppress` CSS で抑制）
- secondary 用に触った track / mode は、OFF 時に native 側へ残さない

### `cue-controller.js` の公開 API（確認済み）

`restoreNativeSubtitles` はすでに公開済み。

```js
return {
  handoffPrimarySubtitleToNative,
  restoreNativeSubtitles,
  unbindPrimarySubtitleTrack,
  bindPrimarySubtitleTrack,
  // ...
};
```

### F-5 完了確認済み事項

- `restoreNativeSubtitles()` は **拡張が変更した分だけ**を戻す仕様で確定
- native menu 状態と `TextTrack.mode` 復元の責務は混同していないことを確認済み
- ON → OFF → ON を繰り返しても native / extension の責務が混線しないことを確認済み
- 別エピソード遷移後でも同じルールで成立することを確認済み

---

## 3. ネイティブ UI アイコン群の仕様

- パネル開閉・トグル ON/OFF に関わらず**常に全表示を維持する**
- 拡張機能は Apple TV+ のヘッダー・フッター・シークバー・再生コントロール・音量・字幕ボタン・共有・全画面などのネイティブ UI 要素を**操作・隠蔽・移動しない**
- **現状：すでに達成済み**（確認済み）

---

## 4. トグル OFF 直後の空白許容

- OFF → UI 破棄 → ネイティブ字幕復元 の切り替え時、字幕が一瞬消えるタイミングが発生しうる
- **これは許容する**（確定）
- ただし、最終状態としては native 字幕が利用可能であることを優先する

処理順序:

```text
① cueController?.restoreNativeSubtitles?.()  ← ネイティブ字幕の track.mode を復元
② destroyUiHosts()                           ← panel / overlay / toggleBtn を DOM から除去
③ applyDone()
```

---

## 5. `destroyUiHosts()` で破棄する対象

| 要素 | DOM ID / selector | 処置 |
|---|---|---|
| 字幕パネル本体 host | `#atv-panel-host` | `remove()` |
| 字幕パネル本体 root | `#atv-panel-root` | host ごと remove される前提。単独で残留していれば除去対象 |
| 字幕パネル開閉ボタン | `#atv-toggle-btn` | `remove()` |
| オーバーレイ host | `#atv-overlay-host` | `remove()` |
| オーバーレイ inner root | `[data-atvb-overlay-root]` | host ごと remove される前提。単独で残留していれば除去対象 |
| ネイティブトグル | `#atvb-native-toggle` | **残す（削除しない）** |

---

## 6. `extensionEnabled` の初期状態

| 状況 | 値 | 理由 |
|---|---|---|
| 初回インストール時（storage に未設定） | `false`（OFF） | ネイティブ UI を壊さない。ユーザーが明示的に ON にする設計 |
| 前回 ON で閉じた場合 | `true`（ON） | `chrome.storage.sync` から引き継ぐ |
| 前回 OFF で閉じた場合 | `false`（OFF） | `chrome.storage.sync` から引き継ぐ |

```js
const { extensionEnabled = false } =
  await chrome.storage.sync.get('extensionEnabled');
```

### 実装上の注意

`extensionEnabled` を `injectNativeToggle` 内で参照するとき、  
`chrome.storage.sync.get` 完了前に関数が呼ばれると `undefined` になり、  
`!extensionEnabled` が `true` と評価されて無言でトグルが注入されない不具合が起こりうる。

```js
// 避ける
if (!settings.extensionEnabled) return;

// 採用
const { extensionEnabled = false } = settings ?? {};
if (!extensionEnabled) return;
```

また `injectNativeToggle` 内の早期 `return` には、  
必ず診断ログまたは警告ログを添える。

```js
if (!toolbar) {
  console.warn('[ATVB] injectNativeToggle: 注入先が見つからない', { tried: '.playback-toolbar' });
  return;
}
```

---

## 7. overlay / panel レイアウト仕様

### 7-1. DOM 正本

| 正式名称 | DOM ID / selector | 役割 |
|---|---|---|
| ネイティブトグル | `#atvb-native-toggle` | 拡張全体の ON/OFF のみ。OFF 時も残す |
| 字幕パネル開閉ボタン | `#atv-toggle-btn` | 右側字幕パネルの開閉のみ |
| 字幕パネル本体 host | `#atv-panel-host` | 表示/非表示・幅計測の正本 |
| 字幕パネル本体 root | `#atv-panel-root` | パネル UI 本体 |
| オーバーレイ host | `#atv-overlay-host` | 位置・幅・矩形計測の正本 |
| オーバーレイ inner root | `[data-atvb-overlay-root]` | overlay 内部コンテナ |
| オーバーレイ primary | `[data-atvb-overlay-primary]` | primary 字幕描画先 |
| オーバーレイ secondary | `[data-atvb-overlay-secondary]` | secondary 字幕描画先 |

### 7-2. 表示ルール

- **トグル OFF:** overlay は非表示。panel は非表示または破棄する
- **トグル ON + パネル閉:** overlay は表示し、動画全体の中央下に配置する
- **トグル ON + パネル開:** overlay は表示し続け、右側パネル幅を除いた左側可視領域の中央下に配置する
- panel の開閉で overlay を消さない。overlay は常に ON/OFF にのみ従属する
- `#atv-toggle-btn`、`#atv-panel-host`、`#atv-overlay-host` は ON 時にのみ存在すべき
- `#atvb-native-toggle` のみ OFF 時も残す

### 7-3. 位置計算ルール

`syncOverlayPositionToPlayer(options = {})` を位置計算の正本とする。

- `panelOpen` は `options.panelOpen` を優先する
- 未指定時は `getPanelOpen()` の値を fallback 参照する
- `panelOpen=true` のときは `visibleWidth = rect.width - panelWidth` を使って overlay の X 位置と幅を計算する
- `panelOpen=false` のときは動画全体矩形の中央へ配置する

### 7-4. フォントサイズ計算ルール

- overlay のフォントサイズは **player 全体矩形** を基準に計算する
- 位置補正用の `visibleWidth` をフォントサイズ計算に流用しない
- そのため `applyOverlayTypography(rect)` は、可視領域幅ではなく player 全体の `rect` を受け取る

### 7-5. F-1 実装後の確認済み挙動

- パネル開時、overlay は左側可視領域中央へ寄る
- パネル閉時、overlay は動画中央へ戻る
- パネル開閉で primary / secondary のフォントサイズは縮小しない

---

## 8. 設定反映メッセージの仕様（F-4 関連・残件）

### 8-1. 基本方針

設定保存後の反映は、background → content のメッセージ経路を使う。  
ただし Apple TV+ の SPA 遷移や content script 再注入の都合で、  
送信直後に content 側がいないことがありうる。

### 8-2. recoverable error の扱い

以下のエラーは、現時点では recoverable と扱う。

- `Receiving end does not exist`
- `message channel closed before a response was received`
- `A listener indicated an asynchronous response by returning true`

recoverable な場合は、content script 生存確認・再注入・再送を試みてよい。

### 8-3. 未確定事項

- `SETTINGS_CHANGED` を request-response として厳密運用するか
- 失敗してもよい fire-and-forget として扱うか

この点は F-4 残件として再整理する。  
仕様上はまだ固定しない。F-5 完了後も本項は未確定のまま持ち越し。

### 8-4. 確定していること

- `waitForPlaybackReady()` 成功後は、`state.video` / `state.dialogEl` を反映してから ON 側 restart へ進む
- UI build 停止を避けるため、playback ready と state 反映は同一フロー内で行う
- `panel host missing` は主因ログではなく、副次的症状ログとして扱う

---

## 9. secondary 言語設定の仕様（F-3 確定）

### 9-1. 言語定義の正本

言語候補の正本は `modules/language-definitions.js` とする。  
popup / options / resolver が独自の言語定義を持たない。

### 9-2. 設定値の正本

設定値の検証・正規化は `modules/settings-schema.js` を正本とする。  
popup / options / background / content 間で個別の検証ロジックを持たない。

### 9-3. 禁止事項

- `hidden && cuesLength === 0` の track を `ensureSubtitleTracksUsable()` 対象から一律除外しない
- この条件は日本語 subtitle track の初期 cue 読み込みまで止め、日本語字幕消失を引き起こしたため再導入しない

### 9-4. 期待挙動

- popup 保存だけで `ja → ko`、`ko → ja`、`ja → en` の切替が反映される
- secondary subtitle の選定・復帰・native menu 同期は、`cue-controller.js` / `subtitle-track-resolver.js` 側の責務で扱う

---

## 10. デバッグパネル仕様（F-6 確定）

- デバッグパネルは拡張 ON/OFF に依存せず開ける
- OFF 状態でもログ確認に到達できる
- デバッグ機能の可用性は、字幕 overlay / panel の表示状態に従属させない

---

## 11. secondary listener リーク対策の仕様（進行中・Step 1〜5 確定分）

**位置づけ:** F-5 完了後に着手した secondary track の listener / rebind / cleanup 整理。  
本項は Step 1〜4 の完了分と、Step 5 で確定した仕様のみを正本として記載する。  
Step 6 以降は未確定のため、実装計画側（Bugfix 将来作業計画.md）を参照する。

### 11-1. 責務分離の確定仕様（Step 1〜2）

- secondary track の選択処理は `modules/subtitle-sync-controller.js` 側で selection result として返す形に統一する
- selection result は `track`、`sameTrackRef`、`requested language change`、`snapshot` を持つ
- 再bind可否の判定は `sameTrackRef`（identity 比較）を主軸とし、`track.id` はログ補助・`language` は補助情報として扱う

### 11-2. 監視・cleanup の一元化仕様（Step 3〜4）

- secondary listener の start / replace / stop は `modules/cue-track-binder.js` の secondary monitor 経由でのみ行う
- listener の cleanup は `createTrackListenerBinding()` の `cleanup()` を唯一の解除経路とする
- `cue-controller.js` 側は個別の cleanup state を保持しない。監視フェーズの orchestration のみを担う
- `destroy()` 相当の処理は secondary monitor 側に持たせ、`cue-controller.js` は monitor destroy を呼ぶだけにする

### 11-3. unreadable 即 rebind 禁止の仕様（Step 5 確定）

- 同一 track（`sameTrackRef === true`）の一時的な unreadable 状態だけでは secondary の再bindを発生させない
- `shouldRebindBecauseUnreadable` は bind 判定条件から除外する
- unreadable の情報自体は削除せず、health 情報（監視用の補助データ）として保持してよい
- bind 理由は `selected-track-changed`（identity 変化）と `force-rebind`（明示的な強制再接続）を中心にする
- `sameTrackUnreadable` を根拠とした `mode` の `readability-promote` 分岐（`_resolveSecondaryTrackModePolicy()` 内）は、同一 track の unreadable を rebind 理由にしないという方針と矛盾するため、削除または無効化する対象とする
- `maybePromoteTrackReadability()` は `sameTrackUnreadable` 依存の補助処理であり、Step 5 の方針上は不要になる想定

**主対象ファイル:** `cue-controller.js`

### 11-4. 未使用退避名の扱い（確定）

以下は削除確定ではなく、今後のステップで使う可能性がある前提で保持する。

- `_resolveSecondarySubtitleTrack`
- `_pickMostReadableTrack`
- `_resolveSecondaryTrackModePolicy`（2026-08-21 時点で現行使用中と確認済み）

---

## 12. 今後の優先仕様

2026-08-21 時点の優先順位は次の通り。

1. リーク対策 Step 5: `shouldRebindBecauseUnreadable` / `sameTrackUnreadable` 除去（`cue-controller.js`）の適用
2. リーク対策 Step 6以降: recovery 側の force rebind 条件見直し、`content.js` 配線整理
3. F-4 残件: message channel closed 系エラーの再整理
4. F-8: DevConsole の常設ログ削減

---

## 13. 補足メモ

- ON 復帰時に `#atv-toggle-btn` と overlay 字幕が出ない問題は、`waitForPlaybackReady()` 後の `state.video` / `state.dialogEl` 未反映が主因だった
- そのため F-7 は独立 bugfix ではなく、現時点では F-4 修正に吸収された主症状として扱う
- OFF 時に残す UI は `#atvb-native-toggle` のみ
- ON 時にのみ存在すべき UI は `#atv-toggle-btn`、`#atv-panel-host`、`#atv-overlay-host`
- F-5（Bugfix-E）は 2026-08-21 時点で完了済み
- secondary listener リーク対策は Step 1〜4 完了、Step 5 は仕様確定済み・実装未適用
