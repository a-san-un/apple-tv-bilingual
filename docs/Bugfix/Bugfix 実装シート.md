# Bugfix 実装シート 2026-08-25（作業台版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-25（要約版）  
**最新反映コミット:** `5a06740 refactor: panel系とdebug/runtime周辺の責務を整理する (Issue #32, Step 17-A)`  
**このシートの役割:** 今まさに着手している修正の対象・変更方針・実装順・検証観点・実機ログ観点を 1 枚に集約する。Step 7 中核、Step 12〜16 は完了済みであり、このシートは **Step 17-A の継続作業、Step 17 の panel 統合、Step 18 の term inspector 分離、および後続ワークストリーム** を管理する作業台として使う。

***

## 今回の作業テーマ

### 主テーマ

**M-3: 字幕同期 decision 統合後の薄化フェーズ**

`subtitle-sync-controller.js` を正本とした decision ベース統合の中核実装、退行防止テスト追加、recovery state 命名整理、cue sequence builder への導出集約までは完了した。

現在はその次段階として、Step 17-A で以下を実施済みである。

- 旧 root 直下の `debug-logger.js` と `debug-panel.js` を削除した。
- `modules/debug-logger.js`、`modules/debug-panel-runtime.js`、`modules/debug-panel-shell.js` を追加した。
- `content.js` から `updateLiveDebugPanel()` と logger callback 経由の debug panel 更新を削除した。
- `debugPanelRuntime.mount()` を使う debug panel runtime 経路へ切り替えた。
- `modules/subtitle-block-state.js` を追加し、subtitle block sequence の取得、current block の解決、current block mirror 同期、panel open 時の再同期を state owner に集約した。
- `content.js` にあった `getSubtitleBlockSequence`、`getCurrentSubtitleBlockFromSequence`、`setCurrentSubtitleBlock`、`rebuildSubtitleBlocksForPanelOpen` の wrapper 関数を削除した。
- `manifest.json`、options、settings、cleanup、state reset 周辺を新しい runtime 構成へ整合させた。
- `npm run lint` を実行し、`eslint *.js modules/*.js` がエラーなしで完了した。
- 変更は `5a06740` として commit / push 済みである。

Step 17 全体としては未完了である。`content.js` に残る panel 実装の薄化、panel owner / dispose 経路の統合、root 直下にある panel 系4ファイルの `modules/` 移動を継続する。

### 副テーマ

- F-5: lifecycle ごとの secondary cleanup / mode restore の確認。
- F-8: decision 単位のログ整理と、トグル ON/OFF 相関ログの追加。
- M-1: 長時間再生時メモリ増加の継続観測。
- F-4: 初回 async response エラーの持ち越し調査。
- F-9: 拡張トグル時の完全リセット実装。
- F-10: 大きな seek 後の track 参照消失と `secondary-track-unbind-skipped` の調査。
- S-2: panel 系既存ファイルの `modules/` 統合と `content.js` の panel / blocks 薄化。
- S-3: `content.js` の term inspector 薄化。

***

## 現在の症状

| # | 症状 | 観察事実 | 関連 ID | 状態 |
|---|---|---|---|---|
| 1 | メッセージチャネルクローズエラー（初回のみ） | `A listener indicated an asynchronous response...` はまだ残るが、UI 復旧自体は達成済み。 | F-4 | 🟠 持ち越し |
| 2 | ネイティブ字幕メニューに干渉せず OFF 後復元を成立させたい | secondary cleanup / mode restore は binder 側へ集約済み。ネイティブ UI を一度触るとトグル復帰率が上がる観察があり、トグル単独復帰はまだ未確認。 | F-5 | 🟠 検証継続 |
| 3 | DevConsole にログが残りやすい | noisy ログは一部 suppress 済み。debug logger / runtime は module 化済みだが、トグル ON/OFF を一意に追える相関ログは未整備。 | F-8 | 🟠 継続整理中 |
| 4 | 長時間再生で Renderer メモリ使用量が大きく増える | cleanup 多重実行対策は入ったが、listener / observer / timer / debug runtime の残留は継続観測が必要。完全リセットは未実装。 | M-1 | 🟠 調査継続 |
| 5 | 大きな seek 後に一時的に字幕情報が失われる | `secondary-track-unbind-skipped` は monitorState にも boundTrack にも track 参照が無いときに出る。大きな seek 直後に `hadCleanup:false`, `hadTrack:false` が連続し、unbind 対象自体が失われている可能性がある。 | F-10 | 🟠 新規調査 |
| 6 | トグル ON/OFF 操作がログに残り切らない | 実ログでは `extensionEnabled:false` やトグル単独操作の痕跡が不足し、観測基盤が弱い。 | F-9 | 🟠 観測基盤不足 |
| 7 | `content.js` がまだ大きい | debug update callback と subtitle block wrapper は削除済みだが、term inspector 関連 state / shell と panel 周辺の実装・中継責務が残る。 | S-2 / S-3 | 🟠 継続作業 |
| 8 | panel 系の owner 境界がまだ完全ではない | debug runtime と block state は分離済み。一方で panel UI / renderer / blocks / resolver は root 直下に残り、`content.js` からの state・DOM・render 直参照も残る。 | S-2 | 🟠 進行中 |
| 9 | subtitle block state の更新責務が `content.js` に残る | `modules/subtitle-block-state.js` は sequence/current block の読み取り・解決・同期を担当するが、`setSubtitleBlocks()` と `state.subtitleBlocks` への直接代入は `content.js` に残る。 | S-2 | 🟠 次作業 |
| 10 | panel renderer が state を直接読む | `panel-renderer.js` は `state.panelShadowRoot`、`state.subtitleBlocks`、`state.currentSubtitleBlock`、`state.lastPanelRenderSnapshot` を直接参照している。 | S-2 | 🟠 次作業 |
| 11 | panel dispose の owner 集約が未完了 | `panel-ui.js` には `dispose()` があるが、debug runtime、host、shadow root、observer、listener、timer、snapshot の cleanup が単一経路に統合され切っていない。 | S-2 | 🟠 次作業 |
| 12 | recovery state モジュール名は整理済み | 旧 `secondary-track-recovery.js` は Step 15 で `lane-recovery-state` 系へ整理済みで、残るのは説明・参照の追従確認である。 | R-1 | ✅ 完了 |
| 13 | decision 統合、cue sequence builder、退行防止は整った | Step 12〜16 の実装・退行防止テスト追加まで完了しており、現在は panel / term inspector の責務整理フェーズである。 | M-3 | ✅ 完了済み土台 |
| 14 | debug runtime と subtitle block state の基盤整理 | debug logger / panel runtime / shell の module 化、旧 root debug files 削除、subtitle block state owner 導入、lint 成功、commit / push を完了した。 | Step 17-A | ✅ 基盤整理完了 |

***

## 今回の到達目標

### 完了済み項目

- `subtitle-sync-controller.js` に secondary decision の正本がある。
- `cue-controller.js` が `staleMonitor` / `shouldRebind` を自前で組み立てない構成へ寄った。
- action が `clear` / `keep` / `wait-and-bind` / `bind` の 4 種に整理された。
- 同一 track の一時 unreadable で即 rebind しない方針を維持している。
- bind / cleanup / mode restore は binder 側に留める方針を維持している。
- selection 共通化、direct bind 共通化、native fallback role 共通化、pending sync task cancel、restart cleanup 一元化、listener cleanup の責務固定までは完了済みである。
- Step 12〜14 の退行防止テスト追加は完了済みである。
- Step 15 の recovery state 命名整理は完了済みである。
- Step 16 の cue sequence / scene / snapshot 導出の builder 集約は完了済みである。
- `modules/debug-logger.js`、`modules/debug-panel-runtime.js`、`modules/debug-panel-shell.js` への debug runtime 分離は完了済みである。
- `modules/subtitle-block-state.js` への subtitle block read / resolve / sync / panel open rebuild の集約は完了済みである。
- debug callback と dead wrapper の削除、関連 manifest / settings / options / cleanup 整合は完了済みである。
- `npm run lint` はエラーなしで成功している。
- Step 17-A 基盤整理は commit / push 済みである。

### Step 17-A 継続の完了条件

- `content.js` から `state.subtitleBlocks = ...` の直接更新を外し、subtitle block sequence 更新の正本を `subtitleBlockState` API に集約する。
- `renderCurrentSnapshot()` を、sequence 取得、view 解決、waiting 判定、overlay 更新、panel 描画の責務に分け、content 側を orchestration に留める。
- `panel-renderer.js` が state 正本・lifecycle 判断を直接持たず、panel owner から render input を受け取る方向へ整理する。
- `createDebugPanel()` と debug runtime の lifecycle を panel owner / dispose 経路に統合する。
- `_ensurePanelSlotLayerStyle`、`renderSecondarySubtitle`、`logSubtitlePanelState`、`applyLayout`、`_refreshSettingsOnPanelOpen` の owner を確定し、移管または削除する。
- `panel-ui.js`、`panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js` を `modules/` 配下へ統合する。
- `manifest.json` の読み込みパス・順序、global export、テスト fixture を移動後の構成へ整合させる。
- `panelUi.dispose()` を入口として、host、shadow root、listener、observer、timer、debug runtime、snapshot、block state の cleanup を追跡できる。
- `npm run lint` が成功し、panel 開閉、再生開始、seek、SPA 遷移、ON→OFF→ON、debug panel 操作で退行がない。

### Step 18 の完了条件

- `content.js` に残っている term inspector（旧 dictionary popup / subtitle popup）の state / style / shell / event / render を owner ごとに切り出す。
- `content.js` には term inspector の生成・破棄・DI だけを残す。
- panel / overlay / term inspector の host、style、event、dispose が混ざらない。
- 新規ファイルは既存 owner に収まらない責務に限定する。

***

## 今回やらないこと

- 多重 session-start のデバウンス・直列化の恒久対応。
- トグル完全リセットのまとめ実装。
- large seek 問題のまとめ実装。
- panel UI / overlay UI の見た目やレイアウト調整。
- Step 8（`content.js` 配線専用化の総点検）を今回まとめて完了させること。
- Step 9（dead code / debug 整理）を今回まとめて完了させること。
- Step 10（lifecycle 網羅確認）を今回まとめて完了させること。
- 長時間再生時のメモリ増加観測を今回まとめて結論づけること。
- Step 18 の term inspector モジュール化を Step 17-A と同じ変更単位に混ぜること。

***

## 触るファイル

### Step 17-A 継続の主対象

- `content.js`
- `modules/subtitle-block-state.js`
- `panel-ui.js`
- `panel-renderer.js`
- `subtitle-blocks.js`
- `subtitle-block-resolver.js`
- `manifest.json`
- 必要に応じて対象テスト

### Step 17-A で追加・更新済み

- `modules/debug-logger.js`
- `modules/debug-panel-runtime.js`
- `modules/debug-panel-shell.js`
- `modules/subtitle-block-state.js`
- `background.js`
- `manifest.json`
- `modules/playback-session-cleanup.js`
- `modules/subtitle-state-reset.js`
- `options.html`
- `options.js`
- `settings-runtime.js`
- `panel-renderer.js`
- `panel-ui.js`
- `subtitle-block-resolver.js`
- `subtitle-blocks.js`
- `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md`
- `docs/Bugfix/17-A-9.md`
- `docs/Bugfix/module-load-order.md`

### Step 17-A で削除済み

- `debug-logger.js`
- `debug-panel.js`

### Step 18 の新規追加候補

- `modules/term-inspector.js`

### 整合確認対象

- `modules/subtitle-sync-controller.js`
- `modules/lane-recovery-state.js`
- `modules/subtitle-recovery-manager.js`
- `modules/cue-track-binder.js`
- `modules/playback-session-cleanup.js`
- `modules/subtitle-state-reset.js`
- `modules/debug-panel-runtime.js`
- `modules/debug-panel-shell.js`

### 後続ワークストリームで触る対象

- `settings-runtime.js` — トグル ON/OFF の相関ログ追加、ON 側完了ログ追加。
- `modules/playback-session-cleanup.js` — 完全リセット実行前後の cleanup 範囲確認、ログ補強。
- `modules/subtitle-state-reset.js` — runtime subtitle state の完全クリア API 強化。
- `modules/cue-track-binder.js` — listener / binding / originalMode 参照の完全解放確認・補強。

***

## 現在の構成と責務境界

### debug runtime

| 領域 | 現在の owner | `content.js` に残るもの | 状態 |
| :-- | :-- | :-- | :-- |
| Debug log 保存・フィルタ | `modules/debug-logger.js` | logger 利用、必要最小限の adapter | ✅ 分離済み |
| Debug panel shell | `modules/debug-panel-shell.js` | なし | ✅ 分離済み |
| Debug panel runtime | `modules/debug-panel-runtime.js` | mount に渡す DI、暫定 `createDebugPanel()` | 🟠 lifecycle owner 移管待ち |

### subtitle block state

| 領域 | 現在の owner | `content.js` に残るもの | 状態 |
| :-- | :-- | :-- | :-- |
| sequence 取得 | `modules/subtitle-block-state.js` | DI / raw input の受け渡し | ✅ 分離済み |
| current block 解決 | `modules/subtitle-block-state.js` | renderer / overlay 互換の mirror 利用 | ✅ 分離済み |
| current block mirror 同期 | `modules/subtitle-block-state.js` | `state.currentSubtitleBlock` 互換参照 | ✅ 分離済み |
| panel open 時再同期 | `modules/subtitle-block-state.js` | panel UI への delegate | ✅ 分離済み |
| sequence 更新・block 数制限 | `content.js` | `setSubtitleBlocks()` と `state.subtitleBlocks` 直接更新 | 🟠 移管待ち |

### panel runtime

| 領域 | 現在の owner | `content.js` に残るもの | 状態 |
| :-- | :-- | :-- | :-- |
| Panel host / shadow root / visibility | `panel-ui.js` | DI、暫定 root 参照 | 🟠 owner 完全移管待ち |
| Panel 描画 | `panel-renderer.js` | render 呼び出し・入力中継 | 🟠 state 直参照削減待ち |
| Block 表示用変換 | `subtitle-blocks.js` / `subtitle-block-resolver.js` | raw input / DI | 🟠 `modules/` 移動待ち |
| Panel dispose | `panel-ui.js` の `dispose()` | runtime / observer / timer の一部管理 | 🟠 cleanup 一元化待ち |
| Layout / secondary subtitle DOM | `content.js` に残存 | `_ensurePanelSlotLayerStyle`、`renderSecondarySubtitle`、`applyLayout` | 🟠 owner 決定待ち |

### term inspector

| 領域 | 現在の owner | `content.js` に残るもの | 状態 |
| :-- | :-- | :-- | :-- |
| term inspector state / shell / event / render | `content.js` | ほぼ全体 | ⬜ Step 18 未着手 |
| term inspector 生成・破棄・DI | 将来の owner | 最小配線のみを残す予定 | ⬜ 設計待ち |

***

## 実装順

### WS-17A-1: subtitle block state update owner の移管

**目的：** `content.js` から `state.subtitleBlocks` の直接更新を外し、subtitle block state の更新正本を完成させる。

**対象ファイル：**

- `content.js`
- `modules/subtitle-block-state.js`
- 必要に応じて `subtitle-blocks.js`
- 必要に応じて対象テスト

**作業手順：**

1. `content.js` の `setSubtitleBlocks()` が行う処理を確認する。
2. 処理を、入力正規化、block 数制限、sequence 保存、current block mirror 同期、ログ出力へ分解する。
3. `modules/subtitle-block-state.js` に `setSequence(...)` 相当の API を追加するか、更新責務を移す最小 API を設計する。
4. `content.js` を、cue sequence builder の結果を state owner へ渡すだけの役割に縮小する。
5. `state.subtitleBlocks = ...` の直接代入が owner API 以外に残っていないか検索する。
6. `npm run lint` を実行する。
7. 実機で panel 表示、current block 強調、panel open 時の rebuild、overlay 更新を確認する。

**完了条件：**

- `content.js` が `state.subtitleBlocks = ...` を直接実行しない。
- block state の読み取りと更新が `subtitleBlockState` API に集約される。
- current block 解決、panel 表示、overlay 更新が退行しない。
- lint が成功する。

### WS-17A-2: `renderCurrentSnapshot()` の薄化

**目的：** `renderCurrentSnapshot()` を描画・状態更新・待機判定の巨大な合流点にしない。

**対象ファイル：**

- `content.js`
- `panel-renderer.js`
- `modules/subtitle-block-state.js`
- 必要に応じて subtitle view resolver / overlay controller 周辺

**作業手順：**

1. `renderCurrentSnapshot()` の処理を、sequence 取得、current block 決定、subtitle view 解決、waiting 判定、overlay 更新、panel render に分類する。
2. current block の正本は `subtitleBlockState` から取得する。
3. subtitle view resolver が返す view と panel renderer が必要とする表示入力を明確にする。
4. 起動直後に current block が未確定な場合は failure ではなく waiting とする現行挙動を維持する。
5. panel renderer が必要とする値を DTO 化できるか検討する。
6. `npm run lint` を実行する。
7. 起動直後、字幕 cue 到着直後、seek 後、panel open / close で確認する。

**完了条件：**

- `renderCurrentSnapshot()` が state 正本の更新や panel DOM 詳細を持たない。
- waiting / ready の表示・観測が維持される。
- panel と overlay の current block 表示が一致する。
- lint が成功する。

### WS-17A-3: panel owner / debug runtime / dispose 経路の統合

**目的：** panel host、shadow root、debug runtime、observer、listener、timer の cleanup を追跡可能な owner 経路へ寄せる。

**対象ファイル：**

- `content.js`
- `panel-ui.js`
- `modules/debug-panel-runtime.js`
- `modules/playback-session-cleanup.js`
- 必要に応じて `modules/subtitle-state-reset.js`

**作業手順：**

1. `createDebugPanel()` が参照する `state.panelShadowRoot` と `state.debugPanelRoot` の owner を確認する。
2. debug runtime の mount / unmount API の有無を確認する。
3. `panelUi.dispose()` を起点に、host detach、listener 解放、observer disconnect、timer 停止、debug runtime 停止、snapshot 初期化を列挙する。
4. `content.js` の direct root 参照を削減する。
5. `_refreshSettingsOnPanelOpen()` と panel open lifecycle の所属を決める。
6. `npm run lint` を実行する。
7. panel の連続 open / close、extension ON / OFF、SPA 遷移、再生ページ離脱で残留がないか確認する。

**完了条件：**

- panel dispose 時の cleanup owner が追える。
- debug runtime が detach 後に更新・timer・listener を残さない。
- `content.js` の panel root 直参照が減る。
- lint が成功する。

### WS-17A-4: panel 周辺の残存関数の owner 確定

**目的：** `content.js` に残る panel 周辺 helper を無目的に残さない。

**対象候補：**

- `_ensurePanelSlotLayerStyle`
- `renderSecondarySubtitle`
- `logSubtitlePanelState`
- `applyLayout`
- `createDebugPanel`
- `_refreshSettingsOnPanelOpen`
- `renderCurrentSnapshot`

**作業手順：**

1. 各関数について、呼び出し元、読んでいる state、書き換える DOM / state、cleanup 必要性を一覧化する。
2. panel UI、overlay controller、debug runtime、subtitle view resolver、専用 debug helper のいずれに寄せるか決める。
3. 使用予定のない `if (false)` debug code は削除する。残す場合は名前付き debug flag にする。
4. 移管後に `content.js` から不要な helper / state / comment を削除する。
5. `npm run lint` を実行する。

**完了条件：**

- 各残存関数に owner または削除理由がある。
- 到達不能な dead debug code を恒久的に残さない。
- `content.js` の panel 実装詳細が減る。
- lint が成功する。

### WS-17A-9: panel 関連ファイルの `modules/` 統合

**目的：** root 直下に残る panel 関連ファイルを、owner 境界を維持したまま `modules/` 配下へ統合する。

**対象ファイル：**

- `panel-ui.js` → `modules/panel-ui.js`
- `panel-renderer.js` → `modules/panel-renderer.js`
- `subtitle-blocks.js` → `modules/subtitle-blocks.js`
- `subtitle-block-resolver.js` → `modules/subtitle-block-resolver.js`
- `manifest.json`
- 必要に応じてテスト / docs

**作業手順：**

1. 各ファイルの global export 名と manifest 読み込み順を確認する。
2. owner / dispose / DI 境界を先に固定する。
3. 1ファイルずつ移動し、manifest パスを更新する。
4. 依存する script 順序を確認する。
5. tests / fixture が root パスを前提にしていないか確認する。
6. `npm run lint` を実行する。
7. extension 再読み込み後に panel、overlay、debug panel、字幕 block 表示を実機確認する。

**完了条件：**

- 4ファイルが `modules/` 配下へ移動している。
- manifest の読み込み順・パスが正しい。
- global export・DI・panel open / render / dispose が退行しない。
- lint が成功する。

### WS-18-1: term inspector owner の設計

**目的：** Step 18 に向け、term inspector の state / shell / event / render / dispose 境界を決める。

**対象候補：**

- `content.js`
- `modules/term-inspector.js`（必要な場合のみ）
- popup host / overlay click handling 周辺

**作業手順：**

1. `content.js` の term inspector 関連 state、style、shell、event、render、document listener を列挙する。
2. panel / overlay と共有する値、term inspector 固有の値を分ける。
3. host、shadow root、document click handler、selection、position 計算の owner を定める。
4. `dispose()` で解放すべき listener / DOM / state を定義する。
5. 新規 module が必要か、既存 popup owner で吸収できるかを判断する。

**完了条件：**

- Step 18 の移管単位と API が決まる。
- panel / overlay / term inspector の DOM owner が混ざらない。
- `content.js` に残す DI と起動配線が明確になる。

***

## 検証手順

### 静的検証

```bash
npm run lint
```

期待結果:

```text
> lint
> eslint *.js modules/*.js
```

エラー出力なしで終了すること。

### Step 17-A 基盤整理の確認済み結果

- `npm run lint` 実行済み。
- `eslint *.js modules/*.js` はエラーなしで終了した。
- `content.js` 内の以下の wrapper 関数定義は削除済み。
  - `getSubtitleBlockSequence`
  - `getCurrentSubtitleBlockFromSequence`
  - `setCurrentSubtitleBlock`
  - `rebuildSubtitleBlocksForPanelOpen`
- `content.js` 側では必要な API を `subtitleBlockState` への delegate として DI に渡している。
- `renderCurrentSnapshot()` は `subtitleBlockState.getSequence()` と `subtitleBlockState.getCurrentBlock()` を利用する。
- `modules/subtitle-block-state.js` は `getSequence`、`getCurrentBlock`、`syncCurrentBlock`、`rebuildForPanelOpen` を提供する。
- 最新の Step 17-A 変更は commit / push 済み。

### 実機確認チェックリスト

#### panel / subtitle block

- [ ] 再生開始直後に panel が正しく mount される。
- [ ] primary / secondary 字幕が panel に表示される。
- [ ] current block の強調表示が current playback time と一致する。
- [ ] panel open 時に subtitle block が正しく再同期される。
- [ ] 起動直後に current block が未確定でも failure ではなく waiting として扱われる。
- [ ] panel open / close を連続しても block 表示が壊れない。

#### overlay / subtitle view

- [ ] panel 表示中に overlay の字幕が更新される。
- [ ] panel の current block と overlay の字幕が矛盾しない。
- [ ] seek 後に字幕 view が回復する。
- [ ] 大きな seek 後に secondary track が失われないか観測する。

#### debug runtime

- [ ] debug panel が panel 内へ mount される。
- [ ] ログフィルタ、ログ表示、ログクリア、ログダウンロードが動作する。
- [ ] panel close / dispose 後に debug runtime の更新が残らない。
- [ ] extension ON / OFF 後に debug runtime が二重 mount されない。

#### lifecycle / cleanup

- [ ] ON→OFF→ON 後に panel、overlay、subtitle binding が復帰する。
- [ ] SPA 遷移後に古い host、shadow root、listener、observer、timer が残らない。
- [ ] 再生ページ離脱後に panel UI が残らない。
- [ ] cleanup 後に old track の listener が残らない。

***

## 観測ログ

### 継続して見るログ

- `A listener indicated an asynchronous response...`
- `secondary-track-unbind-skipped`
- `hadCleanup`
- `hadTrack`
- `restart begin`
- `restart done`
- `apply start`
- `restore before`
- `restore after`
- `apply done`
- panel open / close
- panel dispose
- debug runtime mount / unmount
- subtitle block state sequence update
- current block waiting / ready transition

### Step 17-A で削除・変更した観測経路

- logger の更新通知から `updateLiveDebugPanel()` を呼ぶ callback 経路は削除した。
- debug panel は `debugPanelRuntime.mount()` の mount API を利用する。
- 以前の `if (false)` による snapshot debug code は到達不能であり、今後残す場合は名前付き debug flag に置換する。再利用予定がなければ削除する。
- debug panel / subtitle block state の確認では、常時ログを増やすより、必要な観測点を module owner 側へ寄せる。

***

## コミット運用

### 直近コミット

```text
5a06740 refactor: panel系とdebug/runtime周辺の責務を整理する (Issue #32, Step 17-A)
```

### Step 17-A のコミット内容

```text
refactor: panel系とdebug/runtime周辺の責務を整理する (Issue #32, Step 17-A)

- content.js からsubtitle block stateとdebug panel更新責務を切り出した
- debug logger / debug panel runtime / shell を modules 配下へ分離
- panel UI / renderer / resolver / cleanup / settings / options の整合を取った
- Step 17-A 関連ドキュメントを追加した
```

### コミットメッセージ規約

- 形式は **プレフィックス（英語）+ 本文（日本語）** とする。
- `feat:` 新機能・UI 追加。
- `fix:` バグ修正・挙動修正。
- `refactor:` 構造整理・責務分割。
- `docs:` docs 更新のみ。
- `chore:` 雑多な変更・観測用追加。
- 1行目は「このコミットで何をしたか」が概ね分かる内容にする。
- 詳細が必要な場合だけ、変更した責務や対象ファイルが分かる短い箇条書きを追加する。
- commit 前に `git diff --stat` と `git diff` を読む。
- commit 後に `git status --short`、`git log -1 --oneline`、`git status -sb` を確認する。

***

## 次スレッド開始時の手順

1. `docs/Bugfix/Bugfix マスタープラン.md` を読む。
2. この実装シートを読む。
3. `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md`、`docs/Bugfix/17-A-9.md`、`docs/Bugfix/module-load-order.md` を読む。
4. 次を実行する。

```bash
git status --short
git log -1 --oneline
git status -sb
npm run lint
```

5. 作業開始前に以下を読む。

```text
modules/subtitle-block-state.js
content.js の setSubtitleBlocks()
content.js の renderCurrentSnapshot()
panel-ui.js
panel-renderer.js
```

6. 次の中から **1つだけ** を選び、小さく進める。

```text
WS-17A-1: subtitle block state update owner の移管
WS-17A-2: renderCurrentSnapshot() の薄化
WS-17A-3: panel owner / debug runtime / dispose 経路の統合
WS-17A-4: panel 周辺の残存関数の owner 確定
WS-17A-9: panel 関連ファイルの modules/ 統合
```

7. 変更後は `npm run lint` を実行する。
8. 対象に応じて panel 開閉、字幕表示、seek、SPA 遷移、ON→OFF→ON、debug panel を実機確認する。
9. 差分を確認し、変更単位に合うコミットメッセージで commit / push する。

***

## 実装上の注意

- `content.js` は起動配線、依存注入、状態遷移の orchestration に寄せる。panel DOM、debug UI、block 派生、長期 snapshot 保持を戻さない。
- subtitle block の正本を重複させない。`state.currentSubtitleBlock` を互換ミラーとして残す間は、正本を `subtitleBlockState` とし、更新方向を一方向に保つ。
- panel renderer は描画専用に寄せる。state 正本、listener lifecycle、recovery 判断を renderer に持たせない。
- `panelUi.dispose()` を cleanup の入口に寄せ、host、shadow root、listener、observer、timer、debug runtime、snapshot の残留を確認する。
- panel 関連ファイルの `modules/` 移動は、物理パス変更だけで終わらせない。manifest の読み込み順、global export、DI、tests / fixture、実機導線を確認する。
- 恒久的に無効な `if (false)` debug code は残さない。再利用するなら `DEBUG_...` の名前付き flag にし、再利用予定がなければ削除する。
- Step 17 と Step 18 は別の変更単位として扱う。panel owner 統合が終わる前に term inspector の大規模移動を混ぜない。
- docs には、実装済み、検証済み、残作業を分けて記録する。Step 17 は基盤整理済みでも、全体完了と早合点しない。
