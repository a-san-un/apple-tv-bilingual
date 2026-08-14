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

**修正方針:**

```js
if (!extensionEnabled) {
  destroyUiHosts();

  // ★ F-5: OFF 時にネイティブ字幕を復元する
  const tracks = Array.from(document.querySelectorAll('video track[kind="subtitles"], video track[kind="captions"]'));
  tracks.forEach(t => { t.mode = 'showing'; });

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

// === パネル閉直後のオーバーレイ状態 ===
// パネルを閉じた直後に実行する
console.log('overlay display:', document.getElementById('atv-overlay-root')?.style.display);
console.log('overlay hidden:', document.getElementById('atv-overlay-root')?.hidden);
console.log('overlay class:', document.getElementById('atv-overlay-root')?.className);

// === 字幕トラック状態確認 ===
Array.from(document.querySelectorAll('video track')).forEach(t =>
  console.log(t.kind, t.srclang, t.mode)
);
```

---

## 検証手順

### F-2 検証

1. 再生中のエピソードから別エピソードへ移動（SPA ナビ）
2. 上記「DOM 状態確認」コマンドを実行
3. `#atvb-native-toggle` が **null でない** こと
4. `#atv-panel-root` `#atv-overlay-root` が **null でない** こと

### F-1 検証

1. 字幕パネルが開いている状態で「閉じる」ボタンを押す
2. `#atv-overlay-root` の表示状態確認コマンドを実行
3. `display: none` / `hidden: true` でないこと（オーバーレイが残っていること）
4. 画面上に2言語字幕が表示されていること

### F-3 検証

1. Settings で secondary を `ja` → `ko` に変更
2. secondary のトラック srclang が `ko` に変わること（字幕トラック状態確認コマンドで確認）
3. 実際に韓国語字幕が表示されること

### F-4 検証

1. ON/OFF 切り替えを繰り返す
2. F12 コンソールにチャネルクローズエラーが出ないこと

---

## 完了条件（シート archive の判断基準）

- [ ] F-2: 別エピソード移動後も `#atvb-native-toggle` が DOM に存在する
- [ ] F-1: パネルを閉じてもオーバーレイ字幕が表示される
- [ ] F-3: 言語変更が即時反映される（ja/en 以外も動作）
- [ ] F-4: チャネルクローズエラーがコンソールに出ない
- [ ] F-5: OFF 後にネイティブ字幕が復元される（最後）

上記がすべて ✅ になったら、このシートを `docs/Bugfix/archive/` へ移動してください。

---

## スコープ外（このシートでは扱わない）

- Issue-32 リファクタ（`content.js` 分割）本体
- AI tooltip / 単語ポップアップ機能
- `overlay-block-resolver` の挙動変更
- パフォーマンス最適化
