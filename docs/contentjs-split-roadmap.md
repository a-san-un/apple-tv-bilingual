# content.js 分割ロードマップ

## 基本方針

- `content.js` は一括分割せず、Phase A〜E の段階分割で進める
- 既存挙動を変えないことを最優先にする
- 既存関数の中身は原則そのまま移し、差分ゼロ移行を基本とする
- 先に純関数・独立責務を切り出し、DOM依存・observer依存・Apple TV+ 固有UI依存の強い責務は後ろへ回す
- content script は manifest の `content_scripts` 順で読み込まれる前提で、`window.ATVB` 名前空間で段階分割する

---

## Phase A: 純関数と独立 logger の切り出し

### 対象
- `vtt-normalizer.js`
- `debug-logger.js`

### 目的
- `content.js` の肥大化を安全に減らす
- 既存ロジックを壊さずに最初の分離を行う

### ルール
- `vtt-normalizer.js` に移すのは以下のみ
  - `normalizeSubtitleText`
  - `cleanCueText`
  - `formatTime`
- `debug-logger.js` には既存 logger 関数群をそのまま移す
- logger と UI は単一 callback 方式で接続する
  - `window.ATVB.logger.setOnLogUpdated(fn)`

### manifest
`content_scripts` の `js` 順は以下にする

```json
"js": [
  "vtt-normalizer.js",
  "debug-logger.js",
  "content.js"
]
```

### content.js の対応
- 元の logger / VTT 関数本体は削除
- ファイル上部にラッパーだけ追加して既存呼び出しは維持する

```js
const debugLog = (...args) => window.ATVB?.logger?.debugLog?.(...args);
const appendDebugLog = (...args) => window.ATVB?.logger?.appendDebugLog?.(...args);
const logContent = (...args) => window.ATVB?.logger?.logContent?.(...args);
const getDebugLogText = async (...args) =>
  (await window.ATVB?.logger?.getDebugLogText?.(...args)) ?? "";

const normalizeSubtitleText = (...args) =>
  window.ATVB?.vtt?.normalizeSubtitleText?.(...args) ?? "";
const cleanCueText = (...args) =>
  window.ATVB?.vtt?.cleanCueText?.(...args) ?? "";
const formatTime = (...args) =>
  window.ATVB?.vtt?.formatTime?.(...args) ?? "";
```

### 確認項目
- 拡張の reload でエラーが出ない
- Console に `[ATVB]` ログが従来どおり出る
- 字幕整形が従来どおり動く
- Debug UI が残っている場合、ログ更新が従来どおり動く

---

## Phase B: subtitle track resolver の切り出し

### 対象
- `subtitle-track-resolver.js`

### 目的
- 字幕トラック選定の純ロジックを `content.js` から外へ出す
- binder や DOM更新と切り離して責務を明確化する

### ルール
- 先に切るのは resolver だけ
- binder 系（イベント登録・同期）はまだ `content.js` に残す
- 既存の resolver 相当関数をそのまま移す
- `TextTrackList` は必要に応じて `Array.from()` で配列化して扱う
- score / language match / forced 判定のロジックは変更しない

### 確認項目
- secondary language 切り替え時に正しいトラックが選ばれる
- 既存 fallback が壊れていない
- 実機確認済み言語に退行がない

---

## Phase C: 設定橋渡しと Debug UI API の分離

### 対象
- `settings-bridge.js`
- `debug-panel.js`

### 目的
- storage / message 周辺の橋渡し責務を分ける
- Debug UI を Issue #4 と並行しやすい形にする

### ルール
- `settings-bridge.js` は通信ラッパー中心にする
- `debug-panel.js` はこの段階では UI 完成版にしない
- まずは API スケルトンだけ固定する
  - 例: `window.ATVB.debugPanel.updateLiveDebugPanel`
- logger 側から直接 panel を知らず、callback 登録で接続する

### 確認項目
- settings 保存後の即時反映が壊れていない
- Debug UI の更新導線が維持されている
- Issue #4 の作業と衝突しない

---

## Phase D: track binder と sidebar UI の分離

### 対象
- `subtitle-track-binder.js`
- `sidebar-panel.js`

### 目的
- resolver と分けて、トラック同期・イベント登録・右字幕UIを整理する

### ルール
- binder は副作用ありの層として扱う
- `cuechange`、state 更新、UI トリガーはこの層へ寄せる
- sidebar は DOM 生成・更新責務をまとめる
- Apple TV+ DOM 構造依存が強いので慎重に進める

### 確認項目
- 右字幕の同期が壊れない
- secondary track の切替と追従が維持される
- パネル表示位置や表示更新に退行がない

---

## Phase E: layout / observer / bootstrap の最終整理

### 対象
- `controls-layout.js`
- `content-bootstrap.js`

### 目的
- 最も密結合で壊れやすい層を最後に整理する
- 初期化順、observer、timer、retry を責務分割する

### ルール
- `ResizeObserver` / `MutationObserver` / timer / retry は最後まで慎重に扱う
- Apple TV+ の controls / footer / panel 位置調整はこのフェーズまで後回し
- observer の二重登録や disconnect 漏れを防ぐ
- 最終的に `content.js` は bootstrap 的な薄い入口に寄せる

### 確認項目
- controls 位置調整が壊れない
- panel と footer / unified-controls の干渉が再発しない
- observer の無限ループ・多重登録がない

---

## 実装順まとめ

1. Phase A を実装して確認
2. Phase B は resolver だけ切る
3. Phase C は settings bridge と Debug UI API まで
4. Phase D で binder / sidebar を整理
5. Phase E で layout / observer / bootstrap を最終整理

---

## 現在の着手位置

- ロードマップは Phase A〜E で確定済み
- 今すぐ着手するのは Phase A のみ
- Phase B 以降は Phase A 完了後に順番に進める
