# Bugfix 仕様確定書

**作成日:** 2026-08-14
**最終更新:** 2026-08-17
**ブランチ:** `issue-32-content-core-split`  
**位置づけ:** このセッションで固まった仕様の正本。マスタープランと合わせて参照すること。

---

## 1. レイアウト図との対応（図-B / C / D）

| 状態 | ネイティブ字幕 | 拡張 overlay 字幕 | ネイティブ UI アイコン群 |
|---|---|---|---|
| **図-B** トグル OFF | ✅ 字幕メニューで出せる状態にする | ❌ 非表示 | ✅ 全表示（確認済） |
| **図-C** トグル ON ＋ パネル閉 | ❌ 意図的に非表示（overlay 優先） | ✅ 表示中（確認済） | ✅ 全表示（確認済） |
| **図-D** トグル ON ＋ パネル開 | ❌ 意図的に非表示（overlay 優先） | ✅ 表示中。右パネル幅を除いた左側可視領域中央へ寄せる | ✅ 全表示（確認済） |

**レイアウト図の場所:** `docs/Bugfix/Layout/appletv-layout1.drawio`

---

## 2. ネイティブ字幕の制御仕様（Bugfix-E に対応）

### 方針：「拡張機能とネイティブ UI の完全切り離し」

拡張機能はネイティブ字幕の制御に**最小限だけ介入**し、OFF 時は**触った分だけ元に戻す**。  
Apple TV+ 側の字幕メニュー操作には干渉しない。

### トグル OFF 時（拡張 → ネイティブへの引き渡し）

- `cue-controller.js` の `restoreNativeSubtitles()` を呼ぶ
- この関数は `primaryTrackOriginalMode`（拡張が bind する前に保存した元の mode）に track.mode を戻す
- `atvb-cue-suppress` スタイル要素（`video::cue { visibility: hidden !important; }`）も除去する
- 拡張機能は track.mode の値を自分で決定しない。Apple TV+ が設定していた状態に戻すだけ

```js
// settings-runtime.js の OFF ブランチに追加（Bugfix-E + Bugfix-A）
if (!extensionEnabled) {
  cueController?.restoreNativeSubtitles?.();  // ★ Bugfix-E: ネイティブ字幕を復元
  destroyUiHosts();                           // ★ Bugfix-A: UI を破棄
  applyDone();
  return;
}
```

### トグル ON 時（ネイティブ → 拡張が引き取る）

- `bindPrimarySubtitleTrack()` 内で `primaryTrackOriginalMode = track.mode` を保存してから `hidden` にする（既実装）
- overlay が字幕描画を担う
- ネイティブ字幕は表示しない（`atvb-cue-suppress` CSS で抑制）

### `cue-controller.js` の公開 API（確認済み）

`restoreNativeSubtitles` はすでに公開済みのため、新規実装は不要。

```js
// cue-controller.js の return ブロック（抜粋）
return {
  handoffPrimarySubtitleToNative,  // listener を外して track.mode = "showing" に強制
  restoreNativeSubtitles,          // primaryTrackOriginalMode に戻す ← Bugfix-E で使う
  unbindPrimarySubtitleTrack,      // restoreMode:true で元の mode に戻せる
  bindPrimarySubtitleTrack,
  // ...
};
```

---

## 3. ネイティブ UI アイコン群の仕様

- パネル開閉・トグル ON/OFF に関わらず**常に全表示を維持する**
- 拡張機能は Apple TV+ のヘッダー・フッター・シークバー・再生コントロール・音量・字幕ボタン・共有・全画面などのネイティブ UI 要素を**操作・隠蔽・移動しない**
- **現状：すでに達成済み**（確認済み）

---

## 4. トグル OFF 直後の空白許容

- OFF → UI 破棄 → ネイティブ字幕復元 の順で処理するとき、字幕が一瞬消えるタイミングが発生する
- **これは許容する**（確定）

処理順序：

```text
① cueController?.restoreNativeSubtitles?.()  ← ネイティブ字幕の track.mode を復元
② destroyUiHosts()                           ← panel / overlay / toggleBtn を DOM から除去
③ applyDone()
```

---

## 5. `destroyUiHosts()` で破棄する対象（Bugfix-A）

| 要素 | DOM ID / selector | 処置 |
|---|---|---|
| 字幕パネル本体 host | `#atv-panel-host` | `remove()` |
| 字幕パネル本体 root | `#atv-panel-root` | host ごと remove される前提。単独で残留していれば除去対象 |
| 字幕パネル開閉ボタン | `#atv-toggle-btn` | `remove()` |
| オーバーレイ host | `#atv-overlay-host` | `remove()` |
| オーバーレイ inner root | `[data-atvb-overlay-root]` | host ごと remove される前提。単独で残留していれば除去対象 |
| ネイティブトグル | `#atvb-native-toggle` | **残す（削除しない）** |

---

## 6. `extensionEnabled` の初期状態（③ 確定）

| 状況 | 値 | 理由 |
|---|---|---|
| 初回インストール時（storage に未設定） | `false`（OFF） | ネイティブ UI を壊さない。ユーザーが明示的に ON にする設計 |
| 前回 ON で閉じた場合 | `true`（ON） | `chrome.storage.sync` から引き継ぐ |
| 前回 OFF で閉じた場合 | `false`（OFF） | `chrome.storage.sync` から引き継ぐ |

```js
// content.js 初期化時の読み込み例
const { extensionEnabled = false } =
  await chrome.storage.sync.get('extensionEnabled');
//  ↑ キーが存在しない初回は false（OFF）がデフォルト
```

### ⚠️ 実装上の注意（2026-08-16 追記）

`extensionEnabled` を `injectNativeToggle` 内で参照するとき、
`chrome.storage.sync.get` の完了前に関数が呼ばれると値が `undefined` になり、
`!extensionEnabled` が `true` と評価されて**無言でトグルが注入されない**バグが発生する。

```js
// ❌ 現状（undefined が falsy 扱いになる）
if (!settings.extensionEnabled) return;

// ✅ 修正後
const { extensionEnabled = false } = settings ?? {};
if (!extensionEnabled) return;
```

また `injectNativeToggle` 内の**早期 `return` は必ず `console.warn` を添える**。
無言 return は `isPlaybackReady: true` / `upNextBtn: true` が揃っていても
`atvb-native-toggle` が `null` のままになる原因になる（2026-08-16 実機確認）。

```js
// ❌ 無言終了
if (!toolbar) return;

// ✅ 修正後
if (!toolbar) {
  console.warn('[ATVB] injectNativeToggle: 注入先が見つからない', { tried: '.playback-toolbar' });
  return;
}
```

> **診断コマンド (F-2):** `atvb-native-toggle: false` かつ `isPlaybackReady: true` のとき、
> 注入先セレクタの存在・`__ATVB_DEBUG__.state.contentSettings` の内容を確認する。

---

## 7. overlay / panel レイアウト仕様（F-1 確定）

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

- **トグル OFF:** overlay は非表示。panel も非表示または破棄。
- **トグル ON + パネル閉:** overlay は表示し、動画全体の中央下に配置する。
- **トグル ON + パネル開:** overlay は表示し続け、右側パネル幅を除いた左側可視領域の中央下に配置する。
- panel の開閉で overlay を消さない。overlay は常に ON/OFF にのみ従属する。

### 7-3. 位置計算ルール

`syncOverlayPositionToPlayer(options = {})` の責務は overlay host の位置・幅だけを決めることとする。

- player 矩形を `rect = player.getBoundingClientRect()` で取得する
- パネル開時は `panelWidth = #atv-panel-host.getBoundingClientRect().width`
- 可視領域幅は `visibleWidth = rect.width - panelWidth`
- overlay 中央 X は `rect.left + visibleWidth / 2`
- overlay 幅は `Math.min(visibleWidth * 0.72, 960)`

### 7-4. panelOpen の伝搬ルール

- `panel-ui.js` の `applyPanelVisibility(show)` は、panel の表示切替後に `requestAnimationFrame()` 内で `overlayController.syncOverlayPositionToPlayer({ panelOpen: show, reason: "panel-visibility-change" })` を呼ぶ
- `overlay-controller.js` は `options.panelOpen` を優先し、未指定時は `getPanelOpen()` で現在状態を読む
- `content.js` は `createOverlayController({...})` に `getPanelOpen: () => state.panelOpen` を渡す

### 7-5. フォントサイズ仕様

- overlay の **位置・幅** は `visibleWidth` ベースで決める
- overlay の **文字サイズ** は player 全体矩形 `rect` ベースで決める
- `applyOverlayTypography()` に可視領域幅を渡さない
- これにより、パネル開時も字幕サイズを不必要に縮小しない

### 7-6. 実機確認済みの判定値

- パネル開状態:
  - `panelDisplay='block'`
  - `panelWidth=418.796875`
  - `videoWidth=1396`
  - `overlayCenterX=488.59375`
  - 左側可視領域中央と一致
- パネル閉状態:
  - `panelDisplay='none'`
  - `panelWidth=0`
  - `videoWidth=1396`
  - `overlayCenterX=698`
  - 動画中央と一致
- フォントサイズ:
  - `primaryFontSize='28.192px'`
  - `secondaryFontSize='23.787px'`
  - パネル開閉で変化しない

**判定:** F-1 は完了。位置追従・中央復帰・文字サイズ維持を実機確認済み。

---

## 8. Bugfix 優先順位（2026-08-17 更新）

```text
✅ [F-3] 言語設定変更時のトラック再バインド → 完了
✅ [F-6] デバッグパネル OFF 時不可 → 完了
  ↓ 現在の最優先
[F-4] onRuntimeMessage の sendResponse 漏れ修正
  ↓
[F-5=Bugfix-E] restoreNativeSubtitles() によるネイティブ字幕復元
  ↓
[F-7] extensionEnabled=ON 引き継ぎ時の #atv-toggle-btn 不表示（新規）
  ↓
[F-8] DevConsole 大量ログ削減（新規）
```

---

## 9. スコープ外（このフェーズでは触らない）

- Issue-32 リファクタ（`content.js` 分割）本体
- AI tooltip / 単語ポップアップ機能
- `overlay-block-resolver` の挙動変更
- パフォーマンス最適化
