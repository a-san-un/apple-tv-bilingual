# content.js 分割ロードマップ

## 基本方針

- `content.js` は一括分割せず、Phase A〜E の段階分割で進める
- 既存挙動を変えないことを最優先にする
- 既存関数の中身は原則そのまま移し、差分ゼロ移行を基本とする
- 先に純関数・独立責務を切り出し、DOM 依存・observer 依存・Apple TV+ 固有 UI 依存の強い責務は後ろへ回す
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
- 後続の #8（ログカテゴリ整理）と #17（current ブロック改善）の土台を整える

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
- binder や DOM 更新と切り離して責務を明確化する

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
  - 例: `window.ATVB.settingsBridge.loadSettings` / `window.ATVB.debugPanel.mount`
- logger 側から直接 panel を知らず、callback 登録で接続する

### 確認項目

- settings 保存後の即時反映が壊れていない
- Debug UI の更新導線が維持されている
- Issue #4 の作業と衝突しない
- ATV DEBUG の独立表示は #4 で廃止し、右字幕パネル下部の折り畳み Debug セクションへ統合済みである
- Debug UI API は統合済み UI を前提に、logger / resolver / binder と疎結合で接続できる

### #17 へ渡す read 契約（Phase C 仕上げ）

- settings 状態の取得は `window.ATVB.settingsBridge` を唯一の入口とする
  - `getCurrentSettings()` から `requestedSettings` / `effectiveSettings` / `requestedSecondaryLang` / `resolvedSecondaryLanguage` を取得する
  - 設定変更通知は `handleRuntimeMessage()` の返却 payload と `onSettingsChanged()` で受ける
- Debug UI 操作の入口は `window.ATVB.debugPanel` とする
  - `mount` / `update` / `clear` / `unmount` は UI 配線に限定し、保存・フィルタ・整形責務は持たない
  - ログ本文の取得・カテゴリ絞り込みは logger（`window.ATVB.logger`）の責務とする
- `content.js` / binder / sidebar 側で扱う情報は以下とする
  - current cue / history / future の表示用データ
  - current ブロックの位置制御・視覚強調に必要な状態
  - Apple TV+ DOM 依存のレイアウト情報
- #17 では settings 導線と debug 導線を増やさない
  - 設定は settingsBridge、Debug UI は debugPanel / logger を再利用する

---

## Phase D: track binder と sidebar UI の分離

### 対象

- `subtitle-track-binder.js`
- `sidebar-panel.js`

### 目的

- resolver と分けて、トラック同期・イベント登録・右字幕 UI を整理する
- primary / secondary の描画非対称を UI 層で解消する
- primary cue が live で存在する場合に、binder / sidebar / renderPanel がそれを一貫して描画できるようにする

### 関連 issue

- [#19](../../issues/19) Phase D: binder/sidebar 側で primary cue が UI に反映されない非対称を解消する

### ルール

- binder は副作用ありの層として扱う
- `cuechange`、state 更新、UI トリガーはこの層へ寄せる
- sidebar は DOM 生成・更新責務をまとめる
- Apple TV+ DOM 構造依存が強いので慎重に進める
- resolver の仕様はこのフェーズでは変えない
- secondaryLang fallback の仕様はこのフェーズでは変えない
- #17 で確定した current 行モデル（左マーク欄 + threshold-scroll）は変更しない
- Phase 3 の #18 で確認した「resolver / signal レイヤーでは primary cue が取得できている」前提で、UI 層の非対称解消に集中する

### 確認項目

- 右字幕の同期が壊れない
- secondary track の切替と追従が維持される
- パネル表示位置や表示更新に退行がない
- current 行のスクロール位置は、先頭固定ではなく下端しきい値超過時のみ最小スクロールする実装として #17 で完了した
- primaryLang を de / ja / zh / ko / fr / es に設定した場合でも、primary cue が live で存在する間は UI の primary 行に表示される
- resolver で選ばれた primary track と、binder / sidebar で描画される primary cue の対応関係を追える
- secondary だけ current が成立し、primary 行が空のまま残る非対称が解消される
- #4 / #18 の観測結果を、binder と sidebar UI の責務分離および primary 描画条件見直しの材料として活用する

### Phase D 着手メモ

- #18 の切り分けでは、`primaryTrackFound: true`、`primaryActiveCues > 0`、`primaryCueTextLength > 0`、`snapshotPrimaryTextLength > 0` を確認済み
- それでも UI の primary 行が空になるケースが残ったため、問題は resolver より binder / sidebar / renderPanel 側にあると整理済み
- Phase D では、current / history / future の組み立てと last render snapshot の扱いが、primary / secondary の双方に対して対称かを重点確認する

### Phase D 完了メモ（2026-07-09）

- `primaryTrack.mode` を `hidden` から `showing` へ変更し、non-en primary（zh / ko / fr / de / es）での cue 可用性を改善
- `findCueAt` の `track.cues` 参照を保護し、mode 遷移時の cue 探索を堅牢化
- current 行では `primary=state.primaryTrack` / `secondary=state.secondaryTrack` の責務分離を維持したまま primary 非対称を解消
- panel 周辺は `panel.css` 外だし + `buildPanelShellHTML` / `buildPanelDebugShellHTML` 分離で整理し、`createRightPanel` の責務を縮小
- resolver 仕様 / `secondaryLang` fallback / #17 の current 行モデル（左マーク欄 + threshold-scroll）は変更していない

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

### Phase E 共通ガイドライン

- Phase E は「コード整備を含めた挙動を変えない責務整理」から着手する
- UI shell と binder / cue logic を同じ差分で同時に大きく触らない
- panel / debug / overlay / subtitle popup の構造・template・イベント配線は UI shell 側へ寄せる
- track binding / cue handling / history / current row 連携は binder / cue logic 側としてまとめる
- `createRightPanel()` / `createOverlay()` / `createPopupHost()` などのエントリ関数は、host / shadow 準備、template 適用、イベント配線に集中させる
- 長い HTML テンプレは create 系関数へ直書きせず、`build*ShellHTML()` 系の builder 関数へ寄せる
- `renderPanel()` や `onCueChange()` のような挙動影響が大きい関数は、UI shell 整理と同じバッチで深く分解しない
- resolver の仕様、secondaryLang fallback、#17 の current 行モデル、Phase D で確定した primary 表示条件は維持する
- コメント境界を明示し、少なくとも以下のまとまりを保つ
  - `// [UI shell: panel/debug]`
  - `// [UI shell: subtitle popup]`
  - `// [UI shell: overlay/panel anchor]`
  - `// [render]`
  - `// [binder/cue logic]`
  - `// [observer/layout]`
  - `// [bootstrap]`
- 既存コメントは維持し、責務境界を追加で明確化したい箇所に短いコメントを足す
- 新規 helper は薄い責務のものに限定し、旧ロジックを残したまま新ロジックを継ぎ足す形を避ける
- 削除は「確実に不要」と判断できるものに限り、迷うものは次バッチへ送る

### Phase E (1) メモ: panel / overlay UI shell の責務整理

- 関連 issue: [#20](../../issues/20) Phase E (1): content.js panel / overlay セクションの責務分離
- Phase E の最初の一手（入口整理）は完了し、UI shell 側から安全に整理を進めた
- 対象は panel / debug / overlay / subtitle popup の構造整理とし、binder / cue logic には踏み込まない
- `createRightPanel()` / `createOverlay()` / `createPopupHost()` は host / shadow 準備、shell 適用、イベント配線呼び出しへ責務を寄せた
- subtitle popup の wiring は `wireSubtitlePopupUiEvents()` へ抽出し、create 系の責務線を揃えた
- popup / overlay の長い template は `buildPopupShellHTML()` / `buildOverlayShellHTML()` のような builder 関数へ寄せる
- overlay は 1 段整理済み（`updateOverlay()` の word click listener 登録を外し、`wireOverlayUiEvents()` の event delegation へ移動）
- `createOverlay()` は host 作成 → shadow root 準備 → shell HTML 適用 → wiring 呼び出しへ統一
- subtitle popup は 1 段整理済み（`buildPopupShellStyleText()` へ style 定義を分離し、`wireSubtitlePopupUiEvents()` に責務コメントを追加）
- popup 内 `.atv-word-link` click 処理は early return 形へ整理（仕様・挙動は変更しない）
- panel の `panel-debug-anchor` 追加 + debug mount 先変更案は、責務線が曖昧化しうるため今回は見送り
- panel は案A を 1 段適用済み（`buildPanelShellHTML()` / `buildPanelDebugShellHTML()` / `createDebugPanel()` に責務コメントを追加）
- panel header は `wirePanelHeaderActions()` に責務コメントを追加し、header wiring と shell の境界を明確化した
- debug 側は `createDebugPanel()` / `debug-panel.js` の `mount()` に責務コメントを追加し、debug mount / debug wiring の境界を明確化した
- DOM の id / class / data 属性、見た目、close 動作、panel の current 行や threshold-scroll の挙動は変えない
- `renderPanel()` / `renderSecondarySubtitle()` / `updateOverlay()` / `applyCurrentStateToPanel()` は、shell 作成ではなく既存 shell への state 反映責務として境界を明示した
- 今回は全面分割に進まず、Phase E 本体で panel / overlay / subtitle popup の shell 分離を段階的に切り出す
- #21（binder / cue）/ observer / bootstrap / #10 は今回の範囲外とする
- `renderPanel()` の hover / click / scroll ロジック分解は #20 の範囲では行わず、必要なら次バッチへ送る

### Phase E (2) メモ: binder / cue logic の整理と分割準備

- 関連 issue: [#21](../../issues/21) Phase E (2): content.js binder / cue ロジックの整理と分割準備
- #20 で UI shell 側の境界を明示したあと、次に binder / cue logic 側を整理する
- `selectPrimaryAndSecondaryTracks()` / `bindPrimarySubtitleTrack()` / `bindSecondarySubtitleTrack()` / `clearTrackBindings()` などの track binding 群を近接配置する
- `onCueChange()` / `getCurrentCue()` / `findCueAt()` / snapshot 周辺を cue handling としてまとまり化する
- subtitle history / current row 連携は binder / cue logic 側の責務として見えるようにする
- この段階でも挙動は変えず、関数のグルーピング、コメント境界、早期 return、薄い helper 化に留める
- 実際のファイル分割は Phase E 後半の別 issue に送る

### 確認項目

- controls 位置調整が壊れない
- panel と footer / unified-controls の干渉が再発しない
- observer の無限ループ・多重登録がない
- panel / debug / overlay / subtitle popup の UI shell 境界がコメントと関数構造で追える
- binder / cue logic のまとまりが UI shell と混線せずに追える
- observer / timer / retry を触る差分と、UI shell / binder 整理の差分が必要以上に混ざらない

---

## 実装順まとめ

1. Phase A を実装して確認
2. Phase B は resolver だけ切る
3. Phase C は settings bridge と Debug UI API まで
4. #17 で current ブロック改善を行う
5. #18 で primaryLang 非英語時の主字幕問題を Phase 3 範囲で切り分ける
6. Phase D（#19）で binder / sidebar を整理し、primary UI 非対称を解消した
7. Phase E で UI shell → binder / cue logic → layout / observer / bootstrap の順に最終整理する

---

## 現在の着手位置

- ロードマップは Phase A〜E で確定済み
- Phase A（#12）/ Phase B（#13）/ 設定ライフサイクル再整理（#14）/ ログカテゴリ整理（#8）は完了済み
- Phase C（#16）は完了（settings-bridge.js / debug-panel.js の API 契約確定と content.js 入口委譲を反映済み）
- #17（current 表示モデル整理と最小スクロール）は完了済み
- #18（primaryLang 非英語時の主字幕表示問題の切り分け）は Phase 3 範囲で完了・close 済み
- Phase D の #19（binder / sidebar 側で primary cue が UI に反映されない非対称の解消）は完了済み
- Phase E はその後の UI shell / binder / observer / bootstrap の最終整理として残す
- open issue は #20 / #21 / #10 で、構造改善の主線は #20 → #21 の順で進める

---

## #17 完了メモ（current 表示モデル）

- 関連 issue: [#17](../../issues/17) `[P1] content.js の current 表示モデルを整理し、マーク移動と最小スクロールへ移行する`（完了）
- 扱う範囲
  - current 行の左側固定幅マーク欄による表示
  - current ブロックの視覚的強調は、本文ではなくマーク欄へ寄せる
  - 固定ヘッダー / 固定 debug ログセクション / 字幕スクロール領域の 3 層構造を維持したまま、current を見失いにくくすること
- 前提 API: settings 状態は `window.ATVB.settingsBridge`、Debug UI / log 導線は `window.ATVB.debugPanel` / `window.ATVB.logger` を再利用する
- 導線制約: settings 導線と debug 導線は新設せず、既存 bridge / panel / logger の接続を維持する
- UI 制約
  - ヘッダー（`字幕履歴` / `⚙️` / `閉じる✕`）の構造・位置・文言は維持する
  - debug ログセクションはヘッダー直下に固定されたままとし、折りたたみ時は 1 行、展開時は数行のログ本文を表示できる状態を維持する
  - current / history / future のテキストは選択・コピー可能な DOM のまま維持する
  - 字幕全体の強いグレーアウトは行わず、current テキストだけを少し目立たせる
- 非対象
  - current セクション内へのタイトル・エピソード・`primaryLang` / `secondaryLang` / selected track label の追加表示
  - binder / sidebar / observer / bootstrap の分離
  - `settings-bridge.js` / `debug-panel.js` API 変更
  - resolver / fallback 仕様変更
- 実装方針
  - 既存 helper / bridge / logger / debugPanel を再利用する
  - 新規 timer / observer / listener は追加しない
  - current 表示モデル整理の中で重複コードを増やさない

---

## #18 完了メモ（Phase 3 切り分け）

- 関連 issue: [#18](../../issues/18) `[P1] primaryLang を英語以外にした場合に主字幕が表示されない問題を切り分ける`（完了）
- Phase 3 の範囲では、resolver / primary signal / debug 導線までの切り分けを行った
- `subtitle-track-resolver.js` では、underscore 区切りを hyphen と同等に扱う正規化と、3 文字コードから 2 文字コードへの寄せを追加した
  - `deu -> de`
  - `jpn -> ja`
  - `zho` / `chi` -> `zh`
  - `kor -> ko`
  - `fra` / `fre` -> `fr`
  - `spa -> es`
- その結果、primaryLang = de / ja / zh / ko / fr / es でも resolver 上は `primaryTrackFound: true` になることを確認した
- content.js 側では `primaryActiveCues` / `hasFreshPrimarySnapshot` / `lastPrimarySnapshotAt` を使い、live 優先 + snapshot 鮮度付きの primary signal 判定へ整理した
- Debug ログでは `primaryActiveCues > 0`、`primaryCueTextLength > 0`、`snapshotPrimaryTextLength > 0` を観測でき、primary cue / text / snapshot までは live で取得できていることを確認した
- それでも UI の primary 行が空のケースが残ったため、残課題は binder / sidebar / renderPanel 側の UI 層として整理し、Phase D の #19 へ移管した

---

## 履歴メモ: Phase A 着手前の issue 化方針（完了済み）

- Phase A は `content.js` 分割の最初の実装単位として、着手前に専用 issue を作成してから進める
- issue の目的は、`vtt-normalizer.js` / `debug-logger.js` 切り出しの対象範囲・非対象範囲・確認項目を固定し、Phase B 以降へ責務を持ち越さないようにすること
- この issue では、既存挙動を変えない差分ゼロ移行を前提とし、実装途中の責務拡張は行わない
- `content.js` の全面分割や広範囲な書き換えには進まず、Phase A の対象である純関数と独立 logger の切り出しに限定する
- `manifest.json` の `content_scripts` 追加、`content.js` 上部のラッパー追加、既存 logger / VTT 関数本体の移設を同一 issue のスコープに含める
- 受け入れ条件は本書 Phase A の「確認項目」をそのまま使う
- Issue 進捗・完了状態は `docs/dev-roadmap.md` 側で管理し、本書は分割方針と実装順の整理に限定する

### issue タイトル案

- `[P1] content.js Phase A: vtt-normalizer.js / debug-logger.js を切り出す`

### issue 本文に含めるべき観点

- 対象
  - `vtt-normalizer.js`
  - `debug-logger.js`
- やること
  - `normalizeSubtitleText` / `cleanCueText` / `formatTime` の移設
  - 既存 logger 関数群の移設
  - `window.ATVB` 名前空間経由の公開
  - `content.js` 側ラッパー追加
  - `manifest.json` の `content_scripts` 順更新
- やらないこと
  - resolver の切り出し
  - settings bridge / Debug UI API 分離
  - binder / sidebar / observer / bootstrap 整理
  - `content.js` の全面分割
- 確認項目
  - 拡張の reload でエラーが出ない
  - 右字幕パネル / options の Debug 表示で、共通 `debugLogs` 経由のログが従来どおり追える
  - 字幕整形が従来どおり動く
  - Debug UI が残っている場合、ログ更新が従来どおり動く

### 着手順メモ

1. VSCode Copilot で `content.js` の現状マッピング結果を確認する
2. Phase A 専用 issue を作成する
3. issue 番号確定後、必要なら `docs/dev-roadmap.md` に追加する
4. その後にだけ Phase A 実装へ進む
