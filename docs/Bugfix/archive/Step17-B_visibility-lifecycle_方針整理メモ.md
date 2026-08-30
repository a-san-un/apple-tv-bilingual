# Bugfix Step 17-B 方針整理メモ

対象ブランチ: `issue-32-content-core-split`  
対象ステップ: **Step 17-B: visibility lifecycle 整理**

Step 17-B は、**`panelOpen` の意味・更新・保存・DOM反映・lifecycle cleanup を分離し、visibility の責務を固定する作業**として進めるのが適切です。  
17-A-8 で panel UI の完全破棄入口は `panelUi.dispose()` に固定済みなので、17-B では dispose を再設計せず、**通常の開閉・一時非表示・再初期化・完全破棄の境界**を確定します。

## 到達目標

Step 17-B の完了時点で、以下を満たします。

- `panelOpen` は「現在の panel 開閉状態」のランタイム状態として一貫して扱う。
- `panelDefaultOpen` は通常起動時の初期値だけを与える永続設定として扱う。
- `modules/panel-visibility-state.js` は storage の load / persist に限定し、DOM・renderer・snapshot・block state・overlay を持たない。
- `modules/panel-ui.js` は `panelOpen` を受けて DOM visibility、layout、必要な render を適用する。
- 軽量な visibility reset と `panelUi.dispose()` による完全 cleanup の境界を明文化する。
- playback detach、SPA 遷移、拡張 ON/OFF、再起動後に、stale な `panelOpen`、host、layout、snapshot、render 予約が残らない。
- `content.js` は状態遷移の高レベル中継と DI に留まり、個別 DOM 操作・storage 直接操作・cleanup 詳細を持たない。

`panel-visibility-state.js` は現在、`panelOpen` を `chrome.storage.local` に保存し、未保存の場合に `panelDefaultOpen` を fallback として返す実装です。したがって 17-B では、この既存仕様を壊さず owner と呼び出し経路を整理することが中心になります。

## 状態モデル

| 状態・値 | 正本 owner | 用途 | 保存先 | 17-Bでの扱い |
|---|---|---|---|---|
| `panelOpen` | 共有 runtime state | 現在の panel 開閉 | `chrome.storage.local` | 通常の開閉操作で更新・保存する |
| `panelDefaultOpen` | settings state | 初回 / 未保存時の初期値 | `chrome.storage.sync` | 起動時 fallback としてのみ参照する |
| panel host / ShadowRoot | `panelUi` | UI の実体 | 保存しない | mount / dispose で生成・破棄する |
| panel render snapshot | `panelUi` owner state | render 観測・互換参照 | 保存しない | refresh / reset / dispose の境界を固定する |
| subtitle block state | subtitle state owner | sequence / current block / meta | 保存しない | visibility state と混ぜない |
| overlay DOM / layout tracking | overlay owner | 学習補助 UI | 保存しない | 軽量非表示と完全破棄を区別する |

`panel-ui.js` は既に visibility state の正本ではなく、DOM表示切替・render owner・renderer 呼び出しに留まる方針です。Step 17-B ではこの境界を、呼び出し元・JSDoc・lifecycle 経路まで一貫させます。

## 非目標

以下は Step 17-B に混ぜません。

- panel の見た目、レイアウト、CSS、Shadow DOM の構造変更
- renderer の block 表示ロジックや字幕同期アルゴリズムの変更
- track 選択、native toggle、secondary recovery の不具合修正
- term inspector の module 抽出（Step 18）
- `panelUi.dispose()` が持つ host / observer / timer / overlay の完全 cleanup 契約の再変更
- `panelDefaultOpen` の保存先や設定 UI の仕様変更

## 作業順序

| 順序 | 枝番 | フェーズ種別 | 対象ファイル | 実施内容 | 完了条件 |
|---|---|---|---|---|---|
| 1 | 17-B-1 | 調査・整理 | `content.js`、`modules/panel-ui.js`、`modules/panel-visibility-state.js` | `panelOpen` の read / write / persist / DOM反映 / render 更新の全呼び出し元を列挙する | 状態遷移表と呼び出しグラフを作れる |
| 2 | 17-B-2 | 調査・整理 | `modules/playback-session-cleanup.js`、`modules/subtitle-state-reset.js`、`reinitialize-coordinator.js` | OFF、detach、SPA遷移、restart、mount の各 lifecycle で、`panelOpen` と DOM がどう扱われるか確認する | 通常開閉・軽量reset・完全dispose の境界を説明できる |
| 3 | 17-B-3 | 実ファイル修正 | `modules/panel-visibility-state.js` | load / persist の入出力契約、storage fallback、エラー時挙動を JSDoc と命名で固定する | module が storage adapter 以外の責務を持たない |
| 4 | 17-B-4 | 実ファイル修正 | `modules/panel-ui.js` | visibility 適用 API を整理し、DOM表示・layout適用・必要な render の責務を owner 内に閉じる | `panelOpen` の DOM反映経路が `panelUi` に集約される |
| 5 | 17-B-5 | 実ファイル修正 | `content.js`、必要に応じて `reinitialize-coordinator.js` | 高レベルの visibility action を中継し、storage / DOM / render 詳細への直接依存を外す | `content.js` が state遷移の入口と DI に留まる |
| 6 | 17-B-6 | 実ファイル修正 | `modules/playback-session-cleanup.js`、`modules/subtitle-state-reset.js` | 軽量 reset と完全 dispose の呼び分けを固定する | lifecycle ごとに二重 persist / 二重 render / stale layout がない |
| 7 | 17-B-7 | 実機検証 | Apple TV+ 実機、DevTools | 開閉、OFF/ON、SPA遷移、detach、restart を反復する | host・observer・timer・layout・snapshot が残留しない |
| 8 | 17-B-8 | ドキュメント更新 | 実装シート、方針整理メモ、必要なら module-load-order | owner・API・lifecycle 表を更新する | Step 18 が visibility internals に依存せず着手できる |

## 17-B-1 調査項目

最初にコード変更せず、以下を表にします。

| 観点 | 確認対象 | 確認したい結論 |
|---|---|---|
| Runtime read | `state.panelOpen` の参照元 | 表示・layout・render のどれが現在状態を読むか |
| Runtime write | `state.panelOpen` の代入元 | toggle、起動復元、再初期化で誰が更新するか |
| Persist | `ATVB_PANEL_VISIBILITY.persist()` の呼び出し元 | ユーザー操作時だけ保存しているか |
| Load | `ATVB_PANEL_VISIBILITY.load()` の呼び出し元 | 起動時 fallback として一度だけ使われるか |
| DOM apply | `applyPanelVisibility()` 等 | host、toggle、layout の反映順が一意か |
| Render apply | `applyPanelState()` / `refreshPanel()` | visibility 操作で不要な block rebuild が走らないか |
| Lifecycle | cleanup / reinitialize 系 | dispose 後に古い visibility 操作が走らないか |

特に、`panelOpen` の保存はユーザーの明示的な開閉操作に限定するか、起動・再初期化で復元した値も書き戻すかを決める必要があります。現行 module の設計は `panelOpen` を local storage に保存し、未保存時のみ `panelDefaultOpen` を fallback にするため、推奨は **ユーザー操作でのみ persist、load結果の再保存はしない** です。

## visibility API案

17-B では新規 module を増やさず、既存 `panelUi` と `panelVisibilityState` の API を明確化します。

```js
// panel-visibility-state.js
const panelOpen = await panelVisibility.load(panelDefaultOpen);
panelVisibility.persist(panelOpen, logContent);

// panel-ui.js
panelUi.applyPanelState("mount");
panelUi.applyPanelState("user-toggle");
panelUi.refreshPanel("subtitle-snapshot");

// 完全 UI 破棄のみ
panelUi.dispose({ reason: "extension-disabled" });
```

`applyPanelState()` は state effects を伴う panel 状態の再適用、`refreshPanel()` は既存 state に基づく描画のみ、`dispose()` は host・ShadowRoot・observer・timer・overlay を含む完全 cleanup という既存の役割を維持します。

追加する場合も、public API は最小限にします。

```js
panelUi.setPanelOpen(nextOpen, {
  reason: "user-toggle",
  persist: true,
});
```

ただし、`setPanelOpen()` を導入するのは 17-B-1 の調査で state 代入・persist・DOM反映が複数箇所に残っていると確認できた場合に限ります。単一経路が既にあるなら、関数追加ではなく既存 `togglePanel()` / `applyPanelState()` の入力契約を明文化する方を優先します。

## lifecycle分類

| ケース | `panelOpen` | storage persist | DOM / layout | render snapshot | block state | 完全 dispose |
|---|---|---|---|---|---|---|
| ユーザーが開閉 | 更新する | 行う | 即時反映 | 必要時のみ更新 | 開く場合だけ必要な再同期 | しない |
| 初回 mount | load結果を設定 | 通常はしない | 初期反映 | 必要時に生成 | subtitle owner から読む | しない |
| subtitle 更新 | 変更しない | しない | 原則変更しない | `refreshPanel()` で更新 | subtitle owner が更新 | しない |
| playback restart | 原則維持 | しない | 再mount時に再適用 | 古いものを clear | subtitle lifecycle 側で整理 | ケース依存 |
| SPA / content switch | 原則維持 | しない | 旧DOMを破棄し新targetへ再mount | 古いものを clear | subtitle lifecycle 側で整理 | 行う |
| 拡張機能 OFF | runtime状態の扱いを固定 | 原則しない | host・overlayを破棄 | clear | subtitle reset 側で clear | 行う |
| 拡張機能 ON | 保存済み値を load | 通常はしない | mount後に反映 | 必要時に生成 | subtitle owner から読む | しない |

OFF 時に `panelOpen` を強制的に `false` として保存すると、次回 ON 時にユーザーが開いていた panel が意図せず閉じるため、通常は **UIを完全破棄しても `panelOpen` の保存値は変更しない** 方針が安全です。これは `panelOpen` が「拡張有効中の開閉設定」であり、拡張有効 / 無効自体の state とは別であるためです。

## 実装ファイル別計画

### `modules/panel-visibility-state.js`

- `panelOpen` と `panelDefaultOpen` の意味を JSDoc とモジュール先頭コメントで統一する。
- `load()` は local storage 値、未保存時 fallback、storage error 時 fallback のみを扱う。
- `persist()` は boolean 正規化、保存失敗ログのみを扱う。
- DOM参照、layout、renderer、snapshot、block state、lifecycle 判断を追加しない。
- `chrome.storage.local` を runtime UI state の保存先とする現行契約を維持する。

### `modules/panel-ui.js`

- `applyPanelVisibility()`、`togglePanel()`、`applyPanelState()` の呼び出し関係を整理する。
- `panelOpen` に応じた host visibility、toggle表示、`applyLayout()`、必要な render の順序を固定する。
- open 時だけ `applyPanelStateEffects` を呼ぶのか、close 時にも必要な軽量 cleanup を呼ぶのかを明文化する。
- render 更新だけの経路は `refreshPanel()` に限定し、visibility変更と混同しない。
- `dispose()` は完全cleanupのままとし、通常の close には使用しない。

### `content.js`

- visibility 操作の外部入口だけを保持する。
- `panelOpen` の代入、persist、DOM操作、renderer実行を複数箇所に散らさない。
- `panelUi` への DI と high-level action を中心にする。
- `ATVB_PANEL_VISIBILITY` の storage API を UIイベントや lifecycle が直接呼ぶ設計なら、単一の高レベル中継へ寄せる。

### lifecycle modules

対象:

- `modules/playback-session-cleanup.js`
- `modules/subtitle-state-reset.js`
- `reinitialize-coordinator.js`

作業内容:

- 軽量 reset: panel を通常 close するための処理ではなく、snapshot・subtitle表示の一時整理に限定する。
- 完全 cleanup: target喪失、content switch、拡張 OFF、destroy時に `panelUi.dispose()` を一度だけ呼ぶ。
- restart: `panelOpen` を storage に再保存せず、既存 runtime値またはload済み値を新しい mount へ渡す。
- async callback・timer・observer が dispose 済み UI に visibility / render を適用しない guard を確認する。

## 実機検証

### 基本操作

1. 拡張を有効化し、初回表示が `panelDefaultOpen` または保存済み `panelOpen` に従うことを確認する。
2. panel を開閉し、host visibility、toggle表示、layout、render が同じ操作で整合することを確認する。
3. ページ再読み込み後、最後にユーザーが選んだ `panelOpen` が復元されることを確認する。
4. `panelDefaultOpen` を変更し、local に `panelOpen` 未保存の場合だけ初期値へ反映されることを確認する。
5. local に `panelOpen` 保存済みの場合、`panelDefaultOpen` を変更しても現在の開閉状態が上書きされないことを確認する。

### lifecycle回帰

1. panel を開いた状態で、作品・エピソードを切り替える。
2. panel を閉じた状態で、作品・エピソードを切り替える。
3. panel を開閉した後、拡張を OFF → ON する。
4. 再生中に hard seek、playback detach、再初期化を行う。
5. 上記を繰り返し、panel host、toggle、ShadowRoot、observer、timer、overlay、render snapshot が二重化・残留しないことを確認する。
6. DevTools の Event Listeners、Performance Monitor、Heap Snapshot で detached DOM と listener増加を比較する。

### 観測ログ

17-B で追加または整理するログは最小限にします。

```js
logContent("panel visibility transition", {
  reason,
  previousOpen,
  nextOpen,
  persist,
  hasHost: Boolean(panelHost),
  isDisposed,
});
```

```js
logContent("panel visibility lifecycle", {
  reason,
  panelOpen,
  action: "mount" | "refresh" | "dispose",
  hasTarget: Boolean(getTarget()),
});
```

ログは toggle、mount、dispose、target喪失を関連付けるためだけに使い、cue更新ごとの詳細ログにはしません。

## 完了判定

Step 17-B は、次をすべて満たしたら完了とします。

- `panelOpen` / `panelDefaultOpen` / `extensionEnabled` の意味と保存先が混在していない。
- `panel-visibility-state.js` は storage adapter に留まる。
- 通常の close は `panelUi.dispose()` を呼ばず、DOMを完全破棄しない。
- complete cleanup が必要な lifecycle では `panelUi.dispose()` が一度だけ呼ばれる。
- panel visibility の更新で block state を直接破棄しない。
- storage restore、toggle、layout、render、SPA遷移、OFF/ON の各経路に stale state がない。
- `content.js` に panel DOM / renderer / storage の詳細操作が増えていない。
- Step 18 が panel visibility / disposal internals に依存せず、term inspector を独立して抽出できる。

## 進行管理

| 枝番 | 内容 | フェーズ種別 | 状態 | 主な対象 |
|---|---|---|---|---|
| 17-B-1 | visibility read/write/persist/apply の棚卸し | 調査・整理 | 未着手 | `content.js`、`panel-ui.js`、`panel-visibility-state.js` |
| 17-B-2 | lifecycle別の軽量reset / 完全dispose境界確認 | 調査・整理 | 未着手 | cleanup / reset / reinitialize modules |
| 17-B-3 | visibility storage契約の固定 | 実ファイル修正 | 未着手 | `panel-visibility-state.js` |
| 17-B-4 | UI visibility適用ownerの固定 | 実ファイル修正 | 未着手 | `panel-ui.js` |
| 17-B-5 | `content.js` 高レベル中継への縮小 | 実ファイル修正 | 未着手 | `content.js` |
| 17-B-6 | lifecycle cleanup接続の固定 | 実ファイル修正 | 未着手 | cleanup / reset / reinitialize modules |
| 17-B-7 | 実機・メモリ回帰確認 | 実機検証 | 未着手 | Apple TV+、DevTools |
| 17-B-8 | 設計・実装資料の同期 | ドキュメント更新 | 未着手 | Bugfix docs |
