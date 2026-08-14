# Bugfix 仕様確定書

**作成日:** 2026-08-14  
**ブランチ:** `issue-32-content-core-split`  
**位置づけ:** このセッションで固まった仕様の正本。マスタープランと合わせて参照すること。

---

## 1. レイアウト図との対応（図-B / C / D）

| 状態 | ネイティブ字幕 | 拡張 overlay 字幕 | ネイティブ UI アイコン群 |
|---|---|---|---|
| **図-B** トグル OFF | ✅ 字幕メニューで出せる状態にする | ❌ 非表示 | ✅ 全表示（確認済） |
| **図-C** トグル ON ＋ パネル閉 | ❌ 意図的に非表示（overlay 優先） | ✅ 表示中（確認済） | ✅ 全表示（確認済） |
| **図-D** トグル ON ＋ パネル開 | ❌ 意図的に非表示（overlay 優先） | ✅ 表示中（確認済） | ✅ 全表示（確認済） |

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

````js
// cue-controller.js の return ブロック（抜粋）
return {
  handoffPrimarySubtitleToNative,  // listener を外して track.mode = "showing" に強制
  restoreNativeSubtitles,          // primaryTrackOriginalMode に戻す ← Bugfix-E で使う
  unbindPrimarySubtitleTrack,      // restoreMode:true で元の mode に戻せる
  bindPrimarySubtitleTrack,
  // ...
};
````

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

```
① cueController?.restoreNativeSubtitles?.()  ← ネイティブ字幕の track.mode を復元
② destroyUiHosts()                           ← panel / overlay / toggleBtn を DOM から除去
③ applyDone()
```

---

## 5. `destroyUiHosts()` で破棄する対象（Bugfix-A）

| 要素 | DOM ID | 処置 |
|---|---|---|
| 字幕パネル本体 | `atv-panel-root` | `remove()` |
| 字幕パネル開閉ボタン | `atv-toggle-btn` | `remove()` |
| オーバーレイ | `atv-overlay-root` | `remove()` |
| ネイティブトグル | `atvb-native-toggle` | **残す（削除しない）** |

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

---

## 7. DOM ID 正本（マスタープランと同一・再掲）

| 正式名称 | DOM ID | 役割 |
|---|---|---|
| ネイティブトグル | `atvb-native-toggle` | 拡張全体の ON/OFF のみ。OFF 時も残す |
| 字幕パネル開閉ボタン | `atv-toggle-btn` | 右側字幕パネルの開閉のみ |
| 字幕パネル本体 | `atv-panel-root` | 右側字幕パネル。OFF 時は destroy |
| オーバーレイ | `atv-overlay-root` | 学習補助オーバーレイ。OFF 時は destroy |

---

## 8. Bugfix 優先順位（このセッション時点）

```
[D-2] restartBilingual 二重呼び出し解消     ← 最優先（現在着手中）
  ↓ panel / overlay / toggle が DOM に出るようになったら
[A]  destroyUiHosts() を OFF 経路に追加
  ↓
[E]  restoreNativeSubtitles() を OFF 経路に追加（1 行追加で完了）
  ↓
[B/C] module 初期化順・recovery module（後回し）
```

---

## 9. スコープ外（このフェーズでは触らない）

- Issue-32 リファクタ（`content.js` 分割）本体
- AI tooltip / 単語ポップアップ機能
- `overlay-block-resolver` の挙動変更
- パフォーマンス最適化
