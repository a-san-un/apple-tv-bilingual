# content.js 分割ロードマップ

この文書は、`content.js` の責務整理と段階分割の方針をまとめたロードマップである。

この文書で扱うもの:

- `content.js` をどの順で安全に薄くしていくか
- どの責務境界を守りながら分割するか
- 各 Phase で何を確定し、次にどこを整理するか

この文書で扱わないもの:

- issue の進捗・完了状態の正本管理
- UI 仕様の詳細定義
- 個別セッションの作業メモ全文

正本の位置づけ:

- issue の進捗・完了状態は `docs/dev-roadmap.md` を正本とする
- UI 仕様や表示方針の正本は `docs/atv-design.md` に寄せる
- この文書は、`content.js` 分割の設計原則・責務境界・段階順の正本とする

---

## 1. 分割の目的

`content.js` の分割は、単なるファイル分割ではない。  
最優先は既存挙動を壊さずに責務を分けることだが、同時に次の目的も持つ。

- `content.js` のコード量を段階的に減らす
- 見通しを良くし、現在位置を追いやすくする
- UI shell / binder / observer / bootstrap の責務線を明確にする
- 影響範囲を追いやすくし、修正時の事故を減らす
- 将来的に必要な単位だけ安全に実ファイルへ切り出せる状態を作る

このため、分割は「大きくきれいに作り直す」ことよりも、**挙動を変えずにコードを薄くし、責務の境界を見える化すること** を重視する。

---

## 2. 基本方針

- `content.js` は一括分割せず、Phase 単位で段階的に整理する
- 最優先は **既存挙動を変えないこと**
- 構造整理と仕様変更を同じバッチで混ぜない
- 先に純関数・独立責務を切り出し、DOM 依存・observer 依存・Apple TV+ 固有 UI 依存の強い責務は後ろへ回す
- content script は manifest の `content_scripts` 順で読み込まれる前提で、`window.ATVB` 名前空間を使って段階的に分離する
- 旧ロジックを残したまま新ロジックを継ぎ足す形は避け、薄いラッパーか差分ゼロ移設を基本とする
- 同じ責務の処理を別経路に複製しない
- 既存 helper / 既存 state / 既存フローに寄せられるものは寄せる
- 削除は「確実に不要」と判断できるものだけに限定し、迷うものは次バッチへ送る
- phase 外の全面リファクタリングは行わない
- comments / section boundary を使って、まずは `content.js` 内で責務境界を見える化する

---

## 3. 分割で守る境界

`content.js` の責務は、少なくとも次の 3 層に分けて考える。

### 3.1 UI shell

対象:

- panel
- debug
- overlay
- subtitle popup
- notice / panel slot 周辺の shell 生成導線

責務:

- host 作成
- shadow root 準備
- shell HTML / style 適用
- event wiring
- 既存 shell への state 反映
- 空 shell を不用意に再生成しないための生成条件管理

方針:

- `create*()` 系は host / shadow / shell / wiring に集中させる
- 長い template は `build*ShellHTML()` / `build*StyleText()` 系へ寄せる
- render 系は shell の新規生成ではなく、既存 shell への反映責務に留める
- 未設定状態では panel / secondary host / notice の関係が破綻しないよう、生成条件を UI shell 側で追えるようにする

### 3.2 binder / cue logic

対象:

- track binding
- cue handling
- history 管理
- current row 連携
- snapshot 管理
- primary / secondary の live cue 同期

方針:

- binding 関数群を近接配置して見通しを上げる
- cue handling 関数群をひとまとまりとして追えるようにする
- subtitle history / current row / snapshot の流れを binder 側の責務として見える形にする
- 挙動変更より、関数グルーピング、コメント境界、早期 return、薄い helper 化を優先する

### 3.3 observer / layout / bootstrap

対象:

- `ResizeObserver`
- `MutationObserver`
- timer / retry
- 動画切替
- 再初期化
- `attachTracks`
- playback controls layout 調整
- bootstrap / cleanup
- unconfigured flow

方針:

- 最後に整理する
- observer の二重登録や disconnect 漏れを防ぐ
- UI shell / binder-cue の整理と、observer / bootstrap の整理を同じ差分で大きく混ぜない
- `attachTracks`、再初期化、notice 表示条件、secondary host 生成条件の整合をここで詰める
- 未設定時に空の panel や secondary host が出ないよう、bootstrap 導線と表示条件の責務を明確にする

---

## 4. 実装順

1. 純関数と独立 logger を切り出す
2. subtitle track resolver を切り出す
3. settings bridge と Debug UI API を分ける
4. binder / sidebar の非対称を解消しながら UI 層の責務を整理する
5. UI shell を整理する
6. binder / cue logic を整理する
7. observer / layout / bootstrap を最後に整理する

この順序は、依存の弱い層から先に外へ出し、Apple TV+ 固有の密結合層を最後に扱うためのものである。

---

## 5. 各 Phase の整理

### Phase A: 純関数と独立 logger の切り出し（完了）

#### 関連 issue

- [#12](../../issues/12) content.js Phase A: `vtt-normalizer.js` / `debug-logger.js` を切り出す

#### 対象

- `vtt-normalizer.js`
- `debug-logger.js`

#### 目的

- `content.js` の肥大化を安全に減らす
- 既存ロジックを壊さずに最初の分離を行う
- popup / options / background / content から同じログ基盤を使える状態を先に作る

#### ルール

- `vtt-normalizer.js` に移すのは以下のみ
  - `normalizeSubtitleText`
  - `cleanCueText`
  - `formatTime`
- `debug-logger.js` には既存 logger 関数群をそのまま移す
- logger と UI は単一 callback 方式で接続する
  - `window.ATVB.logger.setOnLogUpdated(fn)`

#### manifest

`content_scripts` の `js` 順は以下とする。

```json
"js": [
  "vtt-normalizer.js",
  "debug-logger.js",
  "content.js"
]
```

#### `content.js` 側の対応

- 元の logger / VTT 関数本体は削除する
- ファイル上部にラッパーだけ追加し、既存呼び出しは維持する

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

#### 確認項目

- 拡張 reload でエラーが出ない
- 右字幕パネル / options の Debug 表示で、共通 `debugLogs` 経由のログが従来どおり追える
- popup / options / background / content の各ログが共通基盤経由で取得できる
- Debug UI で Clear → 再操作後にログが再蓄積される
- 字幕整形が従来どおり動き、タグ断片やエンティティが表示上に残らない

---

### Phase B: subtitle track resolver の切り出し（完了）

#### 関連 issue

- [#13](../../issues/13) content.js Phase B: `subtitle-track-resolver.js` を切り出す

#### 対象

- `subtitle-track-resolver.js`

#### 目的

- 字幕トラック選定の純ロジックを `content.js` から外へ出す
- binder や DOM 更新と切り離して責務を明確化する

#### ルール

- 先に切るのは resolver だけ
- binder 系（イベント登録・同期）はまだ `content.js` に残す
- 既存の resolver 相当関数をそのまま移す
- `TextTrackList` は必要に応じて `Array.from()` で配列化して扱う
- score / language match / forced 判定のロジックは変更しない

#### 確認項目

- secondary language 切り替え時に正しいトラックが選ばれる
- 既存 fallback が壊れていない
- 実機確認済み言語に退行がない

---

### Phase C: 設定橋渡しと Debug UI API の分離（完了）

#### 関連 issue

- [#16](../../issues/16) Phase C: `settings-bridge.js` / `debug-panel.js` を切り出す

#### 対象

- `settings-bridge.js`
- `debug-panel.js`

#### 目的

- storage / message 周辺の橋渡し責務を分ける
- Debug UI を panel 統合後の形でも扱いやすくする

#### ルール

- `settings-bridge.js` は通信ラッパー中心にする
- `debug-panel.js` は UI 配線 API に集中させる
- logger 側から直接 panel を知らず、callback 登録で接続する

#### 読み取り契約

- settings 状態の取得は `window.ATVB.settingsBridge` を唯一の入口とする
- Debug UI 操作の入口は `window.ATVB.debugPanel` とする
- ログ本文の取得・カテゴリ絞り込みは `window.ATVB.logger` の責務とする
- `content.js` / binder / sidebar 側では、current cue / history / future 表示用データとレイアウト情報だけを扱う

#### 確認項目

- settings 保存後の即時反映が壊れていない
- Debug UI の更新導線が維持されている
- ATV DEBUG の独立表示を廃止した後も、右字幕パネル下部の折り畳み Debug セクションで観測できる
- logger / resolver / binder と疎結合で接続できる

---

### Phase D: binder / sidebar 非対称の解消と UI 層整理（完了）

#### 関連 issue

- [#19](../../issues/19) Phase D: binder / sidebar 側で primary cue が UI に反映されない非対称を解消する

#### 対象

- binder / sidebar / `renderPanel` 周辺
- track binding と panel UI の責務境界

#### 目的

- primary / secondary の描画非対称を UI 層で解消する
- primary cue が live で存在する場合に、binder / sidebar / `renderPanel` が一貫して描画できるようにする

#### ルール

- resolver の仕様はこのフェーズでは変えない
- `secondaryLang` fallback の仕様はこのフェーズでは変えない
- #17 で確定した current 行モデル（左マーク欄 + threshold-scroll）は変更しない
- Phase 3 の #18 で確認した「resolver / signal レイヤーでは primary cue が取得できている」前提で、UI 層の非対称解消に集中する

#### 完了メモ

- `primaryTrack.mode` を `hidden` から `showing` へ変更し、non-en primary（zh / ko / fr / de / es）での cue 可用性を改善
- `findCueAt` の `track.cues` 参照を保護し、mode 遷移時の cue 探索を堅牢化
- current 行では `primary = state.primaryTrack` / `secondary = state.secondaryTrack` の責務分離を維持したまま primary 非対称を解消
- panel 周辺は `panel.css` 外だし + `buildPanelShellHTML()` / `buildPanelDebugShellHTML()` 分離で整理し、`createRightPanel()` の責務を縮小した
- resolver 仕様 / `secondaryLang` fallback / #17 の current 行モデルは変更していない

#### 確認項目

- 右字幕の同期が壊れない
- secondary track の切替と追従が維持される
- パネル表示位置や表示更新に退行がない
- primaryLang を `de / ja / zh / ko / fr / es` に設定した場合でも、primary cue が live で存在する間は UI の primary 行に表示される
- secondary だけ current が成立し、primary 行が空のまま残る非対称が解消される

---

### Phase E: UI shell / binder-cue / observer-bootstrap の最終整理（進行中）

Phase E は、最も密結合な `content.js` 本体を安全に薄くするための最終整理フェーズである。  
ここでは **UI shell → binder / cue logic → observer / layout / bootstrap** の順に段階的に整理する。

#### 共通ルール

- まずは「挙動を変えない責務整理」から着手する
- UI shell と binder / cue logic を同じ差分で同時に大きく触らない
- `renderPanel()` や `onCueChange()` のような挙動影響が大きい関数は、別バッチで慎重に扱う
- resolver の仕様、`secondaryLang` fallback、#17 の current 行モデル、Phase D で確定した primary 表示条件は維持する
- 少なくとも以下のまとまりをコメントと関数配置で追えるようにする
  - `// [UI shell: panel/debug]`
  - `// [UI shell: subtitle popup]`
  - `// [UI shell: overlay/panel anchor]`
  - `// [render]`
  - `// [binder/cue logic]`
  - `// [observer/layout]`
  - `// [bootstrap]`

#### Phase E (1): UI shell の責務整理（完了）

##### 関連 issue

- [#20](../../issues/20) Phase E (1): `content.js` panel / overlay セクションの責務分離

##### 対象

- panel
- debug
- overlay
- subtitle popup

##### 完了メモ

- `createRightPanel()` / `createOverlay()` / `createPopupHost()` は、host / shadow 準備、shell 適用、イベント配線呼び出しへ責務を寄せた
- subtitle popup の wiring は `wireSubtitlePopupUiEvents()` へ抽出し、create 系の責務線を揃えた
- popup / overlay の長い template は `buildPopupShellHTML()` / `buildOverlayShellHTML()` などの builder 関数へ寄せた
- overlay は event delegation ベースへ整理した
- panel は `buildPanelShellHTML()` / `buildPanelDebugShellHTML()` / `createDebugPanel()` に責務コメントを追加し、shell / debug mount の境界を明確化した
- `wirePanelHeaderActions()` に責務コメントを追加し、header wiring と shell の境界を明確化した
- DOM の `id` / `class` / `data-*`、見た目、close 動作、current 行や threshold-scroll の挙動は変えていない
- `renderPanel()` / `renderSecondarySubtitle()` / `updateOverlay()` / `applyCurrentStateToPanel()` は、shell 作成ではなく既存 shell への state 反映責務として境界を明示した

#### Phase E (2): binder / cue logic の整理（完了）

##### 関連 issue

- [#21](../../issues/21) Phase E (2): `content.js` binder / cue ロジックの整理と分割準備

##### 対象

- track binding
- cue handling
- history / snapshot
- current row 連携

##### 完了メモ

- track binding 関数群を近接配置し、binding の流れを追いやすくした
- `onCueChange()` / `getCurrentCue()` / `findCueAt()` / snapshot 周辺を cue handling として見える形に整理した
- subtitle history / current row 連携を binder / cue logic 領域として追いやすくした
- この段階では挙動変更よりも、関数グルーピング、コメント境界、早期 return、薄い helper 化を優先した
- 実ファイル分割はまだ行わず、`content.js` 内での責務境界明示に留めた

#### Phase E (3): observer / layout / bootstrap の整理（進行中）

##### 対象

- `ResizeObserver` / `MutationObserver`
- timer / retry
- playback controls layout 調整
- 動画切替 / 再初期化 / cleanup
- `attachTracks` 周辺
- unconfigured flow
- panel / notice / secondary host の生成条件

##### 目的

- 最も壊れやすい layout / observer / bootstrap 層を最後に整理する
- 初期化順、observer、timer、retry の責務を分ける
- 未設定時に空の panel や secondary host が不用意に出る経路を抑止する
- `showLanguageSetupNotice()`、panel 表示、secondary host 生成条件の整合を取る

##### 現在の主な対象

- [#24](../../issues/24) `attachTracks` / observer 周辺の安定化
- [#26](../../issues/26) unconfigured flow と panel / notice / secondary host 生成条件の整理

##### 重点項目

- `showLanguageSetupNotice()` と panel 表示条件の整合
- `ensureSecondarySubtitleElement()` の生成条件見直し
- 未設定時に空の secondary subtitle host や panel が出る経路の抑止
- `attachTracks` / 再初期化 / 動画切替周辺の責務整理
- observer の二重登録や disconnect 漏れの防止
- controls layout 調整と panel 干渉の退行防止

##### このスレッドで明確になった観点

- 未設定時でも `ensureSecondarySubtitleElement()` が別経路から呼ばれると、空の secondary host だけが残る可能性がある
- `showLanguageSetupNotice()` の存在だけでは、secondary host の不要生成を防げない
- 再初期化や `startBilingual()` 後の導線で、panel / notice / secondary host の生成条件がずれていないかを確認する必要がある
- `ensureSecondarySubtitleElement()` 側で `isLanguageSelectionReady(...)` を用いた生成ガードを持つ構成は、再発防止の有力候補である
- `restartBilingual()` や再同期導線での無条件 `ensureSecondarySubtitleElement()` 呼び出しは見直し対象である

#### 確認項目

- controls 位置調整が壊れない
- panel と footer / unified-controls の干渉が再発しない
- observer の無限ループ・多重登録がない
- UI shell / binder-cue / observer-bootstrap の境界がコメントと関数構造で追える
- unconfigured flow で空の panel / overlay / secondary host が不用意に再生成されない
- notice 表示時と字幕表示時で、panel slot / secondary host の生成条件が矛盾しない

---

## 6. 現在位置

- Phase A〜D は完了
- Phase E (1) は完了
- Phase E (2) は完了
- 現在の主線は **Phase E (3)** の observer / layout / bootstrap 整理
- 特に `attachTracks` 周辺と unconfigured flow の安定化を優先する
- #26 では、notice / panel / secondary host の生成条件を整理し、未設定時の空 UI 再生成を防ぐ
- 後続の UI 改善（dictionary / AI popup 拡張）は、この構造整理の後段で扱う

---

## 7. 将来のディレクトリ構成案

この節は、Phase E 後半以降に目指したい将来像をまとめた付録である。  
当面は `content.js` 内で責務境界を見える化し、その後に必要な単位だけ実ファイルへ分ける。

### 想定構成

```text
src/
  subtitle-panel/
    panel-shell.js
    panel-events.js
    panel-render.js
    panel-state.js
    panel.css
  subtitle-overlay/
    overlay-shell.js
    overlay-events.js
    overlay-render.js
    overlay.css
  subtitle-popup/
    popup-shell.js
    popup-events.js
    popup-dictionary.js
    popup-ai.js
  subtitle-tracks/
    subtitle-track-resolver.js
    subtitle-track-binder.js
    subtitle-cue-state.js
  settings/
    settings-bridge.js
    settings-sync.js
  debug/
    debug-logger.js
    debug-panel.js
  playback-layout/
    controls-layout.js
  bootstrap/
    content-bootstrap.js
  content-root/
    content.js
```

### 移行方針

- まずは export / import 導入より先に、責務境界を `content.js` 内で安定させる
- shell / events / render / state の責務は、分割後も混ぜない
- resolver、logger、settings bridge のような横断責務は、無理に UI 機能へ吸収しない
- observer、timer、retry、Apple TV+ 固有 layout 調整は終盤まで慎重に扱う
- 分割の途中で挙動変更を同時に入れず、構造整理と仕様変更を同じバッチで混ぜない

### 優先候補

- `subtitle-panel/`
- `subtitle-popup/`
- `subtitle-overlay/`
- `subtitle-tracks/`
- `playback-layout/`
- `bootstrap/`

panel / popup / overlay は、すでに shell と wiring の境界を見える化し始めているため、Phase E の延長で機能単位へ寄せやすい。  
一方で binder / cue / observer / layout は相互依存が強いため、後段で慎重に扱う。
