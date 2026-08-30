# 診断チェックリスト：injectNativeToggle が実行されない問題

> **作成日**: 2026-08-16  
> **発端**: F-2 診断コマンドで `atvb-native-toggle: false` が確認されたバグ

---

## 症状

- `textTrackCount` が 272 件あり、`isPlaybackReady = true`
- `upNextBtn` も存在し、`watchForPlayerTabs` は通過済み
- にもかかわらず `document.getElementById('atvb-native-toggle')` が **null**
- つまり `startBilingual` フローの最終段 `injectNativeToggle` が **実行されていない or サイレントに失敗している**

---

## 見逃しやすい落とし穴（ポストモーテム）

### ① 注入先セレクタが存在しないと guard で黙って抜ける

`injectNativeToggle` 内部に「注入先が見つからなければ return」のガードを書いた場合、
**DOM が未生成・セレクタ名変更・Shadow DOM 内に移動**したとき、エラーなしで素通りする。

```js
// ❌ 黙って終わる例
const toolbar = document.querySelector('.playback-toolbar');
if (!toolbar) return;   // ← ここで無言終了
```

**対策**: return する前に必ず警告ログを出す。

```js
if (!toolbar) {
  console.warn('[ATVB] injectNativeToggle: 注入先が見つからない', { tried: '.playback-toolbar' });
  return;
}
```

---

### ② `extensionEnabled` が falsy で guard に引っかかる

設定の読み込みタイミングや `chrome.storage.sync.get` の非同期完了前に
`injectNativeToggle` が呼ばれると、`extensionEnabled` が `undefined` → `false` 扱い。

```js
// ❌ undefined を falsy とみなして早期 return
if (!settings.extensionEnabled) return;
```

**対策**: デフォルト値を明示する。

```js
const { extensionEnabled = true } = settings ?? {};
if (!extensionEnabled) return;
```

---

### ③ `watchForPlayerTabs` のコールバック呼び出しが非同期すぎて間に合わない

`MutationObserver` や `setTimeout` のタイミング次第で
「タブが出現したとき」に `injectNativeToggle` を呼ぶコールバックが
**既に DOM が安定した後に発火→即 disconnect** してしまう場合がある。

**対策**: `watchForPlayerTabs` のコールバック内でもセレクタの存在を再チェックし、
見つからなければ再度 `MutationObserver` を張り直す retry ロジックを持つ。

---

## 診断フロー（再発時の手順）

```
step1: textTrackCount を確認
  └─ 0 → 動画未ロード。isPlaybackReady が false のまま。

step2: upNextBtn を確認
  └─ false → watchForPlayerTabs が未トリガー。セレクタ変更を疑う。

step3: atvb-native-toggle を確認
  └─ false (step1/2 が true にもかかわらず) → 本バグ
     → F-3 診断コマンドを実行して注入先セレクタと settings を確認する

step4 (F-3): 以下の3点を確認
  ① 注入先セレクタが DOM に存在するか
  ② __ATVB_DEBUG__.state.contentSettings.extensionEnabled の値
  ③ __ATVB_DEBUG__ 自体が undefined でないか
```

---

## F-3 診断コマンド（コピペ用）

```js
// ── F-3 診断コマンド（一括実行）──────────────────────────
const selectors = [
  '[data-testid="uts.col.PlayerTabUpNext-trigger"]',
  '[data-testid="uts.col.PlayerTabInfo-trigger"]',
  '.player-controls',
  '.playback-toolbar',
];
selectors.forEach(s => {
  const el = document.querySelector(s);
  console.log(`${s}:`, !!el, el?.className ?? '');
});

const debug = window.__ATVB_DEBUG__;
console.log('debug keys:', debug ? Object.keys(debug) : 'undefined');

const settings = debug?.state?.contentSettings ?? debug?.settings ?? debug?.config;
console.log('settings object:', JSON.stringify(settings));
// ─────────────────────────────────────────────────────────
```

---

## 実装上のルール（今後は必ず守る）

| # | ルール |
|---|---|
| 1 | `injectNativeToggle` 内の早期 `return` には必ず `console.warn` を添える |
| 2 | 設定値のデフォルトは `chrome.storage.sync.get` のコールバック引数にデフォルト値として渡す |
| 3 | `watchForPlayerTabs` のコールバックは注入失敗時に retry する |
| 4 | `startBilingual` 完了後に `__ATVB_DEBUG__.state` へ `injectNativeToggle` の成否フラグを書く |

---

## 関連ファイル

- `content.js` → `startBilingual()`, `injectNativeToggle()`, `watchForPlayerTabs()`
- `docs/Bugfix/Bugfix マスタープラン.md`
