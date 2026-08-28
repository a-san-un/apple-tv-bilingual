# Bugfix 実装シート 2026-08-28（作業台完了記録版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** `docs/Bugfix/Bugfix マスタープラン.md`  
**対応方針メモ:** `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md`  
**最新反映コミット:** `refactor: Step 17-A-11 の extensionEnabled runtime 分離とコメント同期を反映する`  
**現在の作業:** Step 17-A-11 完了記録 — `extensionEnabled` を永続設定から runtime state へ分離した結果を整理する。

***

## このシートの役割

このシートは、**Step 17-A-11 の作業台兼完了記録**である。  
変更対象、ファイル単位の実装順、確認観点、実機検証、作業中の判断、および完了結果を記録する。

全体目標、過去 Step の完了履歴、将来作業、各資料の役割は `Bugfix マスタープラン.md` を参照する。  
Step 17-A の owner 判断、API 契約、詳細な移行根拠は `Step17-A_panel系統合_方針整理メモ.md` を正本とする。

***

## 今回の目的

Step 17-A-11 として、`extensionEnabled` を `chrome.storage.sync` に保存する永続設定から外し、`state.extensionEnabled` を current playback session に限定した runtime state として一本化した。

これにより、拡張全体の ON/OFF は設定値の保存・復元ではなく、native toggle または runtime 設定反映による session 内の状態遷移として扱われる。  
ページ再読込、SPA 遷移、別エピソードへの遷移などで生成される新しい playback session は、前セッションの ON/OFF 状態を sync storage から復元しない。

今回の作業で固定した範囲は次のとおりである。

- `settings-runtime.js` における `state.extensionEnabled` 基準への設定反映・restart・runtime message 処理の統一
- `content.js` の settings runtime DI から dead dependency を除去する整理
- `modules/settings-store.js` から `extensionEnabled` の保存・読み込み・export 経路の削除
- `modules/settings-schema.js` の sync schema、default、merge、normalize からの `extensionEnabled` 除外
- `modules/playback-session-cleanup.js` の stop / pause の `runSessionTeardown()` への統合
- `modules/panel-ui.js` の責務を panel lifecycle に限定する整理
- popup / options を runtime enable / disable に追従させる整理

今回の作業では、字幕言語の解決ロジック、cue 同期アルゴリズム、panel の見た目、overlay の見た目、term inspector の抽出、Step 17-B の visibility / lifecycle owner 固定そのものは扱っていない。

***

## 前提

以下は Step 17-A-10 までに完了済みであり、Step 17-A-11 でも維持した。

- `panelUi.dispose()` は panel host、ShadowRoot、toggle button、native toggle observer、resize listener、render timer、render snapshot、renderer owner state、overlay DOM を対称に cleanup する高レベル入口である。
- `removeHost()` は低レベルな DOM host 除去だけを担当する。
- `applyPanelState()` は state effects を含む panel 状態の再適用である。
- `refreshPanel()` は既存 state に基づく描画のみを担当する。
- `panelRenderer` と `getPanelRenderInput()` は `content.js` から `createPanelUi()` へ DI される。
- `modules/subtitle-block-state.js` は subtitle block sequence、current block 解決、current block mirror 同期、panel open 時の block rebuild を担当する。
- `modules/panel-renderer.js` は共有 state を直接読まず、入力から描画結果と snapshot を返す。
- `modules/panel-visibility-state.js` は `panelOpen` の load / persist 専用であり、DOM、render、snapshot、block state を持たない。

***

## 対象ファイル

| ファイル | 今回確認した責務 | Step 17-A-11 の結果 |
| :-- | :-- | :-- |
| `settings-runtime.js` | 設定反映、restart、runtime message の調停 | `state.extensionEnabled` 基準へ統一し、destructure から `cueController` / `syncIntervalOrchestrator` / `panelUi` を外して `deps.*` 経由に整理した。 |
| `content.js` | settings runtime DI、初期 state、全体 orchestration | `createSettingsRuntime()` への dead DI（`clearSecondaryTrackState` / `teardownForRestart` / `getPlaybackContextLogPayload` / `getUniqueTracks` / `renderSecondarySubtitle`）を削除し、遅延代入が必要な owner は getter DI を維持した。 |
| `modules/settings-store.js` | sync 設定の load / save | `extensionEnabled` の `loadEnabledFlag()` / `saveEnabledFlag()` / export / 関連コメントを削除し、保存対象から除外した。 |
| `modules/settings-schema.js` | sync 設定 schema、default、merge、normalize | `extensionEnabled` の schema / default / merge / normalize 経路を削除し、sync 設定の正規化対象から外した。 |
| `modules/playback-session-cleanup.js` | playback session の teardown | stop / pause の処理を `runSessionTeardown()` へ統合し、OFF / restart / SPA 遷移で teardown 経路を一本化した。 |
| `modules/panel-ui.js` | panel lifecycle と UI owner | extension 全体 ON/OFF の owner を持たない構成を確認し、panel lifecycle（host / toggle / render / dispose）に責務を限定した。 |
| `popup.js` / `popup.html` | popup 上の設定・状態反映 | `extensionEnabled` を settings payload に含めず、runtime enable / disable message へ追従させる経路に整理した。 |
| `options.js` / `options.html` | 詳細設定の保存・反映 | sync 設定 UI / 保存 payload から `extensionEnabled` を外し、runtime enable / disable と混同しない構成に整理した。 |

***

## 判断基準

### runtime state と保存設定を分ける

`state.extensionEnabled` は現在の playback session の制御状態として扱う。  
言語設定、字幕表示設定、`panelDefaultOpen` のようなユーザー設定とは異なり、次回ページ起動時へ復元する対象にしない。

### native toggle の責務

`atvb-native-toggle` は `state.extensionEnabled` の切替入口である。  
OFF 時にも DOM 上に残して再操作を可能にするが、`panelOpen`、panel host、overlay host、sync settings の保存を直接 owner として抱えない。

### panel UI の責務

`modules/panel-ui.js` は panel host、ShadowRoot、panel toggle、render timer、resize / observer、panel dispose といった panel lifecycle を owner とする。  
extension 全体の ON/OFF 判断、settings storage の read / write、playback session 全体の restart / teardown sequence は他 owner が扱う。

### cleanup の責務

`modules/playback-session-cleanup.js` は playback session を終了・切替・再起動するための高レベル teardown を一貫して扱う。  
stop / pause のように session teardown に必ず付随する副作用は、呼び出し側へ散らさず `runSessionTeardown()` に統合する。

### popup / options の責務

popup / options は永続設定の編集と、現在アクティブな Apple TV+ tab への設定反映を扱う。  
`extensionEnabled` を永続設定の一部として保存せず、runtime enable / disable を扱う場合は current playback session に対する明示的な runtime message として分離する。

***

## 実装ステップ

| Step | 対象ファイル | 状態 | 実装内容 | 確認結果 |
| :-- | :-- | :-- | :-- | :-- |
| 17-A-11-1 | `settings-runtime.js` | 完了 | `extensionEnabled` の参照を `state.extensionEnabled` 基準へ統一し、設定反映・restart・message 処理を整理した。 | storage 上の `extensionEnabled` に依存せず、session runtime state を正本とする経路へ統一した。 |
| 17-A-11-2 | `settings-runtime.js` | 完了 | `createSettingsRuntime(deps)` の destructure から `cueController` / `syncIntervalOrchestrator` / `panelUi` を除去し、使用箇所を `deps.*` に置換した。 | ESLint no-undef を解消し、遅延代入される dependency の getter DI を維持できている。 |
| 17-A-11-3 | `settings-runtime.js` | 完了 | `resetTopLevelPlaybackRefsForToggleOff()` と `safeTryGetLanguages()` を復元した。 | toggle OFF cleanup と安全な言語取得の補助経路を維持できている。 |
| 17-A-11-4 | `content.js` | 完了 | `createSettingsRuntime()` 呼び出しから dead DI を削除した。 | settings runtime の実利用 dependency だけが残り、DI が過剰に広がらない構成になった。 |
| 17-A-11-5 | `modules/settings-store.js` | 完了 | `loadEnabledFlag()`、`saveEnabledFlag()`、関連 export、コメントを削除した。 | `extensionEnabled` の storage read / write 経路が残っていないことを確認した。 |
| 17-A-11-6 | `modules/settings-schema.js` | 完了 | sync schema、default、merge、normalize の `extensionEnabled` 経路を削除した。 | load / save 時に `extensionEnabled` が設定 snapshot へ再混入しないことを確認した。 |
| 17-A-11-7 | `modules/playback-session-cleanup.js` | 完了 | stop / pause を `runSessionTeardown()` へ統合した。 | OFF、restart、SPA 遷移の teardown 経路が一貫し、stop / pause が二重実行されないことを確認した。 |
| 17-A-11-8 | `modules/panel-ui.js` | 完了 | panel lifecycle に責務を限定し、extension 全体 enable state の owner にならないよう整理した。 | `panelOpen` と `state.extensionEnabled` の責務境界が混ざらないことを確認した。 |
| 17-A-11-9 | `popup.js` / `popup.html` | 完了 | `extensionEnabled` を永続設定として保存せず、runtime enable / disable 反映に追従させた。 | popup の操作が current tab の runtime state にのみ作用することを確認した。 |
| 17-A-11-10 | `options.js` / `options.html` | 完了 | sync settings の UI / 保存 payload から `extensionEnabled` を外した。 | options 保存後にも `extensionEnabled` が sync storage に混入しないことを確認した。 |
| 17-A-11-11 | docs 3 files | 完了 | Step 17-A-11 完了と次フェーズ移行を docs へ同期した。 | この文書差し替えで反映済みである。 |

***

## コメント同期の確認

今回の Step 17-A-11 では、実装差分だけでなくコメント同期も確認対象に含めた。

| ファイル | 確認結果 | 補足 |
| :-- | :-- | :-- |
| `settings-runtime.js` | 良好 | ヘッダーコメントを `state.extensionEnabled` 基準の記述へ更新済みである。 |
| `content.js` | 良好 | `createSettingsRuntime()` 周辺のコメントが dead DI 削除後の構成と整合している。 |
| `modules/settings-store.js` | 良好 | `extensionEnabled` を永続設定として説明するコメントが残っていない。 |
| `modules/settings-schema.js` | 良好 | schema 定義周辺のコメントが `extensionEnabled` を同期対象外として整合している。 |
| `modules/playback-session-cleanup.js` | 良好 | `runSessionTeardown()` の JSDoc が stop / pause 統合後の責務と整合している。 |
| `modules/panel-ui.js` | 良好 | panel lifecycle 限定後の責務説明とコメントが整合している。 |

***

## 確認観点

今回の完了確認では、次の観点を満たしていることを確認対象とした。

- `modules/settings-store.js` に `loadEnabledFlag`、`saveEnabledFlag`、`extensionEnabled` の保存・export が残っていないこと。
- `modules/settings-schema.js` に `extensionEnabled` の schema、default、merge、normalize 経路が残っていないこと。
- `extensionEnabled` を `chrome.storage.sync` の保存値として扱うコメントが残っていないこと。
- `settings-runtime.js` の `cueController`、`syncIntervalOrchestrator`、`panelUi` が destructure 変数ではなく `deps.*` を通じて参照されていること。
- `content.js` の `createSettingsRuntime()` に dead DI が再混入していないこと。
- `modules/panel-ui.js` が sync settings の read / write や extension 全体 state の正本を持たないこと。
- popup / options の settings payload が `extensionEnabled` を含まないこと。

***

## 実機検証メモ

Step 17-A-11 は `extensionEnabled` の owner 境界整理が中心であり、panel / overlay の見た目や字幕同期アルゴリズム自体の変更は行っていない。  
そのため、このシートでは「拡張 ON/OFF が session runtime state として一貺し、既存の panel / overlay / cleanup 到達経路を壊していないこと」を中心に確認対象として扱った。

確認済みの対象は次のとおりである。

- 拡張 OFF 時、`state.extensionEnabled` が `false` として反映され、OFF cleanup が一度だけ実行されること。
- 拡張 OFF 時にも `atvb-native-toggle` が残り、再び ON にできること。
- OFF→ON 復帰時、`state.extensionEnabled` が `true` として反映され、panel / overlay / subtitle が一度だけ再生成されること。
- ON/OFF を連続操作しても、二重 host、二重 listener、二重描画、cleanup / restart の多重実行が起きないこと。
- `extensionEnabled` が `chrome.storage.sync` に保存・更新されないこと。
- ページ再読込または SPA 遷移後、新しい playback session が前セッションの ON/OFF 状態を storage から復元しないこと。
- popup / options 保存後に、`extensionEnabled` が設定 payload や sync storage に混入しないこと。
- `panelOpen` と `panelDefaultOpen` の保存・初期化挙動が今回の変更で壊れていないこと。

***

## 作業中の判断メモ

- `extensionEnabled` を sync storage から削除しても、`panelOpen` と `panelDefaultOpen` の保存仕様は変更していない。
- OFF によって panel host / overlay host などの拡張 UI は破棄するが、`atvb-native-toggle` は OFF 状態でも残す。
- `state.extensionEnabled` は session 固有であり、再読込・SPA 遷移・別エピソード遷移で前状態を復元しない。
- `settings-runtime.js` の getter DI は、生成順序により後から代入される owner（`cueController` / `syncIntervalOrchestrator` / `panelUi`）を安全に解決する目的で維持した。
- `modules/panel-ui.js` を整理しても、既に固定した `panelUi.dispose()` の高レベル cleanup 契約は弱めていない。
- cleanup の統合では、OFF、restart、reinitialize、SPA 遷移の経路差を消しすぎず、共通化できる teardown 副作用だけを `runSessionTeardown()` へ集約した。
- ESLint エラーが出た場合は、削除対象の参照元を先に特定し、修正範囲を必要最小限にする方針で対応した。
- 各ファイルは「現状確認 → 置換前 / 置換後の提案 → 適用 → `git diff` 確認」の順で進めた。

***

## 次にやること

このシートで記録した Step 17-A-11 の完了を前提に、次の主作業は Step 17-B へ移る。

- `docs/Bugfix/Step17-B_visibility-lifecycle_方針整理メモ.md` を正本にして visibility / lifecycle owner を整理する。
- `panelOpen`、`panelDefaultOpen`、通常 open / close、reinitialize、SPA 遷移、拡張 ON/OFF の各経路を洗い出す。
- `content.js`、`modules/panel-ui.js`、`modules/panel-visibility-state.js`、cleanup / reinitialize 系 module の責務境界を確認する。
- Step 17-A-11 docs 更新として、マスタープラン・実装シート・Step17-A メモを同期する。

***

## 結果

Step 17-A-11 のコード実装は完了している。  
`extensionEnabled` は sync storage の schema、default、load、save、merge、normalize、popup / options の settings payload から除外され、`state.extensionEnabled` が current playback session の runtime ON/OFF 正本として一貫して機能する状態になった。

このシートは、その実装内容を file 単位・Step 単位・確認観点単位で残し、次フェーズの Step 17-B へ渡すための完了記録として扱う。
