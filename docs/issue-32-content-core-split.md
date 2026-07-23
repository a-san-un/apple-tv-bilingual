# Issue #32 Content Core Split

## 1. この文書の役割

### 1.1 目的

この文書は、Issue #32 における `content.js` の責務整理と段階分割を、**実装運用の観点**で管理するための文書である。

主目的は次の 4 点である。

- subtitle sync / recovery 改善を、`content.js` への追記ではなく controller / resolver 側への責務移送として進める
- `content.js` を thin coordinator に近づけるため、分割対象とラウンド順を明確にする
- 各ラウンドで何を触るかを固定し、構造整理・物理移送・private 化を混ぜないようにする
- Round 1 の section regroup を基準面として確定し、Round 2 以降の physical split を安全に進められるようにする

### 1.2 扱うもの

この文書で扱うものは次のとおり。

- Issue #32 における `content.js` コア分割の目的
- 現在位置と進行中の主線
- `content.js` の 7 セクション設計
- 分割対象の優先順位
- ラウンド単位の作業スコープ
- 実装時に見るべきログと切り分け観点

### 1.3 扱わないもの

この文書では次を正本として扱わない。

- subtitle sync / recovery の truth / health / lane state の詳細設計
- panel / overlay / popup の UI 詳細仕様
- phase 全体の進捗一覧や他 issue を含めた親ロードマップ
- AI セッションテンプレ全文
- セッションごとの実況メモや一時ログ
- セッション運用の一般ルール（詳細は `docs/ai-session-templates.md` を参照）

### 1.4 他ドキュメントとの分担

文書の分担は次のように整理する。

- `docs/content-architecture.md`
  - content 層全体の設計正本
- `docs/issue-32-content-core-split.md`
  - Issue #32 の分割実装運用正本
- `docs/ai-session-templates.md`
  - AI セッション運用テンプレ
- `docs/README.md`
  - docs 全体の入口と参照案内
- `docs/archive/`
  - 過去ラウンドや完了済み調査ログの保管先

---

## 2. 背景

### 2.1 Issue #32 の主題

Issue #32 は、subtitle sync / recovery の改善そのものに加えて、`content.js` を巨大な実装本体の置き場から外し、controller / resolver / helper / layout module 側へ責務を段階的に移すための issue である。

そのため、この issue の主題は単なる不具合修正ではなく、次の 2 層を同時に持つ。

- subtitle sync / recovery の truth / runtime / UI 境界整理
- `content.js` のコア責務分割と thin coordinator 化

### 2.2 現在の問題群

現在の `content.js` 周辺には、次のような問題がある。

- subtitle sync / recovery の改善を `content.js` 側の追記で吸収しやすい
- large seek 後の secondary missing / recovery / force-rebind まわりの責務が追いにくい
- observer / bootstrap / retry / reinitialize が同じ後半領域に密集しやすい
- UI shell / DOM 管理 / layout bridge / recovery trigger が近接しており、修正時の影響範囲が読みにくい
- 実装ラウンドごとのスコープが曖昧だと、構造整理と仕様変更が混ざりやすい

### 2.3 今回の狙い

今回の狙いは、巨大ファイルを一気に割ることではない。  
あくまで **責務のまとまりごとに、小さなラウンドで安全に外へ出す** ことである。

---

## 3. 現在位置

### 3.1 すでに完了したこと

Issue #32 の流れの中で、すでに次の到達点がある。

- `SubtitleBlockSequence` を truth source として扱う方向が固まっている
- current / panel / overlay / history の境界整理方針が固まっている
- secondary recovery は runtime first / merged assists で扱う方針が固まっている
- `cue-controller.js` 側に lane state / recovery 判定を寄せる方向が固まっている
- `playbackContext.js` が最初の実ファイル分割単位として導入済みである
- `reinitialize-coordinator.js` が導入され、reinitialize / retry / settings-result bridge が 1 塊として `content.js` から外出し済みである
- playback controls layout は `playback-controls-layout.js` を正本とする構成へ整理済みである
- `content.js` 側に secondary recovery 判定結果と sync 実行結果を観測するログが入っている

### 3.2 Round 1 後の現在地

Round 1 では、`content.js` に対して **ordering-only の section regroup** を行った。  
これはロジック変更ではなく、7 セクションコメントの挿入と関数ブロックの物理並べ替えに限定した整理である。

Round 1 完了時点の前提は次のとおり。

- `content.js` を 7 セクションで読む構成を採用済み
- Section 1〜7 のコメントを `state` 定義後に挿入済み
- 関数ブロックは、正本 A の対応表に沿ってセクション単位に寄せ済み
- Section 7: Lifecycle 関数群（boot / restart / teardown / bind / initial snapshot）はコメント直下へ集約済み
- `createRuntimeObservers(...)` / `createSettingsRuntime(...)` / `createReinitializeCoordinator(...)` などの top-level wiring は、依存順優先で後段に残置済み
- Section 6: Observer は、Round 1 では **空セクションのまま許容**と判断済み

### 3.3 Round 1 で得た運用補足

Round 1 実装中、`boot();` を Section 7 直下へ移してしまったことで、`ensureMessageListener` の初期化前参照による `ReferenceError` が発生した。  
この修正により、Round 1 の section regroup では次の補足を採用する。

- **関数定義はセクション所属を優先して前方へ寄せてよい**
- ただし、**top-level wiring と即時実行 (`boot();` など) は依存順優先で後段に残す**

---

## 4. content.js セクション設計

### 4.1 セクション一覧

Round 1 の正本では、`content.js` を次の 7 セクションで読む。

1. Logger & Debug Bridge
2. Playback Context Bridge
3. UI: Secondary Subtitle DOM
4. Sync Interval: Periodic Orchestration
5. Layout: Playback Controls Adjustment
6. Observer: Runtime Monitoring
7. Lifecycle: Boot & Teardown

### 4.2 各セクションの役割

#### Section 1: Logger & Debug Bridge

- logger / debug panel への橋渡し
- contentKey 付き payload への正規化
- live debug panel 更新通知の入口

#### Section 2: Playback Context Bridge

- playback DOM / textTrack 状態から context を検出
- contentKey / history context の切替
- playback context の入口と content 切替 trigger

#### Section 3: UI - Secondary Subtitle DOM

- secondary subtitle element / panel host の確保
- secondary subtitle の描画入口
- UI shell / panel host / hidden layer の橋渡し

#### Section 4: Sync Interval - Periodic Orchestration

- sync interval ごとの playback context refresh
- large seek detection
- secondary recovery pass 起動
- runtime snapshot 採取と orchestration 順制御

#### Section 5: Layout - Playback Controls Adjustment

- playback controls の位置・幅・translate 調整
- layout retry / settling の配線
- layout apply / retry タイミングの coordinator

#### Section 6: Observer - Runtime Monitoring

- mutation / resize / raf observers の登録・解除
- runtime 変化に応じた trigger 配線
- video change / content key change の監視入口

#### Section 7: Lifecycle - Boot & Teardown

- boot / restart / teardown
- message listener / roots / timer cleanup
- bindTracks / buildUi / initial snapshot / boot sequence の入口

### 4.3 Round 1 の読み方

Round 1 では、**セクションコメントは責務ラベル**として扱う。  
そのため、各セクションに必ず top-level wiring や即時実行が物理近接している必要はない。

特に Section 6 / Section 7 では次を守る。

- 関数宣言はセクションへ寄せる
- `const ... = createX(...)` のような wiring は依存順優先
- `boot();` のような即時実行は wiring 後に置く
- Section 6 は Round 1 では空に近い状態でも許容する

---

## 5. 分割対象

### 5.1 content.js に残すもの

最終的に `content.js` に残すものは次の責務である。

- Apple TV+ 再生画面への attach / detach
- lifecycle 管理
- bootstrap / cleanup の入口
- observer / timer の起動と停止
- settings / storage / message bridge の配線
- controller / resolver / renderer の呼び出し配線
- large seek 検知のような薄い runtime fact の記録
- 観測ログの入口

### 5.2 content.js から外へ出すもの

段階的に外へ出す対象は次のとおり。

- subtitle sync / recovery の本体判定
- health 集約
- current / history / panel / overlay の truth 解決本体
- playback context / content key / history context の詳細実装
- reinitialize / retry / result bridge の内部処理
- secondary subtitle DOM の探索 / host 確保 / 描画導線
- sync interval の詳細 orchestration
- layout 計算や managed style の本体
- runtime missing / missCount / force-rebind / terminated の条件本体
- observer callback / resize handler / orientation handler の実装詳細

### 5.3 現在の主要分割単位

現在、Issue #32 で明示的に扱う分割単位は次のとおり。

- `playbackContext`
- playback controls layout
- reinitialize / retry / result bridge
- secondary subtitle DOM 管理
- sync interval orchestration
- runtime observers
- initial cue recovery

このうち、前二者と reinitialize coordinator は導入済みまたは先行整理済みの例として扱い、残りを次ラウンド候補とする。

---

## 6. 実装ラウンド

### 6.1 Round 1: section regroup（完了）

Round 1 の目的は、`content.js` を 7 セクションで読める物理配置へ揃えることだった。  
このラウンドでは **ordering-only** を徹底し、ロジック変更は行わない。

Round 1 で行ったことは次のとおり。

- 7 セクションコメントの挿入
- 関数ブロックのセクション単位並べ替え
- Section 4 / 5 / 7 の関数群集約
- Section 6 は空許容とする設計判断の明文化
- `boot();` は wiring 後へ残す運用ルールの確定

### 6.2 Round 2: runtime observers 物理移送

次の主線は、Section 6 相当の observer 実装詳細を `runtime-observers.js` に寄せるラウンドである。  
この段階では、state 完全 private 化までは行わず、**物理移送だけ**に集中する。

Round 2 で扱う対象は次のとおり。

- MutationObserver callback 本体
- playbackControlsResizeHandler
- playbackControlsOrientationHandler
- `start...Observers` / `stop...Observers` の public API 整理
- `waitForVideo` を含む observer / runtime monitor 実装詳細
- `content.js` 側の observer strategic routing の残置位置整理

Round 2 で `content.js` に残すものは次のとおり。

- `handleVideoChanged`
- `handleContentKeyChanged`
- `scheduleAdjustPlaybackControls`
- observer attach / detach の入口
- module 呼び出し配線
- 監視結果を見てどの coordinator を呼ぶかの判断入口

### 6.3 Round 3: state カプセル化

Round 3 の目的は、observer 関連 state を module private に寄せて `content.js` の state を痩せさせることである。

Round 3 で扱う対象は次のとおり。

- `state.playbackControlsMutationObserver`
- `state.playbackControlsResizeObserver`
- `state.playbackControlsResizeTargets`
- `state.playbackControlsRafId`
- `deps.state.xxx` 依存の段階削減
- create / start / stop API の整理

---

## 7. 現在の次アクション

### 7.1 最優先候補

次の着手候補としては、次の順を推奨する。

1. runtime observers
2. sync interval orchestration
3. secondary subtitle DOM
4. initial cue recovery

### 7.2 Round 2 の着手順

次ラウンドでは、次の順で入るのが安全である。

1. `content.js` 内で Section 6 相当の実体位置を再確認する
2. observer 関連 helper / callback / start-stop API を洗い出す
3. `runtime-observers.js` に寄せる実装本体を cut & paste 単位で確定する
4. `createRuntimeObservers(...)` の deps / bridge 形状を固定する
5. `content.js` 側には strategic routing と wiring だけを残す
6. 構文確認と実機初期化を確認する
7. docs に導入範囲と残課題を反映する

### 7.3 Round 1 完了ライン

Round 1 完了時点で、次を「終わった」とみなす。

- Section 1〜7 コメントの挿入
- Section 4 / 5 / 7 の関数群再配置
- Section 6 空許容の設計確認
- `boot();` の後段残置による TDZ 修正
- `content.js` を Round 2 の physical split を読める形へ整列

---

## 8. ログと検証

### 8.1 観測ポイント

Issue #32 の分割では、ログは次の切り分けに使う。

- recovery 判定が出たか
- trigger が実行されたか
- rebind が行われたか
- track が再取得されたか
- それでも active cues が戻らないか

この考え方は、recovery ロジック本体と Apple TV+ 側挙動を混同しないために重要である。

### 8.2 実機確認観点

実機では、少なくとも次を確認する。

- 通常再生で panel / overlay が壊れない
- large seek 後に primary が復帰する
- secondary recovery / force-rebind が必要なときだけ走る
- panel 開閉や controls 再描画で layout が崩れない
- 再初期化後に二重 attach や二重 render が出ない
- user scroll と auto-follow が不自然に競合しない

### 8.3 Known Issue の切り分け

現時点では、次を拡張側ロジックの問題と即断しない。

- recovery / force-rebind は走っている
- track の再バインドも行われている
- それでも JA track の active cues が復帰しない

このケースは Apple TV+ 側挙動に依存する Known Issue として切り分ける。

---

## 9. 注意

- この文書は Issue #32 の **実装運用正本** であり、subtitle sync 設計そのものの正本ではない
- truth / health / recovery / UI 境界の設計は `docs/content-architecture.md` を参照する
- セッション運用の一般ルールは `docs/ai-session-templates.md` を参照する
- Round 1 / Round 2 / Round 3 を混ぜない
- **区画整理 / 物理移送 / private 化** を常に別論点として扱う
- 行数削減は重要だが、より重要なのは責務が正しい場所へ移っていることである