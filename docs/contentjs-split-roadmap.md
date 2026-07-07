# content.js 分割ロードマップ

## 基本方針

- `content.js` は一括分割せず、Phase A〜E の段階分割で進める
- 既存挙動を変えないことを最優先にする
- 既存関数の中身は原則そのまま移し、差分ゼロ移行を基本とする
- 先に純関数・独立責務を切り出し、DOM依存・observer依存・Apple TV+ 固有UI依存の強い責務は後ろへ回す
- content script は manifest の `content_scripts` 順で読み込まれる前提で、`window.ATVB` 名前空間で段階分割する
- 本書は `content.js` 分割方針専用とし、Issue 進捗・完了状態は `docs/dev-roadmap.md` で管理する

---

## Phase A: 純関数と独立 logger の切り出し

### 関連 issue

- [#12](../../issues/12) content.js Phase A: vtt-normalizer.js / debug-logger.js を切り出す

### 対象

- `vtt-normalizer.js`
- `debug-logger.js`

### 目的

- `content.js` の肥大化を安全に減らす
- 既存ロジックを壊さずに最初の分離を行う
- popup / options / background / content から同じログ基盤を使える状態を先に作る
- 後続の #8（ログカテゴリ整理）と #9（current 表示強化）の土台を整える

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
const appendDebugLog = (...args) =>
  window.ATVB?.logger?.appendDebugLog?.(...args);
const logContent = (...args) => window.ATVB?.logger?.logContent?.(...args);
const getDebugLogText = async (...args) =>
  (await window.ATVB?.logger?.getDebugLogText?.(...args)) ?? "";

const normalizeSubtitleText = (...args) =>
  window.ATVB?.vtt?.normalizeSubtitleText?.(...args) ?? "";
const cleanCueText = (...args) =>
  window.ATVB?.vtt?.cleanCueText?.(...args) ?? "";
const formatTime = (...args) => window.ATVB?.vtt?.formatTime?.(...args) ?? "";
```

### 確認項目

- 拡張の reload でエラーが出ない
- 右字幕パネル / options の Debug 表示で、共通 `debugLogs` 経由のログが従来どおり追える
- popup / options / background / content の各ログが共通基盤経由で取得できる
- Debug UI が残っている場合、Clear → 再操作後にログが再蓄積される
- 字幕整形が従来どおり動き、タグ断片やエンティティが表示上に残らない

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
- ATV DEBUG の独立表示は #4 で廃止し、右字幕パネル下部の折り畳み Debug セクションへ統合済みである
- Debug UI API は統合済み UI を前提に、logger / resolver / binder と疎結合で接続できる

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
- current 行のスクロール位置（先頭固定ではなくパネル中央付近）と、sync_interval 時の current 再評価タイミングの改善はこのフェーズの後続課題として扱う
- #4 の観測結果を、binder と sidebar UI の責務分離および current アンカー戦略見直しの材料として活用する

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
- Phase A（#12）/ Phase B（#13）/ 設定ライフサイクル再整理（#14）/ ログカテゴリ整理（#8）は完了済み
- 次の着手対象は Phase C（#16: settings-bridge.js / debug-panel.js）
- #9（current 表示強化）は、Phase C で責務境界を確定した後に進める

---

## Phase A 着手前の issue 化方針

- Phase A は `content.js` 分割の最初の実装単位として、着手前に専用 issue を作成してから進める。
- issue の目的は、`vtt-normalizer.js` / `debug-logger.js` 切り出しの対象範囲・非対象範囲・確認項目を固定し、Phase B 以降へ責務を持ち越さないようにすること。
- この issue では、既存挙動を変えない差分ゼロ移行を前提とし、実装途中の責務拡張は行わない。
- `content.js` の全面分割や広範囲な書き換えには進まず、Phase A の対象である純関数と独立 logger の切り出しに限定する。
- `manifest.json` の `content_scripts` 追加、`content.js` 上部のラッパー追加、既存 logger / VTT 関数本体の移設を同一 issue のスコープに含める。
- 受け入れ条件は本書 Phase A の「確認項目」をそのまま使う。
- Issue 進捗・完了状態は `docs/dev-roadmap.md` 側で管理し、本書は分割方針と実装順の整理に限定する。

### issue タイトル案

- `[P1] content.js Phase A: vtt-normalizer.js / debug-logger.js を切り出す`

### issue 本文に含めるべき観点

- 対象:
  - `vtt-normalizer.js`
  - `debug-logger.js`
- やること:
  - `normalizeSubtitleText` / `cleanCueText` / `formatTime` の移設
  - 既存 logger 関数群の移設
  - `window.ATVB` 名前空間経由の公開
  - `content.js` 側ラッパー追加
  - `manifest.json` の `content_scripts` 順更新
- やらないこと:
  - resolver の切り出し
  - settings bridge / Debug UI API 分離
  - binder / sidebar / observer / bootstrap 整理
  - `content.js` の全面分割
- 確認項目:
  - 拡張の reload でエラーが出ない
  - 右字幕パネル / options の Debug 表示で、共通 `debugLogs` 経由のログが従来どおり追える
  - 字幕整形が従来どおり動く
  - Debug UI が残っている場合、ログ更新が従来どおり動く

### 着手順メモ

1. VSCode Copilot で `content.js` の現状マッピング結果を確認する
2. Phase A 専用 issue を作成する
3. issue 番号確定後、必要なら `docs/dev-roadmap.md` に追加する
4. その後にだけ Phase A 実装へ進む
