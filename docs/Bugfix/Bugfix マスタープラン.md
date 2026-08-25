# Bugfix マスタープラン 2026-08-25（要約版）

**作成日:** 2026-08-13 ／ **最終更新:** 2026-08-25 ／ **ブランチ:** `issue-32-content-core-split`  
**入口資料：** 新しいスレッドでもこの資料 1 枚を読めば、プロジェクトの目標・現在地・優先順位・次に着手する作業が分かる状態を保つ。  
**Step 15 更新:** `secondary-track-recovery` 系を `lane-recovery-state` へ改名する命名整理コミット `967b326` を反映済みである。  
**Step 16 更新:** `cue-controller.js` と `modules/cue-sequence-builder.js` の責務境界整理コミット `3afcedc` を反映済みである。  
**Step 17-A 更新:** panel 系 / debug runtime / subtitle block state の責務整理コミット `5a06740` を反映済みである。Step 17 全体は継続中であり、panel owner 完全移管・root 直下 panel files の `modules/` 統合・`content.js` 薄化を後続作業として残す。

***

## 関連資料インデックス

| # | 資料名 | 役割 | 更新頻度 |
| :-- | :-- | :-- | :-- |
| 資料① | Bugfix マスタープラン | 全体俯瞰・目標・依存関係・優先順位・次スレッドの入口 | 節目ごとに更新 |
| 資料② | コードベース現状スナップショット | ファイル・関数・DOM ID の正本一覧 | 変更のたびに更新 |
| 資料③ | Bugfix 実装シート | 今の症状・今やる修正箇所・検証手順・実機ログ | 作業中は更新、完了で archive |
| 資料④ | Bugfix 将来作業計画 | 将来作業の計画 | 残っている計画だけにする |
| 資料⑤ | Bugfix-ABCD-plan | 辞書 | 参考資料 |
| 資料⑥ | Bugfix-仕様確定書 | 確定仕様の正本 | 仕様変更時のみ更新 |
| 資料⑦ | 字幕同期・切り替え条件統合と責務再設計メモ | primary / secondary を含む字幕同期・切り替え・monitor・recovery・native fallback の統合設計メモ | 設計変更時に更新 |
| 資料⑧ | `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md` | Step 17-A の panel owner / debug runtime / block state 整理方針と残課題 | Step 17-A 作業時に更新 |
| 資料⑨ | `docs/Bugfix/17-A-9.md` | Step 17-A-9 の `modules/` 統合・manifest 整合の作業メモ | Step 17-A-9 作業時に更新 |
| 資料⑩ | `docs/Bugfix/module-load-order.md` | content scripts の module 読み込み順と依存関係 | manifest / module 追加時に更新 |

***

## 最終目標

動画再生中に拡張機能をリアルタイムで ON/OFF できるようにする。

- **OFF 時：** 拡張 UI をすべて破棄し、Apple TV+ 本来の字幕機能が使える状態に戻す。
- **ON 時：** 字幕パネル＋オーバーレイで 2 言語字幕を表示する。
- **OFF 時に残すのは** 「ネイティブトグル・拡張ポップアップ・設定ページ・設定保存」のみである。

***

## 状態変数の正本定義（現行方針）

| 変数名 | 保存先 | 役割 | 備考 |
| :-- | :-- | :-- | :-- |
| `extensionEnabled` | `chrome.storage.sync` | 拡張全体の ON/OFF | ネイティブトグルが書き換える。 |
| `panelOpen` | ランタイムメモリ | 現在の字幕パネル開閉状態 | 現在状態として扱い、永続化しない方針へ寄せる。 |
| `panelDefaultOpen` | `chrome.storage.sync` | 通常起動時の `panelOpen` 初期値 | ランタイムの現在状態ではない。 |
| `subtitleBlockState.sequence` | ランタイムメモリ | sequence / blocks / currentIndex / meta の正本 | `modules/subtitle-block-state.js` が取得・current block 解決・panel open 時再同期を担当する。 |
| `state.currentSubtitleBlock` | ランタイムミラー | 現在字幕 block の互換参照 | Step 17-A 時点では既存 renderer / overlay との互換のため残す。正本化しない。 |
| `state.lastPanelRenderSnapshot` | 観測用ランタイム情報 | panel 最終描画 snapshot | debug / 観測用途。panel renderer から owner 側への移管を後続で検討する。 |

**補足**  
過去の資料では `panelOpen` を `chrome.storage.local` 前提で記述していたが、現在の設計方針ではランタイム UI 状態と永続設定を分離し、`panelOpen` は保存しない方向へ寄せている。  
関連する正本は `ATV bilingual subtitles 設計・修正方針.md` を優先する。

***

## DOM ID 正本（厳守）

| 正式名称 | DOM ID | 役割 |
| :-- | :-- | :-- |
| ネイティブトグル | `atvb-native-toggle` | 拡張全体の ON/OFF のみ。OFF 時も残す。 |
| 字幕パネル開閉ボタン | `atv-toggle-btn` | 右側字幕パネルの開閉のみ。設定保存に関与しない。 |
| 字幕パネル本体 host | `atv-panel-host` | 右側字幕パネル host。表示/非表示と矩形計測の正本。 |
| 字幕パネル本体 root | `atv-panel-root` | 右側字幕パネル本体。 |
| オーバーレイ host | `atv-overlay-host` | 学習補助オーバーレイ host。位置・幅・矩形計測の正本。 |
| オーバーレイ inner root | `data-atvb-overlay-root` | overlay 内部コンテナ。文字要素の親。 |
| 単語詳細 UI host | `atv-term-inspector-host` | 字幕パネル／オーバーレイ字幕の単語クリックで開く term inspector の host。 |

***

## 現在地の要約

### 主要な完了事項

- 字幕パネル表示、primary / secondary 同期表示、ON→OFF→ON の基本復帰経路は成立している。
- 二重表示・ちらつきは解消済みで、字幕パネル開閉時の overlay 位置追従、文字サイズ維持、70/30 レイアウト追従も完了済みである。
- primary / secondary の listener binding 共通化、secondary monitor の start / replace / stop、cleanup / mode restore の基盤は binder 側へ集約済みである。
- unreadable 即 rebind 抑制、recovery の継続失敗中心化、hard seek / SPA 遷移時の cleanup 多重実行防止までは完了済みである。
- Step 7 の中核実装として、secondary 字幕同期は `decision` ベースの action 判定へ統合済みであり、`buildSecondarySyncDecision()` と `resolveSecondaryWaitOutcome()` を導入したコミット `0c3f20d` が反映済みである。
- `cue-controller.js` 側の secondary sync は `clear` / `keep` / `wait-and-bind` / `bind` の action switch ベースへ移行済みであり、旧 `staleMonitor` / `shouldRebind` のローカル組み立ては整理済みである。
- さらに、selection 共通化、direct bind 経路共通化、native fallback の role 共通化、pending sync task cancel、中核 decision shape 整理、`content.js` の DI 寄せ、restart cleanup 一元化、listener cleanup の責務固定までは完了済みとして整理できる。
- Step 12〜14 の退行防止テスト追加は完了済みである。
- Step 15 として、`modules/secondary-track-recovery.js` は `modules/lane-recovery-state.js` へ改名済みであり、`createLaneRecoveryState`・`root.createLaneRecoveryState`・`laneRecoveryState` を基準に、`content.js`、`manifest.json`、`modules/subtitle-recovery-manager.js`、`tests/lane-recovery-state.test.js` まで追従更新済みである。
- Step 16 として、`modules/cue-sequence-builder.js` に sequence / scene / snapshot の導出を集約し、`cue-controller.js` から cue 配列抽出・previousBlocks 引き継ぎ・currentBlock 決定などの sequence build 詳細を外した。
- `cue-controller.js` は `rebuildCurrentSceneSubtitleBlocks()` から builder を呼び、scene 詳細を再計算せず orchestration と互換 shape の提供に留まる構成へ整理済みである。
- Step 17-A として、旧 root 直下の `debug-logger.js` と `debug-panel.js` を削除し、`modules/debug-logger.js`、`modules/debug-panel-runtime.js`、`modules/debug-panel-shell.js` へ責務を分割した。
- `content.js` から logger callback 経由の `updateLiveDebugPanel()` を削除し、`debugPanelRuntime.mount()` による debug panel runtime の mount 経路へ切り替えた。
- `modules/subtitle-block-state.js` を新設し、subtitle block sequence の取得、current block の解決、current block mirror の同期、panel open 時の再同期を state owner に集約した。
- `content.js` に残っていた `getSubtitleBlockSequence`、`getCurrentSubtitleBlockFromSequence`、`setCurrentSubtitleBlock`、`rebuildSubtitleBlocksForPanelOpen` の wrapper 関数は削除し、必要な DI API は `subtitleBlockState` への delegate に置換した。
- `manifest.json`、`background.js`、`options.html`、`options.js`、`settings-runtime.js`、`modules/playback-session-cleanup.js`、`modules/subtitle-state-reset.js` を新しい debug/runtime 構成に整合させた。
- Step 17-A の変更後に `npm run lint` を実行し、`eslint *.js modules/*.js` がエラーなしで完了している。
- Step 17-A 基盤整理はコミット `5a06740 refactor: panel系とdebug/runtime周辺の責務を整理する (Issue #32, Step 17-A)` としてリモートへ push 済みである。

### 継続課題

- `A listener indicated an asynchronous response...` は初回のみ残ることがあり、F-4 は持ち越しである。
- Chrome Renderer のメモリ使用量増大は継続観測中であり、listener / observer / timer 蓄積の有無を引き続き見たい。
- 拡張 ON/OFF トグル操作は、現状のログでは一意に追えない。OFF 側ログはあるが、ON 側は開始ログ中心で、トグル単独復帰の確認にはまだ弱い。
- 大きな seek 直後に `secondary-track-unbind-skipped` が出るケースがあり、unbind すべき track 参照自体が先に失われている可能性がある。
- `content.js` には term inspector（旧 subtitle popup）関連 state と UI shell が残っており、配線専用化は未完了である。
- Step 17-A 時点でも、`content.js` には `_ensurePanelSlotLayerStyle`、`renderSecondarySubtitle`、`logSubtitlePanelState`、`applyLayout`、`createDebugPanel`、`_refreshSettingsOnPanelOpen`、`renderCurrentSnapshot` など、panel 周辺の実装・中継責務が残っている。
- `setSubtitleBlocks()` とその block 数制限・ログ出力は `content.js` に残っている。`subtitleBlockState` を block sequence の更新正本まで拡張するか、入力整形と state 更新の境界を再定義する必要がある。
- `panel-renderer.js` は `state.panelShadowRoot`、`state.subtitleBlocks`、`state.currentSubtitleBlock`、`state.lastPanelRenderSnapshot` を直接参照している。renderer を描画専用に寄せ、panel owner が render input を組み立てる構成へ近づける必要がある。
- `panel-ui.js` には `dispose()` の土台があるが、debug panel runtime、host、shadow root、observer、listener、timer の cleanup を単一の owner 経路に完全統合する作業が残っている。
- `panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` は root 直下に残っている。`modules/` への物理移動と `manifest.json` のパス更新は Step 17-A-9 の残作業である。
- full test 実行では `cue-track-binder`、`playback-session-cleanup`、`playback-startup-coordinator`、`panel-ui-toggle` に別スコープの失敗があり、Step 16 / Step 17-A 完了とは切り分けて後続ワークストリームで扱う必要がある。

***

## 優先順位

### 最優先

**Step 17-A 継続: subtitle block state owner の完成**

- `content.js` の `setSubtitleBlocks()`、block 数制限、block 更新ログの責務を棚卸しする。
- `modules/subtitle-block-state.js` に `setSequence(...)` 相当を追加するか、sequence build 結果の正規化と state 保存の境界を決める。
- `content.js` から `state.subtitleBlocks` への直接代入を外す。
- `state.currentSubtitleBlock` は互換ミラーとして扱い、sequence/current block の正本を `subtitleBlockState` に重複させない。

### 次点

**Step 17-A 継続: `renderCurrentSnapshot()` と panel render input の薄化**

- `renderCurrentSnapshot()` を、sequence 取得、view 解決、overlay 更新、panel 描画、waiting 状態判定に分解して責務を明示する。
- panel renderer には描画に必要な DTO を渡し、renderer が `state` の正本や lifecycle 判断を直接持たない方向へ寄せる。
- `state.lastPanelRenderSnapshot` は観測情報として扱い、最終的な owner を panel 側に固定する。
- 起動直後の current block 未確定は failure ではなく waiting として扱う現行挙動を保持する。

**Step 17-A 継続: panel owner / dispose 経路の統合**

- `createDebugPanel()` を panel UI owner または debug panel owner に寄せ、`content.js` の `panelShadowRoot` / `debugPanelRoot` 直参照を削減する。
- `panelUi.dispose()` を cleanup の入口として、host detach、listener 解放、observer disconnect、debug runtime 停止、timer 停止、snapshot / block state の必要な初期化を集約する。
- panel open 時の `_refreshSettingsOnPanelOpen()`、layout 適用、secondary subtitle DOM の責務境界を整理する。
- `_ensurePanelSlotLayerStyle`、`renderSecondarySubtitle`、`logSubtitlePanelState`、`applyLayout` の移管先または削除可否を決める。

**Step 17-A-9: panel 関連ファイルの `modules/` 統合**

- `panel-ui.js` → `modules/panel-ui.js`
- `panel-renderer.js` → `modules/panel-renderer.js`
- `subtitle-blocks.js` → `modules/subtitle-blocks.js`
- `subtitle-block-resolver.js` → `modules/subtitle-block-resolver.js`
- `manifest.json` の content script 読み込み順・パスを更新する。
- 移動前後で global export 名、依存順、テスト fixture、lint を確認する。
- 単なるパス移動にせず、owner 境界と dispose 経路を固めてから実施する。

### 並行して扱う別スコープ課題

**7-17: トグル ON/OFF ログの相関強化**

- `settings-runtime.js` にトグル操作単位の相関 ID を入れる。
- OFF 側の `apply start / restore before / restore after / apply done` と、ON 側の `restart begin / restart done` を対で追えるようにする。
- 実機でトグル単独復帰を再確認できる観測基盤を先に整える。

**7-16: トグル時の完全リセット実装**

- `modules/cue-track-binder.js` / `modules/subtitle-state-reset.js` を中心に、listener・timer・Map参照・track binding を明示的に解放する。
- `window.gc()` のような強制 GC は使わず、参照断ち切りによって回収可能な状態を作る。

**7-19〜7-20: 大きな seek 後の track 参照消失調査**

- `cue-controller`、track binder、recovery manager の間で unbind 対象 track を失わないか確認する。
- `secondary-track-unbind-skipped` の発生条件をログと実機再現で切り分ける。
- 問題が listener leak なのか、track 置換順序なのか、state reset の順序なのかを分離する。

***

## Step 17-A の責務境界

### 現在の owner 方針

| 領域 | 主な owner | `content.js` に残すもの | Step 17-A 時点 |
| :-- | :-- | :-- | :-- |
| Debug log 保存・フィルタ | `modules/debug-logger.js` | logger 呼び出し、必要最小限の adapter | 基盤整理完了 |
| Debug panel shell | `modules/debug-panel-shell.js` | なし | 基盤整理完了 |
| Debug panel runtime | `modules/debug-panel-runtime.js` | mount に渡す DI、暫定 `createDebugPanel()` | runtime 分離完了、mount owner 移管は継続 |
| Subtitle block sequence 読み取り・current block 解決 | `modules/subtitle-block-state.js` | DI / sequence build 結果の受け渡し | 基盤整理完了 |
| Subtitle block sequence 更新 | `content.js` と `subtitleBlockState` の境界 | `setSubtitleBlocks()` | owner 完成は継続 |
| Panel host / shadow root / visibility | `panel-ui.js` | DI、必要最小限の起動配線 | owner 完全移管は継続 |
| Panel 描画 | `panel-renderer.js` | render 呼び出し・入力中継 | renderer の state 直参照削減は継続 |
| Block 表示用変換 | `subtitle-blocks.js` / `subtitle-block-resolver.js` | raw input / DI | `modules/` 移動は継続 |
| Overlay 描画 | overlay controller | content key 等の最小 DI | 現行構造を維持 |
| Term inspector | 将来の term inspector owner | 生成・破棄・DI のみを残す | Step 18 未着手 |

### Step 17-A で完了したこと

1. debug logger / debug panel の root 直下実装を廃止し、logger・shell・runtime へ分割した。
2. `content.js` の debug panel 更新 callback と `updateLiveDebugPanel()` を削除した。
3. `debugPanelRuntime.mount()` を使う runtime API へ切り替えた。
4. subtitle block state の read / resolve / sync / panel open rebuild を `modules/subtitle-block-state.js` に切り出した。
5. `content.js` の subtitle block wrapper 関数を削除し、DI 経由の delegate に置き換えた。
6. 新しい module 読み込み構成に合わせて manifest、options、settings、cleanup、state reset を整合させた。
7. `npm run lint` が成功することを確認した。
8. 変更をコミット `5a06740` として remote branch へ push した。

### Step 17-A の残作業

1. `setSubtitleBlocks()` を中心に、subtitle block state の更新責務を `subtitleBlockState` 側へ寄せる。
2. `renderCurrentSnapshot()` を薄くし、view 解決・waiting 判定・panel render・overlay render の責務を分離する。
3. panel renderer の state 直参照を減らし、panel owner から描画 DTO を渡す構造へ移す。
4. `createDebugPanel()` と debug runtime の lifecycle を panel owner / dispose 経路へ統合する。
5. panel open、layout、secondary subtitle DOM、debug observation の残存関数を移管または削除する。
6. root 直下の panel 関連4ファイルを `modules/` へ移し、manifest / テスト / 読み込み順を整合させる。
7. dispose 時の host、listener、observer、timer、runtime、snapshot、block state の解放・初期化を確認する。
8. 実機で panel 開閉、再生開始、seek、SPA 遷移、ON→OFF→ON、debug panel 操作を確認する。

***

## 実装ステップの進捗

| Step | 状態 | 内容 |
| :-- | :-- | :-- |
| 1 | ✅ 完了 | `modules/subtitle-sync-controller.js` に `getTrackIdentity()` と `trackMatchesRequestedLanguage()` を追加し、track identity・言語一致判定の土台を共通化した。 |
| 2 | ✅ 完了 | secondary sync の decision/action 形を導入し、`clear` / `keep` / `wait-and-bind` / `bind` の分岐へ統合した。 |
| 3 | ✅ 完了 | direct bind と native fallback の role 共通化を進めた。 |
| 4 | ✅ 完了 | pending sync task cancel と recovery 経路の責務整理を進めた。 |
| 5 | ✅ 完了 | decision shape と selection 周辺を整理した。 |
| 6 | ✅ 完了 | `content.js` の DI 寄せと restart cleanup 一元化、listener cleanup 責務固定を進めた。 |
| 7 | ✅ 完了 | secondary 字幕同期 decision ベース統合の中核を完了した。 |
| 8 | ✅ 完了 | cue binder / monitor / recovery の分離と整理を進めた。 |
| 9 | ✅ 完了 | seek / SPA 遷移時の cleanup 多重実行防止を進めた。 |
| 10 | ✅ 完了 | listener / mode restore 基盤を整理した。 |
| 11 | ✅ 完了 | secondary recovery の継続失敗中心化と unreadable 即 rebind 抑制を実装した。 |
| 12 | ✅ 完了 | 退行防止テストを追加した。 |
| 13 | ✅ 完了 | 退行防止テストを追加した。 |
| 14 | ✅ 完了 | 退行防止テストを追加した。 |
| 15 | ✅ 完了 | `modules/lane-recovery-state.js` への改名、`createLaneRecoveryState` への factory 名統一、`root.createLaneRecoveryState` 参照への整理、`manifest.json`・`content.js`・`modules/subtitle-recovery-manager.js`・`tests/lane-recovery-state.test.js` の追従更新を実施した。 |
| 16 | ✅ 完了 | `modules/cue-sequence-builder.js` を sequence / scene / snapshot の正本に固定した。`cue-controller.js` は `rebuildCurrentSceneSubtitleBlocks()` から builder を呼び、scene 詳細を再計算せず orchestration と互換 shape の提供に留める。 |
| 17-A | ✅ 基盤整理完了 | debug logger / debug panel runtime / shell を `modules/` へ分割し、旧 root debug files を削除した。`modules/subtitle-block-state.js` を追加し、sequence/current block の読み取り・解決・同期・panel open rebuild を移管した。`npm run lint` 成功確認済み。 |
| 17 | 🔄 進行中 | panel owner 完全移管、`content.js` の panel / blocks 薄化、renderer の state 直参照削減、panel 関連4ファイルの `modules/` 統合、dispose 経路統合を行う。 |
| 18 | ⬜ 未着手 | `content.js` に残る in-player 単語詳細 UI を term inspector として別モジュール化し、state / shell / event / render を切り出す。 |

***

## 次スレッド開始時の手順

1. このマスタープランを読む。
2. `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md`、`docs/Bugfix/17-A-9.md`、`docs/Bugfix/module-load-order.md` を読む。
3. `git status --short`、`git log -1 --oneline`、`git status -sb` を実行し、作業ツリー・最新コミット・追跡ブランチを確認する。
4. `npm run lint` を実行し、作業開始地点の静的検証を確定する。
5. `modules/subtitle-block-state.js`、`content.js` の `setSubtitleBlocks()`、`renderCurrentSnapshot()`、`panel-ui.js`、`panel-renderer.js` を先に読む。
6. Step 17-A の残作業を一度に広げず、次のいずれか1つだけを選ぶ。
   - subtitle block state update owner の移管
   - `renderCurrentSnapshot()` の薄化
   - debug runtime / panel dispose の統合
   - panel 関連ファイルの `modules/` 移動準備
7. 変更後は `npm run lint` を実行し、必要なら対象テストと実機の panel 開閉・seek・ON/OFF 復帰を確認する。
8. コミット前に `git diff --stat` と `git diff` を読み、変更単位に合う `refactor:` / `fix:` / `docs:` / `chore:` メッセージを付ける。

***

## 次の最小ワークストリーム

### WS-17A-1: subtitle block state update owner の移管

**目的：** `content.js` から `state.subtitleBlocks` の直接更新を外し、subtitle block state の正本を完成させる。

**対象ファイル：**

- `content.js`
- `modules/subtitle-block-state.js`
- 必要に応じて `subtitle-blocks.js`
- 必要に応じて対象テスト

**小さな手順：**

1. `content.js` の `setSubtitleBlocks()` が行う処理を、入力正規化、block 数制限、state 保存、current block mirror 同期、ログに分ける。
2. `modules/subtitle-block-state.js` に state 保存 API を追加する。
3. `content.js` は sequence build 結果を API へ渡すだけにする。
4. `state.subtitleBlocks` の更新箇所が owner API 以外に残っていないか検索する。
5. `npm run lint` を実行する。
6. panel 表示、current block 強調、panel open 時の rebuild、overlay 更新を実機確認する。

**完了条件：**

- `content.js` が `state.subtitleBlocks = ...` を直接実行しない。
- block state の読み取りと更新が `subtitleBlockState` API に集約される。
- `renderCurrentSnapshot()` と panel renderer の現在 block 解決が退行しない。
- lint が成功する。

***

## メンテナンス原則

- `content.js` は起動配線、依存注入、状態遷移の orchestration に寄せる。UI shell、DOM 詳細、block 派生、長期 snapshot 保持を戻さない。
- state の正本を重複させない。互換ミラーを残す場合は、正本・更新方向・削除予定をコメントと資料で明示する。
- panel、overlay、term inspector、debug UI の DOM owner と dispose 経路を混ぜない。
- renderer は描画専用に寄せ、state 正本・listener lifecycle・recovery 判断を持たせない。
- `modules/` への移動は path 変更だけで終わらせず、global export、manifest 読み込み順、テスト fixture、dispose、実機導線まで確認する。
- 新規 module は既存 owner に収まらない責務だけに限定し、似た state / helper の重複を避ける。
- dead code や恒久的に `if (false)` で無効化された debug code は、再利用計画がなければ削除する。残す場合は名前付き debug flag または観測機構として意図を明示する。
- ドキュメントには「完了した実装」「残っている実装」「検証済み範囲」を分けて記録し、Step の完了を早まって宣言しない。
