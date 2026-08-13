# Bugfix 実装シート 2026-08-13

**ブランチ:** `issue-32-content-core-split`
**対応マスタープラン:** Bugfix マスタープラン 2026-08-13（改訂版）
**このシートの役割:** 今の症状・今やる修正箇所・検証手順（完了で archive）

---

## 現在の症状

| 症状 | 観察事実 | 関連 Bugfix |
|---|---|---|
| 再生ページで panel / overlay / toggle がすべて DOM に出ない | `startup completed` が同一 ms に 2 回出力される | D-1 / D-2 |
| `content message listener registered` が 2 回ログ出力される | SPA ナビゲーション時の reinject で再現 | D-1 |
| `restartBilingual` が二重呼び出しされている | panel / overlay / toggle が null のまま | D-2 |
| OFF 操作しても UI が破棄されない | `apply start → apply done` が 3ms で完了しており `destroyUiHosts()` が呼ばれていない | A |

---

## 修正対象ファイル一覧

### Bugfix-D-1（最優先）

**ファイル:** `content.js`
**修正箇所:** IIFE 冒頭（`"use strict";` の直後）

**修正前（現状）:**
```js
(function () {
  ("use strict");

  const DEFAULT_SETTINGS = { ... };
  // ...
})();
```

**修正後:**
```js
(function () {
  ("use strict");

  // ★ Bugfix-D-1: 二重 inject ガード
  if (window.__atvbContentInjected) {
    console.warn('[ATVB] content.js already injected, skipping.');
    return;
  }
  window.__atvbContentInjected = true;

  const DEFAULT_SETTINGS = { ... };
  // ...
})();
```

**目的:** SPA ナビゲーション時の reinject による二重起動を防止する。

---

### Bugfix-D-2（D-1 完了後に着手）

**ファイル:** `content.js`
**修正箇所:** `restartBilingual` 関数の呼び出し経路

**確認すること:**
- `restartBilingual` が複数の listener / observer から同時に呼ばれていないか調べる
- 呼び出し元を特定し、フラグ（例: `state.restarting`）または debounce で多重呼び出しを防ぐ

**修正方針（例）:**
```js
let _restartTimer = null;
function scheduleRestart() {
  if (_restartTimer) return; // 二重呼び出し防止
  _restartTimer = setTimeout(() => {
    _restartTimer = null;
    restartBilingual();
  }, 100);
}
```

**目的:** panel / overlay / toggle を確実に DOM に出す。

---

### Bugfix-A（D 完了後に着手）

**ファイル:** `settings-runtime.js`
**修正箇所:** `extensionEnabled === false` ブランチ

**修正前（現状）:**
```js
if (!extensionEnabled) {
  // destroyUiHosts() が呼ばれていない
  applyDone();
  return;
}
```

**修正後:**
```js
if (!extensionEnabled) {
  destroyUiHosts(); // ★ Bugfix-A: OFF 時に全 UI を破棄
  applyDone();
  return;
}
```

**`destroyUiHosts()` で破棄する対象:**

| 要素 | DOM ID | 処置 |
|---|---|---|
| 字幕パネル本体 | `atv-panel-root` | `remove()` |
| 字幕パネル開閉ボタン | `atv-toggle-btn` | `remove()` |
| オーバーレイ | `atv-overlay-root` | `remove()` |
| ネイティブトグル | `atvb-native-toggle` | **残す（削除しない）** |

---

## 検証手順

### D-1 検証

1. 拡張機能をリロード（`chrome://extensions` → 更新ボタン）
2. Apple TV+ の任意の再生ページを開く
3. DevTools Console で以下を確認する：
   - `startup completed` が **1 回だけ** 出力されること
   - `content message listener registered` が **1 回だけ** 出力されること
4. SPA ナビゲーション（別エピソードをクリック）後も 1 回のみであることを確認

### D-2 検証

1. D-1 適用済みの状態で再生ページを開く
2. DevTools → Elements で以下の要素が **すべて存在する** ことを確認：
   - `#atv-panel-root`
   - `#atv-overlay-root`
   - `#atvb-native-toggle`
3. Console に `restartBilingual` 関連のログが **1 回だけ** 出ることを確認

### A 検証

1. 再生ページで拡張が ON 状態であることを確認（panel が表示されている）
2. ネイティブトグル（`#atvb-native-toggle`）を OFF にする
3. DevTools → Elements で以下を確認：
   - `#atv-panel-root` が **存在しない**
   - `#atv-overlay-root` が **存在しない**
   - `#atv-toggle-btn` が **存在しない**
   - `#atvb-native-toggle` が **残っている**
4. Console に `destroyUiHosts called` などのログが出ることを確認（必要に応じてログを追加）

---

## 完了条件（シート archive の判断基準）

- [ ] D-1: `startup completed` が 1 回のみ・リスナー登録も 1 回のみ
- [ ] D-2: panel / overlay / toggle が再生ページに表示される
- [ ] A: OFF 操作で全 UI 要素が破棄され、ネイティブトグルだけ残る

上記 3 点がすべて ✅ になったら、このシートを `docs/Bugfix/archive/` へ移動してください。

---

## スコープ外（このシートでは扱わない）

- Bugfix-E（OFF 時のネイティブ字幕 track 復元）→ A 完了後に着手
- Bugfix-B / C（module 初期化順・recovery module）→ A/E 後に着手
- Issue-32 リファクタ（`content.js` 分割）本体
- AI tooltip / 単語ポップアップ機能
