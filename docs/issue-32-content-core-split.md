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
- Round 1 の section regroup が完了している
- Round 2 の runtime observers 実装本体の物理移送が完了している
- Round 3 の observer state カプセル化が完了している [page:1][page:2]

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

### 3.3 Round 2 / 3 後の現在地

Round 2 では、Section 6: Observer - Runtime Monitoring の実装詳細を `runtime-observers.js` に物理移送した。[page:1]  
これにより、observer callback / resize handler / orientation handler / waitForVideo / layout observer attach-detach の実装本体は `runtime-observers.js` 側を正本として読む構成になった。[page:1]

Round 3 では、Round 2 で module 側へ寄せた runtime observers 実装について、observer 内部だけで使う state を `content.js` から隠す cleanup を行った。[page:2]  
具体的には、`playbackControlsMutationObserver`、`playbackControlsResizeObserver`、`playbackControlsResizeTargets`、`playbackControlsResizeHandler`、`playbackControlsOrientationHandler`、`waitTimer` を `runtime-observers.js` 内の private state に寄せ、`content.js` 側 state から削除した。[page:1][page:2]

### 3.4 運用補足

Round 1 実装中、`boot();` を Section 7 直下へ移してしまったことで、`ensureMessageListener` の初期化前参照による `ReferenceError` が発生した。  
この修正により、Round 1 の section regroup では次の補足を採用する。

- **関数定義はセクション所属を優先して前方へ寄せてよい**
- ただし、**top-level wiring と即時実行 (`boot();` など) は依存順優先で後段に残す**

Round 2 / 3 でもこの補足は維持する。  
とくに `createRuntimeObservers(...)` や `boot();` のような wiring / 即時実行は、セクション所属より依存順を優先して配置する。[page:3]

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
- `content.js` 側では observer attach / detach / routing / wiring を読む
- `runtime-observers.js` 側では observer 実装詳細の正本を読む [page:1][page:2]

#### Section 7: Lifecycle - Boot & Teardown

- boot / restart / teardown
- message listener / roots / timer cleanup
- bindTracks / buildUi / initial snapshot / boot sequence の入口

### 4.3 Round 1 / 2 / 3 の読み方

Round 1 では、**セクションコメントは責務ラベル**として扱う。  
そのため、各セクションに必ず top-level wiring や即時実行が物理近接している必要はない。

Round 2 では、Section 6 の「実装本体を読む場所」が `content.js` から `runtime-observers.js` に移ったと読む。  
`content.js` 側の Section 6 は薄い入口として読み、observer callback / handler / helper の実装本体は module 側を正本とする。[page:1]

Round 3 では、Section 6 に関連する internal state のうち observer module の運転都合だけで存在するものを `runtime-observers.js` 内の private state へ寄せたと読む。  
その結果、`content.js` に残るのは共有意味を持つ state と top-level wiring であり、thin coordinator 化を一段進めた状態として読む。[page:2]

特に Section 6 / Section 7 では次を守る。

- 関数宣言はセクションへ寄せる
- `const ... = createX(...)` のような wiring は依存順優先
- `boot();` のような即時実行は wiring 後に置く
- Section 6 の実装詳細は Round 2 以降 `runtime-observers.js` を正本として読む

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
- module public API を top-level で束ねる wiring [page:3]

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
- observer module の内部 state [page:1][page:2]

### 5.3 現在の主要分割単位

現在、Issue #32 で明示的に扱う分割単位は次のとおり。

- `playbackContext`
- playback controls layout
- reinitialize / retry / result bridge
- secondary subtitle DOM 管理
- sync interval orchestration
- runtime observers
- initial cue recovery

このうち、`playbackContext` / playback controls layout / reinitialize coordinator / runtime observers は導入済みまたは分割実施済みの例として扱う。[page:1][page:2]  
残る主候補は、secondary subtitle DOM 管理、sync interval orchestration、initial cue recovery である。[page:3]

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

### 6.2 Round 2: runtime observers 物理移送（完了）

Round 2 では、Section 6 相当の observer 実装詳細を `runtime-observers.js` に寄せた。[page:1]  
このラウンドは **physical move-only** を原則とし、observer の意味・条件・挙動は変更しないまま、実装本体の置き場所だけを移した。[page:1]

Round 2 で扱った対象は次のとおり。

- MutationObserver callback 本体
- playback controls resize / orientation handler
- resize observer target refresh helper
- `waitForVideo` を含む observer / runtime monitor 実装詳細
- `startPlaybackControlLayoutObservers()` / `stopPlaybackControlLayoutObservers()` / `refreshPlaybackControlResizeObserverTargets()` の public API 成立
- `content.js` 側の observer attach / detach / routing / wiring の残置位置整理 [page:1]

Round 2 完了後の読み方は次のとおり。

- `runtime-observers.js` が observer 実装本体の正本である
- `content.js` 側は observer attach / detach / routing / top-level wiring の入口を持つ
- state private 化・rename・再設計は Round 3 へ送る [page:1]

### 6.3 Round 3: state カプセル化（完了）

Round 3 の目的は、observer 関連 state を module private に寄せて `content.js` の state を痩せさせることだった。[page:2]  
このラウンドでも observer の意味・条件・挙動は変えず、**state カプセル化だけ** に集中した。[page:2]

Round 3 で private 化した対象は次のとおり。

- `playbackControlsMutationObserver`
- `playbackControlsResizeObserver`
- `playbackControlsResizeTargets`
- `playbackControlsResizeHandler`
- `playbackControlsOrientationHandler`
- `waitTimer` [page:1][page:2]

Round 3 で据え置いた共有 state は次のとおり。

- `dialogEl`
- `panelVisible`
- `playbackControlsRafId` [page:2]

Round 3 の結果は次のとおり。

- `runtime-observers.js` に残る `state` 依存は `dialogEl` と `panelVisible` のみになった
- `content.js` から observer module の内部運転都合だけで存在する state がさらに減った
- `content.js` の行数は 3899 → 3894 → 3893 と減少した
- first cleanup はコミット `0db6472`、`waitTimer` private 化を含む完了差分はコミット `51046ce` で反映された [page:1][page:2]

---

## 7. 現在の次アクション

### 7.1 最優先候補

Round 2 / 3 が完了したため、次の着手候補としては次の順を推奨する。

1. sync interval orchestration
2. secondary subtitle DOM
3. initial cue recovery
4. observer deps 整理の継続 [page:3]

### 7.2 次ラウンドの着手順

次ラウンドでは、次の順で入るのが安全である。

1. 次に `content.js` から大きく減らせる責務塊を 1 つ決める
2. 対象セクションの helper / callback / orchestrator 本体を棚卸しする
3. `content.js` に残す入口と module 側へ移す実装本体を切り分ける
4. physical move-only で cut & paste する
5. import / export / wiring を最小限で成立させる
6. 構文確認と簡易実機確認を行う
7. docs に導入範囲と残課題を反映する [page:3]

### 7.3 Round 2 / 3 完了ライン

Round 2 / 3 完了時点で、次を「終わった」とみなす。

- `runtime-observers.js` が Section 6 実装詳細の正本として成立している
- `content.js` の Section 6 が observer attach / detach / routing / wiring の薄い入口として読める
- observer 内部専用 state が `runtime-observers.js` にカプセル化されている
- observer の意味・条件・挙動は Round 2 / 3 を通して変更していない
- `node --check` と軽い拡張更新確認でエラーが出ていない [page:1][page:2]

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

Round 2 / 3 の observer 分割でも、ログの見方自体は変えない。  
分割後も「どの trigger が起きたか」「どこで layout / reinitialize が呼ばれたか」を切り分けられる状態を保つ。[page:3]

### 8.2 実機確認観点

実機では、少なくとも次を確認する。

- 通常再生で panel / overlay が壊れない
- large seek 後に primary が復帰する
- secondary recovery / force-rebind が必要なときだけ走る
- panel 開閉や controls 再描画で layout が崩れない
- 再初期化後に二重 attach や二重 render が出ない
- user scroll と auto-follow が不自然に競合しない

Round 2 / 3 の確認では、加えて次を軽く見る。

- observer start / stop 後にエラーが出ない
- layout observer の attach / detach が二重化していない
- `waitForVideo` 経由の初期化待ちで例外が出ない [page:1][page:2]

### 8.3 Known Issue の切り分け

現時点では、次を拡張側ロジックの問題と即断しない。

- recovery / force-rebind は走っている
- track の再バインドも行われている
- それでも JA track の active cues が復帰しない

このケースは Apple TV+ 側挙動に依存する Known Issue として切り分ける。

observer 分割後も、この Known Issue の切り分け方は変わらない。  
Round 2 / 3 は observer の配置と state 保持場所を変えたラウンドであり、subtitle recovery 仕様そのものは変更していない。[page:1][page:2]

---

## 9. 注意

- この文書は Issue #32 の **実装運用正本** であり、subtitle sync 設計そのものの正本ではない
- truth / health / recovery / UI 境界の設計は `docs/content-architecture.md` を参照する
- セッション運用の一般ルールは `docs/ai-session-templates.md` を参照する
- Round 1 / Round 2 / Round 3 を混ぜない
- **区画整理 / 物理移送 / private 化** を常に別論点として扱う
- 行数削減は重要だが、より重要なのは責務が正しい場所へ移っていることである
- Round 2 は physical move-only、Round 3 は state カプセル化 only として扱い、挙動変更を混ぜない [page:1][page:2]