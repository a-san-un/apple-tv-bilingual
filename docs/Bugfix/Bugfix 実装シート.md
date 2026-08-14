# Bugfix 実装シート 2026-08-14

**ブランチ:** `issue-32-content-core-split`
**対応マスタープラン:** Bugfix マスタープラン 2026-08-14（改訂版）
**このシートの役割:** 今の症状・今やる修正箇所・検証手順（完了で archive）

---

## 現在の症状（2026-08-14 実機テスト確認済み）

| # | 症状 | 観察事実 | 関連 ID |
|---|---|---|---|
| 1 | 字幕パネルを閉じるとオーバーレイ字幕も消える | パネル開いていれば表示される | F-1 |
| 2 | restart 後にネイティブトグルが DOM に出ない | 別エピソード・別作品移動時。パネル開閉で復帰する | F-2 |
| 3 | 言語設定変更がリアルタイムに反映されない | ja→ko 変更後もメインのみ。ja/en 以外は非表示 | F-3 |
| 4 | メッセージチャネルクローズエラー（初回のみ） | `onRuntimeMessage @ settings-runtime.js:690` | F-4 |
| 5 | ネイティブ字幕が OFF 後に復元されない | Bugfix-E 未実装 | F-5 |

### ✅ 動作確認済み（今回テストで確認）

- primary / secondary 字幕の同期表示は正常
- 二重表示・ちらつきなし
- 字幕パネルが開いているときの ON→OFF→ON 復帰は正常

---

## 修正対象ファイル一覧

---

### F-2（最優先）: restart 後のネイティブトグル生成漏れ

**ファイル:** `content.js`（`startBilingual` または `restartBilingual` 関数）

**調査ポイント:**

```js
// 以下を F12 コンソールで実行して現在の DOM 状態を確認
document.getElementById('atvb-native-toggle')  // null なら未生成
document.getElementById('atv-panel-root')       // null なら未生成
document.getElementById('atv-overlay-root')     // null なら未生成
```

**原因仮説と修正方針:**

`restartBilingual` → `startBilingual` の中でネイティブトグル生成が
「字幕パネルが既に開いているとき」だけ通過するパスに入っている可能性がある。

```js
// startBilingual 内でネイティブトグルを無条件に再生成する
function startBilingual() {
  // 既存処理...

  // ★ F-2: restart 後も確実にネイティブトグルを再生成
  ensureNativeToggle(); // 既存関数 or 新規作成
}

function ensureNativeToggle() {
  if (document.getElementById('atvb-native-toggle')) return; // 既存なら skip
  // ネイティブトグル生成処理
}
```

**確認すること:**
1. `startBilingual` トレースログ（F12 確認済み: `content.js:2713`）の後続処理でトグル生成コードが呼ばれているか
2. トグル生成の条件分岐で `panelOpen` や他の状態フラグが誤って skipping させていないか

---

### F-1（F-2 の次）: panelOpen=false がオーバーレイを停止させる誤連動

**ファイル:** `content.js`（`panelOpen` 変更ハンドラ）

**症状の再現パターン:**
- 字幕パネルの「閉じる」ボタンを押す
- `panelOpen = false` がセットされる
- オーバーレイ（`#atv-overlay-root`）が非表示になる ← **本来は独立のはず**

**修正方針:**

```js
// panelOpen 変更ハンドラで overlay を止めないようにする
function onPanelOpenChange(isOpen) {
  // パネル表示/非表示はパネルだけに適用
  setPanelVisibility(isOpen);

  // ★ F-1: overlay は panelOpen に連動させない
  // setOverlayVisibility(isOpen); ← この行があれば削除
}
```

**調査コマンド（F12 コンソール）:**

```js
// パネル閉直後にオーバーレイの display 状態を確認
document.getElementById('atv-overlay-root')?.style.display
document.getElementById('atv-overlay-root')?.hidden
```

---

### F-3（F-1 の次）: 言語設定変更のリアルタイム反映

**ファイル:** `settings-runtime.js`（`applySettingsAsync` 関数）

**症状:**
- secondary を `ja` → `ko` に変更してもメイン字幕しか出ない
- `ja` / `en` 以外の言語を選択すると secondary が非表示になる

**原因仮説:**
`applySettingsAsync` が言語変更を `chrome.storage` に保存するだけで、
実行中の `cueController` に対してトラック再バインドを呼んでいない。

**修正方針:**

```js
// applySettingsAsync の言語変更検知部分
async function applySettingsAsync(newSettings, oldSettings) {
  const languageChanged =
    newSettings.primaryLanguage !== oldSettings.primaryLanguage ||
    newSettings.secondaryLanguage !== oldSettings.secondaryLanguage;

  if (languageChanged) {
    // ★ F-3: 言語変更時はトラックを再バインドする
    cueController?.unbindSecondarySubtitleTrack();
    cueController?.bindSecondarySubtitleTrack(newSettings.secondaryLanguage);
    // primary も変わっていれば
    if (newSettings.primaryLanguage !== oldSettings.primaryLanguage) {
      cueController?.unbindPrimarySubtitleTrack();
      cueController?.bindPrimarySubtitleTrack(newSettings.primaryLanguage);
    }
  }
  // 既存処理...
}
```

**確認すること:**
- `cueController` が `settings-runtime.js` のスコープから参照可能か
- 参照不可なら `restartBilingual()` 経由でリスタートするフォールバックを使う

---

### F-4: onRuntimeMessage の sendResponse 漏れ

**ファイル:** `settings-runtime.js`（`onRuntimeMessage` 関数、690行付近）

**エラー:**
```
Uncaught (in promise) Error: A listener indicated an asynchronous response
by returning true, but the message channel closed before a response was received
```

**原因:** `onRuntimeMessage` が `return true`（非同期宣言）しているが、
`applySettingsAsync` が例外またはタイムアウトで終了したとき `sendResponse` が呼ばれない。

**修正方針:**

```js
function onRuntimeMessage(message, sender, sendResponse) {
  if (message.type === 'APPLY_SETTINGS') {
    applySettingsAsync(message.settings, currentSettings)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[ATVB] applySettingsAsync failed', err);
        sendResponse({ ok: false, error: err.message }); // ★ F-4: 必ず応答する
      });
    return true; // 非同期応答を宣言
  }
  // 同期メッセージはここで処理（return true しない）
}
```

---

### F-5（後回し）: ネイティブ字幕 track 復元（Bugfix-E）

**ファイル:** `settings-runtime.js`（`extensionEnabled === false` ブランチ）

**仕様:** `cue-controller.js` の `restoreNativeSubtitles()` を使う（仕様確定書 §2 参照）。
この関数は `primaryTrackOriginalMode`（bind 前に保存した元の mode）に track.mode を戻す。
拡張が track.mode の値を自分で決定しないことが重要。

**修正方針:**

```js
// settings-runtime.js の OFF ブランチ
if (!extensionEnabled) {
  cueController?.restoreNativeSubtitles?.();  // ★ F-5: 元の mode に戻す（値は自分で決めない）
  destroyUiHosts();                           // ★ Bugfix-A: UI を破棄
  applyDone();
  return;
}
```

**状態:** F-1 / F-2 完了後に着手

---

## F12 コンソールで今すぐ確認できるコマンド集

```js
// === 現在の DOM 状態確認 ===
console.log('native-toggle:', document.getElementById('atvb-native-toggle'));
console.log('panel-root:', document.getElementById('atv-panel-root'));
console.log('overlay-root:', document.getElementById('atv-overlay-root'));

// === TextTrack の mode 状態確認 ===
Array.from(document.querySelector('video')?.textTracks ?? [])
  .forEach(t => console.log(t.language, t.kind, t.mode));

// === panelOpen の現在値確認 ===
chrome.storage.local.get(['panelOpen'], r => console.log('panelOpen:', r.panelOpen));
chrome.storage.sync.get(['extensionEnabled'], r => console.log('extensionEnabled:', r.extensionEnabled));
```

---

## 検証チェックリスト

### F-2 検証
- [ ] 別エピソードに移動した直後（パネル操作なし）で `#atvb-native-toggle` が DOM に存在する
- [ ] 別作品を開いた直後（パネル操作なし）で `#atvb-native-toggle` が DOM に存在する

### F-1 検証
- [ ] 字幕パネルを閉じた後もオーバーレイ字幕（画面上の2言語表示）が表示され続ける
- [ ] `extensionEnabled=ON` の状態で `panelOpen` を切り替えてもオーバーレイに影響がない

### F-3 検証
- [ ] オプション画面で secondary を `ja` → `ko` に変更した直後に secondary 字幕が切り替わる
- [ ] `ja` / `en` 以外の言語を選択しても secondary が表示される

### F-4 検証
- [ ] F12 コンソールにチャネルクローズエラーが出なくなる（初回ロード時も含む）

### F-5 検証
- [ ] トグル OFF 後に Apple TV+ のネイティブ字幕設定から字幕を有効にできる
- [ ] 字幕の二重表示や競合が発生しない
